/**
 * GCP-related runners
 *
 * @packageDocumentation
 */

import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { GaxiosOptions } from "gaxios";
import { File, Storage } from "@google-cloud/storage";

import type {
  EmptyGCPBucketsOnDestroyBlock,
  GcpDeploymentBlock,
  ActionName,
} from "../../config";
import { logErrorRed, logGreen, sortArrayByObjectKey } from "../../util";
import { Runner } from "../";

type gcpDeploymentData = Record<
  string,
  string | Record<string, number | string>
>;

/** Manage ARM deployment */
export class GCPDeployment extends Runner {
  block: GcpDeploymentBlock;

  /** Process IHLP command for an ARM Deployment */
  async action(actionName: ActionName): Promise<void> {
    logGreen("Starting GCP Deployment Manager runner");
    const auth = new GoogleAuth({
      scopes: "https://www.googleapis.com/auth/cloud-platform",
    });
    let client: OAuth2Client;
    // const client = await auth.getClient();
    try {
      client = (await auth.getClient()) as OAuth2Client;
    } catch (err) {
      logErrorRed("Error setting up GCP client (are you logged in?)");
      console.log(err.message);
      process.exit(1);
    }
    const projectId = this.block.options.projectId
      ? this.block.options.projectId
      : await auth.getProjectId();
    const baseUrl = `https://www.googleapis.com/deploymentmanager/v2/projects/${projectId}/global/deployments`;

    if (actionName == "destroy") {
      logGreen("Deleting GCP Deployment Manager Deployment...");
      const deleteOpts: GaxiosOptions = {
        url: baseUrl + "/" + this.block.options.name,
        method: "DELETE",
      };
      if (this.block.options.deletePolicy) {
        deleteOpts["params"] = {
          deletePolicy: this.block.options.deletePolicy,
        };
      }
      try {
        await client.request(deleteOpts);
      } catch (err) {
        if (err.code == 404) {
          logGreen("Deployment does not exist; nothing to do");
        } else {
          logErrorRed(
            "Error(s) encountered while attempting to delete deployment:",
          );
          console.log();
          console.log(err.errors);
          process.exit(1);
        }
      }
      await waitForDeletionToComplete(
        client,
        baseUrl + "/" + this.block.options.name,
      );
    } else if (actionName == "deploy") {
      let deploymentExists = true;
      let currentDeploymentData: gcpDeploymentData;
      let deploymentUpdateRequired = false;
      try {
        const currentDeployment = await client.request({
          url: baseUrl + "/" + this.block.options.name,
          method: "GET",
        });
        currentDeploymentData = currentDeployment.data as gcpDeploymentData;
        checkDeployDataForErrors(currentDeploymentData);
      } catch (err) {
        if (err.code == 404) {
          deploymentExists = false;
          currentDeploymentData = {};
        } else {
          logErrorRed(
            "Error(s) encountered while attempting to describe deployment:",
          );
          console.log();
          console.log(err.errors);
          process.exit(1);
        }
      }

      const deployBody = await this.generateDeploymentBody();
      let requestOpts: GaxiosOptions;

      if (deploymentExists) {
        deploymentUpdateRequired = await this.checkForChangedDeployment(
          client,
          currentDeploymentData,
          deployBody,
        );
        deployBody.fingerprint = currentDeploymentData.fingerprint;
        requestOpts = {
          url: baseUrl + `/${this.block.options.name}`,
          method: "PUT",
          body: JSON.stringify(deployBody),
        };
        if (
          this.block.options.createPolicy ||
          this.block.options.deletePolicy
        ) {
          requestOpts["params"] = {};
        }
        if (this.block.options.createPolicy) {
          requestOpts["params"]["createPolicy"] =
            this.block.options.createPolicy;
        }
        if (this.block.options.deletePolicy) {
          requestOpts["params"]["deletePolicy"] =
            this.block.options.deletePolicy;
        }
        if (deploymentUpdateRequired) {
          logGreen(`Updating deployment ${this.block.options.name}`);
        }
      } else {
        requestOpts = {
          url: baseUrl,
          method: "POST",
          body: JSON.stringify(deployBody),
        };
        if (this.block.options.createPolicy) {
          requestOpts["params"] = {
            createPolicy: this.block.options.createPolicy,
          };
        }
        logGreen(`Creating deployment ${this.block.options.name}`);
      }

      if (!deploymentExists || deploymentUpdateRequired) {
        let reqRes: Record<string, number | string>;
        try {
          reqRes = (await client.request(requestOpts)) as any as Record<
            string,
            number | string
          >;
        } catch (err) {
          logErrorRed(
            "Error(s) encountered while attempting to create deployment:",
          );
          console.log(err.errors);
          process.exit(1);
        }
        logGreen("Waiting for deployment to finish...");
        await new Promise((r) => setTimeout(r, 10000)); // sleep 10 sec
        await waitForCreateOrUpdate(client, reqRes.data["targetLink"]);
      }
    }
    logGreen("GCP Deployment runner complete");
  }

  /** Generate deployment resource
   * https://cloud.google.com/deployment-manager/docs/reference/latest/deployments#resource
   */
  async generateDeploymentBody(): Promise<Record<string, any>> {
    const deployBody = {
      name: this.block.options.name,
      target: {
        config: {
          content: this.block.options.config,
        },
      },
    };

    if (this.block.options.description) {
      deployBody["description"] = this.block.options.description;
    }
    if (this.block.options.imports) {
      deployBody.target["imports"] = [];
      for (const deployImport of this.block.options.imports) {
        deployBody.target["imports"].push({
          content: deployImport.content,
          name: deployImport.name,
        });
      }
      deployBody.target["imports"].sort(sortArrayByObjectKey("name"));
    }
    if (this.block.options.labels) {
      deployBody["labels"] = [];
      for (const [k, v] of Object.entries(this.block.options.labels)) {
        deployBody["labels"].push({ key: k, value: v });
      }
      deployBody["labels"].sort(sortArrayByObjectKey("key"));
    }

    return deployBody;
  }

  async checkForChangedDeployment(
    client: OAuth2Client,
    currentDeploymentData: gcpDeploymentData,
    proposedDeploymentBody: Record<string, any>,
  ): Promise<boolean> {
    if (
      (currentDeploymentData.labels || proposedDeploymentBody.labels) &&
      JSON.stringify(currentDeploymentData.labels) !=
        JSON.stringify(proposedDeploymentBody.labels)
    ) {
      logGreen("Deployment tags do not match; updating...");
      return true;
    }
    if (typeof currentDeploymentData.manifest != "string") {
      logGreen("Unable to determine existing deployment status; updating...");
      return true;
    }
    let currentManifestData: gcpDeploymentData;
    try {
      currentManifestData = (
        (await client.request({
          url: currentDeploymentData.manifest,
        })) as any
      ).data;
    } catch (err) {
      logGreen("Unable to retreive existing deployment manifest; updating...");
      return true;
    }
    if (
      (currentManifestData.config as Record<string, string>).content !=
      proposedDeploymentBody.target.config.content
    ) {
      logGreen("Deploy template has changed; updating...");
      return true;
    }
    if (
      (currentManifestData.imports || proposedDeploymentBody.target.imports) &&
      JSON.stringify(currentManifestData.imports) !=
        JSON.stringify(proposedDeploymentBody.target.imports)
    ) {
      logGreen("Deployment imports do not match; updating...");
      return true;
    }
    logGreen("No changes detected between current and proposed deployment");
    return false;
  }
}

async function waitForCreateOrUpdate(
  client: OAuth2Client,
  deployUrl: string,
): Promise<void> {
  let updateInProgress = true;
  while (updateInProgress) {
    try {
      const currentDeployment = await client.request({
        url: deployUrl,
        method: "GET",
      });
      checkDeployDataForErrors(currentDeployment.data as gcpDeploymentData);
      if (
        (currentDeployment.data as gcpDeploymentData)["operation"]["status"] ==
        "DONE"
      ) {
        updateInProgress = false;
      }
    } catch (err) {
      logErrorRed("ERROR:");
      console.log(err);
    }
    await new Promise((r) => setTimeout(r, 10000)); // sleep 10 sec
  }
}

async function waitForDeletionToComplete(
  client: OAuth2Client,
  deployUrl: string,
): Promise<void> {
  let deletionInProgress = true;
  while (deletionInProgress) {
    try {
      const currentDeployment = await client.request({
        url: deployUrl,
        method: "GET",
      });
      checkDeployDataForErrors(currentDeployment.data as gcpDeploymentData);
      await new Promise((r) => setTimeout(r, 10000)); // sleep 10 sec
    } catch (err) {
      if (err.code == 404) {
        deletionInProgress = false;
      } else {
        logErrorRed("ERROR:");
        console.log(err);
      }
    }
  }
}

/** Inspect response from GET on deployment and exit if errors are present */
function checkDeployDataForErrors(data: gcpDeploymentData): void {
  if (data["operation"]["error"]) {
    logErrorRed("Deployment has errored:");
    console.log(JSON.stringify(data["operation"]["error"], null, 2));
    process.exit(1);
  }
}

/** Helper runner for deleting storage buckets */
export class GCPEmptyBucketsOnDestroy extends Runner {
  block: EmptyGCPBucketsOnDestroyBlock;

  /** Process IHLP command for deleting buckets */
  async action(actionName: ActionName): Promise<void> {
    if (actionName == "destroy") {
      logGreen("Starting GCP bucket emptying runner");
      const storage = new Storage();

      let bucketNames: string[] = [];
      if (typeof this.block.options.bucketNames == "string") {
        bucketNames = this.block.options.bucketNames.split(",");
      } else {
        bucketNames = this.block.options.bucketNames;
      }

      for (const bucketName of bucketNames) {
        logGreen(`Deleting files in bucket ${bucketName}...`);
        const files: File[] = [];
        try {
          files.push(
            ...(
              await storage.bucket(bucketName).getFiles({
                versions: true,
              })
            )[0],
          );
        } catch (err) {
          if (err.code == 404) {
            logGreen("Bucket does not exist; nothing to do");
          } else {
            logErrorRed("Unable to get files in bucket");
            if ("errors" in err) {
              console.log(JSON.stringify(err.errors));
            } else if ("message" in err) {
              logErrorRed("(are you logged in?)");
              console.log(err.message);
            }
            process.exit(1);
          }
        }
        const deletionPromises: Promise<any>[] = [];
        files.forEach((file) => {
          deletionPromises.push(
            storage
              .bucket(bucketName)
              .file(file.name, {
                generation: file.generation,
              })
              .delete(),
          );
        });
        await Promise.all(deletionPromises);
      }
      logGreen("Bucket deletions complete");
    } else {
      logGreen("Skipping bucket deletions - only occurs during destroy action");
    }
  }
}

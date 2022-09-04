/**
 * Azure-related runners
 *
 * @packageDocumentation
 */

import * as promptSync from "prompt-sync";
import * as fs from "fs";
import { DefaultAzureCredential } from "@azure/identity";
import {
  Deployment,
  DeploymentExtended,
  DeploymentMode,
  DeploymentWhatIf,
  ResourceManagementClient,
  WhatIfChange,
  WhatIfOperationResult,
} from "@azure/arm-resources";

import type {
  ArmDeploymentBlock,
  ActionName,
  DeleteResourceGroupOnDestroyBlock,
} from "../../config";
import { logErrorRed, logGreen } from "../../util";
import { Runner } from "../";

const prompt = promptSync();

/** Check response from creation/updating deployment and exit the program if it contains errors */
function exitOnCreateOrUpdateError(response: DeploymentExtended): void {
  if (response.properties?.error) {
    logErrorRed("Error returned from Azure:");
    console.log(JSON.stringify(response.properties.error, null, 2));
    process.exit(1);
  }
}

/** Log caught error and exit */
function handleCaughtCreateOrUpdateError(
  error: Record<string, Record<string, string> | string>,
): void {
  logErrorRed("Error returned from Azure:");
  if (error.bodyAsText) {
    console.log();
    console.log(error.bodyAsText);
  } else if (error.body) {
    console.log(JSON.stringify(error.body, null, 2));
  } else {
    console.log(JSON.stringify(error, null, 2));
  }
  process.exit(1);
}

/** Check response from What-If and exit the program if it contains errors */
function exitOnWhatIfError(response: WhatIfOperationResult): void {
  if ("error" in response && response.error) {
    logErrorRed("Error returned from Azure:");
    console.log(JSON.stringify(response.error, null, 2));
    process.exit(1);
  }
}

/** Manage ARM deployment */
export class AzureArmDeployment extends Runner {
  block: ArmDeploymentBlock;

  /** Process IHLP command for an ARM Deployment */
  async action(actionName: ActionName): Promise<void> {
    logGreen("Starting Azure ARM Deployment runner");
    const armClient = loadArmClient(this.block.options.subscriptionId);

    if (actionName == "destroy") {
      logGreen("Deleting ARM Deployment...");
      if (this.block.options.deployTo) {
        await armClient.deployments.beginDeleteAndWait(
          this.block.options.deployTo.resourceGroupName,
          this.block.options.deploymentName,
        );
      } else {
        await armClient.deployments.beginDeleteAtSubscriptionScopeAndWait(
          this.block.options.deploymentName,
        );
      }
    } else if (actionName == "deploy") {
      if (this.options.autoApprove) {
        if (this.block.options.deployTo) {
          await this.createOrUpdateAtResourceGroupScope(armClient);
        } else {
          await this.createOrUpdateAtSubscriptionScope(armClient);
        }
      } else {
        logGreen(
          "Checking Azure for changes that will occur if deployment is created/updated...",
        );

        let whatIfRes: WhatIfOperationResult;
        if (this.block.options.deployTo) {
          whatIfRes = await armClient.deployments.beginWhatIfAndWait(
            this.block.options.deployTo.resourceGroupName,
            this.block.options.deploymentName,
            await this.getDeployParameters(),
          );
        } else {
          whatIfRes =
            await armClient.deployments.beginWhatIfAtSubscriptionScopeAndWait(
              this.block.options.deploymentName,
              await this.getDeployParameters(),
            );
        }
        exitOnWhatIfError(whatIfRes);
        const proposedChanges: WhatIfChange[] = [];
        if (whatIfRes.changes) {
          for (const proposedChange of whatIfRes.changes) {
            if (
              !["Ignore", "NoChange"].includes(
                proposedChange.changeType.toString(),
              )
            ) {
              proposedChanges.push(proposedChange);
            }
          }
        }

        if (proposedChanges.length) {
          logGreen("Proposed changes:");
          console.log();
          console.log(JSON.stringify(proposedChanges, null, 2));
          console.log();
          const promptResponse = prompt("Apply the changes? (y/n/[q]uit) ? ");

          if (["q", "quit", null].includes(promptResponse)) {
            console.log();
            logGreen("Exiting as requested; goodbye...");
            process.exit(0);
          } else if (promptResponse == "n") {
            console.log();
            logGreen("Skipping block...");
          } else if (["yes", "y"].includes(promptResponse)) {
            if (this.block.options.deployTo) {
              await this.createOrUpdateAtResourceGroupScope(armClient);
            } else {
              await this.createOrUpdateAtSubscriptionScope(armClient);
            }
            logGreen("Deployment creation/update complete");
          } else {
            console.log();
            logErrorRed('Please enter one of "y", "n", or "q"');
            process.exit(1);
          }
        } else {
          logGreen("No changes to be made to deployment");
        }
      }
    }
    logGreen("Azure ARM Deployment runner complete");
  }

  /** Create or update Deployment in resource group */
  async createOrUpdateAtResourceGroupScope(
    armClient: ResourceManagementClient,
  ): Promise<void> {
    if (!this.block.options.deployTo) {
      logErrorRed(
        "This should only be called with a specified Resource Group name",
      );
      process.exit(1);
    }
    logGreen(
      `Creating or updating ARM Deployment ${this.block.options.deploymentName} in Resource Group ${this.block.options.deployTo.resourceGroupName}...`,
    );
    try {
      const createOrUpdateRes =
        await armClient.deployments.beginCreateOrUpdateAndWait(
          this.block.options.deployTo.resourceGroupName,
          this.block.options.deploymentName,
          await this.getDeployParameters(),
        );
      exitOnCreateOrUpdateError(createOrUpdateRes);
    } catch (error) {
      handleCaughtCreateOrUpdateError(error);
    }
  }

  /** Create or update Deployment in subscription */
  async createOrUpdateAtSubscriptionScope(
    armClient: ResourceManagementClient,
  ): Promise<void> {
    logGreen(
      `Creating or updating ARM Deployment ${this.block.options.deploymentName}...`,
    );
    try {
      const createOrUpdateRes =
        await armClient.deployments.beginCreateOrUpdateAtSubscriptionScopeAndWait(
          this.block.options.deploymentName,
          await this.getDeployParameters(),
        );
      exitOnCreateOrUpdateError(createOrUpdateRes);
    } catch (error) {
      handleCaughtCreateOrUpdateError(error);
    }
  }

  /** Generate deployment parameters */
  async getDeployParameters(): Promise<DeploymentWhatIf | Deployment> {
    const params = {
      properties: {
        mode: "Complete" as DeploymentMode,
        template: JSON.parse(
          await fs.promises.readFile(this.block.options.templatePath, "utf8"),
        ),
      },
    };

    if (this.block.options.deploymentParameters) {
      params.properties["parameters"] = {};
      for (const param of Object.keys(
        this.block.options.deploymentParameters,
      )) {
        params.properties["parameters"][param] = {
          value: this.block.options.deploymentParameters[param],
        };
      }
    }

    if (!this.block.options.deployTo) {
      params["location"] = this.location;
      params.properties.mode = "Incremental";
    }
    return params;
  }
}

/** Helper runner for deleting Resource Groups */
export class AzureDeleteResourceGroupsOnDestroy extends Runner {
  block: DeleteResourceGroupOnDestroyBlock;

  /** Process IHLP command for deleting Resource Groups */
  async action(actionName: ActionName): Promise<void> {
    if (actionName == "destroy") {
      logGreen("Starting Azure Resource Group deletion runner");
      const armClient = loadArmClient(this.block.options.subscriptionId);

      let resourceGroupNames: string[] = [];
      if (typeof this.block.options.resourceGroups == "string") {
        resourceGroupNames = this.block.options.resourceGroups.split(",");
      } else {
        resourceGroupNames = this.block.options.resourceGroups;
      }

      for (const resourceGroupName of resourceGroupNames) {
        logGreen(`Deleting Resource Group ${resourceGroupName}...`);
        await armClient.resourceGroups.beginDeleteAndWait(resourceGroupName);
      }
      logGreen("Resource Group deletions complete");
    } else {
      logGreen(
        "Skipping Resource Group deletions - only occurs during destroy action",
      );
    }
  }
}

/** Load and return Azure Resource Manager client
 *
 * Terraform-compatible environment variables (e.g. ARM_CLIENT_ID)
 * are used automatically for convenience.
 */
export function loadArmClient(
  subscriptionId: string | undefined,
): ResourceManagementClient {
  for (const envVar of ["CLIENT_ID", "CLIENT_SECRET", "TENANT_ID"]) {
    if (process.env["ARM_" + envVar] && !process.env["AZURE_" + envVar]) {
      process.env["AZURE_" + envVar] = process.env["ARM_" + envVar];
    }
  }

  if (!subscriptionId && !process.env.ARM_SUBSCRIPTION_ID) {
    logErrorRed(
      "Unable to process ARM deployment: Missing Azure Subscription ID",
    );
    logErrorRed(
      "Provide it as a config file option or via the ARM_SUBSCRIPTION_ID environment variable",
    );
    process.exit(1);
  } else if (!subscriptionId) {
    subscriptionId = process.env.ARM_SUBSCRIPTION_ID as string;
  }

  return new ResourceManagementClient(
    new DefaultAzureCredential(),
    subscriptionId,
  );
}

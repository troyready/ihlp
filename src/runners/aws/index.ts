/**
 * AWS-related runners
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import {
  CloudFormationClient,
  CloudFormationClientConfig,
  CreateChangeSetCommandInput,
  CreateChangeSetCommand,
  DeleteChangeSetCommand,
  DeleteStackCommand,
  DescribeChangeSetCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
} from "@aws-sdk/client-cloudformation";
import {
  S3Client,
  S3ClientConfig,
  DeleteObjectCommand,
  DeleteObjectCommandOutput,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";

import type {
  CfnStackBlock,
  CfnStackOpts,
  ActionName,
  EmptyS3BucketsOnDestroyBlock,
} from "../../config";
import { assumeAWSRole, logErrorRed, logGreen } from "../../util";
import { Runner } from "../";

/** Manage AWS CloudFormation stacks */
export class AwsCfnStack extends Runner {
  block: CfnStackBlock;

  /** Process IHLP command for AWS CloudFormation stack */
  async action(actionName: ActionName): Promise<void> {
    const changeSetInput = await getChangeSetInput(this.block.options);
    const cfnClientConfig: CloudFormationClientConfig = {
      region: this.location,
    };
    if (this.block.options.assumeRoleArn) {
      cfnClientConfig.credentials = await assumeAWSRole(
        this.block.options.assumeRoleArn,
        this.block.options.assumeRoleSessionName
          ? this.block.options.assumeRoleSessionName
          : "ihlp",
        this.location,
        this.block.options.assumeRoleDuration,
      );
    }
    const cfnClient = new CloudFormationClient(cfnClientConfig);

    try {
      await cfnClient.send(
        new DescribeStacksCommand({ StackName: changeSetInput["StackName"] }),
      );

      // No error thrown during describe indicates an existing stack
      if (actionName == "deploy") {
        logGreen(
          `Updating CFN stack "${changeSetInput["StackName"]}" via ChangeSet`,
        );
      }
    } catch (error) {
      if (error.name == "ValidationError") {
        if (actionName == "deploy") {
          logGreen(
            `Creating new CFN stack "${changeSetInput["StackName"]}" via ChangeSet...`,
          );
        }
        changeSetInput["ChangeSetType"] = "CREATE";
      } else if (error.name == "CredentialsProviderError") {
        logErrorRed(
          "Credentials error occured when accessing AWS - please check credentials and try again",
        );
        process.exit(1);
      } else {
        throw error;
      }
    }
    if (actionName == "deploy") {
      if (this.options.verbose) {
        logGreen("Creating ChangeSet...");
      }
      const createChangeSetResponse = await cfnClient.send(
        new CreateChangeSetCommand(changeSetInput),
      );

      if (!createChangeSetResponse.Id) {
        logErrorRed(
          "CFN did not return expected result when creating ChangeSet",
        );
        process.exit(1);
      }

      const changeSetNeededAndReady = await waitForChangeSetCreateComplete(
        cfnClient,
        createChangeSetResponse.Id,
        this.options.verbose,
      );

      if (changeSetNeededAndReady) {
        if (this.options.verbose) {
          logGreen("Executing ChangeSet...");
        }
        await cfnClient.send(
          new ExecuteChangeSetCommand({
            ChangeSetName: createChangeSetResponse.Id,
            StackName: changeSetInput["StackName"],
          }),
        );

        await waitForStackCreateOrUpdateComplete(
          cfnClient,
          changeSetInput.StackName as string,
          this.options.verbose,
        );
      }
    } else if (actionName == "destroy") {
      if (changeSetInput["ChangeSetType"] == "CREATE") {
        console.log();
        logGreen("CFN stack has already been deleted");
        console.log();
      } else {
        logGreen("Destroying stack " + changeSetInput["StackName"]);
        await cfnClient.send(
          new DeleteStackCommand({ StackName: changeSetInput["StackName"] }),
        );
        logGreen("Waiting for stack deletion to complete");
        await waitForStackDeleteComplete(
          cfnClient,
          changeSetInput.StackName as string,
          this.options.verbose,
        );
      }
    }
  }
}

/** Generate CloudFormation ChangeSet API options */
async function getChangeSetInput(
  options: CfnStackOpts,
): Promise<CreateChangeSetCommandInput> {
  const changeSetInput = {
    Capabilities: [
      "CAPABILITY_AUTO_EXPAND",
      "CAPABILITY_IAM",
      "CAPABILITY_NAMED_IAM",
    ],
    ChangeSetName: options.stackName + uuidv4(),
    StackName: options.stackName,
    TemplateBody: await fs.promises.readFile(options.templatePath, "utf8"),
  };

  if (options.stackTags) {
    changeSetInput["Tags"] = [];
    for (const [key, value] of Object.entries(options.stackTags)) {
      changeSetInput["Tags"].push({ Key: key, Value: value });
    }
  }
  if (options.stackParameters) {
    changeSetInput["Parameters"] = [];
    for (const [key, value] of Object.entries(options.stackParameters)) {
      changeSetInput["Parameters"].push({
        ParameterKey: key,
        ParameterValue: value,
      });
    }
  }
  return changeSetInput;
}

// TODO: most of these wait functions should be replaced with the built-in SDK waiters
// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-cloudformation/index.html
// https://github.com/aws/aws-sdk-js-v3/issues/2169

/** Wait for CloudFormation ChangeSet creation to complete */
async function waitForChangeSetCreateComplete(
  cfnClient: CloudFormationClient,
  changeSetName: string,
  verbose = false,
): Promise<boolean> {
  const changeSetDone = false;
  do {
    if (verbose) {
      logGreen("Describing ChangeSet...");
    }
    const describeChangeSetResponse = await cfnClient.send(
      new DescribeChangeSetCommand({ ChangeSetName: changeSetName }),
    );
    if (describeChangeSetResponse.Status == "CREATE_COMPLETE") {
      return true;
    } else if (describeChangeSetResponse.Status == "FAILED") {
      if (
        describeChangeSetResponse.StatusReason?.includes(
          "didn't contain changes",
        )
      ) {
        logGreen("ChangeSet contains no updates");
        await cfnClient.send(
          new DeleteChangeSetCommand({ ChangeSetName: changeSetName }),
        );
        return false;
      } else {
        logErrorRed(
          `Stack ChangeSet errored: ${describeChangeSetResponse.StatusReason}`,
        );
        process.exit(1);
      }
    } else {
      if (verbose) {
        logGreen(
          "ChangeSet still creating; waiting 5 seconds before checking again...",
        );
      }
      await new Promise((r) => setTimeout(r, 5000)); // sleep 5 sec
    }
  } while (changeSetDone == false);
  return true;
}

/** Wait for CloudFormation Stack to finish updating or creating */
async function waitForStackCreateOrUpdateComplete(
  cfnClient: CloudFormationClient,
  stackName: string,
  verbose = false,
): Promise<void> {
  let stackDone = false;
  do {
    if (verbose) {
      logGreen("Describing stack...");
    }
    const describeStacksCommandResponse = await cfnClient.send(
      new DescribeStacksCommand({ StackName: stackName }),
    );
    if (!describeStacksCommandResponse.Stacks) {
      logErrorRed(
        `Stack ${stackName} creation/update errored; CFN did not return expected stack information when describing it`,
      );
      process.exit(1);
    } else if (!describeStacksCommandResponse.Stacks[0].StackStatus) {
      logErrorRed(
        `Stack ${stackName} creation/update errored; CFN did not return expected stack status when describing it`,
      );
      process.exit(1);
    } else if (
      ["CREATE_COMPLETE"].includes(
        describeStacksCommandResponse.Stacks[0].StackStatus,
      )
    ) {
      logGreen("Stack creation complete");
      stackDone = true;
    } else if (
      ["UPDATE_COMPLETE"].includes(
        describeStacksCommandResponse.Stacks[0].StackStatus,
      )
    ) {
      logGreen("Stack update complete");
      stackDone = true;
    } else if (
      [
        "ROLLBACK_COMPLETE",
        "ROLLBACK_FAILED",
        "ROLLBACK_IN_PROGRESS",
        "UPDATE_ROLLBACK_COMPLETE",
        "UPDATE_ROLLBACK_FAILED",
        "UPDATE_ROLLBACK_IN_PROGRESS",
      ].includes(describeStacksCommandResponse.Stacks[0].StackStatus)
    ) {
      logErrorRed(`Stack create/update failed and rolled back`);
      process.exit(1);
    } else if (
      ["CREATE_FAILED", "DELETE_FAILED", "UPDATE_FAILED"].includes(
        describeStacksCommandResponse.Stacks[0].StackStatus,
      )
    ) {
      logErrorRed(
        `Stack creation/update errored: ${describeStacksCommandResponse.Stacks[0].StackStatusReason}`,
      );
      process.exit(1);
    } else {
      if (verbose) {
        logGreen(
          "Stack still updating; waiting 10 seconds before checking again...",
        );
      }
      await new Promise((r) => setTimeout(r, 10000)); // sleep 10 sec
    }
  } while (stackDone == false);
}

/** Wait for CloudFormation Stack to finish deleting */
async function waitForStackDeleteComplete(
  cfnClient: CloudFormationClient,
  stackName: string,
  verbose = false,
): Promise<void> {
  let stackDone = false;
  do {
    if (verbose) {
      logGreen("Describing stack...");
    }
    try {
      const describeStacksCommandResponse = await cfnClient.send(
        new DescribeStacksCommand({ StackName: stackName }),
      );
      if (!describeStacksCommandResponse.Stacks) {
        logGreen("CFN does not have record of stack; deletion complete");
        stackDone = true;
      } else if (
        describeStacksCommandResponse.Stacks[0].StackStatus == "DELETE_COMPLETE"
      ) {
        logGreen("Stack deletion complete");
        stackDone = true;
      } else if (
        describeStacksCommandResponse.Stacks[0].StackStatus == "DELETE_FAILED"
      ) {
        logErrorRed(
          `Stack deletion errored: ${describeStacksCommandResponse.Stacks[0].StackStatusReason}`,
        );
        process.exit(1);
      } else {
        if (verbose) {
          logGreen(
            "Stack still deleting; waiting 10 seconds before checking again...",
          );
        }
        await new Promise((r) => setTimeout(r, 10000)); // sleep 10 sec
      }
    } catch (error) {
      if (error.name == "ValidationError") {
        logGreen("Stack deletion complete");
        stackDone = true;
      } else {
        throw error;
      }
    }
  } while (stackDone == false);
}

/** Delete each object version in S3 bucketName and add the deletion promise to deletionPromiseArray */
async function queueObjectVersionDeletions(
  s3Client: S3Client,
  bucketName: string,
  deletionPromiseArray: Promise<DeleteObjectCommandOutput>[],
  keyMarker: string | undefined = undefined,
  versionIdMarker: string | undefined = undefined,
) {
  const objectVersListRes = await s3Client.send(
    new ListObjectVersionsCommand({
      Bucket: bucketName,
      KeyMarker: keyMarker,
      VersionIdMarker: versionIdMarker,
    }),
  );
  if (objectVersListRes.Versions) {
    for (const version of objectVersListRes.Versions) {
      deletionPromiseArray.push(
        s3Client.send(
          new DeleteObjectCommand({
            Bucket: bucketName,
            Key: version.Key,
            VersionId: version.VersionId,
          }),
        ),
      );
    }
  }
  if (objectVersListRes.DeleteMarkers) {
    for (const marker of objectVersListRes.DeleteMarkers) {
      deletionPromiseArray.push(
        s3Client.send(
          new DeleteObjectCommand({
            Bucket: bucketName,
            Key: marker.Key,
            VersionId: marker.VersionId,
          }),
        ),
      );
    }
  }
  if (
    objectVersListRes.NextKeyMarker &&
    objectVersListRes.NextVersionIdMarker
  ) {
    await queueObjectVersionDeletions(
      s3Client,
      bucketName,
      deletionPromiseArray,
      objectVersListRes.NextKeyMarker,
      objectVersListRes.NextVersionIdMarker,
    );
  }
}

/** Helper runner for emptying AWS S3 buckets */
export class AwsEmptyS3BucketsOnDestroy extends Runner {
  block: EmptyS3BucketsOnDestroyBlock;

  /** Process IHLP command for emptying S3 bucket */
  async action(actionName: ActionName): Promise<void> {
    if (actionName == "destroy") {
      const s3ClientConfig: S3ClientConfig = {};
      if (process.env.IHLP_LOCATION) {
        s3ClientConfig["region"] = process.env.IHLP_LOCATION;
      }
      if (this.block.options.assumeRoleArn) {
        s3ClientConfig.credentials = await assumeAWSRole(
          this.block.options.assumeRoleArn,
          this.block.options.assumeRoleSessionName
            ? this.block.options.assumeRoleSessionName
            : "ihlp",
          this.location,
          this.block.options.assumeRoleDuration,
        );
      }
      const s3Client = new S3Client(s3ClientConfig);

      let bucketNames: string[] = [];
      if (typeof this.block.options.bucketNames == "string") {
        bucketNames = this.block.options.bucketNames.split(",");
      } else {
        bucketNames = this.block.options.bucketNames;
      }

      const objectDeletionPromises: Promise<DeleteObjectCommandOutput>[] = [];
      for (const bucketName of bucketNames) {
        try {
          await queueObjectVersionDeletions(
            s3Client,
            bucketName,
            objectDeletionPromises,
          );
        } catch (error) {
          if (error.name == "CredentialsProviderError") {
            logErrorRed(
              "Credentials error occured when accessing AWS - please check credentials and try again",
            );
            process.exit(1);
          } else {
            throw error;
          }
        }
      }
      await Promise.all(objectDeletionPromises);
      logGreen("Done emptying buckets");
    } else {
      logGreen(
        "Skipping S3 bucket emptying - only occurs during destroy action",
      );
    }
  }
}

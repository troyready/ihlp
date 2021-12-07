/**
 * IHLP config variables
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  SSMClient,
  SSMClientConfig,
  GetParameterCommand,
  GetParameterCommandInput,
} from "@aws-sdk/client-ssm";
import { GoogleAuth } from "google-auth-library";

import {
  gcpAppDefaultCredsPath,
  exitWithGCPNotLoggedInError,
} from "./runners/gcp/index";
import { logErrorRed, logGreen } from "./util";

// easiest to test w/ https://regex101.com/
const varRegexp = /(?<!\$)\${([-a-z]*)\s(.*)}/g;

/** Recursively process block config elements and replace any IHLP variables in it */
export async function processBlockVariables(
  config: Record<string, unknown> | Record<string, unknown>[] | string[],
  verboseLogging = false,
): Promise<Record<string, unknown>> {
  if (Array.isArray(config)) {
    for (let e of config) {
      if (typeof e == "string") {
        e = await replaceConfigVariables(e, verboseLogging);
      } else {
        e = await processBlockVariables(e, verboseLogging);
      }
    }
  } else {
    for (const objectKey of Object.keys(config)) {
      if (typeof config[objectKey] == "string") {
        config[objectKey] = await replaceConfigVariables(
          config[objectKey] as string,
          verboseLogging,
        );
      } else if (typeof config[objectKey] != "undefined") {
        config[objectKey] = await processBlockVariables(
          config[objectKey] as Record<string, unknown>,
          verboseLogging,
        );
      }
    }
  }
  return config as Record<string, unknown>;
}

/** Replace IHLP variables in string */
async function replaceConfigVariables(
  configItem: string,
  verboseLogging = false,
): Promise<string> {
  const match = varRegexp.exec(configItem);
  varRegexp.lastIndex = 0;

  if (match && match.length == 3) {
    let topVarArg = match[2];

    const submatch = varRegexp.exec(topVarArg);
    varRegexp.lastIndex = 0;

    if (submatch && submatch.length == 3) {
      topVarArg = await replaceConfigVariables(submatch[0], verboseLogging);
    }
    return configItem.replace(
      varRegexp,
      await resolveVar(match[1], topVarArg, verboseLogging),
    );
  }
  return configItem;
}

/** Resolve IHLP variable */
async function resolveVar(
  varType: string,
  varArg: string,
  verboseLogging = false,
): Promise<string> {
  switch (varType) {
    case "aws-cfn-output":
      {
        const opts = {};
        const cfnClientOpts = {};

        for (const opt of varArg.split(",")) {
          if (opt.startsWith("stack=")) {
            opts["stackName"] = opt.split("stack=")[1];
          } else if (opt.startsWith("output=")) {
            opts["outputName"] = opt.split("output=")[1];
          } else if (opt.startsWith("region=")) {
            cfnClientOpts["region"] = opt.split("region=")[1];
          }
        }

        if (!("region" in cfnClientOpts)) {
          cfnClientOpts["region"] = process.env["IHLP_LOCATION"];
        }

        try {
          const DescribeStacksResponse = await new CloudFormationClient(
            cfnClientOpts,
          ).send(new DescribeStacksCommand({ StackName: opts["stackName"] }));

          if (
            "Stacks" in DescribeStacksResponse &&
            DescribeStacksResponse.Stacks?.length == 1
          ) {
            if ("Outputs" in DescribeStacksResponse.Stacks[0]) {
              const matchingOutput =
                DescribeStacksResponse.Stacks[0].Outputs?.find(
                  (element) => element.OutputKey == opts["outputName"],
                );
              if (matchingOutput?.OutputValue) {
                return matchingOutput.OutputValue;
              } else {
                logErrorRed(
                  `Stack ${opts["stackName"]} does not have output ${opts["outputName"]}`,
                );
                process.exit(1);
              }
            } else {
              logErrorRed(`No outputs in stack ${opts["stackName"]}`);
              process.exit(1);
            }
          }
        } catch (err) {
          if (err.name == "CredentialsProviderError") {
            logErrorRed(
              "Credentials error occured when accessing AWS - please check credentials and try again",
            );
            process.exit(1);
          } else {
            throw err;
          }
        }
        logErrorRed(`Stack ${opts["stackName"]} not found`);
        process.exit(1);
      }
      break;
    case "aws-ssm-param":
      {
        const opts = {};
        const ssmClientOpts: SSMClientConfig = {};

        for (const opt of varArg.split(",")) {
          if (opt.startsWith("name=")) {
            opts["Name"] = opt.split("name=")[1];
          } else if (opt.startsWith("region=")) {
            ssmClientOpts["region"] = opt.split("region=")[1];
          }
        }

        if (!("region" in ssmClientOpts)) {
          ssmClientOpts["region"] = process.env["IHLP_LOCATION"];
        }

        try {
          if (verboseLogging) {
            logGreen(`Retreiving SSM parameter ${opts["Name"]}`);
          }
          const getParameterCommandResponse = await new SSMClient(
            ssmClientOpts,
          ).send(new GetParameterCommand(opts as GetParameterCommandInput));
          if (getParameterCommandResponse.Parameter?.Value) {
            if (verboseLogging) {
              logGreen(
                `SSM parameter ${opts["Name"]} value is ${getParameterCommandResponse.Parameter.Value}`,
              );
            }
            return getParameterCommandResponse.Parameter.Value;
          } else {
            logErrorRed(
              `Unable to determine SSM parameter ${opts["Name"]} value`,
            );
            process.exit(1);
          }
        } catch (err) {
          if (err.name == "ParameterNotFound") {
            logErrorRed("Error - requested variable SSM parameter not found");
            process.exit(1);
          } else if (err.name == "CredentialsProviderError") {
            logErrorRed(
              "Credentials error occured when accessing AWS - please check credentials and try again",
            );
            process.exit(1);
          } else {
            throw err;
          }
        }
      }
      break;
    case "env":
      {
        if (!(varArg in process.env)) {
          logErrorRed(`Environment variables do not contain "${varArg}"`);
          process.exit(1);
        }
        return process.env[varArg] as string;
      }
      break;
    case "gcp-metadata": {
      if (varArg == "project") {
        const auth = new GoogleAuth({
          scopes: "https://www.googleapis.com/auth/cloud-platform",
        });
        try {
          const projectId = await auth.getProjectId();
          return projectId;
        } catch (err) {
          if (err.message.includes("Unable to detect a Project Id")) {
            if (fs.existsSync(gcpAppDefaultCredsPath)) {
              const appDefaultCreds = JSON.parse(
                (await fs.promises.readFile(gcpAppDefaultCredsPath)).toString(),
              );
              if ("quota_project_id" in appDefaultCreds) {
                return appDefaultCreds.quota_project_id;
              }
            }
            logErrorRed(
              'No default GCP quota project specified (e.g. "gcloud auth application-default set-quota-project")',
            );
            console.log(err.message);
            process.exit(1);
          }
          exitWithGCPNotLoggedInError(err.message);
        }
      } else {
        logErrorRed(
          `gcp-metadata config variable currently only supports "project" argument`,
        );
        process.exit(1);
      }
    }
  }
  logErrorRed(`Invalid var type "${varType}" specified`);
  process.exit(1);
}

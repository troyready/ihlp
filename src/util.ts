/**
 * Utility package
 *
 * @packageDocumentation
 */

import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { Credentials } from "@aws-sdk/types";
import { create as createArchive } from "archiver";
import * as chalk from "chalk";
import * as crypto from "crypto";
import { https, FollowOptions } from "follow-redirects";
import * as fs from "fs";
import { RequestOptions } from "https";
import * as path from "path";
import { Readable } from "stream";
import { SecureContextOptions } from "tls";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { Command, Runner, runnerOpts } from "./runners";
import { AwsCfnStack, AwsEmptyS3BucketsOnDestroy } from "./runners/aws";
import {
  AzureArmDeployment,
  AzureDeleteResourceGroupsOnDestroy,
} from "./runners/azure";
import { GCPEmptyBucketsOnDestroy, GCPDeployment } from "./runners/gcp";
import { EsbuildFunctions } from "./runners/esbuild";
import { GoFunctions } from "./runners/functionbuilder_go";
import { Serverless } from "./runners/serverless";
import { SyncToRemoteStorage } from "./runners/synctoremotestorage";
import { Terraform } from "./runners/terraform";
import type { Block, IHLPConfig } from "./config";

/** Assume AWS IAM Role */
export async function assumeAWSRole(
  roleArn: string,
  roleSessionName: string,
  region = "us-east-1",
  durationSeconds = 3600,
): Promise<Credentials> {
  const stsClient = new STSClient({ region: region });
  const assumeRoleOutput = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: roleSessionName,
      DurationSeconds: durationSeconds,
    }),
  );
  return {
    accessKeyId: assumeRoleOutput.Credentials?.AccessKeyId
      ? assumeRoleOutput.Credentials?.AccessKeyId
      : "",
    secretAccessKey: assumeRoleOutput.Credentials?.SecretAccessKey
      ? assumeRoleOutput.Credentials?.SecretAccessKey
      : "",
    sessionToken: assumeRoleOutput.Credentials?.SessionToken,
  };
}

/** Download S3 object to local file */
export async function downloadS3ObjectToFile(
  s3Client: S3Client,
  bucketName: string,
  objectKey: string,
  destinationFile: string,
): Promise<void> {
  const getRes = await s3Client.send(
    new GetObjectCommand({ Bucket: bucketName, Key: objectKey }),
  );
  if (getRes.Body) {
    await new Promise((resolve, reject) => {
      (getRes.Body as Readable)
        .pipe(fs.createWriteStream(destinationFile))
        .on("error", (err) => reject(err))
        .on("close", () => resolve(null));
    });
  } else {
    logErrorRed(`Error downloading ${objectKey}; no content present`);
    process.exit(1);
  }
}

/** Instantiate and return appropriate class for block type */
export function getBlockRunner(
  block: Block,
  location: string,
  options: runnerOpts,
): Runner {
  switch (block.type) {
    case "aws-cfn-stack": {
      return new AwsCfnStack(block, location, options);
    }
    case "aws-empty-s3-buckets-on-destroy": {
      return new AwsEmptyS3BucketsOnDestroy(block, location, options);
    }
    case "azure-arm-deployment": {
      return new AzureArmDeployment(block, location, options);
    }
    case "azure-delete-resource-groups-on-destroy": {
      return new AzureDeleteResourceGroupsOnDestroy(block, location, options);
    }
    case "command": {
      return new Command(block, location, options);
    }
    case "esbuild-functions": {
      return new EsbuildFunctions(block, location, options);
    }
    case "functionbuilder-go": {
      return new GoFunctions(block, location, options);
    }
    case "gcp-empty-buckets-on-destroy": {
      return new GCPEmptyBucketsOnDestroy(block, location, options);
    }
    case "gcp-deployment": {
      return new GCPDeployment(block, location, options);
    }
    case "serverless-framework": {
      return new Serverless(block, location, options);
    }
    case "sync-to-remote-storage": {
      return new SyncToRemoteStorage(block, location, options);
    }
    case "terraform": {
      return new Terraform(block, location, options);
    }
  }
  logErrorRed(`Invalid block type "${block.type}"specified`);
  process.exit(1);
}

/** Get crypto hash of file */
export async function getFileHash(
  filename: string,
  algo: string,
  encoding: crypto.BinaryToTextEncoding = "hex",
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const input = fs.createReadStream(filename);
    input.on("readable", () => {
      const data = input.read();
      if (data) {
        hash.update(data);
      } else {
        return resolve(hash.digest(encoding));
      }
    });
  });
}

/** Make HTTPS request */
export async function httpsRequest(
  options:
    | string
    | (
        | RequestOptions
        | (SecureContextOptions & {
            rejectUnauthorized?: boolean | undefined;
            servername?: string | undefined;
          } & FollowOptions<RequestOptions>)
      ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postData: any = undefined,
): Promise<string> {
  return new Promise(function (resolve, reject) {
    const req = https.request(options, function (res) {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error("Bad HTTP status code: " + res.statusCode));
      }
      const bodyParts: Uint8Array[] = [];
      let body: string;
      res.on("data", function (chunk) {
        bodyParts.push(chunk);
      });
      res.on("end", function () {
        try {
          body = Buffer.concat(bodyParts).toString();
        } catch (e) {
          reject(e);
        }
        resolve(body);
      });
    });
    req.on("error", function (err) {
      reject(err);
    });
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/** Download to local file */
export async function httpsGetToFile(
  options:
    | string
    | (
        | RequestOptions
        | (SecureContextOptions & {
            rejectUnauthorized?: boolean | undefined;
            servername?: string | undefined;
          } & FollowOptions<RequestOptions>)
      ),
  filePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(filePath, { flags: "wx" });

    const request = https.get(options, (response) => {
      if (response.statusCode === 200) {
        response.pipe(writeStream);
      } else {
        writeStream.close();
        fs.unlink(filePath, () => {}); // eslint-disable-line @typescript-eslint/no-empty-function
        reject(
          `Instead of 200, code ${response.statusCode} (${response.statusMessage})`,
        );
      }
    });

    request.on("error", (err) => {
      writeStream.close();
      fs.unlink(filePath, () => {}); // eslint-disable-line @typescript-eslint/no-empty-function
      reject(err.message);
    });

    writeStream.on("finish", () => {
      resolve();
    });

    writeStream.on("error", (err) => {
      writeStream.close();

      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        reject("File already exists");
      } else {
        fs.unlink(filePath, () => {}); // eslint-disable-line @typescript-eslint/no-empty-function
        reject(err.message);
      }
    });
  });
}

/** Load IHLP config from file */
export async function loadConfig(): Promise<IHLPConfig> {
  const ihlpConfigPath = path.join(process.cwd(), "ihlp.ts");
  if (!pathExists(ihlpConfigPath)) {
    logErrorRed(`No ${path.basename(ihlpConfigPath)} config file found`);
    process.exit(1);
  }
  require("ts-node/register");
  try {
    return require(ihlpConfigPath);
  } catch (err) {
    logErrorRed("Unable to load config file:");
    console.error(err);
    process.exit(1);
  }
}

/** Make a copy of environment variables and add any provided values to it */
export function mergeObjIntoEnv(
  overrideEnvVars: undefined | Record<string, string>,
): NodeJS.ProcessEnv {
  const envVars = Object.assign({}, process.env);

  if (overrideEnvVars) {
    for (const key of Object.keys(overrideEnvVars)) {
      envVars[key] = overrideEnvVars[key];
    }
  }
  return envVars;
}

/** Generate a list of strings matching the length of choices */
export function generateValidChoiceSelections(
  choices: Record<string, unknown>[],
): string[] {
  return Array.from({ length: choices.length + 1 }, (_x, i) =>
    i.toString(),
  ).slice(1);
}

/** Log initial command banner */
export function logBanner(): void {
  console.log();
  console.log(
    "__/\\\\\\\\\\\\\\\\\\\\\\________/\\\\\\________/\\\\\\________/\\\\\\____________________/\\\\\\\\\\\\\\\\\\\\\\\\\\______        ",
  );
  console.log(
    " _\\/////\\\\\\///________\\/\\\\\\_______\\/\\\\\\_______\\/\\\\\\___________________\\/\\\\\\/////////\\\\\\____       ",
  );
  console.log(
    "  _____\\/\\\\\\___________\\/\\\\\\_______\\/\\\\\\_______\\/\\\\\\___________________\\/\\\\\\_______\\/\\\\\\____      ",
  );
  console.log(
    "   _____\\/\\\\\\___________\\/\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\_______\\/\\\\\\___________________\\/\\\\\\\\\\\\\\\\\\\\\\\\\\/_____     ",
  );
  console.log(
    "    _____\\/\\\\\\___________\\/\\\\\\/////////\\\\\\_______\\/\\\\\\___________________\\/\\\\\\/////////_______    ",
  );
  console.log(
    "     _____\\/\\\\\\___________\\/\\\\\\_______\\/\\\\\\_______\\/\\\\\\___________________\\/\\\\\\________________   ",
  );
  console.log(
    "      _____\\/\\\\\\___________\\/\\\\\\_______\\/\\\\\\_______\\/\\\\\\___________________\\/\\\\\\________________  ",
  );
  console.log(
    "       __/\\\\\\\\\\\\\\\\\\\\\\__/\\\\\\_\\/\\\\\\_______\\/\\\\\\__/\\\\\\_\\/\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\__/\\\\\\_\\/\\\\\\___________/\\\\\\_ ",
  );
  console.log(
    "        _\\///////////__\\///__\\///________\\///__\\///__\\///////////////__\\///__\\///___________\\///__",
  );
  console.log();
}

/** Log provided message in green with program prefix */
export function logGreen(message: string): void {
  console.log(chalk.blue("IHLP> ") + chalk.green(message));
}

/** Log provided message as an error in red with program prefix */
export function logErrorRed(message: string): void {
  console.error(chalk.blue("IHLP> ") + chalk.red("ERROR: " + message));
}

/** Log provided message as an warning in yellow with program prefix */
export function logWarningYellow(message: string): void {
  console.error(chalk.blue("IHLP> ") + chalk.yellow("WARNING: " + message));
}

/** Return true if provided path exists */
export async function pathExists(filepath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filepath);
  } catch (error) {
    if (error.code == "ENOENT") {
      return false;
    } else {
      throw error;
    }
  }
  return true;
}

/** Sort function for arrays of objects */
export function sortArrayByObjectKey(
  key: string,
): (a: Record<string, any>, b: Record<string, any>) => 1 | -1 | 0 {
  return (a: Record<string, any>, b: Record<string, any>) => {
    if (a[key] < b[key]) {
      return -1;
    }
    if (a[key] > b[key]) {
      return 1;
    }

    // names must be equal
    return 0;
  };
}

/** Zip directory (contents have timestamps zeroed out for idempotent builds) */
export async function zipDirectory(
  zippath: string,
  dirpath: string,
): Promise<void> {
  const archive = createArchive("zip");
  const output = fs.createWriteStream(zippath);
  archive.pipe(output);
  archive.directory(dirpath, "", { date: new Date(0) });
  await archive.finalize();
  return new Promise((resolve, reject) => {
    archive.on("error", function (err) {
      reject(err);
    });
    output.on("close", function () {
      resolve();
    });
  });
}

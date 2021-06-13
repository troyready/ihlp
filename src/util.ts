/**
 * Utility package
 *
 * @packageDocumentation
 */

import * as chalk from "chalk";
import * as crypto from "crypto";
import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { Readable } from "stream";
import { Repository } from "nodegit";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { Command, Runner, runnerOpts } from "./runners";
import { AwsCfnStack, AwsEmptyS3BucketsOnDestroy } from "./runners/aws";
import {
  AzureArmDeployment,
  AzureDeleteResourceGroupsOnDestroy,
} from "./runners/azure";
import { EsbuildFunctions } from "./runners/esbuild";
import { Serverless } from "./runners/serverless";
import { SyncToRemoteStorage } from "./runners/synctoremotestorage";
import { Terraform } from "./runners/terraform";
import type { Block, IHLPConfig } from "./config";

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
  params: https.RequestOptions | string | URL,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postData: any = undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  return new Promise(function (resolve, reject) {
    const req = https.request(params, function (res) {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error("Bad HTTP status code: " + res.statusCode));
      }
      let body: Uint8Array[] = [];
      res.on("data", function (chunk) {
        body.push(chunk);
      });
      res.on("end", function () {
        try {
          body = JSON.parse(Buffer.concat(body).toString());
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
  url: string,
  filePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(filePath, { flags: "wx" });

    const request = https.get(url, (response) => {
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

/** Determine operating environment from git repo */
export async function getEnvFromRepo(): Promise<string> {
  let branchName: string;
  try {
    branchName = await Repository.open(process.cwd())
      .then(function (repo) {
        return repo.getCurrentBranch();
      })
      .then(function (branch) {
        return branch.name();
      });
  } catch (err) {
    logErrorRed(
      "No environment provided & an error was encountered determining it from the git branch",
    );
    process.exit(1);
  }
  if (branchName.startsWith("refs/heads/")) {
    branchName = branchName.replace(/^(refs\/heads\/)/, "");
  }
  if (["main", "master"].includes(branchName)) {
    logGreen(
      `Automatically setting environment name to prod based on git branch name ${branchName}`,
    );
    branchName = "prod";
  }
  if (branchName.startsWith("ENV-")) {
    branchName = branchName.replace(/^(ENV-)/, "");
    logGreen(
      `Automatically setting environment name to ${branchName} based on git branch name ENV-${branchName}`,
    );
  }
  return branchName;
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

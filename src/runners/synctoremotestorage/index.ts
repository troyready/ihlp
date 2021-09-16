/**
 * Sync to remote storage Runner
 *
 * @packageDocumentation
 */

import {
  CloudFrontClient,
  CloudFrontClientConfig,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import {
  S3Client,
  S3ClientConfig,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  SSMClient,
  SSMClientConfig,
  DeleteParameterCommand,
  GetParameterCommand,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";
import * as fs from "fs";
import * as mime from "mime-types";
import * as path from "path";
import { compare as dircompare } from "dir-compare";
import * as S3SyncClient from "s3-sync-client";
import * as tmp from "tmp-promise";
import { hashElement } from "folder-hash";
import { spawnSync } from "child_process";
import { Runner } from "../";
import {
  downloadS3ObjectToFile,
  extractZipToPath,
  logErrorRed,
  logGreen,
  mergeObjIntoEnv,
} from "../../util";
import type {
  BuildOpts,
  ActionName,
  SyncToRemoteStorageBlock,
} from "../../config";
import * as util from "util";
// https://github.com/bitgenics/deterministic-zip/pull/14
// import * as zip from 'deterministic-zip';
import { zip } from "../../vendored/deterministic-zip";

const zipPromise = util.promisify(zip);

/** Sync local directory to remote object storage */
export class SyncToRemoteStorage extends Runner {
  block: SyncToRemoteStorageBlock;

  /** Execute (pre or regular) build commands */
  async runBuilds(
    buildOpts: BuildOpts | BuildOpts[] | undefined,
  ): Promise<void> {
    if (buildOpts) {
      if (Array.isArray(buildOpts)) {
        for (const build of buildOpts) {
          await this.runBuilds(build);
        }
      } else {
        logGreen(`Running build command "${buildOpts.command.join(" ")}"`);
        const exitCode = spawnSync(
          buildOpts.command[0],
          [...buildOpts.command].slice(1),
          {
            cwd: buildOpts.cwd
              ? path.join(this.block.path, buildOpts.cwd)
              : this.block.path,
            env: mergeObjIntoEnv(buildOpts.envVars),
            stdio: "inherit",
          },
        ).status;
        if (exitCode != 0) {
          process.exit(exitCode ? exitCode : 1);
        }
      }
    }
  }

  /** Download AWS S3 object and extract it to a temporary directory */
  async extractS3ObjectToTmpDir(
    s3Client: S3Client,
    bucketName: string,
    objectKey: string,
  ): Promise<string> {
    const dlDir = await tmp.dir({ unsafeCleanup: true });
    const tmpFilePath = path.join(
      dlDir.path,
      objectKey.includes("/") ? objectKey.split("/").slice(-1)[0] : objectKey,
    );
    await downloadS3ObjectToFile(s3Client, bucketName, objectKey, tmpFilePath);
    const tmpDir = await tmp.dir({ unsafeCleanup: true });
    await extractZipToPath(fs.createReadStream(tmpFilePath), tmpDir.path);
    return tmpDir.path;
  }

  /** Create zip file of directory and copy it to AWS S3 */
  async backupDirToS3(
    s3Client: S3Client,
    bucketName: string,
    objectKey: string,
    dirPath: string,
  ): Promise<void> {
    const zipDir = await tmp.dir({ unsafeCleanup: true });
    const localZipFile = path.join(zipDir.path, "cachedbuild.zip");
    await zipPromise(dirPath, localZipFile, {
      cwd: dirPath,
    });
    logGreen(
      `Backing up new bucket archive to s3://${bucketName}/${objectKey}`,
    );
    await s3Client.send(
      new PutObjectCommand({
        Body: fs.createReadStream(localZipFile),
        Bucket: bucketName,
        Key: objectKey,
      }),
    );
  }

  /** Compare directory against a zip archive (stored as an AWS S3 object) and return list of files which should be invalidated in the CDN cache */
  async getFilesToInvalidateAgainstS3Archive(
    s3Client: S3Client,
    bucketName: string,
    objectKey: string,
    newFilesPath: string,
  ): Promise<string[]> {
    let oldFilesPath = "";
    const diffFiles: string[] = [];
    try {
      await s3Client.send(
        new HeadObjectCommand({ Bucket: bucketName, Key: objectKey }),
      );
      oldFilesPath = await this.extractS3ObjectToTmpDir(
        s3Client,
        bucketName,
        objectKey,
      );
      const dirDiff = await dircompare(oldFilesPath, newFilesPath, {
        compareContent: true,
      });
      for (const diffEntry of dirDiff.diffSet ? dirDiff.diffSet : []) {
        // "distinct" are files that exist in both directories but not identical
        if (diffEntry.state == "distinct" && diffEntry.name2) {
          diffFiles.push(path.join(diffEntry.relativePath, diffEntry.name2));
        }
      }
    } catch (err) {
      if (err.name === "NotFound") {
        if (this.options["verbose"]) {
          logGreen(`Did not find previously cached build ${objectKey}`);
        }
        return ["/*"];
      } else {
        throw err;
      }
    }
    return diffFiles;
  }

  /** If an AWS CloudFront distribution ID is provided, invalidate file paths in it as required */
  async invalidateCf(
    cfClientConfig: CloudFrontClientConfig,
    s3Client: S3Client,
    currentBuildDir: string,
    previouslyDeployedHash: string | undefined,
  ): Promise<void> {
    if (this.block.options.postSync?.cfInvalidation) {
      const cfClient = new CloudFrontClient(cfClientConfig);
      let pathsToInvalidate: string[] = ["/*"];
      if (previouslyDeployedHash && this.block.options.archiveCache) {
        pathsToInvalidate = await this.getFilesToInvalidateAgainstS3Archive(
          s3Client,
          this.block.options.archiveCache.s3Bucket,
          this.block.options.archiveCache.s3Prefix +
            previouslyDeployedHash +
            ".zip",
          currentBuildDir,
        );
      }
      if (pathsToInvalidate) {
        logGreen(
          `Invalidating CloudFront distribution ${this.block.options.postSync.cfInvalidation.distributionID}'s paths:`,
        );
        console.log(pathsToInvalidate);
        console.log();
        await cfClient.send(
          new CreateInvalidationCommand({
            DistributionId:
              this.block.options.postSync.cfInvalidation.distributionID,
            InvalidationBatch: {
              CallerReference: new Date().toISOString(),
              Paths: {
                Items: pathsToInvalidate,
                Quantity: pathsToInvalidate.length,
              },
            },
          }),
        );
      } else {
        logGreen(
          `No paths found to invalidate for CloudFront distribution ${this.block.options.postSync.cfInvalidation.distributionID}`,
        );
      }
    }
  }

  /** Sync local directory with AWS S3 Bucket */
  async syncToS3(
    s3ClientConfig: S3ClientConfig,
    localPath: string,
    bucketName: string,
  ): Promise<void> {
    const s3SyncClient = new S3SyncClient(s3ClientConfig);
    const s3SyncClientOpts = {
      commandInput: {
        ContentType: (syncCommandInput) =>
          mime.lookup(syncCommandInput.Key) || "text/html",
      },
    };
    if (this.block.options.deleteExtraObjects) {
      s3SyncClientOpts["del"] = true;
    }
    try {
      await s3SyncClient.bucketWithLocal(
        localPath,
        bucketName,
        s3SyncClientOpts,
      );
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
  }

  /** Process IHLP command for AWS CloudFormation stack */
  async action(actionName: ActionName): Promise<void> {
    const cfClientConfig: CloudFrontClientConfig = {};
    const s3ClientConfig: S3ClientConfig = {};
    const ssmClientConfig: SSMClientConfig = {};
    for (const element of [cfClientConfig, s3ClientConfig, ssmClientConfig]) {
      if (process.env.IHLP_LOCATION) {
        element["region"] = process.env.IHLP_LOCATION;
      }
    }

    let deployedHash: string | undefined = "";
    let ssmClient: SSMClient | undefined;
    let srcHash = "";

    if (actionName == "deploy") {
      const s3Client = new S3Client(s3ClientConfig);

      await this.runBuilds(this.block.options.preBuild);

      if (
        this.block.options.deployedStateTracking?.ssmParam ||
        this.block.options.archiveCache
      ) {
        // Always force hash to be hex encoded in lieu of base64
        // as it avoids forward slashes (awkward on object storage)
        let sourceHashOpts = this.block.options.sourceHashOpts;
        if (sourceHashOpts) {
          sourceHashOpts.encoding = "hex";
        } else {
          sourceHashOpts = { encoding: "hex" };
        }

        srcHash = (await hashElement(this.block.path, sourceHashOpts)).hash;
        if (this.options["verbose"]) {
          logGreen(`Path source hash is ${srcHash}`);
        }
        if (this.block.options.deployedStateTracking?.ssmParam) {
          ssmClient = new SSMClient(ssmClientConfig);
          try {
            deployedHash = (
              await ssmClient.send(
                new GetParameterCommand({
                  Name: this.block.options.deployedStateTracking.ssmParam,
                }),
              )
            ).Parameter?.Value;
            if (srcHash == deployedHash) {
              logGreen(
                `No syncing to be done; current source hash "${srcHash}" natches last deployed version`,
              );
              return;
            } else {
              logGreen(
                `Current source hash "${srcHash}" does not match last deployed version`,
              );
            }
          } catch (err) {
            if (err.name == "ParameterNotFound") {
              if (this.options["verbose"]) {
                logGreen(
                  `No previous record of bucket status found. Proceeding to sync contents to it.`,
                );
              }
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
      }

      let builtSiteDir = "";
      if (srcHash && this.block.options.archiveCache) {
        const currentBuildObjectKey =
          this.block.options.archiveCache.s3Prefix + srcHash + ".zip";
        try {
          if (this.options["verbose"]) {
            logGreen(
              `Checking for previously cached site archive in object ${currentBuildObjectKey}`,
            );
          }
          await s3Client.send(
            new HeadObjectCommand({
              Bucket: this.block.options.archiveCache.s3Bucket,
              Key: currentBuildObjectKey,
            }),
          );
          logGreen("Previously created bucket archive found; downloading it");
          builtSiteDir = await this.extractS3ObjectToTmpDir(
            s3Client,
            this.block.options.archiveCache.s3Bucket,
            currentBuildObjectKey,
          );
          logGreen("Syncing previously cached bucket archive back to bucket");
        } catch (err) {
          if (err.name === "NotFound") {
            if (this.options["verbose"]) {
              logGreen(
                `Previously cached site archive in object ${currentBuildObjectKey} not found`,
              );
            }
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

      if (!builtSiteDir) {
        logGreen("Running any applicable builds prior to bucket sync");
        await this.runBuilds(this.block.options.build);
        builtSiteDir = this.block.options.outDir
          ? path.join(this.block.path, this.block.options.outDir)
          : this.block.path;
        if (srcHash && this.block.options.archiveCache) {
          await this.backupDirToS3(
            s3Client,
            this.block.options.archiveCache.s3Bucket,
            this.block.options.archiveCache.s3Prefix + srcHash + ".zip",
            builtSiteDir,
          );
        }
        logGreen("Syncing local directory contents with bucket");
      }

      if (this.block.options.destination.s3Bucket) {
        await this.syncToS3(
          this.block.options.destination.region
            ? { region: this.block.options.destination.region }
            : process.env.IHLP_LOCATION
            ? { region: process.env.IHLP_LOCATION }
            : {},
          builtSiteDir,
          this.block.options.destination.s3Bucket,
        );
        logGreen("Sync complete");
      }
      await this.invalidateCf(
        cfClientConfig,
        s3Client,
        builtSiteDir,
        deployedHash,
      );
      if (this.block.options.deployedStateTracking?.ssmParam) {
        await (ssmClient as SSMClient).send(
          new PutParameterCommand({
            Name: this.block.options.deployedStateTracking.ssmParam,
            Overwrite: true,
            Type: "String",
            Value: srcHash,
          }),
        );
      }
    } else {
      if (this.block.options.deployedStateTracking?.ssmParam) {
        logGreen(
          `Deleting S3 bucket sync hash tracking parameter "${this.block.options.deployedStateTracking.ssmParam}"`,
        );
        try {
          await (ssmClient as SSMClient).send(
            new DeleteParameterCommand({
              Name: this.block.options.deployedStateTracking.ssmParam,
            }),
          );
          logGreen(
            `S3 bucket sync hash tracking parameter "${this.block.options.deployedStateTracking.ssmParam}" deleted`,
          );
        } catch (err) {
          if (err.name == "ParameterNotFound") {
            logGreen(
              `Nothing to do - S3 bucket sync hash tracking parameter "${this.block.options.deployedStateTracking.ssmParam}" does not exist`,
            );
          } else if (err.name == "CredentialsProviderError") {
            logErrorRed(
              "Credentials error occured when accessing AWS - please check credentials and try again",
            );
            process.exit(1);
          } else {
            throw err;
          }
        }
      } else {
        logGreen("Skipping S3 bucket sync - nothing to do on destroy");
      }
    }
  }
}

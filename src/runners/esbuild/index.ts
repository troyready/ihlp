/**
 * ESBuild runner
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as path from "path";
import { hashElement } from "folder-hash";
import * as md5File from "md5-file";
import {
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { spawnSync } from "child_process";

import type { EsbuildFunctionsBlock, ActionName } from "../../config";
import {
  downloadS3ObjectToFile,
  logGreen,
  logWarningYellow,
  mergeObjIntoEnv,
  pathExists,
  zipDirectory,
} from "../../util";
import { Runner } from "../";

/** Build functions using esbuild and (optionally) cache them */
export class EsbuildFunctions extends Runner {
  block: EsbuildFunctionsBlock;

  /** Process IHLP command for building functions using esbuild */
  async action(actionName: ActionName): Promise<void> {
    if (actionName != "deploy") {
      logGreen("Skipping esbuild -- only used during deploys");
      return;
    }

    const functionDirs: string[] = [];
    for await (const dirent of await fs.promises.opendir(
      this.block.options?.srcDir
        ? path.join(this.block.path, this.block.options.srcDir)
        : this.block.path,
    )) {
      if (dirent.isDirectory()) {
        functionDirs.push(dirent.name);
      }
    }

    if (functionDirs.length == 0) {
      logWarningYellow("no function directories found to build");
      return;
    }

    let npmCIRun =
      path.resolve(this.block.path) != path.resolve(process.cwd())
        ? false
        : true;

    let s3Client: S3Client | undefined;
    const s3ClientConfig: S3ClientConfig = {};
    if (this.block.options?.archiveCache) {
      if (process.env.IHLP_LOCATION) {
        s3ClientConfig["region"] = process.env.IHLP_LOCATION;
      }
      s3Client = new S3Client(s3ClientConfig);
    }

    for (const dirName of functionDirs) {
      const outFilePath = path.join(
        this.block.options?.outDir
          ? path.join(this.block.path, this.block.options.outDir)
          : this.block.path,
        dirName + ".zip",
      );
      let s3Key = "";
      if (this.block.options?.archiveCache) {
        // Always force hash to be hex encoded in lieu of base64
        // as it avoids forward slashes (awkward on object storage)
        let sourceHashOpts = this.block.options.sourceHashOpts;
        if (sourceHashOpts) {
          sourceHashOpts.encoding = "hex";
        } else {
          sourceHashOpts = {
            encoding: "hex",
            folders: { exclude: [".git", "node_modules"] },
          };
        }
        const srcHash = (
          await hashElement(
            path.join(
              this.block.options.srcDir
                ? path.join(this.block.path, this.block.options.srcDir)
                : this.block.path,
              dirName,
            ),
            sourceHashOpts,
          )
        ).hash;
        if (this.options.verbose) {
          logGreen(
            `Source files for ${dirName} have generated hash ${srcHash}`,
          );
        }

        const cachedBuildFilename = `${dirName}-${srcHash}.zip`;
        s3Key = this.block.options.archiveCache.s3Prefix + cachedBuildFilename;

        try {
          const headRes = await (s3Client as S3Client).send(
            new HeadObjectCommand({
              Bucket: this.block.options.archiveCache.s3Bucket,
              Key: s3Key,
            }),
          );

          if (await pathExists(outFilePath)) {
            const outFileMd5 = await md5File(outFilePath);
            if (headRes.ETag == `"${outFileMd5}"`) {
              logGreen(
                `Skipping build or download of ${outFilePath} - build is already in place with a matching hash`,
              );
              continue;
            } else {
              logGreen(
                `Existing local build ${path.basename(
                  outFilePath,
                )}'s hash ${outFileMd5} does not match cached hash ${
                  headRes.ETag
                } - replacing it with cached version`,
              );
            }
          } else {
            logGreen(
              `Local build ${path.basename(
                outFilePath,
              )} is not present; replacing it with cached version`,
            );
          }

          if (!(await pathExists(path.dirname(outFilePath)))) {
            await fs.promises.mkdir(path.dirname(outFilePath));
          }
          await downloadS3ObjectToFile(
            s3Client as S3Client,
            this.block.options.archiveCache.s3Bucket,
            s3Key,
            outFilePath,
          );
          continue;
        } catch (err) {
          if (err.name === "NotFound") {
            if (this.options.verbose) {
              logGreen(`Did not find previously cached build ${s3Key}`);
            }
          } else {
            throw err;
          }
        }
      }

      if (!npmCIRun) {
        logGreen("Running npm ci to prep for build(s)");
        const exitCode = spawnSync("npm", ["ci"], {
          cwd: this.block.path,
          env: mergeObjIntoEnv(this.block.options?.envVars),
          stdio: "inherit",
        }).status;
        if (exitCode != 0) {
          process.exit(exitCode ? exitCode : 1);
        }
        npmCIRun = true;
      }

      let entryPoint: string;
      if (!this.block.options?.entryPoint) {
        if (
          await pathExists(
            this.block.options?.srcDir
              ? path.join(
                  this.block.path,
                  this.block.options.srcDir,
                  dirName,
                  "handler.mts",
                )
              : path.join(this.block.path, dirName, "handler.mts"),
          )
        ) {
          entryPoint = "handler.mts";
        } else {
          entryPoint = "handler.ts";
        }
      } else {
        entryPoint = this.block.options.entryPoint;
      }

      const fullyQualifiedZipfilename = await this.buildAndZip(
        dirName,
        this.block.options?.sourcesContent
          ? this.block.options.sourcesContent
          : false,
        this.block.options?.srcDir,
        this.block.options?.outDir,
        this.block.options?.target,
        this.block.options?.format,
        this.block.options?.externals,
        this.block.options?.outExtensions,
        entryPoint,
      );
      if (this.block.options?.archiveCache?.s3Bucket) {
        logGreen(
          `Backing up new build to s3://${this.block.options.archiveCache.s3Bucket}/${s3Key}`,
        );
        await (s3Client as S3Client).send(
          new PutObjectCommand({
            Body: fs.createReadStream(fullyQualifiedZipfilename),
            Bucket: this.block.options.archiveCache.s3Bucket,
            Key: s3Key,
          }),
        );
      }
    }
  }

  /** Run esbuild and create zip file of generated directory */
  async buildAndZip(
    dirName: string,
    sourcesContent: boolean,
    baseSrcDir: string | undefined,
    baseOutDir: string | undefined,
    target: string | undefined,
    format: string | undefined,
    externals: string[] | undefined,
    outExtensions: string[] | undefined,
    entryPoint = "handler.ts",
  ): Promise<string> {
    const outputDir = baseOutDir ? path.join(baseOutDir, dirName) : dirName;

    const npxCommandArgs = [
      "esbuild",
      baseSrcDir
        ? path.join(baseSrcDir, dirName, entryPoint)
        : path.join(dirName, entryPoint),
      "--bundle",
      "--outdir=" + outputDir,
      "--minify",
      "--sourcemap",
      `--sources-content=${sourcesContent}`,
    ];

    if (target) {
      npxCommandArgs.push("--target=" + target);
      if (target.startsWith("node")) {
        npxCommandArgs.push("--platform=node");
      }
    }

    if (format) {
      npxCommandArgs.push("--format=" + format);
    }

    if (externals) {
      for (const ext of externals) {
        npxCommandArgs.push("--external:" + ext);
      }
    }

    if (outExtensions) {
      for (const ext of outExtensions) {
        npxCommandArgs.push("--out-extension:" + ext);
      }
    }

    const exitCode = spawnSync("npx", npxCommandArgs, {
      cwd: this.block.path,
      env: mergeObjIntoEnv(this.block.options?.envVars),
      stdio: "inherit",
    }).status;
    if (exitCode != 0) {
      process.exit(exitCode ? exitCode : 1);
    }
    // Terraform can create archive file but likely would not be deterministic
    // https://github.com/hashicorp/terraform-provider-archive/issues/34
    const fullyQualifiedApiDirectory = path.join(this.block.path, outputDir);
    const fullyQualifiedZipfilename = fullyQualifiedApiDirectory + ".zip";
    await zipDirectory(fullyQualifiedZipfilename, fullyQualifiedApiDirectory);
    return fullyQualifiedZipfilename;
  }
}

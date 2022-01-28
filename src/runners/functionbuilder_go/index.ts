/**
 * Function builder for Go runner
 *
 * @packageDocumentation
 */

import * as envPaths from "env-paths";
import * as fs from "fs";
import * as path from "path";
import { hashElement } from "folder-hash";
import * as md5File from "md5-file";
import * as tar from "tar";
import {
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { spawnSync } from "child_process";

import type { FunctionBuilderGoBlock, ActionName } from "../../config";
import {
  downloadS3ObjectToFile,
  httpsGetToFile,
  logErrorRed,
  logGreen,
  logWarningYellow,
  mergeObjIntoEnv,
  pathExists,
  zipDirectory,
} from "../../util";
import { Runner } from "../";

/** Build golang functions and (optionally) cache them */
export class GoFunctions extends Runner {
  block: FunctionBuilderGoBlock;

  /** Process IHLP command for building golang functions */
  async action(actionName: ActionName): Promise<void> {
    if (actionName != "deploy") {
      logGreen("Skipping function build -- only used during deploys");
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

    let s3Client: S3Client | undefined;
    const s3ClientConfig: S3ClientConfig = {};
    if (this.block.options?.archiveCache) {
      if (process.env.IHLP_LOCATION) {
        s3ClientConfig["region"] = process.env.IHLP_LOCATION;
      }
      s3Client = new S3Client(s3ClientConfig);
    }

    let goBinary: string;
    if (this.block.options?.version) {
      goBinary = await getGo(this.block.options.version);
    } else {
      goBinary = "go";
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
            folders: { exclude: [".git", "bootstrap"] },
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

      const fullyQualifiedZipfilename = await this.buildAndZip(
        dirName,
        goBinary,
        this.block.options?.srcDir,
        this.block.options?.outDir,
        this.block.options?.buildTags,
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

  /** Run build and create zip file of generated directory */
  async buildAndZip(
    dirName: string,
    goBinary: string,
    baseSrcDir: string | undefined,
    baseOutDir: string | undefined,
    buildTags: string | undefined,
  ): Promise<string> {
    const functionDir = baseSrcDir
      ? path.join(this.block.path, baseSrcDir, dirName)
      : path.join(this.block.path, dirName);
    const outputDir = baseOutDir ? path.join(baseOutDir, dirName) : dirName;
    let exitCode: number | null;

    exitCode = spawnSync(goBinary, ["mod", "download"], {
      cwd: functionDir,
      env: mergeObjIntoEnv(this.block.options?.envVars),
      stdio: "inherit",
    }).status;
    if (exitCode != 0) {
      logErrorRed(`Error downloading modules for function ${dirName}`);
      process.exit(exitCode ? exitCode : 1);
    }

    const commandArgs = ["build", "-trimpath", "-o", "bootstrap"];

    if (buildTags) {
      commandArgs.push("-tags=" + buildTags);
    }

    exitCode = spawnSync(goBinary, commandArgs, {
      cwd: functionDir,
      env: mergeObjIntoEnv(this.block.options?.envVars),
      stdio: "inherit",
    }).status;
    if (exitCode != 0) {
      logErrorRed(`Error building function ${dirName}`);
      process.exit(exitCode ? exitCode : 1);
    }

    const fullyQualifiedApiDirectory = path.join(this.block.path, outputDir);

    if (!fs.existsSync(fullyQualifiedApiDirectory)) {
      if (
        baseOutDir &&
        !fs.existsSync(path.join(this.block.path, baseOutDir))
      ) {
        await fs.promises.mkdir(path.join(this.block.path, baseOutDir));
      }
      await fs.promises.mkdir(fullyQualifiedApiDirectory);
    }

    await fs.promises.rename(
      path.join(functionDir, "bootstrap"),
      path.join(fullyQualifiedApiDirectory, "bootstrap"),
    );

    const fullyQualifiedZipfilename = fullyQualifiedApiDirectory + ".zip";
    await zipDirectory(fullyQualifiedZipfilename, fullyQualifiedApiDirectory);
    return fullyQualifiedZipfilename;
  }
}

//** Download and cache Go */
async function getGo(version: string): Promise<string> {
  const paths = envPaths("ihlp", { suffix: "" });
  const arch = process.arch == "x64" ? "amd64" : process.arch;

  if (!fs.existsSync(paths.cache)) {
    await fs.promises.mkdir(paths.cache);
  }

  const goPath = path.join(
    paths.cache,
    `go-${process.platform}-${arch}-${version}`,
  );

  if (!fs.existsSync(path.join(goPath, "bin", "go"))) {
    const goArchiveFilename = `go${version}.${process.platform}-${arch}.tar.gz`;
    const downloadedZipPath = path.join(paths.cache, goArchiveFilename);

    logGreen(`Downloading Go version ${version} ...`);
    await httpsGetToFile(
      "https://dl.google.com/go/" + goArchiveFilename,
      downloadedZipPath,
    );

    if (!fs.existsSync(goPath)) {
      await fs.promises.mkdir(goPath);
    }

    await new Promise((resolve, reject) => {
      fs.createReadStream(downloadedZipPath)
        .pipe(
          tar.x({
            strip: 1,
            C: goPath,
          }),
        )
        .on("finish", resolve)
        .on("error", reject);
    });

    await fs.promises.unlink(downloadedZipPath);
  }
  return path.join(goPath, "bin", "go");
}

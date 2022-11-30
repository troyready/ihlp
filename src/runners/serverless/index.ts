/**
 * Serverless runner
 *
 * @packageDocumentation
 */

import * as path from "path";
import { spawnSync } from "child_process";

import type { ServerlessBlock, ActionName } from "../../config";
import { assumeAWSRole, logErrorRed, logGreen, pathExists } from "../../util";
import { getNpmBinaryName, getNpxBinaryName } from "../util";
import { Runner } from "../";

/** Deploy infrastructure using Serverless Framework */
export class Serverless extends Runner {
  block: ServerlessBlock;

  /** Process IHLP command for Serverless */
  async action(actionName: ActionName): Promise<void> {
    logGreen("Starting Serverless Runner");

    if (!pathExists(path.join(this.block.path, "package-lock.json"))) {
      logErrorRed(
        "Unable to process Serverless block. package.json & package-lock.json files must be present, with 'serverless` listed as a devDependency in it.",
      );
      logErrorRed(
        "i.e. switch to the serverless project directory and execute 'npm i -D serverless'",
      );
      process.exit(1);
    }

    const origWorkingDir = process.cwd();
    try {
      process.chdir(this.block.path);
      const npmBinary = await getNpmBinaryName();

      const env: NodeJS.ProcessEnv = { ...process.env };
      if (this.block.options?.assumeRoleArn) {
        const assumeRoleCreds = await assumeAWSRole(
          this.block.options.assumeRoleArn,
          this.block.options.assumeRoleSessionName
            ? this.block.options.assumeRoleSessionName
            : "ihlp",
          this.location,
          this.block.options.assumeRoleDuration,
        );
        env["AWS_ACCESS_KEY_ID"] = assumeRoleCreds.accessKeyId;
        env["AWS_SECRET_ACCESS_KEY"] = assumeRoleCreds.secretAccessKey;
        env["AWS_SESSION_TOKEN"] = assumeRoleCreds.sessionToken;
      }

      logGreen("Running 'npm ci'");
      let exitCode = spawnSync(npmBinary, ["ci"], {
        env: env,
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        process.exit(exitCode ? exitCode : 1);
      }

      const npxBinary = await getNpxBinaryName();

      const slsCommand = [
        npxBinary,
        "serverless",
        actionName == "destroy" ? "remove" : "deploy",
        "-s",
        this.options.environment,
        "-r",
        this.location,
      ];
      logGreen(
        `Performing Serverless ${actionName} by executing "${slsCommand.join(
          " ",
        )}"`,
      );
      exitCode = spawnSync(slsCommand[0], [...slsCommand].slice(1), {
        env: env,
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        process.exit(exitCode ? exitCode : 1);
      }

      logGreen("Serverless Runner complete!");
    } catch (err) {
      if ("dest" in err && err.code == "ENOENT") {
        logErrorRed("Unable to switch to directory: " + this.block.path);
        process.exit(1);
      } else {
        throw err;
      }
    } finally {
      process.chdir(origWorkingDir);
    }
  }
}

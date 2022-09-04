/**
 * Terraform runner
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

// Drop external rimraf package once min node version is 12.10
// https://stackoverflow.com/a/57866165
import * as rimraf from "rimraf";

import * as hcl from "hcl2-parser";
import * as which from "which";

import type { TerraformBlock, ActionName } from "../../config";
import { logErrorRed, logGreen, pathExists } from "../../util";
import { Runner } from "../";
import { TFEnv } from "./tfenv";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Converts javascript object to string for deployment via environment variable
 *  https://www.terraform.io/docs/cli/config/environment-variables.html#tf_var_name
 */
function convertVarObjToMapString(variable: Record<string, any>): string {
  /* eslint-enable @typescript-eslint/no-explicit-any */
  let stringifiedMap = "{";
  for (const key of Object.keys(variable)) {
    stringifiedMap += ` ${key} = "${variable[key]}",`;
  }
  stringifiedMap += " }";
  return stringifiedMap;
}

interface TFSetupResult {
  tfVersionDir: boolean | string;
  tfFullPath: string;
}

/** Deploy infrastructure using Terraform */
export class Terraform extends Runner {
  block: TerraformBlock;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  /** Add any provided Terraform variables to environment variables with TF_VAR_ prefix */
  addTfVarsToEnv(tfVars: Record<string, any> | undefined): NodeJS.ProcessEnv {
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const envVars = Object.assign({}, process.env);

    if (tfVars) {
      for (const key of Object.keys(tfVars)) {
        if (typeof tfVars[key] == "string") {
          envVars[`TF_VAR_${key}`] = tfVars[key];
        } else if (Array.isArray(tfVars[key])) {
          envVars[`TF_VAR_${key}`] = `[${tfVars[key].join(",")}]`;
        } else {
          // map
          envVars[`TF_VAR_${key}`] = convertVarObjToMapString(tfVars[key]);
        }
      }
    }
    return envVars;
  }

  /** Check Terraform files for a defined TF Cloud block*/
  async checkForTfCloud(): Promise<boolean> {
    const dirContents = await fs.promises.readdir(process.cwd());
    for (const dirEntry of dirContents) {
      if (dirEntry.endsWith(".tf")) {
        try {
          const tfFileContents = (
            await fs.promises.readFile(dirEntry)
          ).toString("utf-8");
          const parsedTfFile = JSON.parse(hcl.parseToString(tfFileContents)[0]);
          if ("terraform" in parsedTfFile) {
            if ("cloud" in parsedTfFile["terraform"][0]) {
              return true;
            }
          }
        } catch (err) {
          if (this.options.verbose) {
            logGreen(
              "Error encountered while checking Terraform file for terraform.cloud block:",
            );
            console.log(JSON.stringify(err));
          }
        }
      }
    }
    return false;
  }

  /** Perform all Terraform setup commands */
  async tfSetup(): Promise<TFSetupResult> {
    let tfVersionDir: boolean | string = false;
    let exitCode: number | null;
    let terraformBinary =
      process.platform === "win32" ? "terraform.exe" : "terraform";
    if (
      this.block.options.terraformVersion ||
      (await pathExists(path.join(process.cwd(), ".terraform-version")))
    ) {
      const tfEnvInstallRes = await new TFEnv().install(
        this.block.options.terraformVersion,
      );
      tfVersionDir = tfEnvInstallRes.directory;
      terraformBinary = tfEnvInstallRes.fullPath;
    } else {
      try {
        await which(terraformBinary);
      } catch (err) {
        logErrorRed("Terraform executable not found");
        process.exit(1);
      }
    }

    const useTfCloud = await this.checkForTfCloud();

    await this.tfInit(
      terraformBinary,
      this.addTfVarsToEnv(this.block.options.variables),
      useTfCloud,
      this.block.options.backendConfig,
    );

    if (this.block.options.workspace) {
      if (this.options.verbose) {
        logGreen("Checking current Terraform workspace");
      }
      const currentWorkspace = spawnSync(terraformBinary, ["workspace", "show"])
        .stdout.toString()
        .trim();
      if (this.options.verbose) {
        logGreen(`Current Terraform workspace is ${currentWorkspace}`);
      }
      if (currentWorkspace != this.block.options.workspace) {
        if (this.options.verbose) {
          logGreen("Listing available Terraform workspaces");
        }
        const existingtWorkspaces = spawnSync(terraformBinary, [
          "workspace",
          "list",
        ])
          .stdout.toString()
          .trim();
        if (
          existingtWorkspaces.match(
            new RegExp(`\\s*${this.block.options.workspace}$`, "m"),
          )
        ) {
          if (this.options.verbose) {
            logGreen(
              `Desired Terraform workspace ${this.block.options.workspace} has already been created; selecting it`,
            );
          }
          exitCode = spawnSync(
            terraformBinary,
            ["workspace", "select", this.block.options.workspace],
            { stdio: "inherit" },
          ).status;
          if (exitCode != 0) {
            process.exit(exitCode ? exitCode : 1);
          }
        } else {
          logGreen(
            `Creating Terraform workspace ${this.block.options.workspace}`,
          );
          exitCode = spawnSync(
            terraformBinary,
            ["workspace", "new", this.block.options.workspace],
            { stdio: "inherit" },
          ).status;
          if (exitCode != 0) {
            process.exit(exitCode ? exitCode : 1);
          }
        }

        await this.tfInit(
          terraformBinary,
          this.addTfVarsToEnv(this.block.options.variables),
          useTfCloud,
          this.block.options.backendConfig,
        ); // required after workspace change
      }
    } else {
      if (this.options.verbose) {
        logGreen(
          "Skipping Terraform workspace management (no workspace is defined in IHLP config)",
        );
      }
    }
    return { tfVersionDir: tfVersionDir, tfFullPath: terraformBinary };
  }

  /** Execute "terraform init" */
  async tfInit(
    tfBin: string,
    envVars: NodeJS.ProcessEnv,
    useTFCloud: boolean,
    backendConfig: Record<string, string> | undefined,
  ): Promise<void> {
    const supplementalArgs: string[] = [];
    if (backendConfig) {
      for (const key of Object.keys(backendConfig)) {
        supplementalArgs.push(`-backend-config=${key}=${backendConfig[key]}`);
      }
    }

    if (this.options.autoApprove) {
      supplementalArgs.push("-input=false");
    }

    if (this.options.upgrade) {
      supplementalArgs.push("-upgrade");
    }

    if (!useTFCloud) {
      supplementalArgs.push("-reconfigure");
    }

    logGreen("Running terraform init");
    const exitCode = spawnSync(tfBin, ["init"].concat(supplementalArgs), {
      env: envVars,
      stdio: "inherit",
    }).status;
    if (exitCode != 0) {
      logErrorRed("Terraform init failed");
      if (useTFCloud) {
        logErrorRed(
          `(Terraform cloud authentication failures may be fixed via "${tfBin} login")`,
        );
      }
      process.exit(exitCode ? exitCode : 1);
    }
  }

  /** Process IHLP command for Terraform */
  async action(actionName: ActionName): Promise<void> {
    logGreen("Starting Terraform Runner");

    let exitCode: number | null;
    const origWorkingDir = process.cwd();
    try {
      process.chdir(this.block.path);

      const terraformBinary = (await this.tfSetup()).tfFullPath;

      logGreen("Updating Terraform modules");
      exitCode = spawnSync(terraformBinary, ["get", "-update=true"], {
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        process.exit(exitCode ? exitCode : 1);
      }

      const tfCommand = actionName == "destroy" ? "destroy" : "apply";
      console.log();
      logGreen("Running terraform " + tfCommand);
      console.log();

      const tfArguments = this.options.autoApprove
        ? [tfCommand, "-input=false", "-auto-approve"]
        : [tfCommand];

      if (this.block.options.targets) {
        for (const target of this.block.options.targets) {
          tfArguments.push(`-target=${target}`);
        }
      }

      exitCode = spawnSync(terraformBinary, tfArguments, {
        env: this.addTfVarsToEnv(this.block.options.variables),
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        process.exit(exitCode ? exitCode : 1);
      }

      if (
        actionName == "destroy" &&
        (await pathExists(path.join(process.cwd(), ".terraform")))
      ) {
        logGreen("Removing .terraform directory"); // so subsequent deploys don't give a "The currently selected workspace (foo) does not exist." error
        rimraf.sync(path.join(process.cwd(), ".terraform"));
      }
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

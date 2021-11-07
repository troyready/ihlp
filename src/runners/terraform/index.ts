/**
 * Terraform runner
 *
 * @packageDocumentation
 */

import * as path from "path";
import { spawnSync } from "child_process";

// Drop external rimraf package once min node version is 12.10
// https://stackoverflow.com/a/57866165
import * as rimraf from "rimraf";

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

    await this.tfInit(
      terraformBinary,
      this.addTfVarsToEnv(this.block.options.variables),
      this.block.options.backendConfig,
    );

    if (this.options.verbose) {
      logGreen("Checking current Terraform workspace");
    }
    const currentWorkspace = spawnSync(terraformBinary, ["workspace", "show"])
      .stdout.toString()
      .trim();
    if (this.options.verbose) {
      logGreen(`Current Terraform workspace is ${currentWorkspace}`);
    }
    if (currentWorkspace != this.options.environment) {
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
          new RegExp(`\\s*${this.options.environment}$`, "m"),
        )
      ) {
        if (this.options.verbose) {
          logGreen(
            `Desired Terraform workspace ${this.options.environment} has already been created; selecting it`,
          );
        }
        exitCode = spawnSync(
          terraformBinary,
          ["workspace", "select", this.options.environment],
          { stdio: "inherit" },
        ).status;
        if (exitCode != 0) {
          process.exit(exitCode ? exitCode : 1);
        }
      } else {
        logGreen(`Creating Terraform workspace ${this.options.environment}`);
        exitCode = spawnSync(
          terraformBinary,
          ["workspace", "new", this.options.environment],
          { stdio: "inherit" },
        ).status;
        if (exitCode != 0) {
          process.exit(exitCode ? exitCode : 1);
        }
      }

      await this.tfInit(
        terraformBinary,
        this.addTfVarsToEnv(this.block.options.variables),
        this.block.options.backendConfig,
      ); // required after workspace change
    }
    return { tfVersionDir: tfVersionDir, tfFullPath: terraformBinary };
  }

  /** Execute "terraform init" */
  async tfInit(
    tfBin: string,
    envVars: NodeJS.ProcessEnv,
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

    const exitCode = spawnSync(
      tfBin,
      ["init", "-reconfigure"].concat(supplementalArgs),
      { env: envVars, stdio: "inherit" },
    ).status;
    if (exitCode != 0) {
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
      exitCode = spawnSync(
        terraformBinary,
        this.options.autoApprove
          ? [tfCommand, "-input=false", "-auto-approve"]
          : [tfCommand],
        {
          env: this.addTfVarsToEnv(this.block.options.variables),
          stdio: "inherit",
        },
      ).status;
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
    } finally {
      process.chdir(origWorkingDir);
    }
  }
}

/**
 * Main IHLP package
 *
 * @packageDocumentation
 */

import * as ciDetect from "@npmcli/ci-detect";
import { spawnSync } from "child_process";
import { CommandOptions } from "commander";
import * as chalk from "chalk";
import * as promptSync from "prompt-sync";

import { init } from "./init/index";
import {
  generateValidChoiceSelections,
  getBlockRunner,
  loadConfig,
  logBanner,
  logGreen,
  logErrorRed,
} from "./util";
import type { ActionName, Block, IHLPConfig, TerraformBlock } from "./config";
import { runnerOpts } from "./runners";
import { Terraform } from "./runners/terraform";
import { processBlockVariables } from "./variables";

const prompt = promptSync();

export interface ihlpOpts extends CommandOptions {
  autoApprove: boolean;
  environment: string | undefined;
  target: string[] | undefined;
  upgrade: boolean;
  verbose: boolean;
}

interface SelectedTFBlockRes {
  block: TerraformBlock;
  location: string;
}

/** Infrastruction helper */
class IHLP {
  options: ihlpOpts;

  constructor(options: CommandOptions) {
    this.options = options as ihlpOpts;
  }

  /** Setup class options */
  async setupOptions(): Promise<void> {
    if (!this.options.environment && !process.env.IHLP_ENV) {
      logErrorRed(
        "Please provide environment (-e option or IHLP_ENV environment variable)",
      );
      process.exit(1);
    }
    if (this.options.environment) {
      process.env["IHLP_ENV"] = this.options.environment;
    } else {
      this.options.environment = process.env["IHLP_ENV"];
    }
    if (ciDetect() as boolean | string) {
      this.options.autoApprove = true;
    }
  }

  /** Deploy infrastructure */
  async deploy(): Promise<void> {
    logBanner();
    logGreen("Order up! Time to deploy...");
    await this.setupOptions();
    const config = await loadConfig();
    await this.processDeployments(config, "deploy");

    logGreen("Deploy complete");
  }

  /** Destroy infrastructure */
  async destroy(): Promise<void> {
    logBanner();
    logGreen("Order up! Time to destroy...");
    await this.setupOptions();
    const config = await loadConfig();
    await this.processDeployments(config, "destroy");

    console.log();
    logGreen("Destroy complete");
  }

  /** Creates config files */
  async init(): Promise<void> {
    logBanner();
    logGreen("Order up! Time to set up configuration...");
    await init();
  }

  /** Install Terraform version */
  async tfenvInstall(): Promise<void> {
    console.log("TODO");
  }

  /** Configure Terraform for a block and start a subshell in it */
  async tfShell(): Promise<void> {
    logBanner();
    logGreen("Order up! Time to run some Terraform commands...");
    if (!process.env.SHELL) {
      logErrorRed(
        'Unable to launch Terraform Shell -- need a "SHELL" environment variable',
      );
      process.exit(1);
    }
    await this.setupOptions();
    const config = await loadConfig();
    const getTfblockRes = await this.getSelectedTerraformBlock(config);
    process.env["IHLP_LOCATION"] = getTfblockRes.location;
    const block = (await processBlockVariables(
      getTfblockRes.block as unknown as Record<string, unknown>,
      this.options.verbose,
    )) as unknown as TerraformBlock;
    const runner = new Terraform(
      block,
      getTfblockRes.location,
      this.options as runnerOpts,
    );
    const origWorkingDir = process.cwd();
    try {
      process.chdir(block.path);
      const tfSetupRes = await runner.tfSetup();
      const tfShellEnvVars = runner.addTfVarsToEnv(block.options.variables);
      if (tfSetupRes.tfVersionDir) {
        tfShellEnvVars.PATH =
          tfSetupRes.tfVersionDir + ":" + tfShellEnvVars.PATH;
      }
      console.log();
      logGreen("Launching new shell with Terraform configured...");
      console.log();
      const exitCode = spawnSync(process.env.SHELL, {
        env: tfShellEnvVars,
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        process.exit(exitCode ? exitCode : 1);
      }
    } finally {
      process.chdir(origWorkingDir);
    }
  }

  /** Have user choose from available Terraform blocks */
  async getSelectedTerraformBlock(
    config: IHLPConfig,
  ): Promise<SelectedTFBlockRes> {
    const tfBlocks: Record<string, string | TerraformBlock>[] = [];
    for (const deployment of config.deployments) {
      for (const location of deployment.locations) {
        for (const block of deployment.blocks) {
          if (
            block.type == "terraform" &&
            (!this.options.target ||
              (block.name && this.options.target.includes(block.name)))
          ) {
            tfBlocks.push({ location: location, block: block });
          }
        }
      }
    }

    let selectedBlock: TerraformBlock;
    let selectedLocation: string;
    if (tfBlocks.length) {
      if (tfBlocks.length == 1) {
        selectedBlock = tfBlocks[0].block as TerraformBlock;
        selectedLocation = tfBlocks[0].location as string;
      } else {
        logGreen("Available Terraform blocks:");
        console.log();
        tfBlocks.forEach((element, index) => {
          const selectionId = index + 1;
          console.log(`${selectionId}) location: ${element.location}`);
          console.log(
            new Array(selectionId.toString().length + 3).join(" ") +
              "block:    " +
              JSON.stringify(element.block, null, 2).replace(
                /\n/g,
                "\n" + new Array(selectionId.toString().length + 13).join(" "),
              ),
          );
        });
        console.log();

        const promptResponse = prompt(
          `Choose 1-${tfBlocks.length} (or q to quit) > `,
        );

        if (["q", "quit", null].includes(promptResponse)) {
          console.log();
          logGreen("Exiting as requested; goodbye...");
          process.exit(0);
        } else if (
          generateValidChoiceSelections(tfBlocks).includes(promptResponse)
        ) {
          selectedBlock = tfBlocks[parseInt(promptResponse) - 1]
            .block as TerraformBlock;
          selectedLocation = tfBlocks[parseInt(promptResponse) - 1]
            .location as string;
        } else {
          console.log();
          logErrorRed("Please enter a vaild selection");
          process.exit(1);
        }
      }
      return { block: selectedBlock, location: selectedLocation };
    } else {
      logErrorRed("No Terraform blocks found");
      process.exit(1);
    }
  }

  /** Process IHLP config deployments */
  async processDeployments(
    config: IHLPConfig,
    action: ActionName,
  ): Promise<void> {
    for (const deployment of action == "destroy"
      ? config.deployments.reverse()
      : config.deployments) {
      for (const location of action == "destroy"
        ? deployment.locations.reverse()
        : deployment.locations) {
        console.log();
        logGreen("Processing location " + location + "...");
        await this.processLocation(location, deployment.blocks, action);
      }
    }
  }

  /** Determine if block should be skipped while processing location */
  shouldBlockBeSkipped(block: Block, action: ActionName): boolean {
    if (
      this.options.target &&
      (!block.name || !this.options.target.includes(block.name))
    ) {
      return true;
    }

    if (
      action != "destroy" &&
      [
        "aws-empty-s3-buckets-on-destroy",
        "azure-delete-resource-groups-on-destroy",
      ].includes(block.type)
    ) {
      return true;
    }

    return false;
  }

  /** Process IHLP config deployment location */
  async processLocation(
    location: string,
    blocks: Block[],
    action: ActionName,
  ): Promise<void> {
    process.env["IHLP_LOCATION"] = location;

    for (const block of action == "destroy" ? blocks.reverse() : blocks) {
      if (!this.shouldBlockBeSkipped(block, action)) {
        await this.processBlock(block, location, action);
      }
    }
  }

  /** Process IHLP config deployment block */
  async processBlock(
    block: Block,
    location: string,
    action: ActionName,
  ): Promise<void> {
    console.log();
    logGreen(`Next block to ${action} is:`);
    console.log("");
    if (block.name) {
      console.log(chalk.green("Name:    ") + block.name);
    }
    console.log(chalk.green("Type:    ") + block.type);
    if (block.path) {
      console.log(chalk.green("Path:    ") + block.path);
    }
    if (block.options) {
      console.log(
        chalk.green("Options: ") +
          JSON.stringify(block.options, null, 2).replace(/\n/g, "\n         "),
      );
    }
    console.log();
    const promptResponse = this.options.autoApprove
      ? "y"
      : prompt(
          action.charAt(0).toUpperCase() +
            action.slice(1) +
            " it (y/n/[q]uit) ? ",
        );

    if (["q", "quit", null].includes(promptResponse)) {
      console.log();
      logGreen("Exiting as requested; goodbye...");
      process.exit(0);
    } else if (promptResponse == "n") {
      console.log();
      logGreen("Skipping block...");
    } else if (["yes", "y"].includes(promptResponse)) {
      block = (await processBlockVariables(
        block as unknown as Record<string, unknown>,
        this.options.verbose,
      )) as unknown as Block;
      await this.runBlock(block, location, action);
    } else {
      console.log();
      logErrorRed('Please enter one of "y", "n", or "q"');
      await this.processBlock(block, location, action);
    }
  }

  /** Start requested action on IHLP config deployment block */
  async runBlock(
    block: Block,
    location: string,
    action: ActionName,
  ): Promise<void> {
    const origEnv = process.env;
    try {
      const runner = getBlockRunner(
        block,
        location,
        this.options as runnerOpts,
      );
      await runner.action(action);
    } finally {
      process.env = origEnv;
    }
  }
}

export { IHLP };

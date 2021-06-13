/**
 * Base runner package
 *
 * @packageDocumentation
 */

import { spawnSync } from "child_process";

import type { ihlpOpts } from "../index";
import { mergeObjIntoEnv } from "../util";
import type { Block, CommandBlock, ActionName } from "../config";
import { logGreen } from "../util";

export interface runnerOpts extends ihlpOpts {
  environment: string;
}

/** Base class for runners */
export class Runner {
  block: Block;
  location: string;
  options: runnerOpts;

  constructor(block: Block, location: string, options: runnerOpts) {
    this.block = block;
    this.location = location;
    this.options = options;
  }

  /** Base action function for runners */
  async action(actionName: ActionName): Promise<void> {} // eslint-disable-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
}

/** Support runner to execute commands */
export class Command extends Runner {
  block: CommandBlock;

  /** Process IHLP command for executing commands */
  async action(actionName: ActionName): Promise<void> {
    if (
      !this.block.options.actions ||
      this.block.options.actions.includes(actionName)
    ) {
      logGreen(`Executing "${this.block.options.command.join(" ")}"`);
      const exitCode = spawnSync(
        this.block.options.command[0],
        [...this.block.options.command].slice(1),
        { env: mergeObjIntoEnv(this.block.options.envVars), stdio: "inherit" },
      ).status;
      if (exitCode != 0) {
        process.exit(exitCode ? exitCode : 1);
      }
    } else {
      logGreen(
        "Skipping execution of command - requested action does not match",
      );
    }
  }
}

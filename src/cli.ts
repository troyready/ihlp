#!/usr/bin/env node
/**
 * IHLP CLI
 *
 * @packageDocumentation
 */

import { Command, CommandOptions } from "commander";
import { IHLP } from "./index";

const program = new Command();

/* eslint-disable @typescript-eslint/no-unused-vars */

/** CLI deploy command function */
async function deploy(options: CommandOptions, command: Command) {
  const ihlp = new IHLP(options);
  ihlp.deploy();
}
program
  .command("deploy")
  .description("deploys infrastructure blocks")
  .option("-v, --verbose", "increase output verbosity")
  .option(
    "-a, --auto-approve",
    "perform all actions without prompting (same as setting CI environment variable)",
  )
  .option(
    "-e, --environment <environment-name>",
    ' (same as "IHLP_ENV" environment variable)',
  )
  .option(
    "--upgrade",
    'add "-upgrade" option to terraform init (to update providers)',
  )
  .action(deploy);

/** CLI destroy command function */
async function destroy(options: CommandOptions, command: Command) {
  const ihlp = new IHLP(options);
  ihlp.destroy();
}
program
  .command("destroy")
  .description("destroys infrastructure blocks")
  .option("-v, --verbose", "increase output verbosity")
  .option(
    "-a, --auto-approve",
    "perform all actions without prompting (same as setting CI environment variable)",
  )
  .option(
    "-e, --environment <environment-name>",
    ' (same as "IHLP_ENV" environment variable)',
  )
  .action(destroy);

/** CLI init command function */
async function init(options: CommandOptions, command: Command) {
  const ihlp = new IHLP(options);
  ihlp.init();
}
program.command("init").description("creates config files").action(init);

/** CLI tf-shell command function */
async function tfShell(options: CommandOptions, command: Command) {
  const ihlp = new IHLP(options);
  ihlp.tfShell();
}
program
  .command("tf-shell")
  .description("starts a subshell with Terraform configured for a block")
  .option(
    "-e, --environment <environment-name>",
    ' (same as "IHLP_ENV" environment variable)',
  )
  .option(
    "--upgrade",
    'add "-upgrade" option to terraform init (to update providers)',
  )
  .action(tfShell);

program.parse(process.argv);

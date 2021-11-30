/**
 * Init command for generating configuration
 *
 * @packageDocumentation
 */
import { spawnSync } from "child_process";
import * as promptSync from "prompt-sync";

import * as fs from "fs";
import { awsServerlessFramework } from "./aws_serverless_framework";
import { awsTfEksFluxV2 } from "./aws_tf_eks_fluxv2";
import { awsTfWithS3Backend } from "./aws_tf_s3_backend";
import { azureTfWithArmBackend } from "./azure_tf_azurerm_backend";
import { gcpTfWithGCSBackend } from "./gcp_tf_gcs_backend";
import { bareBones } from "./barebones";
import {
  generateValidChoiceSelections,
  logErrorRed,
  logGreen,
  pathExists,
} from "../util";

const prompt = promptSync();

export async function generateGitIgnore(): Promise<void> {
  const gitIgnoreContents = "node_modules\n";

  if (await pathExists(".gitignore")) {
    logGreen(".gitignore file already exists; would have written this to it:");
    console.log(gitIgnoreContents);
  } else {
    logGreen("Writing barebones .gitignore...");
    await fs.promises.writeFile(".gitignore", gitIgnoreContents);
  }
}

/** Ensure a tsconfig file is present
 *
 * This works around IDE issues where entries in a subdirectory's
 * package.json aren't detected, e.g. '@types/node'
 */
export async function generateTsconfig(): Promise<void> {
  if (!(await pathExists("tsconfig.json"))) {
    logGreen("Writing barebones tsconfig.json...");
    await fs.promises.writeFile("tsconfig.json", "{}\n");
  }
}

/** Ensure IHLP is installed in package.json */
async function installIhlp() {
  let exitCode: number | null;
  if (await pathExists("package.json")) {
    logGreen("package.json already exists; checking for ihlp listed in it");
    exitCode = spawnSync("npm", ["ls", "ihlp"]).status;
    if (exitCode != 0) {
      logGreen("ihlp not present; adding it to package.json devDependencies");
      exitCode = spawnSync("npm", ["i", "-D", "ihlp"], {
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        process.exit(exitCode ? exitCode : 1);
      }
    }
    logGreen("Checking for @types/node listed in package.json");
    if (
      !(await fs.promises.readFile("package.json", "utf-8")).includes(
        '"@types/node"',
      )
    ) {
      logGreen(
        "@types/nodes not present; adding it to package.json devDependencies",
      );
      exitCode = spawnSync("npm", ["i", "-D", "@types/node"], {
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        process.exit(exitCode ? exitCode : 1);
      }
    }
  } else {
    logGreen("Generating package.json and installing ihlp in it");
    exitCode = spawnSync("npm", ["init", "-y"], {
      stdio: "inherit",
    }).status;
    if (exitCode != 0) {
      process.exit(exitCode ? exitCode : 1);
    }
    exitCode = spawnSync("npm", ["install", "-D", "ihlp", "@types/node"], {
      stdio: "inherit",
    }).status;
    if (exitCode != 0) {
      process.exit(exitCode ? exitCode : 1);
    }
  }
  logGreen("package.json setup complete");
  console.log();
}

interface initExample {
  name: string;
  worker: () => Promise<void>;
}

/** Creates config files */
export async function init(): Promise<void> {
  await installIhlp();

  const examples: initExample[] = [
    {
      name: "Empty (barebones config)",
      worker: bareBones,
    },
    {
      name: "(AWS) Terraform with S3 backend",
      worker: awsTfWithS3Backend,
    },
    {
      name: "(AWS) Terraform-managed EKS with FluxV2",
      worker: awsTfEksFluxV2,
    },
    {
      name: "(AWS) Serverless Framework",
      worker: awsServerlessFramework,
    },
    {
      name: "(Azure) Terraform with ARM backend",
      worker: azureTfWithArmBackend,
    },
    {
      name: "(GCP) Terraform with GCS backend",
      worker: gcpTfWithGCSBackend,
    },
  ];

  logGreen("Available example configurations:");
  console.log();
  examples.forEach((element, index) => {
    logGreen(`${index + 1}) ${element.name}`);
  });
  console.log();

  const promptResponse = prompt(
    `Choose 1-${examples.length} (or q to quit) > `,
  );

  if (["q", "quit", null].includes(promptResponse)) {
    console.log();
    logGreen("Exiting as requested; goodbye...");
    process.exit(0);
  } else if (
    generateValidChoiceSelections(
      examples as unknown as Record<string, unknown>[],
    ).includes(promptResponse)
  ) {
    await examples[parseInt(promptResponse) - 1].worker();
  } else {
    console.log();
    logErrorRed("Please enter a vaild selection");
    await init();
  }
}

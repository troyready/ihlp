/**
 * Azure Terraform Integration tests
 *
 * @packageDocumentation
 */

import * as ciDetect from "@npmcli/ci-detect";
import { spawnSync } from "child_process";
import { DefaultAzureCredential } from "@azure/identity";
import { ResourceManagementClient } from "@azure/arm-resources";

/** Run tests */
export async function azureTfTests(): Promise<void> {
  if (!process.env.ARM_SUBSCRIPTION_ID) {
    console.error(
      "Azure Subscription ID needs to be set as environment variable ARM_SUBSCRIPTION_ID",
    );
    process.exit(1);
  }

  const origWorkingDir = process.cwd();
  try {
    process.chdir(__dirname);

    const npmBinary = process.platform === "win32" ? "npm.cmd" : "npm";
    const npxBinary = process.platform === "win32" ? "npx.cmd" : "npx";
    const env = process.env.ENV_SUFFIX
      ? "inttest" + process.env.ENV_SUFFIX
      : "inttest";
    let exitCode: number | null;

    console.log("Installing ihlp...");
    exitCode = spawnSync(npmBinary, ["i"], {
      stdio: "inherit",
    }).status;
    if (exitCode != 0) {
      console.error("Setting up ihlp test install failed");
      process.exit(exitCode ? exitCode : 1);
    }

    console.log(`Deploying Terraform to Azure in environment ${env}...`);
    exitCode = spawnSync(npxBinary, ["ihlp", "deploy", "-a", "-e", env], {
      stdio: "inherit",
    }).status;
    if (exitCode == 0) {
      console.log("Deploy successful; destroying it");
      exitCode = spawnSync(npxBinary, ["ihlp", "destroy", "-a", "-e", env], {
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        if (ciDetect() as boolean | string) {
          await deleteResourceGroup(env, process.env.ARM_SUBSCRIPTION_ID);
        } else {
          console.error("Error encountered while destroying test resources");
        }
        process.exit(exitCode ? exitCode : 1);
      }
    } else {
      if (ciDetect() as boolean | string) {
        const deployExitCode = exitCode;
        console.error(
          `Terraform to Azure deployment in environment ${env} failed; running destroy...`,
        );
        exitCode = spawnSync(npxBinary, ["ihlp", "destroy", "-a", "-e", env], {
          stdio: "inherit",
        }).status;
        if (exitCode != 0) {
          await deleteResourceGroup(env, process.env.ARM_SUBSCRIPTION_ID);
        }
        process.exit(deployExitCode ? deployExitCode : 1);
      } else {
        console.error(
          `Terraform to Azure deployment in environment ${env} failed`,
        );
        process.exit(exitCode ? exitCode : 1);
      }
    }
  } finally {
    process.chdir(origWorkingDir);
  }
  console.log("Azure Terraform test complete!");
}

/** Delete Azure Resource Group */
export async function deleteResourceGroup(
  env: string,
  subscriptionId: string,
): Promise<void> {
  console.error(
    "Error encountered while destroying Terraform resource; manually deleting Resource Group to cleanup resources...",
  );
  setupAzureCredEnvVars();
  const armClient = new ResourceManagementClient(
    new DefaultAzureCredential(),
    subscriptionId,
  );
  await armClient.resourceGroups.deleteMethod(env + "-ihlpazuretf");
}

// ** Add SDK-compatible environment variables from existing TF credentials
export function setupAzureCredEnvVars(): void {
  for (const envVar of ["CLIENT_ID", "CLIENT_SECRET", "TENANT_ID"]) {
    if (process.env["ARM_" + envVar] && !process.env["AZURE_" + envVar]) {
      process.env["AZURE_" + envVar] = process.env["ARM_" + envVar];
    }
  }
}

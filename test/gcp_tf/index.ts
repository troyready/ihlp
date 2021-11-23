/**
 * GCP Terraform Integration tests
 *
 * @packageDocumentation
 */

import * as ciDetect from "@npmcli/ci-detect";
import { spawnSync } from "child_process";

/** Run tests */
export async function gcpTfTests(): Promise<void> {
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

    console.log(`Deploying Terraform to GCP in environment ${env}...`);
    exitCode = spawnSync(npxBinary, ["ihlp", "deploy", "-a", "-e", env], {
      stdio: "inherit",
    }).status;
    if (exitCode == 0) {
      console.log("Deploy successful; destroying it");
      exitCode = spawnSync(npxBinary, ["ihlp", "destroy", "-a", "-e", env], {
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        console.error("Error encountered while destroying test resources");
        process.exit(exitCode ? exitCode : 1);
      }
    } else {
      if (ciDetect() as boolean | string) {
        const deployExitCode = exitCode;
        console.error(
          `Terraform to GCP deployment in environment ${env} failed; running destroy...`,
        );
        exitCode = spawnSync(npxBinary, ["ihlp", "destroy", "-a", "-e", env], {
          stdio: "inherit",
        }).status;
        process.exit(deployExitCode ? deployExitCode : 1);
      } else {
        console.error(
          `Terraform to GCP deployment in environment ${env} failed`,
        );
        process.exit(exitCode ? exitCode : 1);
      }
    }
  } finally {
    process.chdir(origWorkingDir);
  }
  console.log("GCP Terraform test complete!");
}

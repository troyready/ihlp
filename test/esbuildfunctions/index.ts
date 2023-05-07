/**
 * esbuild Functions Integration tests
 *
 * @packageDocumentation
 */

import * as ciDetect from "@npmcli/ci-detect";
import * as fs from "fs";
import * as path from "path";
import { pathExists } from "../index";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { TextDecoder, TextEncoder } from "util";
import { spawnSync } from "child_process";

const expectedFunctionResponse =
  '{"body":"{\\"message\\":\\"Hello world\\"}","statusCode":200}';
const distPath = path.join("example.tf", "dist");
const helloWorldZipPath = path.join(distPath, "helloWorld.zip");

/** Run tests */
export async function esbuildFunctionsTest(): Promise<void> {
  console.log("Starting esbuild functions integration tests");
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

    if (await pathExists(distPath)) {
      await fs.promises.rmdir(distPath, { recursive: true });
    }

    console.log(
      `Building function and deploying via Terraform to AWS in environment ${env}...`,
    );
    exitCode = await deploy(npxBinary, env);
    if (exitCode == 0) {
      console.log("Deploy successful; testing it");
      const functionName = env + "-hello-world";
      const esmFunctionName = env + "-esm-hello-world";
      const lambdaClient = new LambdaClient({ region: "us-west-2" });
      let lambdaHelloWorldResponsePayload = "";
      let lambdaESMResponsePayload = "";
      try {
        const lambdaResponse = await lambdaClient.send(
          new InvokeCommand({
            FunctionName: functionName,
            Payload: new TextEncoder().encode(
              JSON.stringify({ body: JSON.stringify({ foo: "bar" }) }),
            ),
          }),
        );
        lambdaHelloWorldResponsePayload = new TextDecoder().decode(
          lambdaResponse.Payload,
        );
        const lambdaESMResponse = await lambdaClient.send(
          new InvokeCommand({
            FunctionName: esmFunctionName,
            Payload: new TextEncoder().encode(
              JSON.stringify({ body: JSON.stringify({ foo: "bar" }) }),
            ),
          }),
        );
        lambdaESMResponsePayload = new TextDecoder().decode(
          lambdaESMResponse.Payload,
        );
        console.log("Test successful; destroying it");
      } catch (error) {
        console.error("Error encountered when testing deployed functions:");
        console.error(JSON.stringify(error));
        console.log("Destroying deployment");
      }
      exitCode = spawnSync(npxBinary, ["ihlp", "destroy", "-a", "-e", env], {
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        console.error("Error encountered while destroying test resources");
        process.exit(exitCode ? exitCode : 1);
      }
      if (lambdaHelloWorldResponsePayload != expectedFunctionResponse) {
        console.error("Function did not return expected response");
        console.error("Expected: " + expectedFunctionResponse);
        console.error("Received: " + lambdaHelloWorldResponsePayload);
        process.exit(exitCode ? exitCode : 1);
      }
      if (lambdaESMResponsePayload != expectedFunctionResponse) {
        console.error("ESM Function did not return expected response");
        console.error("Expected: " + expectedFunctionResponse);
        console.error("Received: " + lambdaESMResponsePayload);
        process.exit(exitCode ? exitCode : 1);
      }
    } else {
      if (ciDetect() as boolean | string) {
        const deployExitCode = exitCode;
        console.error(
          `Deployment in environment ${env} failed; running destroy...`,
        );
        exitCode = spawnSync(npxBinary, ["ihlp", "destroy", "-a", "-e", env], {
          stdio: "inherit",
        }).status;
        process.exit(deployExitCode ? deployExitCode : 1);
      } else {
        console.error(`Deployment in environment ${env} failed`);
        process.exit(exitCode ? exitCode : 1);
      }
    }
  } finally {
    process.chdir(origWorkingDir);
  }
  console.log("esbuild functions test complete!");
}

/** Run ihlp deploy */
async function deploy(npxBinary: string, env: string): Promise<number | null> {
  let exitCode: number | null;
  // First deploy
  exitCode = spawnSync(npxBinary, ["ihlp", "deploy", "-a", "-e", env], {
    stdio: "inherit",
  }).status;

  if (exitCode != 0) {
    return exitCode;
  }

  // Deploy again, after deleting function zip and breaking esbuild to ensure cached version is retrieved
  for (const filePath of [
    path.join(__dirname, "example.tf", "node_modules", ".bin", "esbuild"),
    helloWorldZipPath,
  ]) {
    if (await pathExists(filePath)) {
      console.log(`Deleting ${filePath} to setup next test deployment`);
      await fs.promises.unlink(filePath);
    }
  }
  exitCode = spawnSync(npxBinary, ["ihlp", "deploy", "-a", "-e", env], {
    stdio: "inherit",
  }).status;
  return exitCode;
}

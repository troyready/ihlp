/**
 * Runner utility functions
 *
 * @packageDocumentation
 */

import { logErrorRed } from "../util";
import * as which from "which";

/** Returns name of platform-specific node-based binary. Exits with error if it doesn't exist. */
async function getNodeBinaryName(baseBinaryName: string): Promise<string> {
  try {
    await which(baseBinaryName);
  } catch (err) {
    logErrorRed(`${baseBinaryName} not found`);
    process.exit(1);
  }
  return baseBinaryName;
}

/** Returns name of platform-specific npm binary. Exits with error if it doesn't exist. */
export async function getNpmBinaryName(): Promise<string> {
  return await getNodeBinaryName(
    process.platform === "win32" ? "npm.cmd" : "npm",
  );
}

/** Returns name of platform-specific npx binary. Exits with error if it doesn't exist. */
export async function getNpxBinaryName(): Promise<string> {
  return await getNodeBinaryName(
    process.platform === "win32" ? "npx.cmd" : "npx",
  );
}

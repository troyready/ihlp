/**
 * Integration tests
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import { azureTfTests } from "./azure_tf/index";
import { gcpTfTests } from "./gcp_tf/index";
import { esbuildFunctionsTest } from "./esbuildfunctions/index";

/** Return true if provided path exists */
export async function pathExists(filepath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filepath);
  } catch (error) {
    if (error.code == "ENOENT") {
      return false;
    } else {
      throw error;
    }
  }
  return true;
}

/** Run tests */
export async function test(): Promise<void> {
  await azureTfTests();
  await esbuildFunctionsTest();
  await gcpTfTests();
}

test();

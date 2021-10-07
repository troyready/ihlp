/**
 * Barebones config generator
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import { generateGitIgnore } from "../";
import { logGreen, pathExists } from "../../util";

export async function bareBones(): Promise<void> {
  const configContents = `import type { IHLPConfig } from "ihlp/lib/config";

const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
      ],
      locations: [""],
    },
  ],
};

module.exports = ihlpConfig;
`;

  await generateGitIgnore();

  if (await pathExists("ihlp.ts")) {
    logGreen(
      "ihlp.ts config file already exists; would have written this to it:",
    );
    console.log(configContents);
  } else {
    logGreen("Writing barebones ihlp.ts...");
    await fs.promises.writeFile("ihlp.ts", configContents);
    logGreen(
      'Barebones config file is now in place. Add locations (e.g. "us-east-1") and any desired blocks',
    );
  }
}

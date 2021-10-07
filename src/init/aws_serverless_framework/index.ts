/**
 * AWS Terraform with S3 backend config generator
 *
 * @packageDocumentation
 */

import * as admzip from "adm-zip";
import * as fs from "fs";
import * as path from "path";
import * as tmp from "tmp-promise";
import { generateGitIgnore } from "../";
import { httpsGetToFile, logGreen, pathExists } from "../../util";

export async function awsServerlessFramework(): Promise<void> {
  const slsProjectPath = "git-lfs-s3.sls";

  const configContents = `import type { IHLPConfig } from "ihlp/lib/config";

const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
        {
          path: "${slsProjectPath}",
          type: "serverless-framework",
        },
      ],
      locations: ["us-west-2"],
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
    logGreen("Writing ihlp.ts...");
    await fs.promises.writeFile("ihlp.ts", configContents);
  }

  if (await pathExists(slsProjectPath)) {
    logGreen(
      `Example Serverless Framework project directory ${slsProjectPath} already exists`,
    );
  } else {
    logGreen(
      `Downloading example Serverless Framework project to ${slsProjectPath}`,
    );
    const tmpDir = await tmp.dir({ unsafeCleanup: true });
    const dlPath = path.join(tmpDir.path, "git-lfs-s3.zip");
    await httpsGetToFile(
      "https://github.com/troyready/git-lfs-s3/archive/refs/heads/main.zip",
      dlPath,
    );
    const dlZip = new admzip(dlPath);
    dlZip.extractAllTo(tmpDir.path);
    await fs.promises.rename(
      path.join(tmpDir.path, "git-lfs-s3-main"),
      slsProjectPath,
    );
  }
  logGreen("Example generation complete");
}

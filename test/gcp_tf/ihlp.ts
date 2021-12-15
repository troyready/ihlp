import * as fs from "fs";
import * as nunjucks from "nunjucks";

import type { IHLPConfig } from "ihlp/lib/config";

if (!process.env.IHLP_ENV) {
  console.error("Missing required environment variables!");
  process.exit(1);
}

const envName = process.env.IHLP_ENV;
const deploymentName = envName + "-ihlpgcptf";
const bucketName = envName + "ihlpgcptf";
const labels = {
  environment: envName,
  purpose: "integration-test",
};

const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
        {
          options: {
            labels: labels,
            name: deploymentName,
            config: nunjucks.renderString(
              fs.readFileSync("./gcp-templates/tf-state.yml.j2", "utf8"),
              {
                env: {
                  deployment: deploymentName,
                },
                properties: {
                  bucketName: bucketName,
                },
              },
            ),
          },
          type: "gcp-deployment",
        },
        {
          options: {
            bucketNames: bucketName,
          },
          type: "gcp-empty-buckets-on-destroy",
        },
        {
          envVars: {
            GOOGLE_PROJECT: "${gcp-metadata project}",
          },
          options: {
            backendConfig: {
              bucket: bucketName,
            },
            terraformVersion: "1.0.2", // specify here or in .terraform-version file in terraform directory
            variables: {
              labels: labels,
            },
            workspace: process.env.IHLP_ENV,
          },
          path: "example.tf",
          type: "terraform",
        },
      ],
      locations: ["us-west-2"],
    },
  ],
};

module.exports = ihlpConfig;

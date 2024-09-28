/**
 * Barebones Terraform Cloud configuration
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as path from "path";
import { generateGitIgnore, generateTsconfig } from "../";
import { logGreen, pathExists } from "../../util";

export async function terraformCloud(): Promise<void> {
  const configContents = `import type { IHLPConfig } from "ihlp/lib/config";

const envOptions = {
  dev: {
    namespace: "dev-ihlp-proj",
    tags: {
      environment: "dev",
      namespace: "dev-ihlp-proj",
    },
    tfVersion: "1.2.8",
  },
  prd: {
    namespace: "prd-ihlp-proj",
    tags: {
      environment: "prd",
      namespace: "prd-ihlp-proj",
    },
    tfVersion: "1.2.8",
  },
};

const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
        {
          options: {
            terraformVersion: envOptions[process.env.IHLP_ENV].tfVersion, // specify here or in .terraform-version file in terraform directory
            variables: {
              region: "\${env IHLP_LOCATION}",
              tags: envOptions[process.env.IHLP_ENV].tags
            },
            // Specify a workspace here or in the terraform configuration file
            workspace: process.env.IHLP_ENV + "-app-" + "\${env IHLP_LOCATION}",
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
`;

  const tfGitIgnore = `.terraform
`;

  const tfConfig = `terraform {
  cloud {
    organization = "ORGNAMEHERE"

    workspaces {
      # Specify a workspace name here or in ihlp.ts
      # name = "TFCLOUDWORKSPACENAME"

      # If specifying a workspace above, then comment out these tag(s)
      tags = [
        "app",
      ]
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.0"
    }
  }
}

variable "region" {
  type = string
}
variable "tags" {
  default = {}
  type    = map
}

provider "aws" {
  region = var.region
}

resource "aws_ssm_parameter" "example" {
  name  = "/\${terraform.workspace}/example/example"
  tags  = var.tags
  type  = "String"
  value = "example"
}
`;

  await generateGitIgnore();
  await generateTsconfig();

  if (await pathExists("ihlp.ts")) {
    logGreen(
      "ihlp.ts config file already exists; would have written this to it:",
    );
    console.log(configContents);
  } else {
    logGreen("Writing ihlp.ts...");
    await fs.promises.writeFile("ihlp.ts", configContents);
  }

  const tfGitIgnorePath = path.join("example.tf", ".gitignore");
  if (await pathExists(tfGitIgnorePath)) {
    logGreen(
      "TF .gitignore file already exists; would have written this to it:",
    );
    console.log(tfGitIgnore);
    console.log();
  } else {
    if (!(await pathExists("example.tf"))) {
      await fs.promises.mkdir("example.tf");
    }
    logGreen(`Writing ${tfGitIgnorePath}...`);
    await fs.promises.writeFile(tfGitIgnorePath, tfGitIgnore);
  }

  const tfConfigPath = path.join("example.tf", "main.tf");
  if (await pathExists(tfConfigPath)) {
    logGreen("TF main.tf file already exists; would have written this to it:");
    console.log(tfConfig);
    console.log();
  } else {
    logGreen(`Writing ${tfConfigPath}...`);
    await fs.promises.writeFile(tfConfigPath, tfConfig);
  }

  logGreen("Example generation complete");
}

/**
 * GCP Terraform with GCS backend config generator
 *
 * @packageDocumentation
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { generateGitIgnore, generateTsconfig } from "../";
import { logGreen, pathExists } from "../../util";

export async function writeGCSBackendTemplate(): Promise<void> {
  const gcpTemplateContents = `resources:
  - name: "{{ properties['bucketName'] }}"
    type: storage.v1.bucket
    properties:
      lifecycle:
        rule:
          - action:
              type: Delete
            condition:
              daysSinceNoncurrentTime: 21
      versioning:
        enabled: true
`;

  const gcpTemplatePath = path.join("gcp-templates", "tf-state.yml.j2");
  if (await pathExists(gcpTemplatePath)) {
    logGreen(
      "GCP deployment manager template file already exists; would have written this to it:",
    );
    console.log(gcpTemplateContents);
    console.log();
  } else {
    if (!(await pathExists("gcp-templates"))) {
      await fs.promises.mkdir("gcp-templates");
    }
    logGreen(`Writing ${gcpTemplatePath}...`);
    await fs.promises.writeFile(gcpTemplatePath, gcpTemplateContents);
  }
}

export async function gcpTfWithGCSBackend(): Promise<void> {
  // Storage account names must be unique
  const randomSuffix = uuidv4().replace(/-/g, "").substring(0, 12);

  const configContents = `import * as fs from "fs";
import * as nunjucks from "nunjucks";

import type { IHLPConfig } from "ihlp/lib/config";

const envOptions = {
  dev: {
    namespace: "dev-ihlp-proj",
    bucketName: "dev-ihlp-proj-${randomSuffix}",
    labels: {
      environment: "dev",
      namespace: "dev-ihlp-proj",
    },
    // specify GCP project here or omit to inherit from \`gcloud auth application-default set-quota-project PROJECTID\`
    // projectId: "",
    tfVersion: "1.2.8",
  },
  prd: {
    namespace: "prd-ihlp-proj",
    bucketName: "prd-ihlp-proj-${randomSuffix}",
    labels: {
      environment: "prd",
      namespace: "prd-ihlp-proj",
    },
    // specify GCP project here or omit to inherit from \`gcloud auth application-default set-quota-project PROJECTID\`
    // projectId: "",
    tfVersion: "1.2.8",
  },
};

const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
        {
          options: {
            labels: envOptions[process.env.IHLP_ENV].labels,
            name: envOptions[process.env.IHLP_ENV].namespace + "-tfstate",
            config: nunjucks.renderString(
              fs.readFileSync("./gcp-templates/tf-state.yml.j2", "utf8"),
              {
                env: {
                  deployment:
                    envOptions[process.env.IHLP_ENV].namespace + "-tfstate",
                },
                properties: {
                  bucketName: envOptions[process.env.IHLP_ENV].bucketName,
                },
              },
            ),
            projectId: envOptions[process.env.IHLP_ENV].projectId // if undefined in envOptions, will fallback to application-default quota project
          },
          type: "gcp-deployment",
        },
        {
          options: {
            bucketNames: envOptions[process.env.IHLP_ENV].bucketName,
            projectId: envOptions[process.env.IHLP_ENV].projectId // if undefined in envOptions, will fallback to application-default quota project
          },
          type: "gcp-empty-buckets-on-destroy",
        },
        {
          envVars: {
            GOOGLE_PROJECT: envOptions[process.env.IHLP_ENV].projectId ? envOptions[process.env.IHLP_ENV].projectId : "\${gcp-metadata project}",
          },
          options: {
            backendConfig: {
              bucket: envOptions[process.env.IHLP_ENV].bucketName,
            },
            terraformVersion: envOptions[process.env.IHLP_ENV].tfVersion, // specify here or in .terraform-version file in terraform directory
            variables: {
              labels: envOptions[process.env.IHLP_ENV].labels,
              region: "\${env IHLP_LOCATION}",
            },
            workspace: process.env.IHLP_ENV,
          },
          path: "example.tf",
          type: "terraform",
        },
      ],
      locations: ["us-west1"],
    },
  ],
};

module.exports = ihlpConfig;
`;

  const tfGitIgnore = `.terraform
`;

  const tfConfig = `terraform {
  backend "gcs" {
    prefix = "/example"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

variable "labels" {
  default = {}
  type    = map
}
variable "region" {
  type = string
}

provider "google" {}

resource "random_id" "bucket" {
  byte_length = 4
}

resource "google_storage_bucket" "example" {
  force_destroy = true
  labels        = var.labels
  location      = "US"
  name          = "\${terraform.workspace}example-bucket-\${random_id.bucket.hex}"
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

  await writeGCSBackendTemplate();

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

  logGreen("Checking for nunjucks dependency in package.json");
  let exitCode = spawnSync("npm", ["ls", "nunjucks"]).status;
  if (exitCode != 0) {
    logGreen("nunjucks not present; adding it to package.json devDependencies");
    for (const dep of [["nunjucks"], ["-D", "@types/nunjucks"]]) {
      exitCode = spawnSync("npm", ["i"].concat(dep), {
        stdio: "inherit",
      }).status;
      if (exitCode != 0) {
        process.exit(exitCode ? exitCode : 1);
      }
    }
  }

  logGreen("Example generation complete");
}

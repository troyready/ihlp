/**
 * AWS Terraform with S3 backend config generator
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as path from "path";
import { generateGitIgnore, generateTsconfig } from "../";
import { logGreen, pathExists } from "../../util";

export async function writeS3BackendCfnTemplate(): Promise<void> {
  const cfnTemplateContents = `---
AWSTemplateFormatVersion: '2010-09-09'
Conditions:
  BucketNameOmitted:
    Fn::Or:
    - Fn::Equals:
      - Ref: BucketName
      - ''
    - Fn::Equals:
      - Ref: BucketName
      - undefined
  TableNameOmitted:
    Fn::Or:
    - Fn::Equals:
      - Ref: TableName
      - ''
    - Fn::Equals:
      - Ref: TableName
      - undefined
Description: Terraform State Resources
Outputs:
  BucketArn:
    Description: Arn of bucket storing Terraform state
    Value:
      Fn::GetAtt:
        - TerraformStateBucket
        - Arn
  BucketName:
    Description: Name of bucket storing Terraform state
    Value:
      Ref: TerraformStateBucket
  TableName:
    Description: Name of DynamoDB table for Terraform state
    Value:
      Ref: TerraformStateTable
Parameters:
  BucketName:
    Default: ''
    Description: "(optional) Name for the S3 bucket"
    Type: String
  TableName:
    Default: ''
    Description: "(optional) Name for the DynamoDB table"
    Type: String
Resources:
  TerraformStateBucket:
    DeletionPolicy: Delete
    Properties:
      AccessControl: Private
      BucketName:
        Fn::If:
          - BucketNameOmitted
          - Ref: AWS::NoValue
          - Ref: BucketName
      LifecycleConfiguration:
        Rules:
          - NoncurrentVersionExpirationInDays: 90
            Status: Enabled
      VersioningConfiguration:
        Status: Enabled
    Type: AWS::S3::Bucket
  TerraformStateTable:
    Properties:
      AttributeDefinitions:
        - AttributeName: LockID
          AttributeType: S
      BillingMode: PAY_PER_REQUEST
      KeySchema:
        - AttributeName: LockID
          KeyType: HASH
      TableName:
        Fn::If:
          - TableNameOmitted
          - Ref: AWS::NoValue
          - Ref: TableName
    Type: AWS::DynamoDB::Table
`;

  const cfnTemplatePath = path.join("cfn-templates", "tf-state.yml");
  if (await pathExists(cfnTemplatePath)) {
    logGreen(
      "CFN template file already exists; would have written this to it:",
    );
    console.log(cfnTemplateContents);
    console.log();
  } else {
    if (!(await pathExists("cfn-templates"))) {
      await fs.promises.mkdir("cfn-templates");
    }
    logGreen(`Writing ${cfnTemplatePath}...`);
    await fs.promises.writeFile(cfnTemplatePath, cfnTemplateContents);
  }
}

export async function awsTfWithS3Backend(): Promise<void> {
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
            stackName: \`\${envOptions[process.env.IHLP_ENV].namespace}-tf-state\`,
            stackTags: envOptions[process.env.IHLP_ENV].tags,
            templatePath: "./cfn-templates/tf-state.yml"
          },
          type: "aws-cfn-stack",
        },
        {
          options: {
            bucketNames: \`\\\${aws-cfn-output stack=\${
              envOptions[process.env.IHLP_ENV].namespace
            }-tf-state,output=BucketName}\`,
          },
          type: "aws-empty-s3-buckets-on-destroy",
        },
        {
          options: {
            backendConfig: {
              bucket: \`\\\${aws-cfn-output stack=\${
                envOptions[process.env.IHLP_ENV].namespace
              }-tf-state,output=BucketName}\`,
              dynamodb_table: \`\\\${aws-cfn-output stack=\${
                envOptions[process.env.IHLP_ENV].namespace
              }-tf-state,output=TableName}\`,
              region: "\${env IHLP_LOCATION}",
            },
            terraformVersion: envOptions[process.env.IHLP_ENV].tfVersion, // specify here or in .terraform-version file in terraform directory
            variables: {
              region: "\${env IHLP_LOCATION}",
              tags: envOptions[process.env.IHLP_ENV].tags
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
`;

  const tfGitIgnore = `.terraform
`;

  const tfConfig = `terraform {
  backend "s3" {
    key = "example.tfstate"
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

  await writeS3BackendCfnTemplate();

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

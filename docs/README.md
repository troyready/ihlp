# IHLP

**_The International House of Loading Programs_**

## Overview

IHLP is a cross-platform program designed as a lightweight helper for infrastructure management.

It compliments tools like Terraform and Serverless Framework, adding pre-deployment (like installing specific Terraform versions or initializing per-environment Terraform backends) and post-deployment (like syncing files to a S3 bucket and invalidating their CloudFront distribution cache) actions.

Its variable system facilitates moving configuration values between tools, e.g. using CloudFormation stack output values in Terraform backend configuration.

## Getting Started

Install `ihlp` via [npm](https://nodejs.org/), e.g.:

```bash
mkdir myproject
cd myproject
npx ihlp init
```

The initialization process will have you choose a starter template. Custom it and deploy it via `npx ihlp deploy -e dev`.

## Uses

* Enabling safe GitOps workflows:
  * When rolling back changes, previous working builds (e.g. AWS Lambda functions or React sites) will be automatically used instead of rebuilding them
* Combining multiple deployment systems (e.g. CloudFormation or Azure Resource Manager alongside Terraform, or Terraform and Serverless Framework)
* Combining multiple Terraform projects
  * Especially useful for when a single Terraform configuration isn't technically feasible (e.g. [dynamic](https://www.terraform.io/docs/language/providers/configuration.html#provider-configuration-1) [provider](https://github.com/hashicorp/terraform/issues/2976) [values](https://github.com/hashicorp/terraform/issues/4149))
* Enforce Terraform execution best-practices:
  * Use of [Workspaces](https://www.terraform.io/docs/language/state/workspaces.html)
  * Retrieving any [module updates](https://www.terraform.io/docs/cli/commands/get.html#update) before plan/apply

## Supported Deployment Systems

* AWS CloudFormation (CFN) / Serverless Application Repository (SAR)
* Azure Resource Manager (ARM)
* GCP Deployment Manager
* Serverless Framework
* Terraform

### AWS CloudFormation (CFN) / Serverless Application Repository (SAR)

#### AWS CloudFormation

Here's a basic IHLP `ihlp.ts` deploying a CloudFormation stack:
```
import type { IHLPConfig } from "ihlp/lib/config";

const envOptions = {
  dev: {
    namespace: "dev",
    someParam: "foo",
    tags: {
      environment: "dev",
      namespace: "dev-app",
    },
  },
};

const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
        {
          options: {
            stackName: `${envOptions[process.env.IHLP_ENV].namespace}-stack-a`,
            stackParameters: {
              SomeParam: envOptions[process.env.IHLP_ENV].someParam
            },
            stackTags: envOptions[process.env.IHLP_ENV].tags,
            templatePath: "./cfn-templates/app-stack-a.yml",
          },
          type: "aws-cfn-stack",
        },
      ],
      locations: ["us-west-2"],
    },
  ],
};

module.exports = ihlpConfig;
```

When running in the `dev` environment (e.g. `npx ihlp deploy -e dev`), the stack `dev-app-stack-a` will be deployed from the template on-disk at `./cfn-templates/app-stack-a.yml` with parameter `SomeParam` set to `foo`.

#### AWS Serverless Application Repository (SAR)

Applications available in the [Serverless Application Repository](https://aws.amazon.com/serverless/serverlessrepo/) can be deployed like regular CloudFormation stacks; simply substitute an `applicationId` in place of the `templatePath`:
```
import type { IHLPConfig } from "ihlp/lib/config";

const envOptions = {
  dev: {
    namespace: "dev",
    appVersion: "1.0.0",
    tags: {
      environment: "dev",
      namespace: "dev-app",
    },
  },
};

const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
        {
          options: {
            applicationId: "arn:aws:serverlessrepo:us-east-2:012345678901:applications/example",
            applicationVersion: envOptions[process.env.IHLP_ENV].appVersion,
            stackName: `${envOptions[process.env.IHLP_ENV].namespace}-stack-a`,
            stackParameters: {
              SomeParam: envOptions[process.env.IHLP_ENV].someParam
            },
            stackTags: envOptions[process.env.IHLP_ENV].tags,
          },
          type: "aws-cfn-stack",
        },
      ],
      locations: ["us-west-2"],
    },
  ],
};

module.exports = ihlpConfig;
```
When running in the `dev` environment (e.g. `npx ihlp deploy -e dev`), the stack `serverlessrepo-dev-app-stack-a` will be deployed from the SAR app `arn:aws:serverlessrepo:us-east-2:012345678901:applications/example` with parameter `SomeParam` set to `foo`.

## FAQ

### Disabling Color in Logging

Messages are logged with color using the [chalk library](https://github.com/chalk/chalk/tree/v4.1.2#chalksupportscolor). It can be explicitly disabled by setting the [FORCE_COLOR environment variable](https://github.com/chalk/chalk/tree/v4.1.2#chalksupportscolor) to `0`.

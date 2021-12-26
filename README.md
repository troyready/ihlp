# IHLP

**_The International House of Loading Programs_**

## Overview

TEST

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

## FAQ

### Disabling Color in Logging

Messages are logged with color using the [chalk library](https://github.com/chalk/chalk/tree/v4.1.2#chalksupportscolor). It can be explicitly disabled by setting the [FORCE_COLOR environment variable](https://github.com/chalk/chalk/tree/v4.1.2#chalksupportscolor) to `0`.

/**
 * AWS Terraform-managed EKS with FluxV2 config generator
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as path from "path";
import { writeEksBase } from "../aws_tf_eks";
import { logGreen, pathExists } from "../../util";

export async function awsTfEksFluxV2(): Promise<void> {
  const configContents = `import type { IHLPConfig } from "ihlp/lib/config";

const envOptions = {
  dev: {
    clusterName: "dev-k8s",
    kubectlAccessPrincipalArn: "YOURROLEARNHERE",
    namespace: "dev-k8s-infra",
    repoName: "dev-flux",
    tags: {
      environment: "dev",
      namespace: "dev-k8s-infra",
    },
    tfVersion: "1.2.8",
  },
  prod: {
    clusterName: "prod-k8s",
    kubectlAccessPrincipalArn: "YOURROLEARNHERE",
    namespace: "prod-k8s-infra",
    repoName: "prod-flux",
    tags: {
      environment: "prod",
      namespace: "prod-k8s-infra",
    },
    tfVersion: "1.2.8",
  },
};

const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
        {
          name: "backend",
          options: {
            stackName: \`\${envOptions[process.env.IHLP_ENV].namespace}-tf-state\`,
            stackTags: envOptions[process.env.IHLP_ENV].tags,
            templatePath: "./cfn-templates/tf-state.yml",
          },
          type: "aws-cfn-stack",
        },
        {
          name: "backend",
          options: {
            bucketNames: \`\\\${aws-cfn-output stack=\${
              envOptions[process.env.IHLP_ENV].namespace
            }-tf-state,output=BucketName}\`,
          },
          type: "aws-empty-s3-buckets-on-destroy",
        },
        {
          name: "eks",
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
              cluster_name: envOptions[process.env.IHLP_ENV].clusterName,
              kubectl_access_principal_arn:
                envOptions[process.env.IHLP_ENV].kubectlAccessRoleArn,
              region: "\${env IHLP_LOCATION}",
              tags: envOptions[process.env.IHLP_ENV].tags,
            },
            workspace: process.env.IHLP_ENV,
          },
          path: "eks-base.tf",
          type: "terraform",
        },
        {
          name: "eks",
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
              cluster_name: envOptions[process.env.IHLP_ENV].clusterName,
              region: "\${env IHLP_LOCATION}",
              tags: envOptions[process.env.IHLP_ENV].tags,
            },
            workspace: process.env.IHLP_ENV,
          },
          path: "eks-auth-and-nodes.tf",
          type: "terraform",
        },
        {
          name: "repo",
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
            terraformVersion: envOptions[process.env.IHLP_ENV].tfVersion,
            variables: {
              region: "\${env IHLP_LOCATION}",
              repo_name: envOptions[process.env.IHLP_ENV].repoName,
              tags: envOptions[process.env.IHLP_ENV].tags,
            },
            workspace: process.env.IHLP_ENV,
          },
          path: "flux-repo.tf",
          type: "terraform",
        },
        {
          name: "flux",
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
            terraformVersion: envOptions[process.env.IHLP_ENV].tfVersion,
            variables: {
              cluster_name: envOptions[process.env.IHLP_ENV].clusterName,
              region: "\${env IHLP_LOCATION}",
              repo_name: envOptions[process.env.IHLP_ENV].repoName,
              tags: envOptions[process.env.IHLP_ENV].tags,
              target_path: \`/clusters/\${
                envOptions[process.env.IHLP_ENV].clusterName
              }\`,
            },
            workspace: process.env.IHLP_ENV,
          },
          path: "flux.tf",
          type: "terraform",
        },
      ],
      locations: ["us-west-2"],
    },
  ],
};

module.exports = ihlpConfig;
`;

  const gitIgnoreContents = `.terraform
node_modules

# Ignore any infrastructure repos co-located here
/*-flux
`;

  const readmeContents = `# Overview

This repo represents a sample Terraform infrastructure deployment of EKS & [Flux](https://fluxcd.io/). Terraform is used to manage the base infrastructure components, including a CodeCommit git repo configured for continuous deployment via Flux.

## Prerequisites

- [awscli](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html)

## Setup

### Deployment

#### Part 1: Deploying Flux

1. Update the \`kubectlAccessPrincipalArn\` values in [ihlp.ts](./ihlp.ts) to specify the IAM principal (e.g. Role) to which cluster admin access should be granted.
   E.g., if you assume an IAM role for operating in your account \`aws sts get-caller-identity --query 'Arn' --output text\` will show you the assumed role principal like:

    \`\`\`text
    arn:aws:sts::123456789012:assumed-role/myIamRole/fitzwilliam.darcy
    \`\`\`

    You can use that arn to determine the IAM role arn for ihlp.ts:

    \`\`\`ts
    kubectlAccessPrincipalArn: "arn:aws:iam::123456789012:role/myIamRole",
    \`\`\`

2. After updating the principal ARN, deploy to the dev environment (\`npx ihlp deploy -a -e dev\`).
   This will take some time to complete.

#### Part 2: Pushing to the Flux repo

1. Setup and push an initial commit to the AWS CodeCommit git repository called \`dev-flux\`.

    macOS/Linux:

    \`\`\`sh
    CC_REPO_URL=https://git-codecommit.us-west-2.amazonaws.com/v1/repos/dev-flux
    cd dev-flux
    git init
    git config credential."$CC_REPO_URL".helper '!aws codecommit credential-helper $@'
    git config credential."$CC_REPO_URL".UseHttpPath true
    git remote add origin $CC_REPO_URL
    git add *
    git commit -m "initial commit"
    git push --set-upstream origin main
    \`\`\`

    Windows:

    \`\`\`powershell
    cd $home
    $CC_REPO_URL = "https://git-codecommit.us-west-2.amazonaws.com/v1/repos/dev-flux"
    cd dev-flux
    git init
    git config credential."$CC_REPO_URL".helper '!aws codecommit credential-helper $@'
    git config credential."$CC_REPO_URL".UseHttpPath true
    git remote add origin $CC_REPO_URL
    git add *
    git commit -m "initial commit"
    git push --set-upstream origin main
    \`\`\`

#### Part 3: Observing Deployment

A Terraform-managed k8s config file for the cluster will be created in \`./.kube/dev/config\`. It can be used directly (e.g. \`export KUBECONFIG="$(pwd)/.kube/dev/config"\`), or the AWS CLI can be used to generate a kubeconfig in your user's default location (\`aws eks --region us-west-2 update-kubeconfig --name dev-k8s\`).

At this point, the [Flux getting started guide](https://fluxcd.io/docs/get-started/) steps through deployment have been completed; notes on viewing the deployment & service are [available here](https://fluxcd.io/docs/get-started/#watch-flux-sync-the-application). Flux will be deploying the podinfo application defined in the \`dev-flux\` repo, visible via \`kubectl -n default get deployments,services\`

### Post-Deployment

It is **strongly recommended** to [disable public access](https://docs.aws.amazon.com/eks/latest/userguide/cluster-endpoint.html#modify-endpoint-access) to the EKS API if this infrastructure will be left running for any period of time.

### Teardown

\`npx ihlp destroy -a -e dev\` will teardown all infrastructure deployed as part of this project.
`;

  const podinfoKustomization = `---
apiVersion: kustomize.toolkit.fluxcd.io/v1beta2
kind: Kustomization
metadata:
  name: podinfo
  namespace: flux-system
spec:
  interval: 5m0s
  path: ./kustomize
  prune: true
  sourceRef:
    kind: GitRepository
    name: podinfo
  targetNamespace: default
`;

  const podinfoSource = `---
apiVersion: source.toolkit.fluxcd.io/v1beta1
kind: GitRepository
metadata:
  name: podinfo
  namespace: flux-system
spec:
  interval: 30s
  ref:
    branch: master
  url: https://github.com/stefanprodan/podinfo
`;

  const fluxRepoTfConfig = `# Backend setup
terraform {
  backend "s3" {
    key = "flux-repo.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.33"
    }
  }

  required_version = "~> 1.0"
}

# Variable definitions
variable "region" {
  type = string
}
variable "repo_name" {
  type = string
}
variable "tags" {
  default = {}
  type    = map(any)
}

# Data and resources
provider "aws" {
  region = var.region
}

resource "aws_codecommit_repository" "flux_repository" {
  repository_name = var.repo_name
  tags            = var.tags
}
`;

  const fluxTfConfig = `# Backend setup
terraform {
  backend "s3" {
    key = "eks-flux.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.33"
    }

    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.12"
    }

    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }

    # Using custom version for:
    # https://github.com/hashicorp/terraform-provider-tls/pull/97
    # This would also work instead:
    # https://github.com/hashicorp/terraform-provider-tls/pull/95
    tls = {
      source  = "troyready/tls"
      version = "~> 3.1.50"
    }
  }

  required_version = "~> 1.0"
}

# Variable definitions
variable "branch" {
  default = "main"
}
variable "cluster_name" {
  type = string
}
variable "region" {
  type = string
}
variable "repo_name" {
  type = string
}
variable "tags" {
  default = {}
  type    = map(any)
}
variable "target_path" {
  type = string
}

# Data and resources
provider "aws" {
  region = var.region
}

# Would be ideal to use aws credential helper instead, if/when go-git gains support for it
# (then would need to see about adding support to Flux itself)
# https://github.com/go-git/go-git/issues/250 / https://github.com/go-git/go-git/issues/490
resource "tls_private_key" "flux" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

data "aws_codecommit_repository" "repo" {
  repository_name = var.repo_name
}
data "tls_ssh_key_scan" "repo" {
  host = regex(
    "ssh://([-\\\\.a-zA-Z0-9]*)/.*",
    data.aws_codecommit_repository.repo.clone_url_ssh
  )[0]
}

resource "aws_iam_user" "flux" {
  name = "\${var.repo_name}-user"
  tags = var.tags
}
data "aws_iam_policy_document" "flux_user_policy" {
  statement {
    effect = "Allow"

    actions = [
      "codecommit:GitPull",
    ]

    resources = [
      data.aws_codecommit_repository.repo.arn,
    ]
  }
}
resource "aws_iam_user_policy" "flux" {
  policy = data.aws_iam_policy_document.flux_user_policy.json
  user   = aws_iam_user.flux.name
}

resource "aws_iam_user_ssh_key" "flux" {
  encoding   = "SSH"
  public_key = tls_private_key.flux.public_key_openssh
  username   = aws_iam_user.flux.name
}

data "aws_eks_cluster" "cluster" {
  name = var.cluster_name
}

data "aws_eks_cluster_auth" "cluster_auth" {
  name = data.aws_eks_cluster.cluster.id
}

provider "kubernetes" {
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.cluster.certificate_authority.0.data)
  host                   = data.aws_eks_cluster.cluster.endpoint
  token                  = data.aws_eks_cluster_auth.cluster_auth.token
}

provider "helm" {
  kubernetes {
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.cluster.certificate_authority[0].data)
    host                   = data.aws_eks_cluster.cluster.endpoint
    token                  = data.aws_eks_cluster_auth.cluster_auth.token
  }
}

# =============================================================================================
# Bootstrap cluster using flux2 helm chart. This chart simply installs flux2
# Ref: https://artifacthub.io/packages/helm/fluxcd-community/flux2
# =============================================================================================

# Note: Do not change the namespace name. This mimics the behaviour of "flux bootstrap".
resource "kubernetes_namespace" "flux_system" {
  metadata {
    name = "flux-system"
  }
}

resource "helm_release" "flux2" {
  repository = "https://fluxcd-community.github.io/helm-charts"
  chart      = "flux2"
  version    = "2.12.4"

  name      = "flux2"
  namespace = kubernetes_namespace.flux_system.metadata[0].name
}

# =============================================================================================
# Bootstrap cluster using flux2-sync helm chart to start reconciliation of resources.
# Ref https://artifacthub.io/packages/helm/fluxcd-community/flux2-sync
# flux2-sync is used to setup the GitRepository and Kustomization resources
# =============================================================================================

resource "kubernetes_secret" "ssh_keypair" {
  type = "Opaque"

  data = {
    "identity.pub" = tls_private_key.flux.public_key_openssh
    identity       = tls_private_key.flux.private_key_pem
    known_hosts    = data.tls_ssh_key_scan.repo.public_host_key
  }

  metadata {
    name      = "ssh-keypair"
    namespace = kubernetes_namespace.flux_system.metadata[0].name
  }

}

resource "helm_release" "flux2_sync" {
  repository = "https://fluxcd-community.github.io/helm-charts"
  chart      = "flux2-sync"
  version    = "1.8.2"

  # Note: Do not change the name or namespace of this resource. These mimic the behaviour of "flux bootstrap".
  name      = "flux-system"
  namespace = kubernetes_namespace.flux_system.metadata[0].name

  set {
    name  = "gitRepository.spec.url"
    # An alternate option to this substitution would be to use a CodeCommit ServiceSpecificCredential
    # https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_service_specific_credential
    value = replace(
      data.aws_codecommit_repository.repo.clone_url_ssh,
      "ssh://",
      "ssh://\${aws_iam_user_ssh_key.flux.ssh_public_key_id}@"
    )
  }

  set {
    name  = "gitRepository.spec.ref.branch"
    value = var.branch
  }

  set {
    name  = "gitRepository.spec.secretRef.name"
    value = kubernetes_secret.ssh_keypair.metadata[0].name
  }

  set {
    name  = "gitRepository.spec.interval"
    value = "1m"
  }

  set {
    name  = "kustomization.spec.path"
    value = var.target_path
  }

  depends_on = [
    helm_release.flux2,
  ]
}
`;

  await writeEksBase();

  if (await pathExists(".gitignore")) {
    logGreen(".gitignore file already exists; would have written this to it:");
    console.log(gitIgnoreContents);
  } else {
    logGreen("Writing .gitignore...");
    await fs.promises.writeFile(".gitignore", gitIgnoreContents);
  }

  if (await pathExists("ihlp.ts")) {
    logGreen(
      "ihlp.ts config file already exists; would have written this to it:",
    );
    console.log(configContents);
  } else {
    logGreen("Writing ihlp.ts...");
    await fs.promises.writeFile("ihlp.ts", configContents);
  }

  if (await pathExists("README.md")) {
    logGreen("README file already exists; would have written this to it:");
    console.log(readmeContents);
  } else {
    logGreen("Writing README.md...");
    await fs.promises.writeFile("README.md", readmeContents);
  }

  const podinfoKustomizationPath = path.join(
    "dev-flux",
    "clusters",
    "dev-k8s",
    "podinfo-kustomization.yaml",
  );
  if (await pathExists(podinfoKustomizationPath)) {
    logGreen(
      "dev-flux/clusters/dev-k8s/podinfo-kustomization.yaml already exists; would have written this to it:",
    );
    console.log(podinfoKustomization);
    console.log();
  } else {
    if (!(await pathExists(path.join("dev-flux", "clusters", "dev-k8s")))) {
      if (!(await pathExists(path.join("dev-flux", "clusters")))) {
        if (!(await pathExists("dev-flux"))) {
          await fs.promises.mkdir("dev-flux");
        }
        await fs.promises.mkdir(path.join("dev-flux", "clusters"));
      }
      await fs.promises.mkdir(path.join("dev-flux", "clusters", "dev-k8s"));
    }
    logGreen(`Writing ${podinfoKustomizationPath}...`);
    await fs.promises.writeFile(podinfoKustomizationPath, podinfoKustomization);
  }

  const podinfoSourcePath = path.join(
    "dev-flux",
    "clusters",
    "dev-k8s",
    "podinfo-source.yaml",
  );
  if (await pathExists(podinfoSourcePath)) {
    logGreen(
      "dev-flux/clusters/dev-k8s/podinfo-source.yaml already exists; would have written this to it:",
    );
    console.log(podinfoSource);
    console.log();
  } else {
    logGreen(`Writing ${podinfoSourcePath}...`);
    await fs.promises.writeFile(podinfoSourcePath, podinfoSource);
  }

  const fluxRepoTfConfigPath = path.join("flux-repo.tf", "main.tf");
  if (await pathExists(fluxRepoTfConfigPath)) {
    logGreen(
      "flux-repo.tf/main.tf already exists; would have written this to it:",
    );
    console.log(fluxRepoTfConfig);
    console.log();
  } else {
    if (!(await pathExists("flux-repo.tf"))) {
      await fs.promises.mkdir("flux-repo.tf");
    }
    logGreen(`Writing ${fluxRepoTfConfigPath}...`);
    await fs.promises.writeFile(fluxRepoTfConfigPath, fluxRepoTfConfig);
  }

  const fluxTfConfigPath = path.join("flux.tf", "main.tf");
  if (await pathExists(fluxTfConfigPath)) {
    logGreen("flux.tf/main.tf already exists; would have written this to it:");
    console.log(fluxTfConfig);
    console.log();
  } else {
    if (!(await pathExists("flux.tf"))) {
      await fs.promises.mkdir("flux.tf");
    }
    logGreen(`Writing ${fluxTfConfigPath}...`);
    await fs.promises.writeFile(fluxTfConfigPath, fluxTfConfig);
  }

  logGreen("Example generation complete");
}

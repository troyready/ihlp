/**
 * AWS Terraform-managed EKS with FluxV2 config generator
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as path from "path";
import { generateTsconfig } from "../";
import { writeS3BackendCfnTemplate } from "../aws_tf_s3_backend";
import { logGreen, pathExists } from "../../util";

export async function awsTfEksFluxV2(): Promise<void> {
  const configContents = `import type { IHLPConfig } from "ihlp/lib/config";

const envOptions = {
  dev: {
    clusterName: "dev-k8s",
    kubectlAccessRoleArn: "YOURROLEARNHERE",
    namespace: "dev-k8s-infra",
    repoName: "dev-flux",
    tags: {
      environment: "dev",
      namespace: "dev-k8s-infra",
    },
    tfVersion: "1.1.0",
  },
  prod: {
    clusterName: "prod-k8s",
    kubectlAccessRoleArn: "YOURROLEARNHERE",
    namespace: "prod-k8s-infra",
    repoName: "prod-flux",
    tags: {
      environment: "prod",
      namespace: "prod-k8s-infra",
    },
    tfVersion: "1.1.0",
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
              kubectl_access_role_arn:
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
          // initial deployment requires target of SSH key
          name: "flux-ssh-key",
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
            targets: [
              "aws_iam_user.flux",
              "aws_iam_user_ssh_key.flux",
            ],
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

1. Update the \`kubectlAccessRoleArn\` values in [ihlp.ts](./ihlp.ts) to specify the IAM role to which cluster admin access should be granted.
   E.g., if you assume an IAM role for operating in your account \`aws sts get-caller-identity --query 'Arn' --output text\` will show you the assumed role principal like:

    \`\`\`text
    arn:aws:sts::123456789012:assumed-role/myIamRole/fitzwilliam.darcy
    \`\`\`

    You can use that arn to determine the IAM role arn for ihlp.ts:

    \`\`\`ts
    kubectlAccessRoleArn: "arn:aws:iam::123456789012:role/myIamRole",
    \`\`\`

    (For any other configuration, like using IAM users via \`mapUsers\`, see the \`kubernetes_config_map\` resource in \`eks-base.tf/main.tf\`)

2. After updating the role ARN, deploy to the dev environment (\`npx ihlp deploy -a -e dev\`).
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

\`npx ihlp destroy -a -e dev --target flux-ssh-key repo eks backend\` will teardown all infrastructure deployed as part of this project (setting the \`target\` will avoid timeouts while trying to delete the flux namespace in k8s).
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

  const kubeConfigTemplate = `apiVersion: v1
clusters:
- cluster:
    server: \${endpoint_url}
    certificate-authority-data: \${ca_cert}
  name: kubernetes
contexts:
- context:
    cluster: kubernetes
    user: aws
  name: aws
current-context: aws
kind: Config
preferences: {}
users:
- name: aws
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1alpha1
      command: aws
      args:
        - "eks"
        - "get-token"
        - "--cluster-name"
        - "\${cluster_name}"
        # - "--role-arn"
        # - "<role-arn>"
      # env:
        # - name: AWS_PROFILE
        #   value: "<aws-profile>"
`;

  const eksbaseTfConfig = `# Backend setup
terraform {
  backend "s3" {
    key = "eks-base.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.63"
    }

    # https://github.com/hashicorp/terraform-provider-http/issues/49
    http = {
      source  = "terraform-aws-modules/http"
      version = "~> 2.4"
    }

    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }

    tls = {
      source  = "hashicorp/tls"
      version = "~> 3.1"
    }
  }

  required_version = "~> 1.0"
}

# Variable definitions
variable "az_count" {
  default = 3
}
variable "cluster_name" {
  type = string
}
variable "cluster_version" {
  default = null
  type    = string
}
variable "kubectl_access_role_arn" {
  type = string
}
variable "node_group_desired_size" {
  default = 1
}
variable "node_group_max_size" {
  default = 3
}
variable "node_group_min_size" {
  default = 1
}
variable "region" {
  type = string
}
variable "tags" {
  default = {}
  type    = map(any)
}
variable "vpc_cidr" {
  default = "10.0.64.0/18"
}

# Provider and access setup
provider "aws" {
  region = var.region
}

# Data and resources
data "aws_availability_zones" "available" {}
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}


module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 3.10.0"

  cidr               = var.vpc_cidr
  enable_nat_gateway = true
  name               = var.cluster_name

  azs = [
    for num in range(var.az_count) :
    data.aws_availability_zones.available.names[num]
  ]

  private_subnets = [
    for num in range(0, var.az_count) :
    cidrsubnet(var.vpc_cidr, 6, num)
  ]

  public_subnets = [
    for num in range(var.az_count, var.az_count * 2) :
    cidrsubnet(var.vpc_cidr, 6, num)
  ]

  tags = merge(
    var.tags,
    {
      "kubernetes.io/cluster/\${var.cluster_name}" = "shared",
    }
  )
}

data "aws_iam_policy_document" "cluster-assume-role-policy" {
  statement {
    actions = [
      "sts:AssumeRole",
    ]

    principals {
      type = "Service"

      identifiers = [
        "eks.amazonaws.com",
      ]
    }
  }
}
resource "aws_iam_role" "cluster" {
  assume_role_policy = data.aws_iam_policy_document.cluster-assume-role-policy.json
  name_prefix        = "eks-cluster-"
  tags               = var.tags
}
resource "aws_iam_role_policy_attachment" "cluster-AmazonEKSClusterPolicy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.cluster.name
}

resource "aws_security_group" "cluster" {
  name_prefix = "eks-cluster-"
  description = "Cluster communication with worker nodes"
  tags        = var.tags
  vpc_id      = module.vpc.vpc_id

  egress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"

    cidr_blocks = [
      "0.0.0.0/0",
    ]
  }
}

data "aws_iam_policy_document" "node-assume-role-policy" {
  statement {
    actions = [
      "sts:AssumeRole",
    ]

    principals {
      type = "Service"

      identifiers = [
        "ec2.amazonaws.com",
      ]
    }
  }
}
resource "aws_iam_role" "node" {
  assume_role_policy = data.aws_iam_policy_document.node-assume-role-policy.json
  name_prefix        = "eks-node-"
  tags               = var.tags
}
resource "aws_iam_role_policy_attachment" "node-AmazonEKSWorkerNodePolicy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.node.name
}
resource "aws_iam_role_policy_attachment" "node-AmazonEKS_CNI_Policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.node.name
}
resource "aws_iam_role_policy_attachment" "node-AmazonEC2ContainerRegistryReadOnly" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.node.name
}
resource "aws_iam_role_policy_attachment" "node-AmazonSSMManagedInstanceCore" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  role       = aws_iam_role.node.name
}

resource "aws_security_group" "node" {
  description = "Security group for all nodes in the cluster"
  name_prefix = "eks-node-"
  vpc_id      = module.vpc.vpc_id

  egress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"

    cidr_blocks = [
      "0.0.0.0/0",
    ]
  }

  tags = merge(
    var.tags,
    {
      "kubernetes.io/cluster/\${var.cluster_name}" = "owned",
    }
  )
}
resource "aws_security_group_rule" "node-ingress-self" {
  description              = "Allow node to communicate with each other"
  from_port                = 0
  protocol                 = "-1"
  security_group_id        = aws_security_group.node.id
  source_security_group_id = aws_security_group.node.id
  to_port                  = 65535
  type                     = "ingress"
}

resource "aws_security_group_rule" "node-ingress-cluster" {
  description              = "Allow worker Kubelets and pods to receive communication from the cluster control plane"
  from_port                = 1025
  protocol                 = "tcp"
  security_group_id        = aws_security_group.node.id
  source_security_group_id = aws_security_group.cluster.id
  to_port                  = 65535
  type                     = "ingress"
}
resource "aws_security_group_rule" "cluster-ingress-node-https" {
  description              = "Allow pods to communicate with the cluster API Server"
  from_port                = 443
  protocol                 = "tcp"
  security_group_id        = aws_security_group.cluster.id
  source_security_group_id = aws_security_group.node.id
  to_port                  = 443
  type                     = "ingress"
}

resource "aws_eks_cluster" "cluster" {
  name     = var.cluster_name
  role_arn = aws_iam_role.cluster.arn
  tags     = var.tags

  # version doesn't need to be specified until it's time to upgrade
  version = var.cluster_version

  vpc_config {
    subnet_ids = module.vpc.private_subnets[*]

    security_group_ids = [
      aws_security_group.cluster.id,
    ]
  }

  depends_on = [
    aws_iam_role_policy_attachment.cluster-AmazonEKSClusterPolicy,
    module.vpc,
  ]
}

data "aws_eks_cluster_auth" "cluster_auth" {
  name = aws_eks_cluster.cluster.id
}

provider "kubernetes" {
  host                   = aws_eks_cluster.cluster.endpoint
  cluster_ca_certificate = base64decode(aws_eks_cluster.cluster.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.cluster_auth.token
}

# Ideally this wouldn't be needed at all, if this could be fixed:
# https://github.com/aws/containers-roadmap/issues/654
# or the TF EKS resources gets more advanced support:
# https://github.com/hashicorp/terraform-provider-aws/pull/11426
data "http" "wait_for_cluster" {
  ca_certificate = base64decode(aws_eks_cluster.cluster.certificate_authority[0].data)
  url            = format("%s/healthz", aws_eks_cluster.cluster.endpoint)

  # https://github.com/terraform-aws-modules/terraform-aws-eks/pull/1253#issuecomment-784968862
  timeout = 15 * 60
}

resource "kubernetes_config_map" "aws_auth_configmap" {
  data = {
    mapRoles = <<YAML
- rolearn: \${aws_iam_role.node.arn}
  username: system:node:{{EC2PrivateDNSName}}
  groups:
    - system:bootstrappers
    - system:nodes
- rolearn: arn:\${data.aws_partition.current.partition}:iam::\${data.aws_caller_identity.current.account_id}:root
  username: kubectl-root-access-user
  groups:
    - system:masters
- rolearn: \${var.kubectl_access_role_arn}
  username: kubectl-access-user
  groups:
    - system:masters
YAML
#   # In place of, or addition to, the IAM role ^ defined here in the system:masters group,
#   # individual IAM users can be specified by adding mapUsers to the data block:
#     mapUsers = <<YAML
# - userarn: arn:aws:iam::123456789012:user/fitzwilliam.darcy
#   username: fitzwilliam.darcy
#   groups:
#     - system:masters
# YAML
  }

  metadata {
    name      = "aws-auth"
    namespace = "kube-system"
  }

  depends_on = [
    data.http.wait_for_cluster,
  ]
}

resource "aws_eks_node_group" "node" {
  cluster_name  = aws_eks_cluster.cluster.name
  node_role_arn = aws_iam_role.node.arn
  subnet_ids    = module.vpc.private_subnets[*]

  scaling_config {
    desired_size = var.node_group_desired_size
    max_size     = var.node_group_max_size
    min_size     = var.node_group_min_size
  }

  lifecycle {
    create_before_destroy = true

    ignore_changes = [
      scaling_config[0].desired_size,
    ]
  }

  # Ensure that IAM Role permissions are created before and deleted after EKS Node Group handling.
  # Otherwise, EKS will not be able to properly delete EC2 Instances and Elastic Network Interfaces.
  depends_on = [
    aws_iam_role_policy_attachment.node-AmazonEKSWorkerNodePolicy,
    aws_iam_role_policy_attachment.node-AmazonEKS_CNI_Policy,
    aws_iam_role_policy_attachment.node-AmazonEC2ContainerRegistryReadOnly,
    aws_iam_role_policy_attachment.node-AmazonSSMManagedInstanceCore,
    kubernetes_config_map.aws_auth_configmap,
  ]
}

# https://docs.aws.amazon.com/eks/latest/userguide/create-kubeconfig.html
resource "local_file" "kube_config" {
  filename = "\${path.module}/../.kube/\${terraform.workspace}/config"

  content = templatefile(
    "\${path.module}/templates/kubeconfig-template.yaml.tpl",
    {
      ca_cert      = aws_eks_cluster.cluster.certificate_authority[0].data,
      cluster_name = var.cluster_name,
      endpoint_url = aws_eks_cluster.cluster.endpoint,
    }
  )
}

# https://docs.aws.amazon.com/eks/latest/userguide/enable-iam-roles-for-service-accounts.html
data "tls_certificate" "cluster_cert_thumbprint" {
  url = aws_eks_cluster.cluster.identity[0].oidc[0].issuer
}
resource "aws_iam_openid_connect_provider" "cluster" {
  tags = var.tags
  url  = aws_eks_cluster.cluster.identity[0].oidc[0].issuer

  client_id_list = [
    "sts.amazonaws.com",
  ]

  thumbprint_list = [
    data.tls_certificate.cluster_cert_thumbprint.certificates[0].sha1_fingerprint,
  ]
}

resource "aws_ssm_parameter" "oidc_iam_provider_cluster_url" {
  name  = "/\${var.cluster_name}/oidc-iam-provider-cluster-url"
  tags  = var.tags
  type  = "String"
  value = aws_iam_openid_connect_provider.cluster.url
}
resource "aws_ssm_parameter" "oidc_iam_provider_cluster_arn" {
  name  = "/\${var.cluster_name}/oidc-iam-provider-cluster-arn"
  tags  = var.tags
  type  = "String"
  value = aws_iam_openid_connect_provider.cluster.arn
}
`;

  const fluxRepoTfConfig = `# Backend setup
terraform {
  backend "s3" {
    key = "flux-repo.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.63"
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
      version = "~> 3.63"
    }

    flux = {
      source  = "fluxcd/flux"
      version = "~> 0.7"
    }

    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "~> 1.0"
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

provider "flux" {}

# Would be ideal to use aws credential helper instead, if/when go-git gains support for it
# (then would need to see about adding support to Flux itself)
# https://github.com/go-git/go-git/issues/250
resource "tls_private_key" "main" {
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
  public_key = tls_private_key.main.public_key_openssh
  username   = aws_iam_user.flux.name
}

data "aws_eks_cluster" "cluster" {
  name = var.cluster_name
}

data "aws_eks_cluster_auth" "cluster_auth" {
  name = data.aws_eks_cluster.cluster.id
}

provider "kubernetes" {
  host                   = data.aws_eks_cluster.cluster.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.cluster.certificate_authority.0.data)
  token                  = data.aws_eks_cluster_auth.cluster_auth.token
}

resource "kubernetes_namespace" "flux" {
  metadata {
    name = "flux-system"
  }

  lifecycle {
    ignore_changes = [
      metadata[0].labels,
    ]
  }
}

data "flux_install" "main" {
  target_path = var.target_path
}

data "flux_sync" "main" {
  branch      = var.branch
  target_path = var.target_path

  # would be a little cleaner to just use http credentials (and not need to do this replacement)
  # if it was supported in TF:
  # https://github.com/hashicorp/terraform-provider-aws/issues/3233
  url = replace(
    data.aws_codecommit_repository.repo.clone_url_ssh,
    "ssh://",
    "ssh://\${aws_iam_user_ssh_key.flux.ssh_public_key_id}@"
  )
}

provider "kubectl" {
  host                   = data.aws_eks_cluster.cluster.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.cluster.certificate_authority.0.data)
  token                  = data.aws_eks_cluster_auth.cluster_auth.token
  load_config_file       = false
}

data "kubectl_file_documents" "install" {
  content = data.flux_install.main.content
}

data "kubectl_file_documents" "sync" {
  content = data.flux_sync.main.content
}

locals {
  install = [for v in data.kubectl_file_documents.install.documents : {
    data : yamldecode(v)
    content : v
    }
  ]
  sync = [for v in data.kubectl_file_documents.sync.documents : {
    data : yamldecode(v)
    content : v
    }
  ]
}

resource "kubectl_manifest" "install" {
  for_each = { for v in local.install : lower(join("/", compact([v.data.apiVersion, v.data.kind, lookup(v.data.metadata, "namespace", ""), v.data.metadata.name]))) => v.content }

  yaml_body = each.value

  depends_on = [
    kubernetes_namespace.flux,
  ]
}

# The dependency on the IAM User ssh_public_key_id will cause this to fail on initial deployment unless -target="aws_iam_user_ssh_key.flux" is used
# (or the aws_iam_user_ssh_key resource is moved out of this module)
resource "kubectl_manifest" "sync" {
  for_each = { for v in local.sync : lower(join("/", compact([v.data.apiVersion, v.data.kind, lookup(v.data.metadata, "namespace", ""), v.data.metadata.name]))) => v.content }

  yaml_body = each.value

  depends_on = [
    kubernetes_namespace.flux,
  ]
}

resource "kubernetes_secret" "main" {

  metadata {
    name      = data.flux_sync.main.secret
    namespace = data.flux_sync.main.namespace
  }

  data = {
    identity       = tls_private_key.main.private_key_pem
    "identity.pub" = tls_private_key.main.public_key_pem
    known_hosts    = data.tls_ssh_key_scan.repo.public_host_key
  }

  depends_on = [
    kubectl_manifest.install,
  ]
}

resource "local_file" "install" {
  content  = data.flux_install.main.content
  filename = "\${path.module}/../\${var.repo_name}\${data.flux_install.main.path}"
}

resource "local_file" "sync" {
  content  = data.flux_sync.main.content
  filename = "\${path.module}/../\${var.repo_name}\${data.flux_sync.main.path}"
}

resource "local_file" "kustomize" {
  content  = data.flux_sync.main.kustomize_content
  filename = "\${path.module}/../\${var.repo_name}\${data.flux_sync.main.kustomize_path}"
}
`;

  if (await pathExists(".gitignore")) {
    logGreen(".gitignore file already exists; would have written this to it:");
    console.log(gitIgnoreContents);
  } else {
    logGreen("Writing .gitignore...");
    await fs.promises.writeFile(".gitignore", gitIgnoreContents);
  }

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

  if (await pathExists("README.md")) {
    logGreen("README file already exists; would have written this to it:");
    console.log(readmeContents);
  } else {
    logGreen("Writing README.md...");
    await fs.promises.writeFile("README.md", readmeContents);
  }

  await writeS3BackendCfnTemplate();

  const kubeConfigTemplatePath = path.join(
    "eks-base.tf",
    "templates",
    "kubeconfig-template.yaml.tpl",
  );
  if (await pathExists(kubeConfigTemplatePath)) {
    logGreen(
      "eks-base.tf/templates/kubeconfig-template.yaml.tpl already exists; would have written this to it:",
    );
    console.log(kubeConfigTemplate);
    console.log();
  } else {
    if (!(await pathExists(path.join("eks-base.tf", "templates")))) {
      if (!(await pathExists("eks-base.tf"))) {
        await fs.promises.mkdir("eks-base.tf");
      }
      await fs.promises.mkdir(path.join("eks-base.tf", "templates"));
    }
    logGreen(`Writing ${kubeConfigTemplatePath}...`);
    await fs.promises.writeFile(kubeConfigTemplatePath, kubeConfigTemplate);
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

  const eksbaseTfConfigPath = path.join("eks-base.tf", "main.tf");
  if (await pathExists(eksbaseTfConfigPath)) {
    logGreen(
      "eks-base.tf/main.tf already exists; would have written this to it:",
    );
    console.log(eksbaseTfConfig);
    console.log();
  } else {
    logGreen(`Writing ${eksbaseTfConfigPath}...`);
    await fs.promises.writeFile(eksbaseTfConfigPath, eksbaseTfConfig);
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

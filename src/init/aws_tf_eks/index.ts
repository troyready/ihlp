/**
 * AWS Terraform-managed EKS with IAM integration config generator
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as path from "path";
import { generateTsconfig } from "../";
import { writeS3BackendCfnTemplate } from "../aws_tf_s3_backend";
import { logGreen, pathExists } from "../../util";

export async function writeEksBase(): Promise<void> {
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

  const eksbaseReadme = `## Overview

This Terraform module contains the base VPC & EKS cluster components.
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
resource "aws_ssm_parameter" "vpc_private_subnet_ids" {
  name  = "/\${var.cluster_name}/vpc-private-subnet-ids"
  tags  = var.tags
  type  = "String"
  value = join(",", module.vpc.private_subnets[*])
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
`;

  const eksAuthAndNodesReadme = `## Overview

This Terraform module contains EKS configuration above & beyond the deployment of the cluster itself.

These elements cannot be colocated in the same base EKS module because, though initial deployment would work correctly, any subsequent updates to the cluster (e.g. changing tags) would [cause authentication errors](https://github.com/hashicorp/terraform-provider-kubernetes/issues/1095) (root cause described [here](https://github.com/hashicorp/terraform/issues/29182)).
`;

  const eksAuthAndNodesTfConfig = `# Backend setup
terraform {
  backend "s3" {
    key = "eks-auth-and-nodes.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.63"
    }

    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }

    local = {
      source  = "hashicorp/local"
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
variable "node_group_subnet_ids" {
  default = null
  type    = list(string)
}
variable "region" {
  type = string
}
variable "tags" {
  default = {}
  type    = map(any)
}

# Provider and access setup
provider "aws" {
  region = var.region
}

# Data and resources
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_eks_cluster" "cluster" {
  name = var.cluster_name
}

data "aws_eks_cluster_auth" "cluster_auth" {
  name = data.aws_eks_cluster.cluster.id
}

provider "kubernetes" {
  host                   = data.aws_eks_cluster.cluster.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.cluster.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.cluster_auth.token
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

#     # In place of, or addition to, the IAM role ^ defined here in the system:masters group,
#     # individual IAM users can be specified by adding mapUsers to the data block:
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
}

data "aws_ssm_parameter" "vpc_private_subnet_ids" {
  count = var.node_group_subnet_ids == null ? 1 : 0

  name = "/\${data.aws_eks_cluster.cluster.name}/vpc-private-subnet-ids"
}

resource "aws_eks_node_group" "node" {
  cluster_name  = data.aws_eks_cluster.cluster.name
  node_role_arn = aws_iam_role.node.arn
  subnet_ids    = var.node_group_subnet_ids == null ? split(",", nonsensitive(data.aws_ssm_parameter.vpc_private_subnet_ids[0].value)) : var.node_group_subnet_ids
  tags          = var.tags

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
      ca_cert      = data.aws_eks_cluster.cluster.certificate_authority[0].data,
      cluster_name = data.aws_eks_cluster.cluster.name,
      endpoint_url = data.aws_eks_cluster.cluster.endpoint,
    }
  )
}

# https://docs.aws.amazon.com/eks/latest/userguide/enable-iam-roles-for-service-accounts.html
data "tls_certificate" "cluster_cert_thumbprint" {
  url = data.aws_eks_cluster.cluster.identity[0].oidc[0].issuer
}
resource "aws_iam_openid_connect_provider" "cluster" {
  tags = var.tags
  url  = data.aws_eks_cluster.cluster.identity[0].oidc[0].issuer

  client_id_list = [
    "sts.amazonaws.com",
  ]

  thumbprint_list = [
    data.tls_certificate.cluster_cert_thumbprint.certificates[0].sha1_fingerprint,
  ]
}

resource "aws_ssm_parameter" "oidc_iam_provider_cluster_url" {
  name  = "/\${data.aws_eks_cluster.cluster.name}/oidc-iam-provider-cluster-url"
  tags  = var.tags
  type  = "String"
  value = data.aws_eks_cluster.cluster.identity[0].oidc[0].issuer
}
resource "aws_ssm_parameter" "oidc_iam_provider_cluster_arn" {
  name  = "/\${data.aws_eks_cluster.cluster.name}/oidc-iam-provider-cluster-arn"
  tags  = var.tags
  type  = "String"
  value = aws_iam_openid_connect_provider.cluster.arn
}
`;

  await generateTsconfig();
  await writeS3BackendCfnTemplate();

  const eksbaseReadmePath = path.join("eks-base.tf", "README.md");
  if (await pathExists(eksbaseReadmePath)) {
    logGreen(
      "eks-base.tf/README.md already exists; would have written this to it:",
    );
    console.log(eksbaseReadme);
    console.log();
  } else {
    if (!(await pathExists("eks-base.tf"))) {
      await fs.promises.mkdir("eks-base.tf");
    }
    logGreen(`Writing ${eksbaseReadmePath}...`);
    await fs.promises.writeFile(eksbaseReadmePath, eksbaseReadme);
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

  const kubeConfigTemplatePath = path.join(
    "eks-auth-and-nodes.tf",
    "templates",
    "kubeconfig-template.yaml.tpl",
  );
  if (await pathExists(kubeConfigTemplatePath)) {
    logGreen(
      "eks-auth-and-nodes.tf/templates/kubeconfig-template.yaml.tpl already exists; would have written this to it:",
    );
    console.log(kubeConfigTemplate);
    console.log();
  } else {
    if (!(await pathExists(path.join("eks-auth-and-nodes.tf", "templates")))) {
      if (!(await pathExists("eks-auth-and-nodes.tf"))) {
        await fs.promises.mkdir("eks-auth-and-nodes.tf");
      }
      await fs.promises.mkdir(path.join("eks-auth-and-nodes.tf", "templates"));
    }
    logGreen(`Writing ${kubeConfigTemplatePath}...`);
    await fs.promises.writeFile(kubeConfigTemplatePath, kubeConfigTemplate);
  }

  const eksAuthAndNodesReadmePath = path.join(
    "eks-auth-and-nodes.tf",
    "README.md",
  );
  if (await pathExists(eksAuthAndNodesReadmePath)) {
    logGreen(
      "eks-auth-and-nodes.tf/README.md already exists; would have written this to it:",
    );
    console.log(eksAuthAndNodesReadme);
    console.log();
  } else {
    logGreen(`Writing ${eksAuthAndNodesReadmePath}...`);
    await fs.promises.writeFile(
      eksAuthAndNodesReadmePath,
      eksAuthAndNodesReadme,
    );
  }

  const eksAuthAndNodesTfConfigPath = path.join(
    "eks-auth-and-nodes.tf",
    "main.tf",
  );
  if (await pathExists(eksAuthAndNodesTfConfigPath)) {
    logGreen(
      "eks-auth-and-nodes.tf/main.tf already exists; would have written this to it:",
    );
    console.log(eksAuthAndNodesTfConfigPath);
    console.log();
  } else {
    logGreen(`Writing ${eksAuthAndNodesTfConfigPath}...`);
    await fs.promises.writeFile(
      eksAuthAndNodesTfConfigPath,
      eksAuthAndNodesTfConfig,
    );
  }
}

export async function awsTfEks(): Promise<void> {
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
    tfVersion: "1.2.8",
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
              kubectl_access_role_arn:
                envOptions[process.env.IHLP_ENV].kubectlAccessRoleArn,
              region: "\${env IHLP_LOCATION}",
              tags: envOptions[process.env.IHLP_ENV].tags,
            },
            workspace: process.env.IHLP_ENV,
          },
          path: "eks-auth-and-nodes.tf",
          type: "terraform",
        },
        {
          name: "job-s3-echo",
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
              tags: envOptions[process.env.IHLP_ENV].tags,
            },
            workspace: process.env.IHLP_ENV,
          },
          path: "job-s3-echo.tf",
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
`;

  const readmeContents = `# Overview

This repo represents a sample Terraform infrastructure deployment of EKS. It also includes a sample k8s job demonstrating AWS IAM integration.

## Prerequisites

- [awscli](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html)

## Setup

### Deployment

1. Update the \`kubectlAccessRoleArn\` values in [ihlp.ts](./ihlp.ts) to specify the IAM role to which cluster admin access should be granted.
   E.g., if you assume an IAM role for operating in your account \`aws sts get-caller-identity --query 'Arn' --output text\` will show you the assumed role principal like:

    \`\`\`text
    arn:aws:sts::123456789012:assumed-role/myIamRole/fitzwilliam.darcy
    \`\`\`

    You can use that arn to determine the IAM role arn for ihlp.ts:

    \`\`\`ts
    kubectlAccessRoleArn: "arn:aws:iam::123456789012:role/myIamRole",
    \`\`\`

    (For any other configuration, like using IAM users via \`mapUsers\`, see the \`kubernetes_config_map\` resource in \`eks-auth-and-nodes.tf/main.tf\`)

2. After updating the role ARN, deploy to the dev environment (\`npx ihlp deploy -a -e dev\`).
   This will take some time to complete.

### Post-Deployment

It is **strongly recommended** to [disable public access](https://docs.aws.amazon.com/eks/latest/userguide/cluster-endpoint.html#modify-endpoint-access) to the EKS API if this infrastructure will be left running for any period of time.

### Teardown

\`npx ihlp destroy -a -e dev\` will teardown all infrastructure deployed as part of this project (in the \`dev\` environment).

## IAM Role enabled Service Accounts (IRSA)

An IAM OIDC identity provider is configured (see \`aws_iam_openid_connect_provider\` in the [eks-auth-and-nodes.tf](./eks-auth-and-nodes.tf/main.tf) module) to allow containers access to AWS APIs (by way of annotated k8s service accounts).

The example [job-s3-echo.tf](./job-s3-echo.tf/main.tf) module creates an IAM role, a k8s service account annotated with the role, and a job using the service account to place an object on S3 (see the bucket starting with \`dev-eks-s3-echo-\` after deployment).
`;

  const s3EchoTfConfig = `# Backend setup
terraform {
  backend "s3" {
    key = "job-s3-echo.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.63"
    }

    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }

    time = {
      source  = "hashicorp/time"
      version = "~> 0.7"
    }
  }

  required_version = "~> 1.0"
}

# Variable definitions
variable "cluster_name" {
  type = string
}
variable "region" {}
variable "tags" {
  default = {}
  type    = map(any)
}

# Provider and access setup
provider "aws" {
  region = var.region
}

# Data and resources
data "aws_region" "current" {}

locals {
  job_name = "s3-echo"
  sa_name  = "\${local.job_name}-serviceaccount"
}

data "aws_eks_cluster" "cluster" {
  name = var.cluster_name
}

data "aws_eks_cluster_auth" "cluster_auth" {
  name = data.aws_eks_cluster.cluster.id
}

provider "kubernetes" {
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.cluster.certificate_authority[0].data)
  host                   = data.aws_eks_cluster.cluster.endpoint
  token                  = data.aws_eks_cluster_auth.cluster_auth.token
}

data "aws_ssm_parameter" "oidc_iam_provider_cluster_url" {
  name = "/\${var.cluster_name}/oidc-iam-provider-cluster-url"
}
data "aws_ssm_parameter" "oidc_iam_provider_cluster_arn" {
  name = "/\${var.cluster_name}/oidc-iam-provider-cluster-arn"
}

resource "aws_s3_bucket" "bucket" {
  acl           = "private"
  bucket_prefix = "\${terraform.workspace}-eks-\${local.job_name}-"
  force_destroy = "true"
  tags          = var.tags
}

data "aws_iam_policy_document" "service_account_assume_role_policy" {
  statement {
    effect  = "Allow"

    actions = [
      "sts:AssumeRoleWithWebIdentity",
    ]

    condition {
      test     = "StringEquals"
      variable = "\${replace(data.aws_ssm_parameter.oidc_iam_provider_cluster_url.value, "https://", "")}:sub"

      values = [
        "system:serviceaccount:default:\${local.sa_name}",
      ]
    }

    principals {
      type = "Federated"

      identifiers = [
        data.aws_ssm_parameter.oidc_iam_provider_cluster_arn.value,
      ]
    }
  }
}
resource "aws_iam_role" "service_account" {
  assume_role_policy = data.aws_iam_policy_document.service_account_assume_role_policy.json
  name_prefix        = "\${terraform.workspace}-eks-\${local.sa_name}-"
  tags               = var.tags
}
data "aws_iam_policy_document" "service_account" {
  statement {
    actions = [
      "s3:ListBucket",
      "s3:ListBucketVersions",
    ]

    resources = [
      aws_s3_bucket.bucket.arn,
    ]
  }

  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject*",
    ]

    resources = [
      "\${aws_s3_bucket.bucket.arn}/*",
    ]
  }
}
resource "aws_iam_role_policy" "service_account" {
  policy = data.aws_iam_policy_document.service_account.json
  role   = aws_iam_role.service_account.id
}

resource "kubernetes_service_account" "service_account" {
  metadata {
    name = local.sa_name

    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.service_account.arn
    }
  }

  depends_on = [
    aws_iam_role_policy.service_account,
  ]
}

resource "time_sleep" "wait_for_service_account_creation" {
  create_duration = "15s"

  depends_on = [
    kubernetes_service_account.service_account,
  ]
}

resource "kubernetes_job" "job" {
  metadata {
    name = local.job_name
  }

  spec {
    template {
      metadata {}
      spec {
        restart_policy       = "Never"
        service_account_name = kubernetes_service_account.service_account.metadata[0].name

        container {
          image = "amazonlinux:2.0.20220121.0"
          name  = "main"

          command = [
            "sh",
            "-c",
            "curl -sL -o /s3-echoer https://github.com/mhausenblas/s3-echoer/releases/latest/download/s3-echoer-linux && chmod +x /s3-echoer && echo This is an in-cluster test | /s3-echoer $BUCKET_NAME",
          ]

          env {
            name  = "AWS_DEFAULT_REGION"
            value = var.region
          }

          env {
            name  = "BUCKET_NAME"
            value = aws_s3_bucket.bucket.id
          }

          env {
            name  = "ENABLE_IRP"
            value = "true"
          }

          volume_mount {
            mount_path = "/var/run/secrets/kubernetes.io/serviceaccount"
            name       = kubernetes_service_account.service_account.default_secret_name
            read_only  = true
          }
        }

        volume {
          name = kubernetes_service_account.service_account.default_secret_name

          secret {
            secret_name = kubernetes_service_account.service_account.default_secret_name
          }
        }
      }
    }
  }

  depends_on = [
    time_sleep.wait_for_service_account_creation,
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

  const s3EchoTfConfigPath = path.join("job-s3-echo.tf", "main.tf");
  if (await pathExists(s3EchoTfConfigPath)) {
    logGreen(
      "job-s3-echo.tf/main.tf already exists; would have written this to it:",
    );
    console.log(s3EchoTfConfig);
    console.log();
  } else {
    if (!(await pathExists("job-s3-echo.tf"))) {
      await fs.promises.mkdir("job-s3-echo.tf");
    }
    logGreen(`Writing ${s3EchoTfConfigPath}...`);
    await fs.promises.writeFile(s3EchoTfConfigPath, s3EchoTfConfig);
  }

  logGreen("Example generation complete");
}

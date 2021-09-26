variable "repo_name" {
  description = "orgnames/reponame"
  type        = string
}

variable "resource_prefix" {
  default     = "inttest"
  description = "Prefix to resource names"
  type        = string
}

variable "tags" {
  default = {}
  type    = map
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix = "${replace(var.repo_name, "/", "-")}-"
}

data "aws_iam_policy_document" "boundary" {
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.resource_prefix}*"
    ]
  }
}

resource "aws_iam_policy" "boundary" {
  description = "Integration test role boundary policy"
  name_prefix = local.name_prefix
  policy      = data.aws_iam_policy_document.boundary.json
  tags        = var.tags
}

output "boundary_policy_arn" {
  description = "Permissions boundary IAM Managed Policy"
  value       = aws_iam_policy.boundary.arn
}

data "aws_iam_policy_document" "assume_role_policy" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    condition {
      test     = "StringLike"
      variable = "vstoken.actions.githubusercontent.com:sub"

      values = [
        "repo:${var.repo_name}:*",
      ]
    }

    principals {
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/vstoken.actions.githubusercontent.com"]
      type        = "Federated"
    }
  }
}

data "aws_iam_policy_document" "policy" {
  statement {
    actions = [
      "iam:AttachRolePolicy",
      "iam:CreateRole",
      "iam:DetachRolePolicy",
      "iam:PutRolePolicy",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${var.resource_prefix}*",
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"

      values = [
        aws_iam_policy.boundary.arn,
      ]
    }
  }

  statement {
    actions = [
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRolePolicies",
      "iam:ListRoleTags",
      "iam:PassRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateRoleDescription",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${var.resource_prefix}*",
    ]
  }

  statement {
    actions = [
      "cloudformation:CreateChangeSet",
      "cloudformation:DeleteChangeSet",
      "cloudformation:DeleteStack",
      "cloudformation:DescribeChangeSet",
      "cloudformation:DescribeStacks",
      "cloudformation:ExecuteChangeSet",
      "cloudformation:TagResource",
      "cloudformation:UntagResource",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:cloudformation:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:stack/${var.resource_prefix}*",
    ]
  }

  statement {
    actions = [
      "dynamodb:CreateTable",
      "dynamodb:DeleteItem",
      "dynamodb:DeleteTable",
      "dynamodb:DescribeTable",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:TagResource",
      "dynamodb:UntagResource",
      "dynamodb:UpdateTable",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${var.resource_prefix}*",
    ]
  }

  statement {
    actions = [
      "lambda:CreateFunction",
      "lambda:DeleteFunction",
      "lambda:GetFunction",
      "lambda:GetFunctionCodeSigningConfig",
      "lambda:InvokeFunction",
      "lambda:ListTags",
      "lambda:ListVersionsByFunction",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:UpdateFunctionCode",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:${var.resource_prefix}*",
    ]
  }

  statement {
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:GetBucketVersioning",
      "s3:GetLifecycleConfiguration",
      "s3:GetObject",
      "s3:HeadObject",
      "s3:ListBucket",
      "s3:ListBucketVersions",
      "s3:PutBucketVersioning",
      "s3:PutLifecycleConfiguration",
      "s3:PutObject",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:s3:::${var.resource_prefix}*",
    ]
  }

  statement {
    actions = [
      "ssm:DeleteParameter",
      "ssm:GetParameter",
      "ssm:PutParameter",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:dwssmlambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/${var.resource_prefix}*",
    ]
  }
}

resource "aws_iam_role" "role" {
  assume_role_policy = data.aws_iam_policy_document.assume_role_policy.json
  name_prefix        = local.name_prefix
  tags               = var.tags

  inline_policy {
    name   = "IntegrationTestPermissions"
    policy = data.aws_iam_policy_document.policy.json
  }
}

output "role_arn" {
  description = "IAM Role"
  value       = aws_iam_role.role.arn
}

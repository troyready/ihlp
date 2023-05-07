terraform {
  backend "s3" {
    key = "example-esbuild-aws.tfstate"
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
variable "node_version" {
  type = string
}
variable "role_boundary_arn" {
  type = string
}
variable "tags" {
  default = {}
  type    = map(string)
}

provider "aws" {
  region = var.region
}

data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "lambda_role_assume_role_policy" {
  statement {
    actions = [
      "sts:AssumeRole",
    ]

    principals {
      type = "Service"

      identifiers = [
        "lambda.amazonaws.com",
      ]
    }
  }
}

locals {
  hello_world_function_name = "${terraform.workspace}-hello-world"
}

data "aws_iam_policy_document" "hello_world_lambda_role_policy" {
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:ListTagsForResource",
      "logs:PutLogEvents",
      "logs:TagResource",
      "logs:UntagResource",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.hello_world_function_name}*",
    ]
  }
}

resource "aws_iam_role" "hello_world_lambda" {
  assume_role_policy   = data.aws_iam_policy_document.lambda_role_assume_role_policy.json
  name_prefix          = "${terraform.workspace}-hello-world-"
  permissions_boundary = var.role_boundary_arn
  tags                 = var.tags

  inline_policy {
    name   = "lambda-permissions"
    policy = data.aws_iam_policy_document.hello_world_lambda_role_policy.json
  }
}

resource "aws_cloudwatch_log_group" "hello_world_function" {
  name = "/aws/lambda/${local.hello_world_function_name}"
  tags = var.tags
}

resource "aws_lambda_function" "hello_world" {
  filename         = "./dist/helloWorld.zip"
  function_name    = local.hello_world_function_name
  handler          = "handler.handler"
  role             = aws_iam_role.hello_world_lambda.arn
  runtime          = "nodejs${var.node_version}.x"
  source_code_hash = filebase64sha256("./dist/helloWorld.zip")
  tags             = var.tags

  environment {
    variables = {
      NODE_OPTIONS = "--enable-source-maps"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.hello_world_function,
  ]
}

locals {
  esm_hello_world_function_name = "${terraform.workspace}-esm-hello-world"
}

resource "aws_ssm_parameter" "esm_hello_world" {
  name  = "${terraform.workspace}-esm-function-hello-world"
  tags  = var.tags
  type  = "String"
  value = "Hello world"
}

data "aws_iam_policy_document" "esm_hello_world_lambda_role_policy" {
  statement {
    actions = [
      "ssm:GetParameter",
    ]

    resources = [
      aws_ssm_parameter.esm_hello_world.arn,
    ]
  }

  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:ListTagsForResource",
      "logs:PutLogEvents",
      "logs:TagResource",
      "logs:UntagResource",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.esm_hello_world_function_name}*",
    ]
  }
}

resource "aws_iam_role" "esm_hello_world_lambda" {
  assume_role_policy   = data.aws_iam_policy_document.lambda_role_assume_role_policy.json
  name_prefix          = "${terraform.workspace}-hello-world-"
  permissions_boundary = var.role_boundary_arn
  tags                 = var.tags

  inline_policy {
    name   = "lambda-permissions"
    policy = data.aws_iam_policy_document.esm_hello_world_lambda_role_policy.json
  }
}

resource "aws_cloudwatch_log_group" "esm_hello_world_function" {
  name = "/aws/lambda/${local.esm_hello_world_function_name}"
  tags = var.tags
}

resource "aws_lambda_function" "esm_hello_world" {
  filename         = "./dist/esmTopLevelAwait.zip"
  function_name    = local.esm_hello_world_function_name
  handler          = "handler.handler"
  role             = aws_iam_role.esm_hello_world_lambda.arn
  runtime          = "nodejs${var.node_version}.x"
  source_code_hash = filebase64sha256("./dist/esmTopLevelAwait.zip")
  tags             = var.tags

  environment {
    variables = {
      NODE_OPTIONS   = "--enable-source-maps"
      SSM_PARAM_NAME = aws_ssm_parameter.esm_hello_world.name
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.esm_hello_world_function,
  ]
}

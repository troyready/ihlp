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

locals {
  hello_world_function_name = "${terraform.workspace}-hello-world"
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

data "aws_iam_policy_document" "hello_world_lambda_role_policy" {
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
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

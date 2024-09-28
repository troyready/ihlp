terraform {
  backend "s3" {
    key = "example-esbuild-aws.tfstate"
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.32"
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

resource "aws_cloudwatch_log_group" "hello_world_function" {
  name = "/aws/lambda/${local.hello_world_function_name}"
  tags = var.tags
}

data "aws_iam_policy_document" "hello_world_lambda_role_policy" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:ListTagsForResource",
      "logs:PutLogEvents",
      "logs:TagResource",
      "logs:UntagResource",
    ]

    resources = [
      "${aws_cloudwatch_log_group.hello_world_function.arn}*",
    ]
  }
}

resource "aws_iam_role" "hello_world_lambda" {
  assume_role_policy   = data.aws_iam_policy_document.lambda_role_assume_role_policy.json
  name_prefix          = "${terraform.workspace}-hello-world-"
  permissions_boundary = var.role_boundary_arn
  tags                 = var.tags
}

resource "aws_iam_role_policy" "hello_world_lambda_permissions" {
  role   = aws_iam_role.hello_world_lambda.id
  policy = data.aws_iam_policy_document.hello_world_lambda_role_policy.json
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

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.hello_world_function.name
  }

  depends_on = [
    aws_iam_role_policy.hello_world_lambda_permissions,
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

resource "aws_cloudwatch_log_group" "esm_hello_world_function" {
  name = "/aws/lambda/${local.esm_hello_world_function_name}"
  tags = var.tags
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
      "logs:CreateLogStream",
      "logs:ListTagsForResource",
      "logs:PutLogEvents",
      "logs:TagResource",
      "logs:UntagResource",
    ]

    resources = [
      "${aws_cloudwatch_log_group.esm_hello_world_function.arn}*",
    ]
  }
}

resource "aws_iam_role" "esm_hello_world_lambda" {
  assume_role_policy   = data.aws_iam_policy_document.lambda_role_assume_role_policy.json
  name_prefix          = "${terraform.workspace}-hello-world-"
  permissions_boundary = var.role_boundary_arn
  tags                 = var.tags
}

resource "aws_iam_role_policy" "esm_hello_world_lambda_permissions" {
  role   = aws_iam_role.esm_hello_world_lambda.id
  policy = data.aws_iam_policy_document.esm_hello_world_lambda_role_policy.json
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

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.esm_hello_world_function.name
  }

    depends_on = [
      aws_iam_role_policy.esm_hello_world_lambda_permissions,
    ]
}

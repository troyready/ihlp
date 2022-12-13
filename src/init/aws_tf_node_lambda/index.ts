/**
 * AWS Terraform-managed Node lambda config generator
 *
 * @packageDocumentation
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { generateGitIgnore, generateTsconfig } from "../";
import { writeS3BackendCfnTemplate } from "../aws_tf_s3_backend";
import { logGreen, pathExists } from "../../util";

export async function awsTfNodeLambda(): Promise<void> {
  const configContents = `import type { IHLPConfig } from "ihlp/lib/config";

const envOptions = {
  dev: {
    namespace: "dev-ihlp-proj",
    nodeVersion: "16",
    tags: {
      environment: "dev",
      namespace: "dev-ihlp-proj",
    },
    tfVersion: "1.2.8",
  },
  prod: {
    namespace: "prod-ihlp-proj",
    nodeVersion: "16",
    tags: {
      environment: "prod",
      namespace: "prod-ihlp-proj",
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
          path: "example.tf",
          options: {
            archiveCache: {
              s3Bucket: \`\\\${aws-cfn-output stack=\${
                envOptions[process.env.IHLP_ENV].namespace
              }-tf-state,output=BucketName}\`,
              s3Prefix: \`\${process.env.IHLP_ENV}/exampleFunctions/\`,
            },
            srcDir: "src",
            outDir: "dist",
            target: \`node\${envOptions[process.env.IHLP_ENV].nodeVersion}\`,
          },
          type: "esbuild-functions",
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
              node_version: envOptions[process.env.IHLP_ENV].nodeVersion,
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

  const functionTest = `/**
 * Tests for Hello world handler
 *
 * @packageDocumentation
 */

import { APIGatewayProxyEvent, Context } from "aws-lambda";

import { handler } from "./handler";

/** Mock callback function for handler invocations */
function unusedCallback<T>() {
  return undefined as any as T; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Helper for generating input for Lambda from AWS API Gateway */
function generateAPIGatewayProxyEvent({
  httpMethod,
  path,
  body,
  queryStringParameters,
}: {
  httpMethod;
  path;
  body;
  queryStringParameters;
}) {
  return {
    body: body,
    headers: {},
    httpMethod: httpMethod,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    path: path,
    pathParameters: null,
    queryStringParameters: queryStringParameters,
    requestContext: {
      accountId: "unused",
      apiId: "unused",
      httpMethod: "unused",
      identity: {
        accessKey: "unused",
        accountId: "unused",
        apiKey: "unused",
        apiKeyId: "unused",
        caller: "unused",
        clientCert: null,
        cognitoAuthenticationProvider: "unused",
        cognitoAuthenticationType: "unused",
        cognitoIdentityId: "unused",
        cognitoIdentityPoolId: "unused",
        principalOrgId: "unused",
        sourceIp: "unused",
        user: "unused",
        userAgent: "unused",
        userArn: "unused",
      },
      authorizer: { principalId: "unittestuser" },
      path: "unused",
      protocol: "unused",
      stage: "unused",
      requestId: "unused",
      requestTimeEpoch: 0,
      resourceId: "unused",
      resourcePath: "unused",
    },
    resource: "unused",
    stageVariables: null,
  } as APIGatewayProxyEvent;
}

describe("Handler tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("handler errors on request without body", async () => {
    const handlerReturn = await handler(
      {} as APIGatewayProxyEvent,
      {} as Context,
      unusedCallback<any>(), // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    expect(handlerReturn).toMatchObject({ statusCode: 400 });
  });

  test("handler returns hello world", async () => {
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "GET",
        path: "/",
        body: '{"foo": "bar"}',
        queryStringParameters: null,
      }),
      {} as Context,
      unusedCallback<any>(), // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    expect(handlerReturn).toMatchObject({
      body: '{"message":"Hello world"}',
      statusCode: 200,
    });
  });
});
`;

  const functionContents = `/**
 * Hello world handler
 *
 * @packageDocumentation
 */

import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import "source-map-support/register";

/** Respond to incoming requests with hello world message */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context, // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<APIGatewayProxyResult> => {
  let body: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (event.body) {
    body = JSON.parse(event.body);
  } else {
    console.log("Body not found on event");
    return {
      body: JSON.stringify({
        errorType: "BadRequest",
        message: "Missing body in request",
      }),
      statusCode: 400,
    };
  }

  return {
    body: JSON.stringify({ message: "Hello world" }),
    statusCode: 200,
  };
};
`;

  const tfModuleGitIgnoreContents = `.terraform

/coverage
node_modules
/dist
`;

  const jestConfigContents = `module.exports = {
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: -10,
    },
  },
  roots: ["<rootDir>/src"],
  transform: {
    "^.+\\\\.tsx?$": "ts-jest",
  },
};
`;

  const terraformConfig = `terraform {
  backend "s3" {
    key = "example-tf-aws-lambda-node.tfstate"
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
  default = null
  type    = string
}
variable "tags" {
  default = {}
  type    = map(string)
}

provider "aws" {
  region = var.region
}

locals {
  hello_world_function_name = "\${terraform.workspace}-hello-world"
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
      "logs:ListTagsForResource",
      "logs:PutLogEvents",
      "logs:TagResource",
      "logs:UntagResource",
    ]

    resources = [
      "arn:\${data.aws_partition.current.partition}:logs:\${var.region}:\${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/\${local.hello_world_function_name}*",
    ]
  }
}

resource "aws_iam_role" "hello_world_lambda" {
  assume_role_policy   = data.aws_iam_policy_document.lambda_role_assume_role_policy.json
  name_prefix          = "\${terraform.workspace}-hello-world-"
  permissions_boundary = var.role_boundary_arn
  tags                 = var.tags

  inline_policy {
    name   = "lambda-permissions"
    policy = data.aws_iam_policy_document.hello_world_lambda_role_policy.json
  }
}

resource "aws_cloudwatch_log_group" "hello_world_function" {
  name = "/aws/lambda/\${local.hello_world_function_name}"
  tags = var.tags
}

resource "aws_lambda_function" "hello_world" {
  filename         = "./dist/helloWorld.zip"
  function_name    = local.hello_world_function_name
  handler          = "handler.handler"
  role             = aws_iam_role.hello_world_lambda.arn
  runtime          = "nodejs\${var.node_version}.x"
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
`;

  const lambdaPackageJsonContents = `{
  "name": "example-api",
  "version": "0.1.0",
  "description": "Example API Project",
  "main": "index.js",
  "scripts": {
    "test": "jest",
    "coverage": "npm test -- --coverage"
  },
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "@types/aws-lambda": "^8.10.83",
    "@types/jest": "^27.0.1",
    "@types/source-map-support": "^0.5.4",
    "esbuild": "^0.12.24",
    "jest": "^27.1.0",
    "ts-jest": "^27.0.5"
  },
  "dependencies": {
    "source-map-support": "^0.5.19"
  }
}
`;

  const lambdaTsConfigContents = `{}
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

  const functionTestPath = path.join(
    "example.tf",
    "src",
    "helloWorld",
    "handler.test.ts",
  );
  if (await pathExists(functionTestPath)) {
    logGreen(
      "example.tf/src/helloWorld/handler.test already exists; would have written this to it:",
    );
    console.log(functionTest);
    console.log();
  } else {
    if (!(await pathExists(path.join("example.tf", "src", "helloWorld")))) {
      if (!(await pathExists(path.join("example.tf", "src")))) {
        if (!(await pathExists("example.tf"))) {
          await fs.promises.mkdir("example.tf");
        }
        await fs.promises.mkdir(path.join("example.tf", "src"));
      }
      await fs.promises.mkdir(path.join("example.tf", "src", "helloWorld"));
    }
    logGreen(`Writing ${functionTestPath}...`);
    await fs.promises.writeFile(functionTestPath, functionTest);
  }

  const functionPath = path.join(
    "example.tf",
    "src",
    "helloWorld",
    "handler.ts",
  );
  if (await pathExists(functionPath)) {
    logGreen(
      "example.tf/src/helloWorld/handler.ts already exists; would have written this to it:",
    );
    console.log(functionContents);
  } else {
    logGreen("Writing example.tf/src/helloWorld/handler.ts...");
    await fs.promises.writeFile(functionPath, functionContents);
  }

  const tfModuleGitIgnorePath = path.join("example.tf", ".gitignore");
  if (await pathExists(tfModuleGitIgnorePath)) {
    logGreen(
      "example.tf/.gitignore file already exists; would have written this to it:",
    );
    console.log(tfModuleGitIgnoreContents);
  } else {
    logGreen("Writing examples.tf/.gitignore...");
    await fs.promises.writeFile(
      tfModuleGitIgnorePath,
      tfModuleGitIgnoreContents,
    );
  }

  const jestConfigPath = path.join("example.tf", "jest.config.js");
  if (await pathExists(jestConfigPath)) {
    logGreen(
      "example.tf/jest.config.js file already exists; would have written this to it:",
    );
    console.log(jestConfigContents);
  } else {
    logGreen("Writing example.tf/jest.config.js...");
    await fs.promises.writeFile(jestConfigPath, jestConfigContents);
  }

  if (await pathExists(path.join("example.tf", "main.tf"))) {
    logGreen(
      "example.tf/main.tf already exists; would have written this to it:",
    );
    console.log(terraformConfig);
  } else {
    logGreen("Writing example.tf/main.tf...");
    await fs.promises.writeFile(
      path.join("example.tf", "main.tf"),
      terraformConfig,
    );
  }

  const lambdaPackageJsonPath = path.join("example.tf", "package.json");
  if (await pathExists(lambdaPackageJsonPath)) {
    logGreen(
      "example.tf/package.json file already exists; would have written this to it:",
    );
    console.log(lambdaPackageJsonContents);
  } else {
    logGreen("Writing example.tf/package.json...");
    await fs.promises.writeFile(
      lambdaPackageJsonPath,
      lambdaPackageJsonContents,
    );
  }

  const lambdaTsConfigPath = path.join("example.tf", "tsconfig.json");
  if (await pathExists(lambdaTsConfigPath)) {
    logGreen(
      "example.tf/tsconfig.json file already exists; would have written this to it:",
    );
    console.log(lambdaTsConfigContents);
  } else {
    logGreen("Writing example.tf/tsconfig.json...");
    await fs.promises.writeFile(lambdaTsConfigPath, lambdaTsConfigContents);
  }

  logGreen("Generating function package-lock.json");
  const exitCode = spawnSync("npm", ["i"], {
    cwd: "example.tf",
    stdio: "inherit",
  }).status;
  if (exitCode != 0) {
    process.exit(exitCode ? exitCode : 1);
  }

  logGreen("Example generation complete");
}

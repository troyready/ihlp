/**
 * AWS Terraform-managed Golang lambda config generator
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as path from "path";
import { generateTsconfig } from "../";
import { writeS3BackendCfnTemplate } from "../aws_tf_s3_backend";
import { logGreen, pathExists } from "../../util";

export async function awsTfGoLambda(): Promise<void> {
  const configContents = `import type { IHLPConfig } from "ihlp/lib/config";

const envOptions = {
  dev: {
    functionArchitecture: "arm64",
    namespace: "dev-ihlp-proj",
    tags: {
      environment: "dev",
      namespace: "dev-ihlp-proj",
    },
    tfVersion: "1.2.8",
  },
  prod: {
    functionArchitecture: "arm64",
    namespace: "prod-ihlp-proj",
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
              s3Prefix: \`\${process.env.IHLP_ENV}/functions/\`,
            },
            buildTags: "lambda.norpc",
            envVars: {
              CGO_ENABLED: "0",
              GOARCH: envOptions[process.env.IHLP_ENV].functionArchitecture,
              GOOS: "linux",
            },
            srcDir: "src",
            outDir: "dist",
            version: "1.16"
          },
          type: "functionbuilder-go",
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
              function_architecture: envOptions[process.env.IHLP_ENV].functionArchitecture == "arm64" ? "arm64" : "x86_64",
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

  const gitIgnoreContents = `.terraform
node_modules
`;

  const functionGitignore = `bootstrap
`;

  const functionEventJson = `{}
`;

  const functionGoMod = `module example.com/function

go 1.14

require (
  github.com/aws/aws-lambda-go v1.27.1
  github.com/aws/aws-sdk-go v1.29.33
)
`;

  const functionGoSum = `github.com/BurntSushi/toml v0.3.1 h1:WXkYYl6Yr3qBf1K79EBnL4mak0OimBfB0XUf9Vl28OQ=
github.com/BurntSushi/toml v0.3.1/go.mod h1:xHWCNGjB5oqiDr8zfno3MHue2Ht5sIBksp03qcyfWMU=
github.com/aws/aws-lambda-go v1.15.0 h1:QAhRWvXttl8TtBsODN+NzZETkci2mdN/paJ0+1hX/so=
github.com/aws/aws-lambda-go v1.15.0/go.mod h1:FEwgPLE6+8wcGBTe5cJN3JWurd1Ztm9zN4jsXsjzKKw=
github.com/aws/aws-lambda-go v1.27.1 h1:MAH6hbrsktcSr/gGQKLvHeJPeoOoaspJqh+O4g05bpA=
github.com/aws/aws-lambda-go v1.27.1/go.mod h1:jJmlefzPfGnckuHdXX7/80O3BvUUi12XOkbv4w9SGLU=
github.com/aws/aws-sdk-go v1.29.33 h1:WP85+WHalTFQR2wYp5xR2sjiVAZXew2bBQXGU1QJBXI=
github.com/aws/aws-sdk-go v1.29.33/go.mod h1:1KvfttTE3SPKMpo8g2c6jL3ZKfXtFvKscTgahTma5Xg=
github.com/cpuguy83/go-md2man/v2 v2.0.0-20190314233015-f79a8a8ca69d/go.mod h1:maD7wRr/U5Z6m/iR4s+kqSMx2CaBsrgA7czyZG/E6dU=
github.com/cpuguy83/go-md2man/v2 v2.0.0 h1:EoUDS0afbrsXAZ9YQ9jdu/mZ2sXgT1/2yyNng4PGlyM=
github.com/cpuguy83/go-md2man/v2 v2.0.0/go.mod h1:maD7wRr/U5Z6m/iR4s+kqSMx2CaBsrgA7czyZG/E6dU=
github.com/davecgh/go-spew v1.1.0/go.mod h1:J7Y8YcW2NihsgmVo/mv3lAwl/skON4iLHjSsI+c5H38=
github.com/davecgh/go-spew v1.1.1 h1:vj9j/u1bqnvCEfJOwUhtlOARqs3+rkHYY13jYWTU97c=
github.com/davecgh/go-spew v1.1.1/go.mod h1:J7Y8YcW2NihsgmVo/mv3lAwl/skON4iLHjSsI+c5H38=
github.com/go-sql-driver/mysql v1.5.0 h1:ozyZYNQW3x3HtqT1jira07DN2PArx2v7/mN66gGcHOs=
github.com/go-sql-driver/mysql v1.5.0/go.mod h1:DCzpHaOWr8IXmIStZouvnhqoel9Qv2LBy8hT2VhHyBg=
github.com/jmespath/go-jmespath v0.0.0-20180206201540-c2b33e8439af h1:pmfjZENx5imkbgOkpRUYLnmbU7UEFbjtDA2hxJ1ichM=
github.com/jmespath/go-jmespath v0.0.0-20180206201540-c2b33e8439af/go.mod h1:Nht3zPeWKUH0NzdCt2Blrr5ys8VGpn0CEB0cQHVjt7k=
github.com/pkg/errors v0.9.1 h1:FEBLx1zS214owpjy7qsBeixbURkuhQAwrK5UwLGTwt4=
github.com/pkg/errors v0.9.1/go.mod h1:bwawxfHBFNV+L2hUp1rHADufV3IMtnDRdf1r5NINEl0=
github.com/pmezard/go-difflib v1.0.0 h1:4DBwDE0NGyQoBHbLQYPwSUPoCMWR5BEzIk/f1lZbAQM=
github.com/pmezard/go-difflib v1.0.0/go.mod h1:iKH77koFhYxTK1pcRnkKkqfTogsbg7gZNVY4sRDYZ/4=
github.com/russross/blackfriday/v2 v2.0.1 h1:lPqVAte+HuHNfhJ/0LC98ESWRz8afy9tM/0RK8m9o+Q=
github.com/russross/blackfriday/v2 v2.0.1/go.mod h1:+Rmxgy9KzJVeS9/2gXHxylqXiyQDYRxCVz55jmeOWTM=
github.com/shurcooL/sanitized_anchor_name v1.0.0 h1:PdmoCO6wvbs+7yrJyMORt4/BmY5IYyJwS/kOiWx8mHo=
github.com/shurcooL/sanitized_anchor_name v1.0.0/go.mod h1:1NzhyTcUVG4SuEtjjoZeVRXNmyL/1OwPU0+IJeTBvfc=
github.com/stretchr/objx v0.1.0 h1:4G4v2dO3VZwixGIRoQ5Lfboy6nUhCyYzaqnIAPPhYs4=
github.com/stretchr/objx v0.1.0/go.mod h1:HFkY916IF+rwdDfMAkV7OtwuqBVzrE8GR6GFx+wExME=
github.com/stretchr/testify v1.4.0/go.mod h1:j7eGeouHqKxXV5pUuKE4zz7dFj8WfuZ+81PSLYec5m4=
github.com/stretchr/testify v1.6.1 h1:hDPOHmpOpP40lSULcqw7IrRb/u7w6RpDC9399XyoNd0=
github.com/stretchr/testify v1.6.1/go.mod h1:6Fq8oRcR53rry900zMqJjRRixrwX3KX962/h/Wwjteg=
github.com/urfave/cli/v2 v2.1.1/go.mod h1:SE9GqnLQmjVa0iPEY0f1w3ygNIYcIJ0OKPMoW2caLfQ=
github.com/urfave/cli/v2 v2.2.0 h1:JTTnM6wKzdA0Jqodd966MVj4vWbbquZykeX1sKbe2C4=
github.com/urfave/cli/v2 v2.2.0/go.mod h1:SE9GqnLQmjVa0iPEY0f1w3ygNIYcIJ0OKPMoW2caLfQ=
golang.org/x/crypto v0.0.0-20190308221718-c2843e01d9a2 h1:VklqNMn3ovrHsnt90PveolxSbWFaJdECFbxSq0Mqo2M=
golang.org/x/crypto v0.0.0-20190308221718-c2843e01d9a2/go.mod h1:djNgcEr1/C05ACkg1iLfiJU5Ep61QUkGW8qpdssI0+w=
golang.org/x/net v0.0.0-20200202094626-16171245cfb2 h1:CCH4IOTTfewWjGOlSp+zGcjutRKlBEZQ6wTn8ozI/nI=
golang.org/x/net v0.0.0-20200202094626-16171245cfb2/go.mod h1:z5CRVTTTmAJ677TzLLGU+0bjPO0LkuOLi4/5GtJWs/s=
golang.org/x/sys v0.0.0-20190215142949-d0b11bdaac8a h1:1BGLXjeY4akVXGgbC9HugT3Jv3hCI0z56oJR5vAMgBU=
golang.org/x/sys v0.0.0-20190215142949-d0b11bdaac8a/go.mod h1:STP8DvDyc/dI5b8T5hshtkjS+E42TnysNCUPdjciGhY=
golang.org/x/text v0.3.0 h1:g61tztE5qeGQ89tm6NTjjM9VPIm088od1l6aSorWRWg=
golang.org/x/text v0.3.0/go.mod h1:NqM8EUOU14njkJ3fqMW+pc6Ldnwhi/IjpwHt7yyuwOQ=
gopkg.in/check.v1 v0.0.0-20161208181325-20d25e280405 h1:yhCVgyC4o1eVCa2tZl7eS0r+SDo693bJlVdllGtEeKM=
gopkg.in/check.v1 v0.0.0-20161208181325-20d25e280405/go.mod h1:Co6ibVJAznAaIkqp8huTwlJQCZ016jof/cbN4VW5Yz0=
gopkg.in/yaml.v2 v2.2.2 h1:ZCJp+EgiOT7lHqUV2J862kp8Qj64Jo6az82+3Td9dZw=
gopkg.in/yaml.v2 v2.2.2/go.mod h1:hI93XBmqTisBFMUTm0b8Fm+jr3Dg1NNxqwp+5A1VGuI=
gopkg.in/yaml.v3 v3.0.0-20200313102051-9f266ea9e77c/go.mod h1:K4uyk7z7BCEPqu6E+C64Yfv1cQ7kz7rIZviUmN+EgEM=
gopkg.in/yaml.v3 v3.0.0-20200615113413-eeeca48fe776 h1:tQIYjPdBoyREyB9XMu+nnTclpTYkz2zFM+lzLJFO4gQ=
gopkg.in/yaml.v3 v3.0.0-20200615113413-eeeca48fe776/go.mod h1:K4uyk7z7BCEPqu6E+C64Yfv1cQ7kz7rIZviUmN+EgEM=
`;

  const functionTest = `package main

import (
	"context"
	"encoding/json"
	"io/ioutil"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambdacontext"
)

func TestMain(t *testing.T) {
	d := time.Now().Add(50 * time.Millisecond)
	os.Setenv("AWS_LAMBDA_FUNCTION_NAME", "blank-go")
	ctx, _ := context.WithDeadline(context.Background(), d)
	ctx = lambdacontext.NewContext(ctx, &lambdacontext.LambdaContext{
		AwsRequestID:       "495b12a8-xmpl-4eca-8168-160484189f99",
		InvokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:blank-go",
	})
	inputJson := ReadJSONFromFile(t, "./event.json")
	var event events.SQSEvent
	err := json.Unmarshal(inputJson, &event)
	if err != nil {
		t.Errorf("could not unmarshal event. details: %v", err)
	}
	//var inputEvent SQSEvent
	result, err := handleRequest(ctx, event)
	if err != nil {
		t.Log(err)
	}
	t.Log(result)
	if !strings.Contains(result, "FunctionCount") {
		t.Errorf("Output does not contain FunctionCount.")
	}
}
func ReadJSONFromFile(t *testing.T, inputFile string) []byte {
	inputJSON, err := ioutil.ReadFile(inputFile)
	if err != nil {
		t.Errorf("could not open test file. details: %v", err)
	}

	return inputJSON
}
`;

  const functionContents = `package main

import (
	"context"
	"encoding/json"
	"github.com/aws/aws-lambda-go/events"
	runtime "github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-lambda-go/lambdacontext"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/lambda"
	"log"
	"os"
)

var client = lambda.New(session.New())

func callLambda() (string, error) {
	input := &lambda.GetAccountSettingsInput{}
	req, resp := client.GetAccountSettingsRequest(input)
	err := req.Send()
	output, _ := json.Marshal(resp.AccountUsage)
	return string(output), err
}

func handleRequest(ctx context.Context, event events.SQSEvent) (string, error) {
	// event
	eventJson, _ := json.MarshalIndent(event, "", "  ")
	log.Printf("EVENT: %s", eventJson)
	// environment variables
	log.Printf("REGION: %s", os.Getenv("AWS_REGION"))
	log.Println("ALL ENV VARS:")
	for _, element := range os.Environ() {
		log.Println(element)
	}
	// request context
	lc, _ := lambdacontext.FromContext(ctx)
	log.Printf("REQUEST ID: %s", lc.AwsRequestID)
	// global variable
	log.Printf("FUNCTION NAME: %s", lambdacontext.FunctionName)
	// context method
	deadline, _ := ctx.Deadline()
	log.Printf("DEADLINE: %s", deadline)
	// AWS SDK call
	usage, err := callLambda()
	if err != nil {
		return "ERROR", err
	}
	return usage, nil
}

func main() {
	runtime.Start(handleRequest)
}
`;

  const terraformConfig = `
terraform {
  backend "s3" {
    key = "example.tfstate"
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.0"
    }
  }
}

variable "function_architecture" {
  default = "arm64"
}
variable "region" {
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
  function_name = "\${terraform.workspace}-function"
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

data "aws_iam_policy_document" "function_lambda_role_policy" {
  # Logging permissions
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = [
      "arn:\${data.aws_partition.current.partition}:logs:\${var.region}:\${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/\${local.function_name}*",
    ]
  }

  # Function runtime permissions
  statement {
    actions = [
      "lambda:GetAccountSettings",
    ]

    resources = [
      "*",
    ]
  }
}

resource "aws_iam_role" "function_lambda" {
  assume_role_policy   = data.aws_iam_policy_document.lambda_role_assume_role_policy.json
  name_prefix          = "\${terraform.workspace}-function-"
  tags                 = var.tags

  inline_policy {
    name   = "lambda-permissions"
    policy = data.aws_iam_policy_document.function_lambda_role_policy.json
  }
}

resource "aws_cloudwatch_log_group" "function_lambda" {
  name = "/aws/lambda/\${local.function_name}"
  tags = var.tags
}

resource "aws_lambda_function" "function" {
  filename         = "./dist/function.zip"
  function_name    = local.function_name
  handler          = "bootstrap"
  role             = aws_iam_role.function_lambda.arn
  runtime          = "provided.al2"
  source_code_hash = filebase64sha256("./dist/function.zip")
  tags             = var.tags

  architectures = [
    var.function_architecture,
  ]

  depends_on = [
    aws_cloudwatch_log_group.function_lambda,
  ]
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

  await writeS3BackendCfnTemplate();

  const functionGitignorePath = path.join(
    "example.tf",
    "src",
    "function",
    ".gitignore",
  );
  if (await pathExists(functionGitignorePath)) {
    logGreen(
      "example.tf/src/function/.gitignore already exists; would have written this to it:",
    );
    console.log(functionGitignore);
    console.log();
  } else {
    if (!(await pathExists(path.join("example.tf", "src", "function")))) {
      if (!(await pathExists(path.join("example.tf", "src")))) {
        if (!(await pathExists("example.tf"))) {
          await fs.promises.mkdir("example.tf");
        }
        await fs.promises.mkdir(path.join("example.tf", "src"));
      }
      await fs.promises.mkdir(path.join("example.tf", "src", "function"));
    }
    logGreen(`Writing ${functionGitignorePath}...`);
    await fs.promises.writeFile(functionGitignorePath, functionGitignore);
  }

  if (
    await pathExists(path.join("example.tf", "src", "function", "event.json"))
  ) {
    logGreen(
      "example.tf/src/function/event.json already exists; would have written this to it:",
    );
    console.log(functionEventJson);
  } else {
    logGreen("Writing example.tf/src/function/event.json...");
    await fs.promises.writeFile(
      path.join("example.tf", "src", "function", "event.json"),
      functionEventJson,
    );
  }

  if (await pathExists(path.join("example.tf", "src", "function", "go.mod"))) {
    logGreen(
      "example.tf/src/function/go.mod already exists; would have written this to it:",
    );
    console.log(functionGoMod);
  } else {
    logGreen("Writing example.tf/src/function/go.mod...");
    await fs.promises.writeFile(
      path.join("example.tf", "src", "function", "go.mod"),
      functionGoMod,
    );
  }

  if (await pathExists(path.join("example.tf", "src", "function", "go.sum"))) {
    logGreen(
      "example.tf/src/function/go.sum already exists; would have written this to it:",
    );
    console.log(functionGoSum);
  } else {
    logGreen("Writing example.tf/src/function/go.sum...");
    await fs.promises.writeFile(
      path.join("example.tf", "src", "function", "go.sum"),
      functionGoSum,
    );
  }

  if (
    await pathExists(path.join("example.tf", "src", "function", "main_test.go"))
  ) {
    logGreen(
      "example.tf/src/function/main_test.go already exists; would have written this to it:",
    );
    console.log(functionTest);
  } else {
    logGreen("Writing example.tf/src/function/main_test.go...");
    await fs.promises.writeFile(
      path.join("example.tf", "src", "function", "main_test.go"),
      functionTest,
    );
  }

  if (await pathExists(path.join("example.tf", "src", "function", "main.go"))) {
    logGreen(
      "example.tf/src/function/main.go already exists; would have written this to it:",
    );
    console.log(functionContents);
  } else {
    logGreen("Writing example.tf/src/function/main.go...");
    await fs.promises.writeFile(
      path.join("example.tf", "src", "function", "main.go"),
      functionContents,
    );
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

  logGreen("Example generation complete");
}

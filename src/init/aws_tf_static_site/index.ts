/**
 * AWS Terraform with static site config generator
 *
 * @packageDocumentation
 */

import { spawnSync } from "child_process";
import * as admzip from "adm-zip";
import * as fs from "fs";
import * as fse from "fs-extra";
import * as path from "path";
import * as tmp from "tmp-promise";
import { generateGitIgnore, generateTsconfig } from "../";
import { writeS3BackendCfnTemplate } from "../aws_tf_s3_backend";
import { httpsGetToFile, logGreen, pathExists } from "../../util";

export async function awsTfStaticSite(): Promise<void> {
  const sitePath = "site";

  const readmeContents = `## Overview

This repo demonstrates the deployment of a simple static webapp to S3, using AWS CloudFront and a custom TLS certificate. The site build/deploy process features:

* Build caching - rolling back to a previous version of the app (e.g. \`git revert\`) will re-use the previous build instead of building it again
* Automatic CF cache invalidation for changed paths

## Setup

The example domain deployed is \`example.com\` Search for all instances of:

* \`example.com\`
* \`example_dot_com\`
* \`example-dot-com\`
* \`exampleDotCom\`

in \`main.tf\` & \`ihlp.ts\` and replace them with your domain.

## Deploying

Execute:

\`\`\`bash
npx ihlp deploy -e ENVIRONMENT
\`\`\`

e.g. \`npx ihlp deploy -e prd\`
`;

  const configContents = `import type { IHLPConfig } from "ihlp/lib/config";

const envOptions = {
  prd: {
    namespace: "prd-example-website",
    tags: {
      environment: "prd",
      namespace: "prd-example-website",
    },
    tfVersion: "1.3.5",
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
            templatePath: "./cfn-templates/tf-state.yml",
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
              tags: envOptions[process.env.IHLP_ENV].tags,
            },
            workspace: process.env.IHLP_ENV,
          },
          path: "infra.tf",
          type: "terraform",
        },
        {
          path: "${sitePath}",
          options: {
            archiveCache: {
              s3Bucket: \`\\\${aws-cfn-output stack=\${
                envOptions[process.env.IHLP_ENV].namespace
              }-tf-state,output=BucketName}\`,
              s3Prefix: \`\${process.env.IHLP_ENV}/exampleDotCom/\`,
            },
            deleteExtraObjects: true,
            build: [
              {
                command: ["npm", "ci"],
              },
              {
                command: ["npm", "run", "build"],
              },
            ],
            postSync: {
              cfInvalidation: {
                distributionID: \`\\\${aws-ssm-param name=/\${process.env.IHLP_ENV}/exampleDotCom/cfDistributionId}\`,
              },
            },
            deployedStateTracking: {
              ssmParam: \`/\${process.env.IHLP_ENV}/exampleDotCom/deployedSourceHash\`,
            },
            outDir: "public",
            sourceHashOpts: {
              folders: {
                exclude: [
                  ".cache",
                  ".github",
                  ".git",
                  "node_modules",
                  "public",
                ],
              },
            },
            destination: {
              s3Bucket: \`\\\${aws-ssm-param name=/\${process.env.IHLP_ENV}/exampleDotCom/siteBucketName}\`,
              region: "us-east-1",
            },
          },
          type: "sync-to-remote-storage",
        },
      ],
      locations: ["us-west-2"],
    },
  ],
};

module.exports = ihlpConfig;
`;

  const tfGitIgnore = `.terraform
`;

  const tfConfig = `terraform {
  backend "s3" {
    key = "infra.tfstate"
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
variable "tags" {
  default = {}
  type    = map(any)
}

provider "aws" {
  region = var.region
}

provider "aws" {
  alias  = "virginia"
  region = "us-east-1"
}

data "aws_route53_zone" "example_dot_com" {
  name = "example.com"
}

resource "aws_acm_certificate" "example_dot_com" {
  provider = aws.virginia

  domain_name       = "example.com"
  tags              = var.tags
  validation_method = "DNS"

  subject_alternative_names = [
    "www.example.com",
  ]
}

resource "aws_route53_record" "example_dot_com_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.example_dot_com.domain_validation_options : dvo.domain_name => {
      name    = dvo.resource_record_name
      record  = dvo.resource_record_value
      type    = dvo.resource_record_type
      zone_id = data.aws_route53_zone.example_dot_com.zone_id
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = each.value.zone_id
}

resource "aws_acm_certificate_validation" "example_dot_com" {
  provider = aws.virginia

  certificate_arn         = aws_acm_certificate.example_dot_com.arn
  validation_record_fqdns = [for record in aws_route53_record.example_dot_com_cert_validation : record.fqdn]
}

# https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
resource "aws_cloudfront_origin_access_control" "example_dot_com" {
  name                              = "\${terraform.workspace}-example-dot-com"
  description                       = "CF access to example.com bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket" "example_dot_com" {
  provider = aws.virginia

  bucket_prefix = "\${terraform.workspace}-example-dot-com-"
  tags          = var.tags
}

resource "aws_s3_bucket_acl" "bucket_acl" {
  provider = aws.virginia

  acl    = "private"
  bucket = aws_s3_bucket.example_dot_com.id
}

resource "aws_s3_bucket_versioning" "example_dot_com" {
  provider = aws.virginia

  bucket = aws_s3_bucket.example_dot_com.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "example_dot_com" {
  provider = aws.virginia

  bucket = aws_s3_bucket.example_dot_com.id

  rule {
    id     = "expire_noncurrent_objects"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

resource "aws_ssm_parameter" "example_dot_com_bucket_name" {
  name  = "/\${terraform.workspace}/exampleDotCom/siteBucketName"
  tags  = var.tags
  type  = "String"
  value = aws_s3_bucket.example_dot_com.id
}

resource "aws_cloudfront_function" "rewrite_directory_index" {
  provider = aws.virginia

  code    = file("\${path.module}/rewrite_directory_index.js")
  comment = "Rewrite incoming requests to load index.html objects"
  name    = "\${terraform.workspace}-rewrite-directory-index"
  runtime = "cloudfront-js-1.0"
}

resource "aws_cloudfront_response_headers_policy" "example_dot_com" {
  provider = aws.virginia

  name = "\${terraform.workspace}-exampledotcom-response-headers"

  custom_headers_config {
    items {
      header   = "permissions-policy"
      override = true
      value    = "interest-cohort=()"
    }
  }
}

locals {
  s3_origin_id = "myS3Origin"
}
resource "aws_cloudfront_distribution" "example_dot_com" {
  provider = aws.virginia

  default_root_object = "index.html"
  enabled             = true
  is_ipv6_enabled     = true
  price_class         = "PriceClass_100"
  tags                = var.tags

  aliases = [
    "example.com",
    "www.example.com",
  ]

  default_cache_behavior {
    default_ttl                = 86400
    max_ttl                    = 31536000
    min_ttl                    = 0
    response_headers_policy_id = aws_cloudfront_response_headers_policy.example_dot_com.id
    target_origin_id           = local.s3_origin_id
    viewer_protocol_policy     = "redirect-to-https"

    allowed_methods = [
      "GET",
      "HEAD",
    ]

    cached_methods = [
      "GET",
      "HEAD",
    ]

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.rewrite_directory_index.arn
    }
  }

  origin {
    domain_name              = aws_s3_bucket.example_dot_com.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.example_dot_com.id
    origin_id                = local.s3_origin_id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.example_dot_com.certificate_arn
    minimum_protocol_version = "TLSv1"
    ssl_support_method       = "sni-only"
  }
}

resource "aws_ssm_parameter" "example_dot_com_distribution_id" {
  name  = "/\${terraform.workspace}/exampleDotCom/cfDistributionId"
  tags  = var.tags
  type  = "String"
  value = aws_cloudfront_distribution.example_dot_com.id
}

data "aws_iam_policy_document" "example_dot_com_bucket_policy" {
  statement {
    actions = [
      "s3:GetObject",
    ]

    resources = [
      "\${aws_s3_bucket.example_dot_com.arn}/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"

      values = [
        aws_cloudfront_distribution.example_dot_com.arn,
      ]
    }

    principals {
      type = "Service"

      identifiers = [
        "cloudfront.amazonaws.com",
      ]
    }
  }
}
resource "aws_s3_bucket_policy" "example_dot_com" {
  provider = aws.virginia

  bucket = aws_s3_bucket.example_dot_com.id
  policy = data.aws_iam_policy_document.example_dot_com_bucket_policy.json
}

resource "aws_route53_record" "example_dot_com" {
  name    = "example.com"
  type    = "A"
  zone_id = data.aws_route53_zone.example_dot_com.zone_id

  alias {
    name                   = aws_cloudfront_distribution.example_dot_com.domain_name
    zone_id                = aws_cloudfront_distribution.example_dot_com.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_dot_example_dot_com" {
  name    = "www.example.com"
  type    = "CNAME"
  ttl     = "900"
  zone_id = data.aws_route53_zone.example_dot_com.zone_id

  records = [
    aws_cloudfront_distribution.example_dot_com.domain_name,
  ]
}
`;

  const cfRewriteDirIndex = `/**
 * CloudFront function package
 *
 * @packageDocumentation
 */

/** Rewrite incoming requests to always explicitly retrieve an object by name */
function handler(event) {
    var request = event.request;
    request.uri = request.uri.replace(/\\/$/, '/index.html');
    return request;
}
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

  if (await pathExists("README.md")) {
    logGreen("README.md already exists; would have written this to it:");
    console.log(readmeContents);
  } else {
    logGreen("Writing README.md...");
    await fs.promises.writeFile("README.md", readmeContents);
  }

  await writeS3BackendCfnTemplate();

  const tfGitIgnorePath = path.join("infra.tf", ".gitignore");
  if (await pathExists(tfGitIgnorePath)) {
    logGreen(
      "TF .gitignore file already exists; would have written this to it:",
    );
    console.log(tfGitIgnore);
    console.log();
  } else {
    if (!(await pathExists("infra.tf"))) {
      await fs.promises.mkdir("infra.tf");
    }
    logGreen(`Writing ${tfGitIgnorePath}...`);
    await fs.promises.writeFile(tfGitIgnorePath, tfGitIgnore);
  }

  const tfConfigPath = path.join("infra.tf", "main.tf");
  if (await pathExists(tfConfigPath)) {
    logGreen("TF main.tf file already exists; would have written this to it:");
    console.log(tfConfig);
    console.log();
  } else {
    logGreen(`Writing ${tfConfigPath}...`);
    await fs.promises.writeFile(tfConfigPath, tfConfig);
  }

  const cfRewriteDirIndexPath = path.join(
    "infra.tf",
    "rewrite_directory_index.js",
  );
  if (await pathExists(cfRewriteDirIndexPath)) {
    logGreen(
      "rewrite_directory_index.js file already exists; would have written this to it:",
    );
    console.log(cfRewriteDirIndex);
    console.log();
  } else {
    logGreen(`Writing ${cfRewriteDirIndexPath}...`);
    await fs.promises.writeFile(cfRewriteDirIndexPath, cfRewriteDirIndex);
  }

  if (await pathExists(sitePath)) {
    logGreen(`Example website directory ${sitePath} already exists`);
  } else {
    logGreen(`Downloading example static site to directory: ${sitePath}`);
    const tmpDir = await tmp.dir({ unsafeCleanup: true });
    const dlPath = path.join(tmpDir.path, "site.zip");
    await httpsGetToFile(
      "https://github.com/LekoArts/gatsby-starter-portfolio-cara/archive/refs/heads/master.zip",
      dlPath,
    );
    const dlZip = new admzip(dlPath);
    dlZip.extractAllTo(tmpDir.path);
    await fse.move(
      path.join(tmpDir.path, "gatsby-starter-portfolio-cara-master"),
      sitePath,
    );
    logGreen('Running "npm i" to install site dependencies...');
    const exitCode = spawnSync("npm", ["i"], { cwd: sitePath }).status;
    if (exitCode != 0) {
      process.exit(exitCode ? exitCode : 1);
    }
  }

  logGreen("Example generation complete");
}

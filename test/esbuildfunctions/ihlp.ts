import type { IHLPConfig } from "ihlp/lib/config";

if (!process.env.IHLP_ENV || !process.env.IHLP_AWS_ROLE_BOUNDARY_ARN) {
  console.error("Missing required environment variables!");
  process.exit(1);
}

const nodeVersion = "14";
const tfStackName = `${process.env.IHLP_ENV}-tf-state`;
const tags = {
  environment: process.env.IHLP_ENV,
  purpose: "integration-test",
};

const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
        {
          options: {
            stackName: tfStackName,
            stackTags: tags,
            templatePath: "./cfn-templates/tf-state.yml",
          },
          type: "aws-cfn-stack",
        },
        {
          options: {
            bucketNames: `\${aws-cfn-output stack=${tfStackName},output=BucketName}`,
          },
          type: "aws-empty-s3-buckets-on-destroy",
        },
        {
          path: "example.tf",
          options: {
            archiveCache: {
              s3Bucket: `\${aws-cfn-output stack=${tfStackName},output=BucketName}`,
              s3Prefix: `${process.env.IHLP_ENV}/exampleFunctions/`,
            },
            srcDir: "src",
            outDir: "dist",
            target: `node${nodeVersion}`,
          },
          type: "esbuild-functions",
        },
        {
          options: {
            backendConfig: {
              bucket: `\${aws-cfn-output stack=${tfStackName},output=BucketName}`,
              dynamodb_table: `\${aws-cfn-output stack=${tfStackName},output=TableName}`,
              region: "${env IHLP_LOCATION}",
            },
            terraformVersion: "1.0.2",
            variables: {
              node_version: nodeVersion,
              region: "${env IHLP_LOCATION}",
              role_boundary_arn: process.env.IHLP_AWS_ROLE_BOUNDARY_ARN,
              tags: tags,
            },
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

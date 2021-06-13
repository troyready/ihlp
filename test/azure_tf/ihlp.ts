import type { IHLPConfig } from "ihlp/lib/config";

if (!process.env.ARM_SUBSCRIPTION_ID || !process.env.IHLP_ENV) {
  console.error("Missing required environment variables!");
  process.exit(1);
}

const azureSubId = process.env.ARM_SUBSCRIPTION_ID;
const envName = process.env.IHLP_ENV;
const rgName = envName + "-ihlpazuretf";
const storageName = envName + "ihlpazuretf";
const tags = {
  environment: envName,
  purpose: "integration-test",
};

const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
        {
          options: {
            resourceGroups: rgName,
            subscriptionId: azureSubId,
          },
          type: "azure-delete-resource-groups-on-destroy",
        },
        {
          options: {
            deploymentName: rgName,
            deploymentParameters: {
              location: "${env IHLP_LOCATION}",
              name: rgName,
              tags: tags,
            },
            subscriptionId: azureSubId,
            templatePath: "./arm-templates/resource-group.json",
          },
          type: "azure-arm-deployment",
        },
        {
          options: {
            deploymentName: `${rgName}-tf-state`,
            deployTo: {
              resourceGroupName: rgName,
            },
            deploymentParameters: {
              storageAccountName: storageName,
            },
            subscriptionId: azureSubId,
            templatePath: "./arm-templates/tf-state.json",
          },
          type: "azure-arm-deployment",
        },
        {
          options: {
            backendConfig: {
              resource_group_name: rgName,
              storage_account_name: storageName,
              container_name: "tfstate",
            },
            terraformVersion: "1.0.2",
            variables: {
              resource_group: {
                location: "${env IHLP_LOCATION}",
                name: rgName,
              },
              tags: tags,
            },
          },
          path: "example.tf",
          type: "terraform",
        },
      ],
      locations: ["eastus"],
    },
  ],
};

module.exports = ihlpConfig;

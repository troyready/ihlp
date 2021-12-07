/**
 * Azure Terraform with ARM backend config generator
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { generateGitIgnore, generateTsconfig } from "../";
import { logGreen, pathExists } from "../../util";

export async function azureTfWithArmBackend(): Promise<void> {
  // Storage account names must be unique
  const randomSuffix = uuidv4().replace(/-/g, "").substring(0, 12);

  const configContents = `import type { IHLPConfig } from "ihlp/lib/config";

const envOptions = {
  dev: {
    namespace: "dev-ihlp-proj",
    azureSubId: "SUBSCRIPTION_ID_HERE",
    storageAccountName: "devihlpproj${randomSuffix}",
    tags: {
      environment: "dev",
      namespace: "dev-ihlp-proj",
    },
  },
  prod: {
    namespace: "prod-ihlp-proj",
    azureSubId: "SUBSCRIPTION_ID_HERE",
    storageAccountName: "prodihlpproj${randomSuffix}",
    tags: {
      environment: "prod",
      namespace: "prod-ihlp-proj",
    },
  },
};
    
const ihlpConfig: IHLPConfig = {
  deployments: [
    {
      blocks: [
        {
          options: {
            resourceGroups: envOptions[process.env.IHLP_ENV].namespace,
            subscriptionId: envOptions[process.env.IHLP_ENV].azureSubId,
          },
          type: "azure-delete-resource-groups-on-destroy",
        },
        {
          options: {
            deploymentName: \`\${envOptions[process.env.IHLP_ENV].namespace}-tfstate-rg\`,
            deploymentParameters: {
              location: "eastus",
              name: envOptions[process.env.IHLP_ENV].namespace,
              tags: envOptions[process.env.IHLP_ENV].tags,
            },
            subscriptionId: envOptions[process.env.IHLP_ENV].azureSubId,
            templatePath: "./arm-templates/resource-group.json",
          },
          type: "azure-arm-deployment",
        },
        {
          options: {
            deploymentName: \`\${
              envOptions[process.env.IHLP_ENV].namespace
            }-tfstate\`,
            deployTo: {
              resourceGroupName: envOptions[process.env.IHLP_ENV].namespace,
            },
            deploymentParameters: {
              storageAccountName:
                envOptions[process.env.IHLP_ENV].storageAccountName,
              tags: envOptions[process.env.IHLP_ENV].tags,
            },
            subscriptionId: envOptions[process.env.IHLP_ENV].azureSubId,
            templatePath: "./arm-templates/tf-state.json",
          },
          type: "azure-arm-deployment",
        },
        {
          options: {
            backendConfig: {
              resource_group_name: envOptions[process.env.IHLP_ENV].namespace,
              storage_account_name:
                envOptions[process.env.IHLP_ENV].storageAccountName,
              container_name: "tfstate",
            },
            terraformVersion: "1.0.2", // specify here or in .terraform-version file in terraform directory
            variables: {
              location: "\${env IHLP_LOCATION}",
              namespace: envOptions[process.env.IHLP_ENV].namespace,
              tags: envOptions[process.env.IHLP_ENV].tags,
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
`;

  const rgTemplateContents = `{
  "$schema": "https://schema.management.azure.com/schemas/2018-05-01/subscriptionDeploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "location": {
      "type": "string",
      "defaultValue": "westus",
      "metadata": {
        "description": "Location of resource group."
      }
    },
    "name": {
      "type": "string",
      "metadata": {
        "description": "Name of resource group."
      }
    },
    "tags": {
      "defaultValue": {},
      "type": "object",
      "metadata": {
        "description": "Resource group tags."
      }
    }
  },
  "resources": [
    {
      "name": "[parameters('name')]",
      "type": "Microsoft.Resources/resourceGroups",
      "apiVersion": "2020-06-01",
      "location": "[parameters('location')]",
      "tags": "[parameters('tags')]",
      "properties": {}
    }
  ]
}
`;

  const stateArmTemplateContents = `{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "containerName": {
      "type": "string",
      "defaultValue": "tfstate",
      "metadata": {
        "description": "Specifies the name of the blob container."
      }
    },
    "location": {
      "type": "string",
      "defaultValue": "[resourceGroup().location]",
      "metadata": {
        "description": "Specifies the location in which the Azure Storage resources should be deployed."
      }
    },
    "storageAccountName": {
      "type": "string",
      "metadata": {
        "description": "Specifies the name of the Azure Storage account."
      }
    },
    "tags": {
      "defaultValue": {},
      "type": "object",
      "metadata": {
        "description": "Resource tags."
      }
    }
  },
  "resources": [
    {
      "type": "Microsoft.Storage/storageAccounts",
      "apiVersion": "2019-06-01",
      "name": "[parameters('storageAccountName')]",
      "location": "[parameters('location')]",
      "sku": {
        "name": "Standard_LRS",
        "tier": "Standard"
      },
      "kind": "StorageV2",
      "properties": {
        "accessTier": "Hot"
      },
      "resources": [
        {
          "type": "blobServices/containers",
          "apiVersion": "2019-06-01",
          "name": "[concat('default/', parameters('containerName'))]",
          "dependsOn": [
            "[parameters('storageAccountName')]"
          ]
        }
      ],
      "tags": "[parameters('tags')]"
    }
  ]
}
`;

  const tfGitIgnore = `.terraform
`;

  const tfConfig = `terraform {
  backend "azurerm" {
    key = "example.tfstate"
  }

  required_providers {
    azurerm = ">=2.0"
  }
}

variable "location" {
  type = string
}
variable "namespace" {
  type = string
}
variable "tags" {
  default = {}
  type    = map(string)
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "example" {
  location = var.location
  name     = "\${var.namespace}-example"
  tags     = var.tags
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
  logGreen(
    "(Update the azureSubId values with your Azure Subscription ID, i.e. from 'az account list')",
  );

  const rgTemplatePath = path.join("arm-templates", "resource-group.json");
  if (await pathExists(rgTemplatePath)) {
    logGreen(
      "Resource Group template file already exists; would have written this to it:",
    );
    console.log(rgTemplateContents);
    console.log();
  } else {
    if (!(await pathExists("arm-templates"))) {
      await fs.promises.mkdir("arm-templates");
    }
    logGreen(`Writing ${rgTemplatePath}...`);
    await fs.promises.writeFile(rgTemplatePath, rgTemplateContents);
  }

  const stateArmTemplatePath = path.join("arm-templates", "tf-state.json");
  if (await pathExists(stateArmTemplatePath)) {
    logGreen(
      "Terraform state storage template file already exists; would have written this to it:",
    );
    console.log(stateArmTemplateContents);
    console.log();
  } else {
    logGreen(`Writing ${stateArmTemplatePath}...`);
    await fs.promises.writeFile(stateArmTemplatePath, stateArmTemplateContents);
  }

  const tfGitIgnorePath = path.join("example.tf", ".gitignore");
  if (await pathExists(tfGitIgnorePath)) {
    logGreen(
      "TF .gitignore file already exists; would have written this to it:",
    );
    console.log(tfGitIgnore);
    console.log();
  } else {
    if (!(await pathExists("example.tf"))) {
      await fs.promises.mkdir("example.tf");
    }
    logGreen(`Writing ${tfGitIgnorePath}...`);
    await fs.promises.writeFile(tfGitIgnorePath, tfGitIgnore);
  }

  const tfConfigPath = path.join("example.tf", "main.tf");
  if (await pathExists(tfConfigPath)) {
    logGreen("TF main.tf file already exists; would have written this to it:");
    console.log(tfConfig);
    console.log();
  } else {
    logGreen(`Writing ${tfConfigPath}...`);
    await fs.promises.writeFile(tfConfigPath, tfConfig);
  }

  logGreen("Example generation complete");
}

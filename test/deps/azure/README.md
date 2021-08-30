## Azure Setup

Set the following GitHub repository secrets for integration tests.

### Subscription ID

Set `ARM_SUBSCRIPTION_ID` to the ID of the Azure subscription to use (i.e. from `az account show`). This is referenced by [Terraform](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/guides/service_principal_client_secret#configuring-the-service-principal-in-terraform) and IHLP ARM deployments.

### Service Principal

GitHub Actions runs integration tests using an [Azure Service Principal](https://docs.microsoft.com/en-us/cli/azure/create-an-azure-service-principal-azure-cli). Create it using a command line the following:

```bash
az ad sp create-for-rbac --skip-assignment --name IHLPIntegrationTester
```

Then set the repository secrets:

* `ARM_CLIENT_ID` - set to the displayed `appId`
* `ARM_TENANT_ID` - set to the displayed `tenant`
* `ARM_CLIENT_SECRET` - set to the displayed `password`

Finally, assign a role to the principal:

```bash
az deployment sub create --confirm-with-what-if --what-if-exclude-change-types NoChange --location eastus --template-file role-assignment.json --parameters principalId=$(az ad sp list --display-name IHLPIntegrationTester --query '[].objectId' --output tsv) builtInRoleType=Owner roleAssignmentGuid=1C7F92B9-C8E8-43A6-BF94-8D3FC5E27A8E
```
([roleAssignmentGuid was generated](https://stackoverflow.com/questions/246930/is-there-any-difference-between-a-guid-and-a-uuid) via `uuidgen| awk '{print toupper($0)}'`)

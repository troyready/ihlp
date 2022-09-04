variable "federated_identity_credential_description" {
  default     = "Testing"
  description = "Description for Azure AD application federated identity credential"
}

variable "display_name" {
  default = "GitHubOIDC"
  description = "Application and federated identity credential display name"
}

variable "owners" {
  description = "AzureAD owners of the service principle and application"
    type = list(string)
}

variable "repo_name" {
  default     = "troyready/ihlp"
  description = "Name of GitHub repo"
}

variable "subscription_id" {
    description = "Azure subscription ID of which the service principle will be made an Owner"
}

# https://docs.microsoft.com/en-us/azure/developer/github/connect-from-azure
resource "azuread_application" "this" {
  display_name = var.display_name
  owners       = var.owners
}

resource "azuread_service_principal" "this" {
  app_role_assignment_required = false
  application_id               = azuread_application.this.application_id
  owners                       = var.owners
}

resource "azurerm_role_assignment" "this" {
  principal_id                     = azuread_service_principal.this.object_id
  role_definition_name             = "Owner"
  scope                            = var.subscription_id  # in general would be better to scope down to a resource group but this testing requires the ability to create/delete RGs
  skip_service_principal_aad_check = true
}

resource "azuread_application_federated_identity_credential" "ihlp_prs" {
  application_object_id = azuread_application.this.object_id
  description           = var.federated_identity_credential_description
  display_name          = var.display_name
  issuer                = "https://token.actions.githubusercontent.com"
  subject               = "repo:${var.repo_name}:pull_request"

  audiences = [
    "api://AzureADTokenExchange",
  ]
}

output "client_id" {
  value = azuread_application.this.application_id 
}
output "subscription_id" {
  value = regex("^/subscriptions/([-0-9a-z]*)/", azurerm_role_assignment.this.id)[0]
}
output "tenant_id" {
  value = azuread_service_principal.this.application_tenant_id
}

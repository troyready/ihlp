## Azure Setup

Use this directory's Terraform module to create the GitHub Actions -> Azure OIDC trust and set the GitHub repository secrets for integration tests:

```
provider "azuread" {
  tenant_id = <tenant_id>
}

provider "azurerm" {
  features {}
}

resource "github_repository" "repo" {
  name = <repo_name>
}

module "oidc" {
  source = "github.com/<repo_full_name>//test/deps/azure"

  repo_name = github_repository.repo.full_name
}

resource "github_actions_secret" "ARM_CLIENT_ID" {
  repository      = github_repository.repo.name
  plaintext_value = module.oidc.client_id
  secret_name     = "ARM_CLIENT_ID"
}

resource "github_actions_secret" "ARM_SUBSCRIPTION_ID" {
  repository      = github_repository.repo.name
  plaintext_value = module.oidc.subscription_id
  secret_name     = "ARM_SUBSCRIPTION_ID"
}

resource "github_actions_secret" "ARM_TENANT_ID" {
  repository      = github_repository.repo.name
  plaintext_value = module.oidc.tenant_id
  secret_name     = "ARM_TENANT_ID"
}
```

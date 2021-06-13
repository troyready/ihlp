terraform {
  backend "azurerm" {
    key = "infra.tfstate"
  }

  required_providers {
    azurerm = ">=2.0"
  }
}

variable "resource_group" {
  type = object({
    name     = string
    location = string
  })
}
variable "tags" {
  default = {}
  type    = map(string)
}

provider "azurerm" {
  features {}
}

resource "azurerm_ssh_public_key" "example" {
  name                = "${var.resource_group.name}-example"
  resource_group_name = var.resource_group.name
  location            = var.resource_group.location
  public_key          = file("./id_rsa.pub")
  tags                = var.tags
}

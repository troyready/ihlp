terraform {
  backend "gcs" {
    prefix = "/example"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 4.0"
    }
    random= {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

variable "labels" {
  default = {}
  type    = map
}

provider "google" {}

resource "random_id" "bucket" {
  byte_length = 4
}

resource "google_storage_bucket" "example" {
  force_destroy = true
  labels        = var.labels
  location      = "US"
  name          = "example-bucket-${random_id.bucket.hex}"
}


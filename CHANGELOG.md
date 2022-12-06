# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.2] - 2022-12-05
### Added
- Support for TFENV_NETRC_PATH environment variable

## [0.8.1] - 2022-11-29
### Fixed
- sync-to-remote-storage runner will no longer try to invalidate 0 CloudFront paths
- serverless init generator errors when tmp storage is mounted on a different filesystem

### Added
- IAM Role assumption support for Serverless runner (e.g. deploying CFN stack)
- Init generator for AWS static site

## [0.8.0] - 2022-11-22
### Added
- IAM Role assumption support for AWS runners (e.g. deploying CFN stack) & CFN output lookup variables

## [0.7.1] - 2022-09-06
### Added
- NodeJs Lambda function init generator

### Changed
- Bumped general Terraform AWS provider versions to v4

## [0.7.0] - 2022-09-04
### Fixed
- Directory changes errors will now generate proper error messages instead of stacktraces

### Changed
- Default version of Terraform is now v1.2.8
- Update `@azure/arm-resources` dependency to v5

## [0.6.3] - 2022-02-20
### Fixed
- Terraform installation errors when temporary directories on are separate filesystems

## [0.6.2] - 2022-02-08
### Fixed
- Missing tags in AWS EKS w/ example IAM-integration job init generator

## [0.6.1] - 2022-02-07
### Added
- AWS EKS w/ example IAM-integration job init generator
- Go function builder will now attempt to strip GOPATH from builds for reproducibility

## [0.6.0] - 2021-12-16
### Added
- Golang Lambda function builder & init generator

## [0.5.0] - 2021-12-14
### Changed
- Terraform workspace name must now be explicitly set
  - This is mainly to support Terraform Enterprise/Cloud where a workspace name may be set in the Terraform files themselves

### Added
- Terraform Cloud init generator

### Fixed
- Inconsistent directory name in sample azure template 

## [0.4.4] - 2021-12-06
### Fixed
- GCP project id will now be automatically retrieved from application default credentials

## [0.4.3] - 2021-12-01
### Fixed
- Terraform downloads on darwin not having correct permissions set

## [0.4.2] - 2021-12-01
### Fixed
- Better GCP auth error handling

## [0.4.1] - 2021-11-29
### Fixed
- Added tsconfig.json file generation to init

## [0.4.0] - 2021-11-22
### Fixed
- Fixed `init` @types/node detection

### Added
- GCP deployment manager support

## [0.3.2] - 2021-11-17
### Added
- AWS EKS with Flux init generator

## [0.3.1] - 2021-11-16
### Fixed
- Fixed `--target` option (now skipping non-matching block correctly)
- Fixed TF targets syntax (dropped extra quotes)

## [0.3.0] - 2021-11-15
### Added
- `--target` option to `deploy/destroy/tf-shell` to specify block names to target
- `target` option in Terraform blocks to specify `--target=` option during terraform operations
- `--upgrade` option to `deploy` to use the upgrade option of `tf init`

## [0.2.0] - 2021-11-07
### Added
- `--upgrade` option to tf-shell to use the upgrade option of `tf init`

## [0.1.10] - 2021-10-07
### Fixed
- Add gitignore file to init examples

## [0.1.9] - 2021-10-05
### Fixed
- Add license file

## [0.1.8] - 2021-09-24
### Fixed
- Add environment option to tf-shell subcommand

## [0.1.7] - 2021-09-24
### Fixed
- Move typescript to regular dependencies to fix ts-node

## [0.1.6] - 2021-09-23
### Fixed
- Deployment on ARM fixed (dropped `nodegit` package)
  - Automatic environment detection from git branch dropped for now

### Changed
- Switched to `archiver` for zip file generation

## [0.1.5] - 2021-09-21
### Fixed
- Terraform will now download the correct build for the system architecture

## [0.1.4] - 2021-09-14
### Added
* Support for `TFENV_REMOTE` environment variable for custom Terraform release mirrors
* Follow redirects on file (e.g. Terraform archives) downloads

## [0.1.3] - 2021-09-12
### Added
- Support auto-approving deployments on additional CI platforms (via `@npmcli/ci-detect` library)

## [0.1.2] - 2021-09-01
### Fixed
- `(Azure) Terraform with ARM backend` terraform state template missing tags parameter

## [0.1.1] - 2021-08-30
### Fixed
- `(Azure) Terraform with ARM backend` init template generation error

## [0.1.0] - 2021-08-30
### Added
- Initial commit

[Unreleased]: https://github.com/troyready/ihlp/compare/v0.8.2...HEAD
[0.8.2]: https://github.com/troyready/ihlp/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/troyready/ihlp/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/troyready/ihlp/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/troyready/ihlp/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/troyready/ihlp/compare/v0.6.3...v0.7.0
[0.7.0]: https://github.com/troyready/ihlp/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/troyready/ihlp/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/troyready/ihlp/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/troyready/ihlp/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/troyready/ihlp/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/troyready/ihlp/compare/v0.4.4...v0.5.0
[0.4.4]: https://github.com/troyready/ihlp/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/troyready/ihlp/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/troyready/ihlp/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/troyready/ihlp/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/troyready/ihlp/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/troyready/ihlp/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/troyready/ihlp/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/troyready/ihlp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/troyready/ihlp/compare/v0.1.10...v0.2.0
[0.1.10]: https://github.com/troyready/ihlp/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/troyready/ihlp/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/troyready/ihlp/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/troyready/ihlp/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/troyready/ihlp/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/troyready/ihlp/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/troyready/ihlp/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/troyready/ihlp/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/troyready/ihlp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/troyready/ihlp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/troyready/ihlp/releases/tag/v0.1.0

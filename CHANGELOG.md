# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/troyready/ihlp/compare/v0.3.2...HEAD
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

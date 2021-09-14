# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
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

[Unreleased]: https://github.com/troyready/ihlp/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/troyready/ihlp/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/troyready/ihlp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/troyready/ihlp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/troyready/ihlp/releases/tag/v0.1.0

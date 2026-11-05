# Changelog

All notable changes to acme-widget are documented in this file. This is a demo
fixture for BumpAudit: host it anywhere public and audit it.

## [Unreleased]

## [2.0.0] - 2026-03-01

### Removed
- Removed the legacy `connect()` API. Use `Client.open()` instead.

### Added
- New `--json` output flag for the command line tool.

## [1.5.0] - 2026-01-10

### Added
- Added streaming uploads for large files.

### Fixed
- Fixed a crash when uploading empty files.

## [1.4.3] - 2025-12-15

### Fixed
- Fixed a typo in the help text.

### Removed
- Removed the deprecated `--legacy` flag. Scripts that still pass it now fail.

## [1.4.2] - 2025-12-01

### Fixed
- Fixed a memory leak in the uploader.

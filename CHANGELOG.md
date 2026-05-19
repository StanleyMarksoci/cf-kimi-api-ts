# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-05-19

### Added

- Multi-model gateway architecture — support for Kimi, OpenAI, and custom API endpoints
- Agent routing rules with model name matching and wildcard (`*`) support
- Admin dashboard SPA with stats overview, account/key management, and request logs
- Requests log storage with D1 database (filter, pagination, detail view)
- Account pool health monitoring with token type detection and expiration display
- Sparkline chart showing 24h request trend on the dashboard

### Changed

- Renamed from `worker-ai-proxy` to `cf-kimi-api-ts`
- Refactored Kimi protocol client to support pluggable transport layer
- Enhanced error handling with upstream status code tracking

### Security

- CSRF protection for all admin API mutations
- Cookie-based session management with configurable `SESSION_SECRET`

## [1.1.0] - 2026-02-?? (pre-refactor)

- Initial Kimi-to-OpenAI proxy implementation
- Basic account pool with token refresh
- Legacy `cf-kimi-api` naming

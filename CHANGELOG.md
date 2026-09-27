# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Monorepo with `apps/web` (React + Vite) and `packages/engine` (TypeScript).
- Free-space path loss function with unit tests.
- Floor plan schema v1 (`@signalplan/floorplan`) with validation, migrations, a sample home, and a function that splits walls into material segments for the engine.
- Engine: wall crossings along a straight path and the total wall loss, counting corners and door edges once.
- Engine: North American band profiles and wall-material losses computed from ITU-R P.2040-4 layered constructions, including low-E glass fitted to published measurements; `docs/MODEL.md`.
- Floor plan: `low-e-glass` material; radio power is EIRP.
- Engine: coverage grid for a floor and band (10 cm cells, strongest access point per cell) and a typed Web Worker message API.
- CI: typecheck, lint, format check, tests, build, and Cloudflare Pages deploys with pull request previews.

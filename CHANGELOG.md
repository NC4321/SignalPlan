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
- Save and open: autosave in the browser with a status indicator, reopening the last plan, New plan, Open and Save to `.signalplan.json` files, confirmation before replacing an edited plan, and an editable plan name.
- Doors and windows: Door and Window tools with slide-to-fit placement, dragging along walls, and a panel for kind, width and material (including open doorways).
- Select and edit: click and Shift-click selection, drag corners (joining on drop) and walls (at right angles, stretching neighbours), arrow-key nudging, Delete with automatic merging, double-click to split, and a properties panel for wall material and length.
- Wall tool: click-to-chain drawing with snapping (corners, walls, 15° steps, grid; Alt to bypass), T and X junctions, typed lengths and angles, per-material wall styles with a legend, and a material picker.
- Editor foundation: full-screen layout, pan and zoom, adaptive metric/imperial grid, undo and redo, units toggle, and browser tests with Playwright in CI.
- Web: live heatmap of the sample flat with a draggable router, band switcher, signal readout and a colour-blind-safe quality legend.
- CI: typecheck, lint, format check, tests, build, and Cloudflare Pages deploys with pull request previews.

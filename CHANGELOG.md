# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Access point tool (A): click to add an access point, then set its name, mounting height, bands and power per band (with a note above the FCC limit). Access points can now be deleted, with undo.
- Engine property tests (fast-check): adding a wall never raises signal, signal never rises with distance on an open line, wall losses are finite and never negative (metal capped at 40 dB), and adding an access point never lowers any cell.
- Keyboard access and screen-reader labels: the tools form a toolbar navigable with arrow keys, the File menu works by keyboard, dialogs return focus to where they opened from, and on the canvas Tab steps through walls, doors and windows, corners and access points with the selection announced. Browser tests now include axe-core scans.
- Monorepo with `apps/web` (React + Vite) and `packages/engine` (TypeScript).
- Free-space path loss function with unit tests.
- Floor plan schema v1 (`@signalplan/floorplan`) with validation, migrations, a sample home, and a function that splits walls into material segments for the engine.
- Engine: wall crossings along a straight path and the total wall loss, counting corners and door edges once.
- Engine: North American band profiles and wall-material losses computed from ITU-R P.2040-4 layered constructions, including low-E glass fitted to published measurements; `docs/MODEL.md`.
- Floor plan: `low-e-glass` material; radio power is EIRP.
- Engine: coverage grid for a floor and band (10 cm cells, strongest access point per cell) and a typed Web Worker message API.
- Tracing: add a PNG, JPEG or WebP floor plan image to a floor, set its scale by clicking two points and typing the distance, drag it into place, and adjust opacity, visibility and lock (or recalibrate, replace or remove it) from the properties panel. All of it can be undone, and saved files embed the image.
- My plans: every edited plan is kept in a list in the browser (IndexedDB), with open, rename, duplicate and delete; plans saved by the previous version move over automatically.
- Save and open: autosave in the browser with a status indicator, reopening the last plan, New plan, Open and Save to `.signalplan.json` files, confirmation before replacing an edited plan, and an editable plan name.
- Doors and windows: Door and Window tools with slide-to-fit placement, dragging along walls, and a panel for kind, width and material (including open doorways).
- Select and edit: click and Shift-click selection, drag corners (joining on drop) and walls (at right angles, stretching neighbours), arrow-key nudging, Delete with automatic merging, double-click to split, and a properties panel for wall material and length.
- Wall tool: click-to-chain drawing with snapping (corners, walls, 15° steps, grid; Alt to bypass), T and X junctions, typed lengths and angles, per-material wall styles with a legend, and a material picker.
- Editor foundation: full-screen layout, pan and zoom, adaptive metric/imperial grid, undo and redo, units toggle, and browser tests with Playwright in CI.
- Web: live heatmap of the sample flat with a draggable router, band switcher, signal readout and a colour-blind-safe quality legend.
- CI: typecheck, lint, format check, tests, build, and Cloudflare Pages deploys with pull request previews.

# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-09-28

M2: smart placement. The optimizer suggests where to put one or more access points, and how many a home needs, with a before → after comparison.

### Added

- Optimizer exit gate: two more test homes (a 65 m² concrete apartment and a 220 m² L-shaped house) next to the sample home. A test shows the suggested router spot beats a router in the middle of each home at Good on 5 GHz (87.4% → 90.5%, 72.1% → 97.4%, 75.6% → 100%), and `pnpm speed` now checks that every search finishes within the 10 s budget (CI fails at 15 s). `docs/MODEL.md` has a new section on how the optimizer works and its limits (D47).
- How many access points do I need?: with nothing selected, pick a coverage goal (80, 90, 95 or 100% of the floor; 90% by default, not saved) and the optimizer finds the fewest access points that reach it, adding up to 4 and moving the unlocked ones to suit. It says when moving is enough, when the ones there already meet the goal, and when even 4 more fall short, offering the best layout it found. On the sample home at Fair on 5 GHz, 90% needs no more (moving the router reaches 92%) and 100% needs one more. The engine's `searchHowMany` tries 0, 1, 2 … added with one shared lattice and 10 s budget (D46).
- Several access points at once: with nothing selected, "Find better spots for N access points" moves every unlocked access point together, and "Suggest one more access point" adds one (a copy of the first access point's bands, power and height) and moves the unlocked ones to suit. On the sample home, one more access point takes 5 GHz coverage at Fair from 86% to 100%. Apply places them all as one undo step. The engine's `searchMultiPlacement` adds access points greedily, then refines them all by simulated annealing with a fixed seed, so results repeat, and never ends below where it started (D45).
- Suggest a spot: a panel section that finds the best spot for the selected access point (or the only unlocked one, or a new one on an empty floor), with a progress bar and Cancel. The suggestion appears as a ghost access point, the heatmap and status bar show coverage with it in place, and the panel gives the before → after share (e.g. 86% → 92%). Apply moves or adds the access point as one undo step; Dismiss or Esc discards it, and any edit or band change drops it with a note (D44).
- Lock access points in place: a Locked checkbox in the access point panel. A locked access point can't be dragged or nudged (the status bar says why), shows a padlock by its name, and will be left alone by the placement optimizer. It's saved as the optional `locked` field (D43).
- Engine: placement scoring for the upcoming optimizer (`createScorer`, `candidatePositions`). It gives the share of the floor at the coverage target for any access point layout, works on 25 cm cells from a 0.5 m lattice of candidate positions clear of the walls, and agrees exactly with the coverage summary on the same grid (D41).
- Engine: single access point search (`searchSinglePlacement`). It refines the best candidates to 10 cm, breaks ties by the strongest weakest spot, reports progress, stops within 10 s, and runs in its own worker so it can be cancelled (D42). On the sample home it finds a spot covering 92% at Fair on 5 GHz, against 87% for the router's current spot.

## [0.1.0] - 2026-09-28

M1: single-floor MVP. Draw a floor to scale, add doors, windows and access points, and see predicted coverage on 2.4, 5 and 6 GHz.

### Added

- Engine: wall losses near 2.4 GHz checked against NIST at 2.0 GHz and in-building measurements at 2.5 GHz; drywall, glass and lumber stay within 4 dB of NIST in a unit test.
- README demo GIF (draw walls, place an access point, drag it), recorded by `scripts/record-demo.mjs` so it can be regenerated.
- Engine: second validation source for wall losses (Muqaibel, Virginia Tech) at 2.4, 5 and 6 GHz, with the wooden door and glass within 1 dB in a unit test; `docs/MODEL.md` now documents the brick gap and how moisture sets concrete loss (Rhim, MIT).
- Usability: an agent cold-start walkthrough (`docs/usability/2026-09-27-agent-walkthrough.md`) and a script for testing with real people (`docs/usability/test-script.md`). An empty floor's panel now says how to start drawing, and the notice for a band nothing broadcasts on says how to turn it on.
- Engine: wall losses validated against NIST measurements at 5 and 6 GHz; drywall, glass and lumber stay within 5 dB in a unit test, and the brick and concrete disagreement is documented in `docs/MODEL.md`.
- File › Export image…: a PNG of the floor with its heatmap, access point names, legend, coverage summary and a scale bar, in three sizes and a light or dark theme, named after the plan and band.
- Coverage summary: under the heatmap legend, the share of the floor inside the outer walls that reaches a chosen target (Excellent, Good, Fair or Weak; Fair by default), for the band on show. The target is saved with the plan as the optional `coverageTarget`.
- CI: a coverage-grid speed check (`pnpm speed`) on the sample home and a busy 100 m² room grid, failing at 1.5× the 200 ms budget; timings in `docs/MODEL.md`.
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

### Changed

- Coverage summary: now always visible in the status bar (and in the bottom bar on phones), not only at the bottom of the Properties panel. Screen readers hear it once a drag ends rather than on every frame.
- Engine: brick walls now lose more signal. Brick's conductivity is fitted to a measured single-wythe wall (Muqaibel, Virginia Tech 2003) instead of taken from ITU-R P.2040, so the brick veneer wall loses 6.6 / 9.0 / 9.9 dB at 2.4 / 5 / 6 GHz, up from 5.8 / 5.3 / 5.2 (D36).
- Engine: the coverage grid is 5–7× faster with identical results (a 300 m² house went from ~210 ms to 28 ms), so the heatmap keeps up while dragging on slower devices. `pnpm speed` adds the 300 m² house with a 50 ms budget.

### Fixed

- Wall tool: between chains, pressing on an access point now selects or drags it instead of starting a wall (hold Alt to start a wall there). Door and Window tools grab access points the same way.
- Access point tool: pressing on an existing access point now grabs it to move it, instead of stacking a new one on top.

[Unreleased]: https://github.com/NC4321/SignalPlan/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/NC4321/SignalPlan/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NC4321/SignalPlan/releases/tag/v0.1.0

# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Phase 6 exit gate: a three-AP two-storey home (`three-ap-home.json`: the router downstairs, a mesh point in the far downstairs bedroom and one upstairs, all hearing each other, plus a faint neighbour's network). At 80 MHz with DFS allowed the channel planner finds a plan with no clashes; without DFS no such plan exists, and it gives the least-bad one (1 clash, on the pair that hear each other most faintly) and says DFS would clear it. Both are checked against brute force over every assignment, and the panel's explanation for each access point is checked in unit and end-to-end tests. The README's views clip now shows the Interference view before and after replanning with DFS (D69).

- Channel planner: when it puts radios on DFS channels, the plan says why, e.g. "Bedroom 2 mesh point and Upstairs mesh point are on DFS channels: without DFS channels, 1 clash would be left" (or the plan would narrow, or there'd be more interference) (D69).

- Channel planner: with nothing selected, the Channels section has a Plan channels button. It suggests a channel for every radio left on Auto, on every band at once, so access points that hear each other (at 802.11's clear-channel-assessment level, walls and floors included) don't share one, and steers clear of strong neighbours' networks. Radios whose width is on Auto keep the band's usual width unless a narrower one is needed to keep them apart. It says when no plan keeps them all apart, and when allowing DFS would help. Each radio gets a one-line reason, the map previews the plan, Apply sets it as one undo step and Dismiss drops it, as does any change to the plan (D68).

- Neighbours' networks: with nothing selected, the panel has a Neighbours' networks section below Channels. Each network next door gets a band, width, channel, a rough signal in dBm and an optional name, with a hint on reading them from a Wi-Fi analyser app. The Interference view counts each at that strength everywhere in the home, on radios with a channel set, and its legend says how many count. A new network starts at the band's usual width with no channel, and isn't counted until one is picked. Each add, change and removal can be undone. Plans get the optional `neighbourNetworks` field (D67).

- A more polished README: a feature gallery with three new demo GIFs (placement optimizer, 3D view, overlap and roaming), features grouped by task, a summary of the sources and validation behind the model, and the shipped releases. It only names features that exist. `scripts/record-demo.mjs` now records any of the four clips by name (D65).

- Interference view: Show → Interference maps signal to interference and noise (SINR) in dB. Each cell is on its strongest access point, and other access points on overlapping channels, on any floor, count as interference in proportion to how much their channels overlap. Noise follows the channel width, so wider channels pay more noise and reach more neighbours. The bands are named after the 802.11 rate each SINR allows, from Wi-Fi 6's fastest (39 dB) to the slowest (9 dB); below that is hatched as unusable, and the summary gives that share. Radios with the channel on Auto count as on a channel of their own until the channel planner arrives, and the legend says how many there are (D66).

- Channels by region: with nothing selected, the panel has a Channels section. It sets the plan's region (United States or European Union) and whether 5 GHz DFS channels may be used, with a short explanation of what DFS means. New plans guess the region from the browser's language. The note for power above the legal limit now uses the region's limit. The channels and limits for each region come from a data file, `packages/engine/src/regions.json`, checked against FCC, ETSI, EU and IEEE sources listed in `docs/MODEL.md`. Plans get the optional `region` and `allowDfs` fields (D62).

- Channel and width per radio: under each band's power, the access point panel has a Width menu and then a Channel menu, showing only what the plan's region and DFS setting allow (Auto leaves either open). Changing the width sets the channel back to Auto, and each change can be undone. When a region change or turning DFS off rules out a channel or width you set, it's kept but flagged, and the plan's Channels section lists each such radio with a button that selects it. An access point added by the optimizer copies the width but not the channel. Radios get the optional `channel` and `channelWidthMHz` fields (D63).

- Overlap and Roaming views: a Show menu next to the band picks what the heatmap shows. **Signal** is the heatmap as before. **Overlap** counts the access points competing for a device in each spot: those within 8 dB of the strongest and at least −70 dBm. **Roaming** colours each area by the access point a device would be on, draws a line where it would switch, and hatches gaps where none reaches −70 dBm. Each has its own legend and summary line (the share with two or more competing, or in gaps), and the 3D view and PNG export follow the choice. The defaults are Apple's roaming rules for iPhone and iPad. With nothing selected, "Overlap and roaming" in the panel changes them for the plan, saved as the optional `overlapMarginDb` and `roamThresholdDbm` fields (D64).

### Changed

- Engine: a floor's loss now depends on the angle the signal passes through it, as ITU-R P.2040 gives it, up to 75° from straight up. Signal to rooms well across the floor above or below meets the floor at a shallow angle and loses more than head on (a timber floor: 2.7 dB straight through, 6.6 dB at 75° on 5 GHz). Against ITU-R P.1238-13, the upper floor of the two-storey sample home goes from 2.3 / 5.5 dB optimistic to 0.7 / 3.4 dB on 2.4 / 5 GHz; the main floor doesn't change. Walls stay head-on (D60).

## [0.3.0] - 2026-09-28

M3: whole home. Plan several floors with signal passing between them, cut stairwells and atriums, let the optimizer work across the whole home, and look at it all in a 3D view.

### Added

- M3 exit gate: a two-storey sample home (`two-storey-home.json`) and a test that its one router downstairs reaches Fair on at least 85% of each floor on 2.4 GHz and stays within 2σ of ITU-R P.1238-13 on both floors. Upstairs the model is 2.3 / 5.5 dB more optimistic than P.1238 on 2.4 / 5 GHz, mostly because the timber floor loses less than P.1238's house factor; `docs/MODEL.md` says so and has a new section on floors and their limits. With `?fps` in the address, the 3D view has a button to measure its frame rate; on a Windows laptop it holds 60 fps (16.7 ms median, 16.9 ms 95th percentile) (D58).
- 3D view: a 2D | 3D switch in the top bar shows the floors stacked at their elevations, with walls cut away at 1 m (or full height), each floor's heatmap for the band on show (inside its walls, stairwells left open), access points at their mounting height with their names, and faint slabs. Drag to rotate, scroll or pinch to zoom, or use the view's buttons from the keyboard. The panel picks which floors show and spreads them apart; a hidden list describes each floor, its access points and coverage for screen readers. It's view only: tools are off until you switch back to 2D. three.js loads only when the view first opens (D57).
- Stairwells and atriums: a Floor opening tool (O) on every floor but the lowest. Click the corners of a stairwell or atrium, snapping as the Wall tool does (the floor below too), and close it on the first corner, with a double-click or with Enter. Signal between that floor and the one below pays no floor loss where it passes through the opening, and the opening's area is left out of the floor, so the coverage summary and optimizer skip it. Openings are drawn hatched and can be selected, dragged whole or by their corners, nudged and deleted, all with undo. Plans get the optional `floorOpenings` field (D54).
- Ghosted floor below: while you draw an upper floor, the floor below shows faintly under it (walls, doors and windows dashed, and its access points labelled "(below)"), and the Wall tool snaps to its corners and walls, so floors line up. A "Show floor below" checkbox in the floor stack turns it off (D53).
- Floor list: the floors show as a stack in the canvas corner, top floor at the top, with buttons to add a floor above or below; click a floor (or press PageUp / PageDown) to show it. With nothing selected, the panel's Floor section sets the floor's name, elevation (negative for a basement), floor-to-ceiling height and construction (timber joists or concrete slab), moves it up or down, and deletes it. Undo brings a deleted floor back. The heatmap shows signal from access points on other floors, the coverage summary names the floor when there are several, and the optimizer counts access points on other floors as fixed (D52).
- Engine: floor constructions for multi-floor plans. A timber joist floor (OSB subfloor, joist cavity and gypsum ceiling, with layer thicknesses from the IRC and PS 20-20, averaged over 2×8 to 2×12 joists) loses 2.5 / 2.7 / 3.1 dB at 2.4 / 5 / 6 GHz, and a 150 mm concrete slab 11.5 / 20.2 / 22.8 dB. The slab agrees with ITU-R P.1238-13's measured 20 dB through a concrete floor at 5.2 GHz. The floor list (#88) will let you pick one (D50).
- Engine: signal between floors. Each floor's coverage now counts access points on every floor: the 3D distance, the loss of each slab crossed, and each floor's walls along the part of the path inside that storey. Floors get an optional `material` (`timber-joist` by default). A floor with no walls yet shows signal 5 m around access points on other floors. The optimizer still works on one floor until #91. A 300 m² two-storey house takes about 20 ms per floor (D51).

### Changed

- Faster engine: wall checks only test the walls in each path's direction from the access point, with exactly the same results. The optimizer's searches take about half as long (the two-storey house's how-many 7.1 s → 3.6 s on the development machine) and so does the heatmap on large homes (big house 28 ms → 11.5 ms) (D56).
- The optimizer now works on the whole home (D55). With several floors it maximises the share of all floors' area together, "Find better spots" moves unlocked access points on every floor (each stays on its own floor), and added access points go on whichever floor helps most. The panel gives the whole-home before → after with one line per floor, spots say which floor they're on, and the floor stack marks floors with suggested spots. Switching floors keeps a search or suggestion, so you can look at each floor's preview. On a plan with no access points, "Find the best spot" adds one wherever it helps most. `pnpm speed` now includes the two-storey house (7.1 s for how many, within the 10 s budget).

### Fixed

- `docs/MODEL.md` and D50 wrongly said ITU-R P.1238-13's floor factors belong to its site-general model; they belong to its eq. (2). No model numbers changed (D58).

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

[Unreleased]: https://github.com/NC4321/SignalPlan/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/NC4321/SignalPlan/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/NC4321/SignalPlan/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NC4321/SignalPlan/releases/tag/v0.1.0

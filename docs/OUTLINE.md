# Wi-Fi Coverage Planner — Project Outline

Sep 27, 2026 · @Nathan

## Vision and goals

A free, browser-based tool where anyone can draw their home to scale, place Wi-Fi access points, and see predicted coverage floor by floor, then let the tool suggest better placements.

The project is portfolio first, product second. Every phase should end in something demoable, and the codebase should be clean enough that a hiring manager can read it. Product concerns (accounts, hosting cost, support) are deliberately deferred until the portfolio version is solid.

**What success looks like**

- A live demo link where a visitor can draw a room, drop an AP, and see a heatmap within two minutes, with no sign-up.
- A README with a GIF, an architecture diagram, and a short explanation of the propagation model.
- A propagation engine with unit tests and a written note on its accuracy limits.
- Later: real users planning real homes, and predictions that match phone measurements closely enough to be trusted.

## How to use this outline

Decisions are made at the phase that needs them, not up front. Each phase lists its goal, its deliverables, the decisions to settle when you reach it, and an exit gate.

- **Decide at this phase** lists the open questions for that phase. Answer them when you start the phase, with what you learned in earlier phases.
- **Exit gate** is the check that must pass before moving on. If it fails, fix it or cut scope rather than carry the problem forward.
- **Settled so far** is limited to what you've told me: the goal is portfolio first, you're very comfortable with TypeScript and React, and you have a few hours a week.
- Anything else that looks decided below is a working default, marked as such, and can be revisited at its phase.

## Feature scope and milestones

All requested features are in scope. They ship in four milestones so there is always a working demo.

| Milestone | Features | Phases | Demo you can show |
| --- | --- | --- | --- |
| M1: Single-floor MVP | Wall drawing to scale, wall materials, AP placement with band, heatmap | 0 to 3 | Draw a flat, drop an AP, see coverage |
| M2: Smart placement | Placement optimizer, multi-AP and mesh suggestions | 4 | Tool suggests the best spot |
| M3: Whole home | Multiple floors, floor attenuation, 3D stacked view | 5 | Rotate a two-storey house in 3D |
| M4: Pro features | Overlap and roaming view, channel planning, phone calibration, launch polish | 6 to 8 | Compare prediction to real readings |

Out of scope unless you add them later: commercial or enterprise sites, outdoor coverage, importing CAD files, and user accounts. Each is noted in the open questions register.

## Architecture overview

The propagation engine is the heart of the project, and it knows nothing about React. The editor writes a plain JSON floor plan, the engine turns it into a coverage grid, and every view reads that grid.

&#91;embedded content: system architecture · 7 modules\]

The engine and optimizer run in Web Workers so the UI never freezes while a heatmap recomputes. Keeping the engine pure TypeScript means it can be unit tested alone and later reused in a CLI or on a server.

**Working defaults, confirmed in Phase 0:** TypeScript with React and Vite, the engine as its own package in a monorepo, and the floor plan as a versioned JSON schema.

## Phase 0: Project foundation

Goal: a repo that builds, tests and deploys an empty app on every push, so every later phase is instantly demoable.

**Deliverables**

- [ ] Repo with monorepo layout: `apps/web` and `packages/engine`
- [ ] Lint, format and type-check on commit
- [ ] Unit test runner and one passing test in the engine
- [ ] CI that runs checks and deploys a preview of every pull request
- [ ] README skeleton, license file, and a short CONTRIBUTING note

**Decide at this phase**

- Project name, which also decides the repo and domain name.
- License: permissive (such as MIT) keeps options open; copyleft (such as AGPL) stops others running a closed hosted copy. This matters because of the product-second goal.
- Monorepo tool and package manager (for example pnpm workspaces alone, or with Turborepo).
- Hosting for the demo (for example GitHub Pages, Vercel, Netlify or Cloudflare Pages). A static host is enough until accounts are needed.
- Test stack (for example Vitest for units, Playwright for browser tests).

**Exit gate:** a push to main deploys a live page, and CI fails on a type error.

## Phase 1: Floor plan editor

Goal: draw one floor to real-world scale, with walls, doors and windows, and save or load it as JSON.

**Deliverables**

- [ ] Canvas with pan, zoom and a snapping grid
- [ ] Scale calibration: draw a line over a known length and type its real length
- [ ] Wall tool with endpoint snapping, angle snapping and live length labels
- [ ] Select, move, split and delete walls
- [ ] Wall material picker with a legend (drywall, brick, concrete, glass, wood, metal)
- [ ] Doors and windows as openings inside a wall, each with its own material
- [ ] Undo and redo
- [ ] Save and load a plan file; autosave in the browser
- [ ] Floor plan JSON schema with a version number and validation

**Decide at this phase**

- Rendering: plain Canvas 2D, SVG, or a library such as Konva or PixiJS. Decide by building a quick prototype with 200 walls and checking that it stays smooth.
- Units: metric only, imperial only, or a toggle. Store in one internal unit either way.
- State management: React state alone, or a store such as Zustand. The undo design depends on this choice.
- Whether to support tracing over an uploaded photo or image of an existing floor plan. This is a big usability win and would slot in here.
- Whether walls have thickness, or are thin lines with a material. Thickness looks better; thin lines are simpler for the engine.

**Exit gate:** you can draw your own home floor in under 10 minutes, save it, reload it, and the measurements match a tape measure.

## Phase 2: RF propagation engine

Goal: given a floor plan and one AP, return the predicted signal strength in dBm at any point, with unit tests and no UI.

The starting model is log-distance path loss plus the loss of every wall the direct line crosses:

```latex
P_{rx} = P_{tx} + G_{tx} + G_{rx} - \left[ PL(d_0) + 10\,n\,\log_{10}\frac{d}{d_0} + \sum_i L_{wall,i}(f) + \sum_j L_{floor,j}(f) \right]
```

Here d is distance, d0 is a 1 m reference, n is the path loss exponent, and the wall and floor losses depend on material and band. The 1 m reference loss follows from free space: about 40 dB at 2.4 GHz, 47 dB at 5 GHz and 48 dB at 6 GHz.

**Deliverables**

- [ ] Geometry: segment intersection between the AP-to-point line and every wall, with a spatial index so large plans stay fast
- [ ] Band profiles for 2.4, 5 and 6 GHz: reference loss, exponent and default transmit power
- [ ] Material table: loss per material per band, each value with a cited source
- [ ] Grid evaluator: fill a grid of cells for one AP, then combine APs by taking the strongest per cell
- [ ] Unit tests against hand-worked cases (free space, one wall, two walls)
- [ ] A short MODEL.md explaining the maths and its limits

**Decide at this phase**

- Where the material loss values come from. Candidates to research are ITU-R P.2040 and P.1238, NIST building-material studies, and vendor planning guides. Every value used should cite one.
- Path loss exponent defaults for a home, and whether users can adjust them.
- Default transmit powers per band, and whether users pick a router model or type a number. Regional power limits differ, so this may tie to a region setting.
- Whether to model antenna patterns or treat APs as omnidirectional. Omnidirectional is the usual first step.
- Grid resolution (for example 10 cm, 25 cm or 50 cm), balancing accuracy against speed.
- Whether to go beyond the direct line later: reflections, diffraction around corners, or a simple ray-tracing mode.

**Exit gate:** tests pass, a 100 m² floor computes in under 200 ms in a worker, and MODEL.md explains every number.

## Phase 3: Heatmap visualization

Goal: place APs on the plan, pick each one's band, and see coverage update live as you drag. This completes milestone M1.

**Deliverables**

- [ ] AP tool: place, drag, delete; per-AP band and power settings
- [ ] Heatmap layer drawn under the walls, recomputed in the worker while dragging
- [ ] Colour scale with a legend in dBm, plus a hover readout for any point
- [ ] Coverage summary: share of floor area above the chosen threshold
- [ ] Band filter: view 2.4, 5 or 6 GHz separately
- [ ] Export the view as a PNG for sharing

**Decide at this phase**

- Colour thresholds and their labels. A common target is about −67 dBm for calls and streaming, but you may want presets such as "browsing" and "gaming".
- Colour palette. It must stay readable for colour-blind users, so test it in a simulator.
- Rendering approach for the heatmap: an ImageData bitmap, WebGL, or smoothed contours. Measure drag speed before choosing.
- How to handle dragging on slow devices: lower resolution while moving, full resolution on release.

**Exit gate:** dragging an AP updates the heatmap smoothly on a mid-range laptop, and a stranger can use it without instructions. Record the README GIF here.

## Phase 4: Placement optimizer

Goal: the tool suggests where to put one or more APs, and shows how much better the suggestion is than the current layout.

**Deliverables**

- [ ] Scoring function: coverage above threshold, weighted by room importance
- [ ] Constraints: allowed zones (near outlets, on shelves), forbidden zones, and APs the user has locked in place
- [ ] Single-AP search over candidate positions
- [ ] Multi-AP search, adding one AP at a time, then refining with simulated annealing
- [ ] "How many APs do I need?" mode that adds APs until a target coverage is reached
- [ ] Before and after comparison with the coverage gain in percent
- [ ] Progress bar and cancel button while the search runs

**Decide at this phase**

- What "optimal" means to users. Options include most area covered, best worst-case room, or priority rooms such as an office. Probably a small set of presets.
- Whether users mark rooms and their importance, which needs a room-tagging tool back in the editor.
- Search algorithm details: candidate grid spacing, annealing schedule, and a time budget.
- Whether the optimizer also considers wired backhaul between mesh nodes, or only wireless links.

**Exit gate:** on three test homes, the suggested placement beats a naive centre placement, and the search finishes in under 10 seconds.

## Phase 5: Multi-floor and 3D view

Goal: plan a whole house, with signal passing between floors, and show it as a rotatable 3D stack. This completes milestone M3.

**Deliverables**

- [ ] Floor list: add, rename, reorder, set height, and pick a floor material
- [ ] Ghosted view of the floor below while drawing, to line up walls and stairs
- [ ] Engine: 3D distance plus floor loss for points on other floors
- [ ] Stairwells and open atriums as floor openings with no floor loss
- [ ] Optimizer extended across floors
- [ ] 3D view with three.js: stacked floors, walls extruded, heatmap on each floor

**Decide at this phase**

- Floor materials to offer (wood joists, concrete slab, and so on) and their loss values, sourced as in Phase 2.
- How signal crosses floors: a flat penalty per floor, or loss that grows with the angle through the slab.
- Whether the 3D view is view-only or also editable.
- Whether basements, split levels and sloped ceilings are supported, or noted as limits.

**Exit gate:** a two-storey home shows sensible coverage on both floors from one AP, and the 3D view runs smoothly on a laptop.

## Phase 6: Overlap, roaming and channel planning

Goal: show where APs compete or hand off, and suggest channels that keep them from interfering with each other.

**Deliverables**

- [ ] Overlap view: cells where two or more APs are within a set margin of each other
- [ ] Roaming view: the boundary where a device would switch APs, and gaps between them
- [ ] Signal-to-interference view, counting same-channel APs as interference
- [ ] Channel plan per band, treated as a graph-colouring problem so neighbouring APs get different channels
- [ ] Channel width choice per AP and its effect on the plan

**Decide at this phase**

- Which channel sets to offer. They vary by region and change as regulators open new spectrum, so this needs a region setting and a data file you can update.
- Whether to support DFS channels on 5 GHz, and how to explain their trade-offs simply.
- Whether to model neighbours' networks as background interference, entered by hand or from a phone scan.
- Overlap margin and roaming thresholds, and whether users can change them.

**Exit gate:** on a three-AP home, the tool finds a channel plan with no same-channel neighbours where one exists, and explains its choice.

## Phase 7: Real-world calibration

Goal: users walk their home, record real signal readings at marked spots, and the tool tunes its model to match.

The main constraint is that web browsers cannot read Wi-Fi signal strength, and iOS limits it for apps too. So readings will come from somewhere other than the web page itself; this needs checking against current platform rules when the phase starts.

**Deliverables**

- [ ] Survey mode: tap a spot on the plan and enter or import a reading for each AP
- [ ] Import format for readings (CSV or JSON), with the AP identified by network name or MAC address
- [ ] Error report: predicted versus measured at each spot, with an overall error figure
- [ ] Fitting: adjust material losses and the path loss exponent to reduce the error, within sensible limits
- [ ] Before and after accuracy shown to the user

**Decide at this phase**

- How readings are captured. Options include typing values from the phone's settings or a free analyser app, a small Android companion app, or a desktop script that reads the laptop's Wi-Fi card.
- Whether calibrated values stay per home, or users can share anonymised values to improve the defaults for everyone. Sharing raises privacy and backend questions.
- Fitting method, for example least squares with limits on each value.
- How many readings to ask for, and how to guide users to good spots.

**Exit gate:** on your own home, calibration measurably lowers the average prediction error, and the report makes that visible.

## Phase 8: Polish, documentation and launch

Goal: turn the working tool into something that looks and reads like a professional product. This completes milestone M4.

**Deliverables**

- [ ] Onboarding: a sample home to explore and a short guided first run
- [ ] Empty, loading and error states for every screen
- [ ] Keyboard shortcuts with a help overlay
- [ ] Shareable plan links (plan encoded in the URL, or a small backend)
- [ ] README: GIF, live demo link, feature list, architecture diagram, model summary, roadmap
- [ ] Docs site or MODEL.md expanded into a readable explainer
- [ ] A short write-up or blog post on the physics and the optimizer
- [ ] Launch posts where home-network and developer audiences gather

**Decide at this phase**

- Whether shareable links need a backend. URL encoding may be enough for small plans.
- Analytics: none, or a privacy-friendly option, to learn what people use.
- Whether to start product steps now: accounts, saved plans in the cloud, and any paid tier.
- Where to launch and in what order.

**Exit gate:** a stranger lands on the demo, understands it in 30 seconds, and plans a room without help.

## Testing, quality and accessibility

These run through every phase rather than being a phase of their own.

| Area | What to do | Starts in |
| --- | --- | --- |
| Engine correctness | Unit tests on hand-worked cases; property tests (adding a wall never raises signal) | Phase 2 |
| Regression | A folder of sample homes whose heatmaps are snapshot-tested | Phase 3 |
| Performance | Benchmarks in CI for grid compute and optimizer time, failing on big slowdowns | Phase 2 |
| UI | Browser tests for draw, save, load and place | Phase 1 |
| Accessibility | Keyboard use for all tools, colour-blind-safe palettes, screen-reader labels outside the canvas | Phase 1 |
| Code quality | Strict TypeScript, lint in CI, small pull requests with clear descriptions | Phase 0 |
| Project hygiene | Issues and a public roadmap, conventional commits, a changelog and tagged releases | Phase 0 |

Clean pull requests and a visible roadmap matter for the portfolio as much as the features do, because reviewers read the history.

## Risks and mitigations

The biggest risk is scope: with a few hours a week, nine phases can stall. The milestone plan exists so the project is presentable after M1 even if later phases slow down.

| Risk | Mitigation |
| --- | --- |
| Scope stalls the project before anything ships | Ship M1 publicly before starting Phase 4; treat each milestone as a release |
| Predictions look confident but are wrong | Show accuracy limits in the UI, cite every value, and add calibration in Phase 7 |
| The editor is slow or fiddly to use | Prototype rendering early in Phase 1; test with real people before Phase 2 |
| Heatmap recompute is too slow for live dragging | Workers, spatial indexing, and a lower resolution while dragging |
| Phones cannot supply signal readings easily | Start with manual entry; add a companion app only if demand appears |
| Channel and power rules differ by country and change | Keep them in an updatable data file with a region setting |
| Losing momentum between sessions | End each session with a note on the next task in the issue tracker |

## Timeline

At about 4 hours a week, M1 is a 3 to 4 month project and the full plan is roughly 8 to 11 months. These are rough planning estimates; revise them after Phase 1, once you know your real pace.

&#91;embedded content: roadmap · 4 milestones, 3 gates\]

Each gate is the exit gate of the milestone's last phase. Passing a gate is the signal to tag a release and post about it.

## Open questions register

This is the running list of decisions, ordered by when they're needed. Only the first few need answers before any code is written.

| Question | Needed by | Why it matters |
| --- | --- | --- |
| What is the project called? | Phase 0 | Sets the repo, package and domain names |
| Which license? | Phase 0 | Decides whether others can run a closed hosted copy |
| Which host for the live demo? | Phase 0 | Sets up preview deploys from day one |
| Metric, imperial, or both? | Phase 1 | Affects every label and input in the editor |
| Trace over an uploaded floor plan image? | Phase 1 | Big usability win; shapes the editor design |
| Walls with thickness, or thin lines? | Phase 1 | Trade-off between looks and engine simplicity |
| Which sources for material loss values? | Phase 2 | Credibility of every prediction |
| Pick router models, or type transmit power? | Phase 2 | Ease of use versus accuracy |
| Which regions to support first? | Phase 2 | Sets allowed power levels and channel sets |
| Coverage threshold presets? | Phase 3 | Defines what "good coverage" means |
| What does "optimal" mean for users? | Phase 4 | Defines the optimizer's scoring |
| Room tagging and priority rooms? | Phase 4 | May add a tool to the editor |
| Is the 3D view editable? | Phase 5 | Large effect on Phase 5 size |
| DFS channels and neighbours' networks? | Phase 6 | Realism of the channel plan |
| How are phone readings captured? | Phase 7 | Platform limits on reading signal strength |
| Shared calibration data? | Phase 7 | Needs a backend and a privacy policy |
| Accounts, cloud saves, paid tier? | Phase 8 | The start of the product-second path |
| Out of scope for now: offices, outdoor, CAD import | Revisit after M4 | Possible later growth |

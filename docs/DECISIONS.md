# Decisions

A running log of project decisions, newest last. Each entry records what was decided, why, and what would make us revisit it. Open questions live in the [outline](OUTLINE.md#open-questions-register) and as GitHub issues labelled `decision`.

## Phase 0

### D1. Name, license and hosting — 2026-09-27

- **Decision:** the project is called SignalPlan, is MIT licensed, and the demo is hosted on Cloudflare Pages.
- **Why:** MIT keeps the portfolio goal simple. Cloudflare Pages gives free preview deploys for every pull request, which GitHub Pages does not.
- **Revisit if:** the product path makes a closed hosted copy by someone else a real risk (consider AGPL for new code).

### D2. Tooling — 2026-09-27

- **Decision:** pnpm workspaces (no Turborepo), TypeScript in strict mode, oxlint, Prettier, Vitest, lefthook and commitlint.
- **Why:** two packages don't need a task runner; oxlint is what the current Vite template ships and is fast.
- **Revisit if:** the workspace grows past a handful of packages or build times hurt.

## Phase 1

### D3. Build order: thin slice first — 2026-09-27

- **Decision:** build one thin path through the whole system before the full editor: floor plan schema → engine on a hand-written sample plan → basic heatmap → editor.
- **Why:** the editor is the biggest schedule risk in M1. A thin slice gives a live heatmap early and proves the engine and schema before the editor depends on them.
- **Consequence:** some Phase 2 and 3 work moves ahead of the Phase 1 editor. The M1 milestone and its exit gates are unchanged.

### D4. Units: metric and imperial toggle, metric default — 2026-09-27

- **Decision:** the floor plan stores lengths in metres. The editor shows metric by default, with a user setting for feet and inches.
- **Why:** one internal unit keeps the engine and schema simple; a display toggle serves both audiences.

### D5. Walls are thin segments with a material — 2026-09-27

- **Decision:** a wall is a line segment plus a material. Any visible width is a display property only.
- **Why:** keeps the engine's line-crossing maths simple, and avoids polygon joins in the editor.
- **Revisit if:** thickness becomes necessary for accuracy (for example, oblique paths through thick masonry). It can be added as an optional property without breaking the schema.

### D6. Trace over an uploaded floor plan image — 2026-09-27

- **Decision:** Phase 1 includes uploading a background image, calibrating its scale, and drawing over it.
- **Why:** it is the fastest way for a user to draw an accurate home, and it reuses the scale calibration tool.

### D7. Floor plan schema v1 — 2026-09-27

- **Decision:** a separate `@signalplan/floorplan` package with a Zod schema. Walls join shared nodes; openings sit along a wall by offset and width; floors and access points are lists from the start; each access point has one radio per band.
- **Why:** the editor and engine both depend on it and on neither of each other; shared nodes make moving corners work; lists avoid a migration when multi-floor arrives.

## Phase 2

### D8. Region and transmit power — 2026-09-27

- **Decision:** North America (FCC / ISED) first. Each radio uses its band's default EIRP (20 / 23 / 18 dBm) unless the user sets one. Router-model presets come later, if at all.
- **Revisit if:** users outside North America arrive, or channel planning (Phase 6) needs regional channel sets.

### D9. Wall losses are computed from ITU-R P.2040 — 2026-09-27

- **Decision:** each material is a layered North American construction whose loss is computed with the P.2040-4 multi-layer slab method, averaged over each band. Metal is capped at 40 dB. Low-E glass is a separate material, modelled as a conductive film fitted to one published measurement.
- **Why:** one citable standard, reproducible numbers, and a clear story in [MODEL.md](MODEL.md). Measured values are used to validate, not to set, the other materials.
- **Revisit if:** calibration (Phase 7) shows systematic errors for a material.

### D10. No clutter term — 2026-09-27

- **Decision:** the distance term stays at free space (n = 2), with no extra clutter loss.
- **Why:** with typical wall counts the model is within about 3 dB of the ITU-R P.1238-13 office median, well inside its 5 dB spread. An earlier estimate of ~10 dB optimism was not supported by the standard.
- **Revisit if:** phone measurements in Phase 7 show a consistent offset; receiver losses (phone antenna, body) are the first suspect.

### D11. Grid resolution — 2026-09-27

- **Decision:** 10 cm cells by default, with no spatial index.
- **Why:** measured at ~20 ms for the 150 m² sample home, far inside the 200 ms budget.

## Phase 3

### D12. Heatmap colours — 2026-09-27

- **Decision:** five labelled quality bands (Excellent ≥ −50, Good ≥ −60, Fair ≥ −67, Weak ≥ −75, Poor ≥ −85 dBm) in the viridis palette; weaker cells are left uncoloured.
- **Why:** bands answer "is it good enough?" at a glance, and viridis stays readable with colour-vision deficiencies.

### D13. Sample home — 2026-09-27

- **Decision:** the demo and tests use a 150 m² bungalow with a concrete utility room, a steel door and low-E windows, instead of the original 80 m² flat.
- **Why:** one router covered the flat almost entirely, so the demo showed little contrast.

## Phase 1: editor

### D14. Canvas 2D for the editor — 2026-09-27

- **Decision:** the editor draws with plain Canvas 2D, the same renderer as the heatmap.
- **Why:** a prototype with 200 walls, length labels, a grid and a full-house heatmap held 60 fps while panning and zooming in both Canvas 2D (about 0.2 ms of script per frame) and SVG, so speed didn't decide. Canvas keeps one drawing path, and hit-testing is point-to-segment maths that snapping needs anyway.

### D15. Zustand store with Immer patches — 2026-09-27

- **Decision:** one Zustand store holds the plan and editor state. Every edit runs through Immer, which records a patch and its inverse for undo and redo. A drag is a "gesture" whose previews commit as one undo step.

### D16. Editor behaviour — 2026-09-27

- **Layout:** full-screen app with a tool bar, a properties panel and a status bar; the panel becomes a drawer on narrow screens.
- **First view:** the sample home, ready to edit, with a live heatmap that updates while editing (it can be hidden).
- **Navigation:** Figma-style: wheel or two-finger scroll pans; Ctrl/⌘ + wheel or pinch zooms at the cursor; Space + drag or middle-drag pans.
- **Touch:** view, pan, zoom and move access points on touch; drawing and editing walls are desktop-first.
- **Walls:** click-to-chain drawing; snapping to a 10 cm (1″) grid, 15° angles, and existing walls, with Alt to bypass; new walls split existing ones at T and X junctions; dragging a wall stretches connected walls; double-click splits a wall; new walls use the last material picked (drywall at first).
- **Imperial display:** feet and inches to the nearest half inch (12′ 6½″); typing accepts common forms.

### D17. Wall tool details — 2026-09-27

- **Junctions inside openings:** a new junction on a wall inside a door or window moves to the opening's nearest edge. A new wall that _crosses_ a wall inside a doorway crosses it without joining, since moving the junction would bend the new wall.
- **Overlaps:** a new wall that runs along an existing wall reuses it; only the parts beyond it are added.
- **Undo while drawing:** each wall in a chain is its own undo step; undo mid-chain removes the last wall and keeps drawing from the corner before it.
- **Exact lengths:** while a wall follows the cursor, typing a number opens a length box (Tab for an angle, measured counter-clockwise from east); Enter places the wall.
- **After a chain:** the wall tool stays active; Esc again (or V) returns to Select.
- **Wall styles:** each material has an Okabe–Ito colour plus its own width and pattern (drywall plain, brick ticked, concrete thick, wood dashed, glass double line, low-E glass double line with dots, metal hatched), outlined in dark so walls stay readable over any heatmap colour.

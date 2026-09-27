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

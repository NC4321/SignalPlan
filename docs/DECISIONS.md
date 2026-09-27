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

### D18. Selecting and editing walls — 2026-09-27

- **Selection:** click selects one wall, corner or access point; Shift-click adds or removes; no box selection yet. Arrow keys move everything selected; Delete removes selected walls and corners (access points are kept until the access point tool exists).
- **Dragging a corner** snaps like drawing (not to itself or its own walls); dropping it on a corner merges them, and on a wall splits the wall and joins. Walls that merely cross after a move stay independent.
- **Dragging a wall** slides it at right angles to itself in grid steps, stretching connected walls; Alt moves it freely.
- **Deleting a corner** joins its two walls into one straight wall (taking the longer wall's material), or, with more or fewer than two walls, removes the walls attached to it. **Deleting a wall** merges any straight, same-material halves it leaves at an otherwise unused corner.
- **Doors and windows on a changed wall** slide to stay inside it and apart, and shrink in proportion if the wall gets too short; nothing is deleted.
- **Wall properties:** material and length (the start corner stays, the end corner moves); Split in half and Delete buttons; double-click splits a wall anywhere.

### D19. Doors and windows — 2026-09-27

- **Placing:** Door (D) and Window (N) tools preview a default-sized opening on the wall under the cursor; a click places it, sliding it to fit beside corners and other openings. Where no free stretch is wide enough, nothing is placed.
- **Defaults:** doors 32″ (0.81 m) wood, windows 48″ (1.22 m) glass; each tool remembers the last material picked.
- **Look:** openings draw in their material's style, thinner than walls, with end marks; an open doorway is just its end marks. No door swings.
- **Editing:** switch door/window, type a width (it grows about its centre, up to the next corner or opening), pick a material including open, drag it along its wall (it stops at neighbours), or delete it.

### D20. Saving and opening plans — 2026-09-27

> **Storage superseded by D21:** plans now live in a list in IndexedDB. The file format, reopening behaviour and New plan contents below still apply.

- **In the browser:** one current plan, autosaved to localStorage shortly after each change (and when the page is hidden). The units preference is kept too. The status bar says whether the plan is saved, and warns when storage is full or blocked.
- **On reopening:** the last plan edited; the sample home appears only on a first visit. A saved plan that no longer loads falls back to the sample, with an offer to download the stored text first.
- **Files:** plain JSON named after the plan, `<name>.signalplan.json`. File menu: New plan, Open file (Ctrl/⌘+O), Save to file (Ctrl/⌘+S), Open the sample home. Files that fail validation are refused with their first problems listed.
- **Replacing:** since only one plan is kept, replacing an edited plan asks first and offers to download a copy; an untouched sample or blank plan is replaced without asking.
- **New plan:** one empty floor and one dual-band router in the middle of a 10 m × 8 m starting view. The coverage grid now always covers access points (5 m around them on a floor with no walls), so a blank plan shows coverage straight away.
- **Revisit when** traced floor-plan images (#19) arrive: localStorage's ~5 MB limit is too small to keep images, so they need their own storage decision.

### D21. A list of plans in IndexedDB — 2026-09-27

- **Decision:** plans (and, with tracing, their background images) are kept in IndexedDB as a list, replacing D20's single plan in localStorage. The units preference stays in localStorage, since it's needed before the first render.
- **Why:** traced floor-plan images can be several megabytes, far more than localStorage's ~5 MB; and with room to spare, keeping every plan means New and Open never replace anything.
- **My plans:** File › My plans… lists plans by name and last edit, with Open, Rename, Duplicate and Delete. Deleting asks first and offers a download; deleting the open plan opens the next most recent one (or the sample).
- **Joining the list:** a New plan or the sample joins on its first edit, so looking around creates no clutter; an opened file joins straight away. Switching plans saves the open one first, so no confirmation is needed.
- **Migration:** a plan saved by the single-plan version is moved into the list on first load and opens as before.

### D22. Tracing over a floor plan image — 2026-09-27

- **Decision:** each floor can have one background image to trace over, added from File › Trace a floor plan image…. PNG, JPEG and WebP are accepted; images over 10 MB get a note that saved files will be large, and images over 25 MB are refused. PDFs aren't read directly: export or screenshot the page first.
- **Placing and scale:** a new image fills most of the current view at 50% opacity, then calibration starts straight away: click two points a known distance apart and type the real distance (in the current units). The image rescales about the first point and is locked. An unlocked image can be dragged. Images can't be rotated.
- **Tracing image panel:** shown when nothing is selected (or when an unlocked image is clicked) on a floor with an image. It has opacity, Show/Hide, Lock/Unlock, Recalibrate, Replace image… and Remove. Replacing an image with the same proportions keeps its position and scale; otherwise the new image is placed afresh and calibration starts again. File › Trace a floor plan image… on a floor that already has an image acts the same way.
- **Heatmap while tracing:** the heatmap is drawn opaque, so it would hide the image. It's hidden while calibrating and while the Tracing image section is showing, and comes back as soon as something is selected or another tool is picked. The Heatmap checkbox keeps its own setting.
- **Undo:** every image change goes through undo like any other edit, including opacity, show/hide and lock. An opacity drag, an image drag and a calibration are one step each.
- **Storage:** in the browser, images live in their own IndexedDB store (D21) and floors refer to them by `imageId`. Saved `.signalplan.json` files embed them as a `dataUrl`, so one file restores everything; opening a file moves embedded images back into the store. Images no longer used by any plan are removed at startup, so a removed image can still be brought back with undo during the session. Adding the optional `background` field needed no `schemaVersion` bump.
- **Why:** tracing over an existing plan is much faster and more accurate than measuring each room by hand (OUTLINE.md open question). Two-point calibration is the simplest method that works with any scanned plan, even one without a printed scale bar.
- **Revisit if** people often trace from PDFs or rotated scans (read PDFs with pdf.js, add rotation), or if embedded images make files too big to share (downscale on import).

### D23. Keyboard access and screen-reader labels — 2026-09-27

- **Decision:** everything around the canvas works from the keyboard with accessible names, and the canvas gets basic keyboard selection. Keyboard drawing (placing wall corners with a keyboard cursor) is left out.
- **Why:** the toolbar, menus, panels and dialogs are ordinary controls and should all work without a mouse; drawing walls by keyboard would need its own cursor and snapping model, far more work than it's worth for a drawing tool at this stage.
- **Tools:** an ARIA toolbar. Tab reaches the current tool, the arrow keys (and Home/End) move between tools, Enter or Space picks one; V, W, D and N still work anywhere, and are exposed through `aria-keyshortcuts`.
- **File menu:** Enter, Space or ↓ opens it on the first item; ↑/↓ move, Esc closes it and returns to File, and tabbing away or clicking elsewhere closes it.
- **Dialogs:** native modal dialogs trap focus; on closing, focus returns to whatever opened them (File, when opened from the menu).
- **Canvas:** focusable, with a short label and a described-by hint listing the keys. With Select active, Tab and Shift+Tab step through walls, doors and windows, corners, then access points, each in reading order (top to bottom, then left to right), and move on to the next control after the last one. Arrow keys move the selection and Delete removes it, as before. A polite live region announces the selection in the display units, e.g. "Wall, drywall, 3.20 m, 2 of 14".
- **Space to pan** now only applies when the canvas (or nothing) has focus. Before, it swallowed Space everywhere, so Space couldn't press buttons, tick Heatmap or open the File menu.
- **Quiet readout:** the pointer position in the status bar is no longer a live region, since it changed on every mouse move.
- **Checks:** `@axe-core/playwright` scans the editor, the properties panel, the File menu and every dialog in the browser tests, failing on serious or critical findings; keyboard-only flows are tested too.
- **Revisit if** people ask to draw by keyboard, or a screen-reader user reports that the canvas announcements are too chatty or too sparse.

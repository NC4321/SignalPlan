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
- **Update:** NIST measurements at 5 and 6 GHz show brick and concrete much lossier than computed; see D31.
- **Update:** brick's conductivity is now fitted to a measured wall, a second fitted value after low-E; see D36.

### D10. No clutter term — 2026-09-27

- **Decision:** the distance term stays at free space (n = 2), with no extra clutter loss.
- **Why:** with typical wall counts the model is within about 3 dB of the ITU-R P.1238-13 office median, well inside its 5 dB spread. An earlier estimate of ~10 dB optimism was not supported by the standard.
- **Revisit if:** phone measurements in Phase 7 show a consistent offset; receiver losses (phone antenna, body) are the first suspect.

### D11. Grid resolution — 2026-09-27

- **Decision:** 10 cm cells by default, with no spatial index.
- **Why:** measured at ~20 ms for the 150 m² sample home, far inside the 200 ms budget.
- **Update:** still no spatial index; the grid got 5–7× faster instead, and large homes have their own budget (D29).

### D24. Propagation scope for M1: omnidirectional, direct path only — 2026-09-27

- **Decision:** for M1, every access point radiates equally in all directions (no antenna pattern), and only the direct line from access point to cell is modelled, adding the loss of each wall it crosses. Reflections and diffraction are not modelled.
- **Why:** there's no router data to source antenna patterns from, and D8 already leaves router-model presets for later. The multi-wall model, as in the COST 231 final report, is the standard citable approach and is what [MODEL.md](MODEL.md#from-equation-to-heatmap) describes. It's also cheap: one straight-line wall check per cell keeps the grid inside the 200 ms budget (D11), which live dragging needs.
- **Revisit if:** Phase 7 calibration shows a consistent error behind strong walls, router presets with real antenna patterns arrive, or a reflection or ray-tracing mode fits the worker's time budget.

### D26. CI speed check at 1.5× the budget — 2026-09-27

- **Decision:** `pnpm speed` runs in CI and fails when the median coverage-grid time on the sample home or the busy room grid exceeds 300 ms, 1.5× the 200 ms budget (D11). The 200 ms budget itself stays the target on a real device.
- **Why:** the CI runner is about 2.1× slower than the desktop (room grid: 80 ms there, 170 ms on CI), and runner hardware varies. Held to exactly 200 ms, the check would fail at random; at 300 ms it still catches the room grid getting about 1.8× slower. Timings are in [MODEL.md](MODEL.md#speed).
- **Revisit if:** the check fails at random anyway, the room grid's CI time drifts near 300 ms, or a spatial index lands and the margin can tighten.

### D29. Heatmap speed on slow devices — 2026-09-27

- **Decision:** keep the current rendering: the worker computes the grid, and the page draws it as one ImageData bitmap, with only the newest request queued. Make the engine faster instead of coarsening the grid. Each wall segment is prepared once per grid (direction, length, bounding box, loss), segments clear of a path's bounding box are skipped, and nothing is allocated per cell. Large homes get a budget of 200 ms on a device 4× slower than the desktop (50 ms on it), checked in `pnpm speed` on a 300 m² "big house" at 1.5× on CI.
- **Why:** measured with Chromium's CPU throttling, the page held 56–60 frames a second at 4× and 6× on both the sample home and the big house, so drawing isn't the bottleneck. The grid was: the big house took ~211 ms on the desktop, about 1 s on a 4–6× slower phone. Now it takes 28 ms (5–7× faster across all plans), and a drag updates the heatmap ~28 times a second instead of 4.5. The results are bit-for-bit the same: fingerprints of every grid matched before and after, and property tests compare against the reference path. A coarser grid while dragging wasn't needed.
- **Limits:** Chromium doesn't throttle dedicated workers, so slow-phone worker times are the desktop times × 4–6, not measured.
- **Revisit if:** a real phone or the usability test (#46) feels laggy, multi-floor or larger plans push the big house past its budget, or a spatial index becomes worthwhile.

### D30. Wall loss stays at normal incidence — 2026-09-27

- **Decision:** each wall crossing keeps the loss computed for a wave meeting the wall head on, whatever the angle of the path. No build issue follows.
- **Why:** the P.2040 slab method in `slab.ts` already takes an angle, so the effect was measured rather than guessed. Loss doesn't simply grow with angle: from 0° to 60° it moves by a few dB either way, and plain glass, low-E glass and the stud wall lose _less_ at some angles between 30° and 60° than head on (e.g. low-E glass at 5 GHz: 29.9 dB at 0°, 22.2 dB at 60°). Past about 80° every material climbs steeply, up to 40 dB or more near 89°. Replaying the sample home and the big house with angle-dependent loss (from a 1° table, so compute isn't the obstacle) moved the median cell by at most 0.5 dB and 90% of cells by at most about 3 dB, and the share of the floor at −67 dBm or better by 0.2 points at most. Without a cap on the angle, a few nearly parallel crossings dropped by 8–22 dB. The effect is well inside P.1238-13's 5 dB spread and the model's other known limits (D24), and a heatmap that brightens behind glass at an angle would look like a bug.
- **Validation and P.1238:** unchanged. The Shakya et al. samples were measured head on, and the P.1238 comparison in [MODEL.md](MODEL.md#against-the-itu-r-p1238-13-indoor-model) counts walls without angles.
- **Revisit if:** Phase 7 measurements show a consistent error along corridors or beside long walls; if so, use the P.2040 angle with a cap of about 60–75° so grazing crossings stay finite.

### D31. Validation against NIST at 5 and 6 GHz — 2026-09-27

- **Decision:** add NISTIR 6055 (Stone, 1997) as the second validation source, for 5 and 6 GHz. A unit test keeps every drywall, glass and dry lumber sample within 5 dB in both bands. Brick and concrete are shown in [MODEL.md](MODEL.md#against-nist-at-5-and-6-ghz) but not tested, and no material values change. 2.4 GHz stays unvalidated for now.
- **Why:** it's a primary NIST source measured across both bands, and it publishes each curve as a polynomial, so values are computed exactly rather than read off plots; each copied curve is checked against its plot. Drywall and glass agree within 2.3 dB, and wood is under-predicted by 2–5 dB, as in the Shakya comparison. Brick and concrete are 12–30 dB lossier than P.2040 predicts, but the report doesn't give the specimens' moisture, and D9 keeps measurements for validating rather than setting values, so one source isn't enough to retune them. The 5 dB limit covers every non-masonry sample without picking; the worst, 75 mm lumber at 5 GHz, is 4.97 dB under. NIST didn't measure 2 to 3 GHz.
- **Follow-ups:** [#55](https://github.com/NC4321/SignalPlan/issues/55) investigates the masonry gap with more sources; [#56](https://github.com/NC4321/SignalPlan/issues/56) looks for a peer-reviewed 2.4 GHz source.
- **Revisit if:** a second source confirms the masonry gap (retune `brick` and `concrete`), or a change to wood pushes the 75 mm sample past 5 dB.
- **Update:** 2.4 GHz is now checked against the nearest available data; see D32.

### D32. Validation at 2.4 GHz — 2026-09-27

- **Decision:** validate the 2.4 GHz band against the nearest primary data that could be read in full: NIST's low range at 2.0 GHz (NISTIR 6055, the top of its 0.5–2.0 GHz range) and Anderson and Rappaport's in-building partition losses at 2.5 GHz (IEEE TWC, 2004). A unit test keeps NIST's drywall, glass and dry lumber samples within 4 dB at 2.0 GHz; the in-building values and masonry are shown in [MODEL.md](MODEL.md#near-24-ghz-nist-at-20-ghz-and-anderson-and-rappaport-at-25-ghz) but not tested. No material values change.
- **Why:** no lab measurement inside the band was both primary and readable. Searched and not used: Koppel et al., "Reflection and Transmission Properties of Common Construction Materials at 2.4 GHz Frequency", _Energy Procedia_ 113 (2017), open access but only reachable through a captcha; an IEEE Antennas and Wireless Propagation Letters study of building structures from 0.4 to 2.7 GHz (2018), paywalled; Ali-Rantala et al. (IEEE AP-S 2003), which is simulation, not measurement; ITU-R P.2346-1, whose material data are at 3.5 GHz; and the Magis Networks white paper (Wilson, 2002), which isn't peer-reviewed. At 2.0 GHz, NIST's drywall and glass agree within 1 dB, lumber is 2.6–3.5 dB under (as in every other band), brick within 2.6 dB, and concrete 6–22 dB under. 4 dB, the same as the Shakya test, covers every non-masonry NIST sample; the worst is 75 mm lumber at 3.5 dB. Anderson and Rappaport's office drywall agrees within one standard deviation (−2.1 dB), but their single 3.2 mm clear glass measured 6.4 dB against 0.8 dB predicted; as in-building averages of partitions of unknown construction (frames, cavities, multipath), they're shown but not tested, since a limit wide enough for the glass (6 dB or more) would catch little.
- **Limits:** 2.0 and 2.5 GHz bracket the band rather than sit in it; the model's own 2.0 GHz values are within about 1 dB of its 2.4 GHz band averages for these samples.
- **Revisit if:** an in-band lab source becomes readable (the Energy Procedia paper is the first to try), or #55 changes the masonry or wood constructions.

### D33. Masonry and wood validation, second source — 2026-09-27

- **Decision:** add Muqaibel (Virginia Tech, 2003) as a second measurement source and Rhim (MIT, 1995) for how moisture changes concrete, with a test that keeps the wooden door and glass within 1 dB in all three bands and records that the model under-predicts dry-stacked brick by less than 5 dB. No material values change yet: whether to change `brick` or `concrete` is **pending the user's decision** on #55.
- **Findings:** the model is below every wood measurement, but by only 0.4–0.5 dB for Muqaibel's 44.5 mm door, against 2–5 dB for NIST's lumber and the Shakya fire door. Brick is under-predicted by every source: 0.8–4.8 dB for Muqaibel's dry-stacked wall and 12 dB for NIST's mortared one at 5 GHz, but NIST's 3–8 GHz brick is out of line with its own 2.0 GHz value (D32) and with Muqaibel, so the supported gap is about 1–5 dB. Concrete loss is dominated by moisture: with Rhim's measured permittivities, 102 mm of concrete loses 4.0 dB at 5 GHz air dried, 16.1 dB saturated and 27.4 dB wet; P.2040's concrete (14.2 dB) behaves like saturated concrete, and NIST's (17.9–26.8 dB) lies between saturated and wet. P.2040-4 doesn't state the moisture of its samples. Details are in [MODEL.md](MODEL.md#masonry-and-wood-second-sources).
- **Why:** D9 keeps measurements for validating rather than setting values, and D31 asked for a second source before retuning masonry. The second source confirms the direction for brick but not the size, and for concrete it shows the answer depends on moisture, which a plan doesn't record.
- **Revisit if:** the user picks a change on #55, or Phase 7 measurements in real homes show a consistent error behind brick or concrete walls.
- **Update:** the user chose to fit brick and keep concrete; see D36.

### D36. Brick conductivity fitted to a measured wall — 2026-09-28

- **Decision:** the `brick` construction's 90 mm brick layer keeps P.2040's ε′ = 3.91 but uses a fitted conductivity, σ = 0.0170·f^0.92 S/m, instead of P.2040's 0.0238·f^0.16. It lives in `FITTED_MATERIALS` in `slab.ts` as `brick-fitted`, next to the unchanged P.2040 table, so it's clear which numbers are the standard's and which are fitted. `concrete` and `wood` are unchanged. The brick veneer wall now loses 6.6 / 9.0 / 9.9 dB at 2.4 / 5 / 6 GHz, up from 5.8 / 5.3 / 5.2.
- **Why:** every brick measurement found is lossier than P.2040's brick (D31–D33). The fit reproduces the single-wythe wall Muqaibel measured head on (Table 4.3, 1.0702·f + 0.9757 dB) within 0.13 dB in all three bands, and NIST's mortared brick at 2.0 GHz points the same way (within 1.6 dB of the fit, against 2.0 dB for P.2040). NIST's 3–8 GHz brick isn't used: it's out of line with NIST's own 2.0 GHz value and with Muqaibel, and matching it would take 6.2 times P.2040's conductivity.
- **D9 exception:** D9 keeps measurements for validating rather than setting values. This is the second fitted value, after the low-E coating. Brick is used for exterior walls in many plans, and a 1–5 dB optimism there was consistent across sources, so one well-documented measurement is better than a standard value every source disagrees with.
- **Caveats:** Muqaibel's bricks were dry-stacked without mortar (Figure B2.1), so a mortared wall may lose somewhat more. The 6 GHz band runs to 7.125 GHz, slightly past the fit's stated 1–7 GHz.
- **Concrete stays** at P.2040's values (D33): its loss depends mostly on moisture, which a plan doesn't record, and P.2040's concrete behaves like Rhim's saturated concrete, in the middle of the measured range and close to 3GPP TR 38.901.
- **Revisit if:** a mortared-brick measurement at 2–7 GHz disagrees with the fit by more than about 2 dB, or Phase 7 calibration shows a consistent error behind brick walls.

## Phase 3

### D12. Heatmap colours — 2026-09-27

- **Decision:** five labelled quality bands (Excellent ≥ −50, Good ≥ −60, Fair ≥ −67, Weak ≥ −75, Poor ≥ −85 dBm) in the viridis palette; weaker cells are left uncoloured.
- **Why:** bands answer "is it good enough?" at a glance, and viridis stays readable with colour-vision deficiencies.

### D13. Sample home — 2026-09-27

- **Decision:** the demo and tests use a 150 m² bungalow with a concrete utility room, a steel door and low-E windows, instead of the original 80 m² flat.
- **Why:** one router covered the flat almost entirely, so the demo showed little contrast.

### D25. Access point tool — 2026-09-27

- **Decision:** an Access point tool (A) adds one where you click. A new access point is named "Access point N", mounted 1 m above the floor (a router on a desk or shelf, as in a New plan), with a radio on 2.4, 5 and 6 GHz at each band's typical EIRP (D8). It stays selected and the tool stays active, like the door and window tools.
- **Editing:** the panel sets the name, mounting height (0 m up to the floor's height), which bands are on and each band's EIRP. An empty power field means the band's typical value. Every access point keeps at least one band on, as the schema requires; the last band's checkbox is disabled. Delete (key or button) now removes access points too, and deleting the last one on a floor is allowed: the heatmap goes blank and a notice points to the tool.
- **Power limits:** any EIRP from −10 to 40 dBm is accepted. Above the band's highest FCC limit a note says so: 36 dBm at 2.4 GHz (1 W with antennas up to 6 dBi, 47 CFR § 15.247(b)(3), (b)(4)), 36 dBm at 5 GHz (U-NII-1, 3 and 4; U-NII-2A/2C allow 30 dBm, § 15.407(a)(1)–(3)) and 30 dBm for indoor 6 GHz (§ 15.407(a)(5)). Values aren't refused, so routers certified elsewhere can still be modelled.
- **Why:** placing and editing access points is the core of planning coverage (Phase 3). Warning instead of refusing keeps the numbers honest without blocking unusual set-ups.
- **Revisit if:** regions beyond North America arrive (D8), or channel planning (Phase 6) makes the 5 GHz limit depend on the chosen channel.
- **Update:** a press on an existing access point with the tool grabs it rather than adding another (D34).

### D27. Coverage summary — 2026-09-27

- **Decision:** under the heatmap legend, one line gives the share of the floor area that reaches a target for the band on show, e.g. "86% of 150 m² at Fair or better on 5 GHz". It updates live, is rounded down (so 100% means all of it) and is a polite status for screen readers.
- **Floor area:** the cells inside the outer walls, found by flooding in from the grid's edge; a step between cell centres that touches a wall is blocked. Doors and windows count as closed, since they sit on walls. Until the outline is closed, the line asks for that instead of showing a share. A cell whose centre lies exactly on a wall counts as inside, so the area can run up to half a cell over along such walls, but the flood can't leak through a closed outline. The sample home measures its stated 150 m².
- **Target:** one of the D12 bands (Excellent, Good, Fair, Weak), picked from a list showing what each is good for. The default is Fair, −67 dBm, for calls and streaming. It's stored in the plan as the optional `coverageTarget`, so it's saved and undoable; adding an optional field needs no schema version bump.
- **Why:** the whole grid would count the 1 m outdoor margin and change as you draw; rooms don't exist in the schema. Reusing the D12 bands avoids new thresholds that would each need a source.
- **Revisit if:** rooms or room importance arrive (Phase 4 scoring), or a floor has courtyards or holes that should be left out.

### D28. Export as a PNG — 2026-09-27

- **Decision:** File › Export image… opens a dialog with a size (Small 1280 × 800, Medium 1920 × 1200 by default, Large 3840 × 2400) and a theme (Light by default, or Dark), then downloads a PNG named after the plan and band, e.g. "Sample bungalow - 5 GHz.png".
- **Contents:** a title (plan name, floor and band), the whole floor fitted to the image whatever the current zoom, the heatmap for the band on show, walls, doors and windows, access points with their names, a scale bar, the quality legend, the coverage summary and target (D27), and a line saying it's a simplified model's prediction. The tracing image, the grid, selection and tool previews are left out.
- **How:** the page is laid out at 1280 × 800 and scaled, so text and lines keep their proportions at every size. Coverage is computed for the export with the engine directly, not the worker. The theme colours are copied from the stylesheet's tokens, and a unit test fails if they drift apart.
- **Why:** an image for sharing needs to stand alone, so it carries its own legend and scale. It's the same at any zoom. Light suits documents, READMEs and print, and a theme choice suits people who share into dark-themed places.
- **Revisit if:** multi-floor plans arrive (export one floor or all), or people ask for the tracing image or SVG/PDF output.

### D34. Fixes from the agent usability walkthrough — 2026-09-27

- **Decision:** three small changes from the agent's cold-start walkthrough ([docs/usability](usability/2026-09-27-agent-walkthrough.md)). The Access point tool now grabs an existing access point when pressed on it (select, and drag to move, with a grab cursor and no placement ghost), instead of adding another on top; clicking empty floor still adds one, and the tool stays active (D25). An empty floor's panel says how to start drawing. The notice for a band nothing broadcasts on says how to turn the band on.
- **Why:** the tool stays active after placing, so "place a router, then drag it" stacked an invisible duplicate that doubled the signal from that spot. A New plan's router is dual-band (D20), so 6 GHz starts blank, and the old notice didn't say what to do.
- **Not changed here:** where the coverage summary sits (#61) and the Wall tool starting a wall on an access point (#62) are design choices left open. The walkthrough doesn't replace watching real people (#46); see the [test script](usability/test-script.md).
- **Revisit if:** the human usability test shows people still stack or lose access points, or don't find how to start.

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

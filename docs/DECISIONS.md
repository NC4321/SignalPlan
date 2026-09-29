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
- **Update:** still no spatial index; the grid got 5–7× faster instead, and large homes have their own budget (D29). _D56 adds one: walls sorted by direction from each access point._

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
- **Update:** the line now also sits in the status bar, where it's always visible, and the status bar's copy is the one announced to screen readers; see D37.

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
- **Update:** the coverage summary is now also in the status bar (D37).
- **Update:** the Wall, Door and Window tools now grab access points too (D38).

### D37. Coverage summary always in view — 2026-09-28

- **Decision:** the coverage summary line (D27) also appears at the left of the status bar, in bold, before the pointer readout. On phones the status bar is the bottom bar, and the summary gets its own line above the readout and zoom buttons. The panel keeps its copy with the target picker, since the target is changed there. When nothing broadcasts on the band, the status bar shows no summary, as the panel doesn't.
- **Why:** the summary is the app's main answer, but it sat at the bottom of the Properties panel: below the fold at 1280×800 (further still with an access point selected), and on phones inside the Details drawer, whose name doesn't hint at it (#61, found in the D34 walkthrough). The status bar is visible at every width.
- **One source:** the line is computed once in `useCoverageMessage` and passed to both places, so they can't disagree.
- **Screen readers:** the visible line updates with every frame while dragging, so it's hidden from assistive tech. A separate polite live region beside it holds the last settled text during a drag and announces the result once the drag ends, in keeping with D23's quiet readout. The panel's copy is no longer a live region, so nothing is announced twice.
- **Details** keeps its name: with the result in the bottom bar, the drawer holds the legends and settings, which "Details" describes well enough.
- **Revisit if:** the human usability test (#46) shows people still miss the summary, or the status bar gets crowded at 1024 px wide.

### D38. Wall, Door and Window tools grab access points — 2026-09-28

- **Decision:** with the Wall tool active and no chain in progress, a press on an access point grabs it, as the Access point tool does (D34): a click selects it and a drag moves it, as one undo step, and the tool stays active (D17). The cursor shows a grab hand over the access point and the wall preview is hidden. Mid-chain, clicks always place corners, even on an access point. The Door and Window tools grab access points the same way, since a press there would otherwise do nothing useful.
- **Starting a wall on an access point:** hold Alt, which already means "place freely, without snapping" in the Wall tool. An access point is a small circle in the middle of a room, so a wall rarely needs to start exactly there, and a mis-grab is one undo away.
- **Why:** the tool stays active after a chain, so "draw the rooms, then move the router" started a stray wall from the router instead (#62, from the D34 walkthrough). One check, `pressGrabsAccessPoint`, now decides this for every tool, so the tools can't drift apart.
- **Revisit if:** the usability test (#46) shows people meaning to start walls on access points, or grabbing them by accident while drawing.

### D39. M1 exit gate: closed without first-time users — 2026-09-28

- **Decision:** close #46 and the M1 milestone after the author's own pass through every feature ([notes](usability/2026-09-28-functional-pass.md)) and the agent walkthrough (D34, whose findings D37 and D38 fixed). Tag the result as v0.1.0. Watching 2–3 first-time users with the [test script](usability/test-script.md) moves to an M2 issue and must happen before any launch post.
- **Why:** the features work end to end and M2 doesn't depend on the stranger test. But an author can't see where a newcomer gets stuck, so "a stranger can use it without instructions" isn't shown yet, and this entry says so.
- **Revisit if:** the first-time-user test finds blocking problems. Fix those before announcing anything.

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
- **After a chain:** the wall tool stays active; Esc again (or V) returns to Select. Between chains, a press on an access point grabs it rather than starting a wall (D38).
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

## Phase 4

### D40. Placement optimizer scope for M2 — 2026-09-28

- **Goal:** maximise the share of floor area at or above the plan's coverage target, for the band on show. This is the same number as the coverage summary (D27, D37), so the "before → after" figure matches what the status bar says. Other goals (best weakest spot, priority areas) can come later as presets.
- **No rooms:** every cell inside the outer walls counts equally. The schema and editor get no room tool in M2.
- **Constraints:** candidate positions lie inside the outer walls and not on a wall. Each access point gets an optional `locked` flag (an optional schema field, so no version bump); locked access points never move. No allowed or no-go zones.
- **Showing a suggestion:** suggested spots appear as ghost access points with before and after coverage (e.g. 72% → 91%). Apply moves or adds access points as one undo step; Dismiss discards them.
- **Multiple access points and mesh:** added access points copy the first access point's bands and power. (D45: its mounting height too.) Backhaul between them is ignored, which assumes wired or good-enough wireless links. The app and MODEL.md say so.
- **Time budget:** the search runs in the worker, shows a progress bar and Cancel, and stops within 10 seconds, returning the best result found so far. The outline's exit gate still applies: on three test homes, the suggestion beats a naive centre placement.
- **Why:** these are the smallest choices that give a useful, honest optimizer. Each one reuses something that already exists (the coverage target, the floor area, the gesture undo), so nothing new needs a source.
- **Revisit if:** people ask for priority rooms or no-go areas, or mesh suggestions turn out unrealistic because of weak backhaul (M4).

### D41. Optimizer scoring and candidate positions — 2026-09-28

- **Decision:** `createScorer` in `placement.ts` scores a placement as the share of floor-area cells (D27's flood fill) at or above the target, with the fixed access points plus the moving ones. It searches on 25 cm cells. The first candidates are the points (i + ½, j + ½) × 0.5 m that lie inside the walls and at least 10 cm from any wall. The best ones are refined to 10 cm afterwards (#72), and the final figure is confirmed on the normal 10 cm grid, so it matches the status bar.
- **Speed:** everything that doesn't depend on the moving access points is computed once: the floor-area cells, the prepared walls, and the strongest signal from the fixed access points. Only cells inside the walls are evaluated. One pass over all candidates for a single access point takes about 0.26 s on the sample home (600 candidates, 2,400 cells), 0.26 s on the room grid and 2.2 s on the 300 m² big house (1,200 candidates, 4,800 cells), measured on the development machine.
- **Wall clearance:** walls are thin lines, so a point on one is on neither side. 10 cm stands for an access point placed against the wall.
- **Why:** you chose a 0.5 m lattice with refinement over 0.25 m everywhere (about 4× slower) or 1 m (more risk of missing narrow spots). At 25 cm the scorer agrees exactly with `evaluateCoverage` plus `summariseCoverage` on the same grid (unit test), so the search optimizes the same model the heatmap shows, only on coarser cells.
- **Revisit if:** the 25 cm score often ranks candidates differently from the 10 cm check, or the big house's multi-AP search runs over the 10 s budget.

### D42. Single access point search — 2026-09-28

- **Decision:** `searchSinglePlacement` scores every 0.5 m candidate on 25 cm cells (D41), then refines the best 5 by pattern search. It moves to the best of the 8 neighbours 0.25 m away while that improves the score, then does the same at 0.1 m. The winner is chosen on the normal 10 cm grid, so its share is the number the status bar will show once it's applied. With a `current` position it also reports the share there, for the before → after figure.
- **Ties:** a larger share wins. On an equal share, the spot whose weakest cell inside the walls is strongest wins (your choice). One router often covers 100% of a home at Fair from almost anywhere, and without a tie-break the first candidate, a corner of the house, won. The weakest spot leaves the most headroom for furniture, doors and model error, and pulls the suggestion toward the middle. Ties that remain keep reading order, so results are reproducible.
- **Time and cancelling:** the search checks a 10 s budget (D40) between evaluations. When the budget runs out it skips the rest, still picks the best found so far on 10 cm cells, and says it stopped early. It reports progress as a fraction, and the worker posts it at most every 100 ms. The search runs in its own worker (`handlePlacementRequest`), so the heatmap keeps updating, and Cancel terminates that worker.
- **Results:** starting from the router's current spot, the sample home goes from 86.9% to 92.0% at Fair on 5 GHz, in about 0.36 s. The room grid and the big house are already at 100%, and the suggestions are their middles (the weakest spot is −50.8 and −55.7 dBm), in 0.37 s and 2.5 s. At Fair these test homes can't show a gain over a centre placement, so the exit gate (#76) needs homes or targets where one router falls short.
- **Why:** refining a handful of the best lattice points is far cheaper than a denser lattice, and pattern search needs no tuning. Checking on 10 cm cells at the end keeps the promised figure honest.
- **Revisit if:** refining often lands in a different room from the best lattice point, which would mean more seeds are needed, or searches on large homes approach the budget.

### D43. Locking access points in place — 2026-09-28

- **Decision:** access points get an optional `locked` flag (an optional field, so no `schemaVersion` bump), set by a "Locked (stays where it is)" checkbox in the access point panel. Locking and unlocking are undoable edits. A locked access point can't be moved at all: a press selects it but a drag doesn't move it, and the cursor shows it can't. Arrow keys move the rest of a selection and skip it. The optimizer will treat it as fixed (D40). Everything else stays editable, including Delete.
- **Feedback:** during a drag, or after the arrow keys skip a locked access point, the status bar reads "Locked: unlock it in the panel to move it". The note is a polite live region, since it's rare and short, and it clears on the next edit or when the selection changes. The panel's hint says it's locked, and screen readers hear "locked" in the selection description.
- **Look:** a small padlock drawn before the name, outlined in the canvas colour like the label. It appears in PNG exports too, since those use the same drawing code. It's drawn as a vector rather than an emoji, so it doesn't depend on the fonts installed.
- **Why:** these were your choices: can't move at all, delete still works, select with an explanation, padlock by the name. Stopping only the optimizer would let a drag quietly undo what the lock is for, and refusing selection would hide the panel that unlocks it.
- **Revisit if:** people lock access points by mistake and can't find how to unlock them, or want to lock walls too.

### D44. The optimizer panel — 2026-09-28

- **Decision:** a "Suggest a spot" section in the properties panel, shown with nothing selected, with one access point selected, or while a search or suggestion is under way. Its button finds a spot for the selected access point; with nothing selected, for the only unlocked one on the floor, or for a new one (with the Access point tool's settings) when the floor has none. _With several floors, see D55: the choice is made over the whole plan, not the floor on show._ Every other access point on the floor stays fixed. Where the choice isn't clear (several unlocked, all locked, the band off), the section says what to do instead of showing the button. The multi-AP search widened this with nothing selected (see D45).
- **Searching:** a progress bar and Cancel, with "Searching for a spot for …" in a status region. Each search runs in a fresh worker that Cancel terminates. Focus stays in the section as its buttons change (Find → Cancel → Apply), so it works from the keyboard alone.
- **Suggestion:** a ghost access point with a dashed ring and a "Suggested" label, a dashed line from the access point that would move (drawn faded), and the heatmap and status bar switched to coverage with the suggestion in place ("With the suggestion: 92% of …"). The panel says where it goes and the before → after share, rounded down like the summary. When the share is unchanged it gives the weakest spot's gain instead. If the best spot is within 10 cm of the current one, it says the access point is already there. A search stopped by the 10 s budget says so. The section notes that mesh backhaul isn't modelled.
- **Apply and Dismiss:** Apply moves or adds the access point as one undo step and selects it. Dismiss and Esc discard the suggestion. Any edit, undo, redo, drag or band change drops a waiting suggestion or a running search, and the status bar says why ("Suggestion dismissed: the plan changed.").
- **Why:** these were your choices: a panel button, the selected access point (or the only one), a heatmap preview, and discarding on change. The panel sits next to the settings the search uses (target, band, lock), and previewing on the heatmap shows where the gain is, not only its size. Dropping stale results means a suggestion always matches the plan on screen.
- **Revisit if:** people miss the section (for example on phones, where the panel is a drawer), or the heatmap preview is mistaken for the applied plan.

### D45. Multi access point search — 2026-09-28

- **Decision:** `searchMultiPlacement` places the moving (unlocked) access points and any added ones together. Added ones go in greedily, one at a time, at the best 0.5 m lattice spot given the rest. A second start places every moving one greedily in turn, which escapes a bad current layout, and the better start (on 25 cm cells) is refined. Refining is simulated annealing, then pattern search on each access point at 0.25 m and 0.1 m (D42's steps). The winner is chosen on 10 cm cells from the refined layout and both starts, so refining never lowers the score (property test).
- **Annealing:** 250 steps per access point, taking them in turn. A step either moves by a random length of 0.5–1.5 × a reach that shrinks geometrically from 2 m to 10 cm, or (one step in five) jumps to a random lattice spot, so an access point can change rooms late on. Energy is covered cells + 0.01 × weakest dBm, so 70 dB of weakest spot is worth less than one cell and share always comes first, as in D42. A worse layout is accepted with probability exp(ΔE / T), T cooling geometrically from 1% of the cells to 0.05 of a cell. The seed is fixed (`0x5eed`) and one random number is drawn per step whether or not the proposal is allowed, so the same plan gives the same answer on every device (your choice). The 10 s budget only caps it and says when it stopped early.
- **Panel:** with one access point selected, only it moves (your choice), as in D44. With nothing selected, "Find better spots for N access points" moves every unlocked one that broadcasts on the band, and "Suggest one more access point" adds one and moves the unlocked ones to suit. The new one copies the bands, power and height of the first access point on the floor that broadcasts on the band (your choice: height too, so a mesh node matches the router), or uses the tool's defaults if none does. A suggestion lists every move ("Move … and add … at …"), draws a ghost for each ("Suggested", or "New: Access point 1"), and Apply makes one undo step and selects them all.
- **Results:** on the development machine, moving the sample home's router alone reaches 92.0% in 0.37 s, the same as the single search. Adding one more takes the sample home from 86.9% to 100% at Fair on 5 GHz in 0.5 s. The big house takes 3.3 s to move both access points and 4.6 s to add two more at a −50 dBm target, within the 10 s budget.
- **Why:** greedy placement is cheap and good at choosing rooms; annealing then fixes greedy's short-sightedness by moving everything together. Starting only from the current layout missed the best room for the sample home's router (90.9% against 92.0%), which the second start fixes. A fixed step count keeps results reproducible, as #73 asked.
- **Revisit if:** results on larger or odder homes are clearly beaten by moving access points by hand, or searches approach the 10 s budget on slower devices.

### D46. "How many access points do I need?" — 2026-09-28

- **Decision:** a "How many access points do I need?" button in the optimizer panel with nothing selected, under a "Coverage goal" menu: 80, 90, 95 or 100% of the floor, 90% by default. The goal is the share of the floor that has to reach the plan's coverage target on the band on show. It lives in the editor, isn't saved with the plan and resets on reload (your choice), so the schema doesn't change. `searchHowMany` adds up to `MAX_ADDED` = 4 access points (your choice). The unlocked ones on the band move too, as with "Suggest one more" (your choice), and locked ones stay put.
- **Search:** if the access points already reach the goal where they are, nothing moves, and the panel says no more are needed. Otherwise it runs D45's multi search with 0, 1, 2 … added, and stops at the first count that reaches the goal. With no access point that can move, it starts at 1. Each count also starts from the previous count's winner plus one placed greedily, so one more never scores lower. Between counts only a larger share counts: one more always raises the weakest spot, and that tie-break would otherwise favour the extra access point. The counts share one lattice of candidate signals, the greedy starts, the 10 cm signals and one 10 s budget.
- **Out of reach:** if even 4 more don't reach the goal, the panel says so ("Even 4 more access points don't cover 100% of the floor. The best found: …") and offers the best layout found for Apply or Dismiss (your choice), with the fewest added among equal shares. If the 10 s budget runs out first, it says no layout was found in time rather than claiming the goal is out of reach.
- **Text:** "You need 1 more access point for 100% of the floor. Move … and add …: 86% → 100% of the floor at Fair or better on 5 GHz." Or "No more access points needed for 90% of the floor. Move …" when moving is enough.
- **Results** (development machine, 5 GHz): on the sample home at Fair, moving the router reaches 92% for the 90% goal in 0.38 s, and the 100% goal takes one more in 0.67 s. At Excellent, 100% takes two more in 1.0 s. On the 300 m² big house at Excellent, 90% needs none (moving both reaches 99.8%) in 3.3 s, 100% needs one more in 5.1 s, and from an empty floor three in 5.6 s. As a stress test beyond any real target (−40 dBm), the big house hits the 10 s cap while trying four more and says so.
- **Why:** reusing the multi search keeps one model of "best", and trying counts in order gives the fewest. Sharing the lattice between counts keeps the big house within the budget: separate searches for 1 to 4 added would take about 20 s. 4 more covers a large home with a router and a mesh kit. Offering the best layout when the goal is out of reach still shows where more access points help most.
- **Revisit if:** people often hit the 4 limit or the 10 s budget on real homes, or want the goal saved with the plan.

### D47. Optimizer exit gate: test homes, centre baseline and speed check — 2026-09-28

- **Homes:** the sample home (150 m², brick bungalow) plus two new fixtures in `packages/floorplan/fixtures/` (your choice): `apartment.json`, a 65 m² flat with a concrete shell and a concrete spine wall, router in the entrance hall; and `l-shaped-house.json`, a 220 m² L-shaped house with brick outer and bearing walls and drywall rooms, router in the far study. Three sizes, three shapes and different materials.
- **Baseline and test:** the naive placement is the middle of the floor's bounding box, moved to the nearest spot the optimizer allows (10 cm lattice) when it's outside the walls or on one (your choice). The L-shape's middle is outside. `exitGate.test.ts` requires the single-AP suggestion to cover a strictly larger share than the middle at Good (−60 dBm) on 5 GHz (your choice). At Fair a router in the middle already covers most of these homes, so nothing could beat it. Results: sample home 87.4% → 90.5%, apartment 72.1% → 97.4%, L-shaped house 75.6% → 100%.
- **Speed:** `optimizer.speed.ts` in `pnpm speed` (so on CI) runs the best spot, one more, and how many for 100% on each gate home and the 300 m² big house, at Excellent on 5 GHz, where every home needs more access points. Each search runs once with its 10 s cap lifted. The budget is 10 s on a desktop and CI fails at 15 s, 1.5× as in D26 (your choice). The slowest is the big house's how-many: 5.6 s on the desktop and 7.4 s on the CI runner. The gate homes take at most 1.3 s on the desktop and 1.7 s on CI.
- **Why:** the middle is what someone would pick by eye, and Good is the strictest target where every home has room to improve, so the gate compares against a real alternative. Holding the budget to a 4× slower device (as D29 does for the heatmap) would need the big house's search about 2.2× faster first. On slow phones the search stops at 10 s and says so, which MODEL.md lists as a limit.
- **Revisit if:** the CI times drift toward 15 s, people report "stopped early" on real homes, or the usability test (#77) suggests a different baseline, such as where people actually put routers.

### D48. M2 closed on the exit gate and the author's pass — 2026-09-28

- **Decision:** close the M2 milestone on the exit gate (D47: the suggestion beats a centre router on three test homes, and every search finishes within the 10 s budget) and the author's own pass through the M2 features ([notes](usability/2026-09-28-m2-functional-pass.md)). Tag the result as v0.2.0. The first-time-user test (#77) moves to M3 and, as D39 says, must happen before any launch post.
- **Why:** your choice. The gate's measurable parts are met, and your pass found nothing to fix. As with M1, an author can't see where a newcomer gets stuck, and the optimizer adds new things to find and understand, so the stranger test stays a launch condition rather than being dropped.
- **Revisit if:** the first-time-user test finds that people miss the optimizer or misread its suggestions. Fix that before announcing anything.

## Phase 5

### D49. Multi-floor scope for M3 — 2026-09-28

- **Floor loss:** each floor has a construction built from P.2040 layers, like the walls. A path pays the loss of each slab it crosses, computed head-on as D30 does for walls, plus the 3D straight-line distance. The slab constructions and their layers need a primary source, and at least one check against a measured floor loss, before they're committed (#86). _Superseded in part by D60: a slab's loss now follows the path's angle, up to 75°._
- **Constructions:** a timber joist floor (subfloor, joist cavity, plasterboard ceiling) and a concrete slab. Precast hollow-core concrete and concrete on a steel deck are left out for now.
- **3D view:** view-only. Rotate, zoom and choose which floors show, with the heatmap on each. All editing stays in the 2D editor.
- **Shapes:** any number of flat floors stacked at set elevations, including basements (negative elevation). Split levels and sloped ceilings aren't supported, and MODEL.md will say so.
- **Issues:** floor constructions #86, cross-floor signal #87, floor list #88, ghosted floor below #89, stairwells and atriums #90, optimizer across floors #91, 3D view #92, exit gate #93. The first-time-user test #77 moved here from M2 (D48).
- **Why:** these were your choices. A slab built from P.2040 layers is sourced and computed the same way as walls, rather than a flat per-floor penalty that ignores what the floor is made of. Head-on loss keeps floors consistent with walls. A view-only 3D view keeps Phase 5 to a size OUTLINE's open question warned about. Basements are common in North American homes and cost nothing extra when floors are flat.
- **Revisit if:** the head-on slab loss clearly disagrees with measurements far off the vertical, people ask for split levels, or the 3D view turns out to be where people want to place access points.

### D50. Floor constructions and their losses — 2026-09-28

- **Decision:** two floor materials, `timber-joist` and `concrete-slab` (`FLOOR_MATERIALS` in the schema; plans got the optional `material` field with #87, D51, and the floor list #88 will let you pick it). Their losses are computed as for walls (P.2040-4 layers, head-on, averaged over each band) in `FLOOR_CONSTRUCTIONS` and `FLOOR_LOSS_DB`: 2.5 / 2.7 / 3.1 dB for timber joists and 11.5 / 20.2 / 22.8 dB for the slab at 2.4 / 5 / 6 GHz. A floor that doesn't say is `timber-joist` (your choice).
- **Timber joist floor:** 18.3 mm OSB subfloor (23/32 in, allowed for 16 or 24 in joists by IRC 2021 Table R503.2.1.1(1)), a joist cavity, and a 12.7 mm gypsum ceiling (IRC Table R702.3.5). The cavity makes the 2.4 GHz loss swing between 1.7 and 4.1 dB with joist depth, so the construction averages the transmitted power over 2×8, 2×10 and 2×12 cavities (184, 235 and 286 mm, PS 20-20 Table 3), standing for a typical floor rather than one exact floor (your choice). Joists themselves are left out, as studs are in walls.
- **Concrete slab:** 150 mm (your choice). No readable code source for a typical thickness was found, so it's justified by agreement with ITU-R P.1238-13's head-on measurement of a reinforced concrete floor at 5.2 GHz: 20 dB (σ 1.5), against the model's 19.4 dB. A unit test holds it within 3 dB (2σ). 200 mm, like the concrete wall, would be 25.4 dB. Reinforcing steel and false ceilings aren't modelled.
- **Checks:** only the slab is tested against a measurement (your choice). P.1238-13 Table 5's floor factors (house 5 / 7 dB, apartment 10 / 13 dB at 2.4 / 5.2 GHz) belong to its site-general model, so they're shown in MODEL.md but not tested; the timber floor is 2–4 dB under the house values. _Corrected in D58: they belong to P.1238-13's eq. (2), not to its site-general model._
- **Why:** the same method and material data as the walls keep floors and walls consistent, and every layer thickness has a code or standard source except the slab, which is pinned to the one head-on measurement found.
- **Revisit if:** a head-on measurement of a timber joist floor at 2.4–6 GHz turns up, or #87's two-storey results look clearly wrong against real homes. _D60 charges these losses by the path's angle; the head-on values above are its 0° values._

### D51. Signal between floors — 2026-09-28

- **Decision:** the coverage of each floor counts access points on every floor. A path from another floor is one straight 3D line, from the access point (its floor's elevation plus its mounting height) to a receiver 1 m above the cell's floor. It pays the 3D distance, the head-on loss of every slab it crosses (D49, D50), and the walls of each storey along the stretch of the path inside that storey, including storeys in between (your choice). A stretch runs from the floor's surface to its ceiling, or to the next floor's surface if that's lower. Floors are stacked by elevation, ties in plan order.
- **Slabs:** each floor gets an optional `material` (`timber-joist` or `concrete-slab`; no `schemaVersion` bump), its slab: the floor under its rooms. A path pays the slab of each floor above its lower end up to its upper end's floor, so the lowest floor's slab is never crossed. Every slab covers the whole plan (your choice), including outside a smaller upper floor, where the roof or ceiling below would be; stairwells (#90) will cut holes. _Stairwells and atriums now cut holes in slabs: see D54._
- **Grid:** a floor with no walls yet reaches 5 m around access points on other floors too, so a new floor shows what already reaches it (your choice). Once it has walls, its grid follows them as before.
- **Optimizer:** unchanged for now; it still ignores other floors, and #91 extends it (your choice). The editor shows one floor until the floor list (#88), so nothing on screen can disagree yet. _Superseded in part by D52: the optimizer now counts other floors' access points as fixed signal._
- **Checks:** hand-worked cases (3D distance and one slab; straight up pays only the slab; walls on each floor only along their stretch; a basement path crossing a concrete ground floor and a timber upper floor, both ways; plan order doesn't matter). Property tests: more floors between never raise the signal on plans without walls, loss is the same both ways along a path, and a wall on either floor never raises the signal upstairs. With walls, more floors between can raise the signal: a steeper path spends less of its length in each storey and may pass fewer walls there. That follows from the geometry, so the property is stated for plans without walls, and MODEL.md says so.
- **Speed:** the stretches depend only on the two heights, so each access point works them out once per floor, and a cell adds one wall check per storey. A 300 m² two-storey house (two 150 m² floors of 25 rooms, one access point on each) takes about 20 ms per floor on the development machine and 31 ms on the CI runner, within the 50 ms large-home budget (D29); `pnpm speed` checks both floors on CI. Single-floor timings are unchanged.
- **Why:** splitting the path by storey is what the signal physically passes, and costs little. Counting only the end floors would skip the walls of a storey in between, and counting each end floor's walls along the whole path would charge a ground-floor wall that the path passes above. Covering the whole plan with each slab keeps the model from being too optimistic outside a smaller upper floor, where it otherwise has nothing to cross.
- **Revisit if:** two-storey results disagree clearly with measurements, especially steep paths, where head-on slab loss is optimistic (D49); or people build partial upper floors and find the slab outside them too pessimistic.

### D52. The floor list — 2026-09-28

- **Switching:** the floors show as a stack in the canvas's bottom-left corner, top floor at the top, with "+ Floor above" and "+ Floor below" (your choice). Picking a floor shows it; PageUp and PageDown move up and down the stack. Switching isn't an edit, so it isn't undone. It clears the selection, ends a wall chain, leaves calibration, and stops a search or drops a suggestion ("the floor changed"). The camera stays, so floors line up. A plan opens on its first floor.
- **Order and elevation:** elevation sets the order (your choice). The stack is always sorted by elevation, which the panel lets you type, negative for a basement. A floor added above sits on its own slab over the top floor's ceiling; one added below sits under the bottom floor's slab. Both copy their neighbour's height. Slab thickness is the construction's real thickness from D50: 0.266 m for timber joists (the 2×10 variant) and 0.15 m for the concrete slab. Move up and Move down swap a floor with its neighbour: the lower of the two keeps the lower elevation and the gap between them stays, so the pair spans the same heights and no other floor moves.
- **New floors** are empty (your choice), named "Upper floor" or "Basement" (then "… 2"). The ghosted floor below (#89) is for tracing.
- **Panel:** with nothing selected, a Floor section for the floor on show: name, elevation, floor-to-ceiling height (1.5–10 m), construction, Move up, Move down and Delete floor. The construction hint says which floor the slab separates it from, or that nothing is below the lowest floor, so its construction doesn't change the signal. Elevations run from −30 to 300 m.
- **Delete:** no dialog (your choice). It removes the floor with its walls, openings, access points and tracing image as one undo step, and the status bar says "Deleted … and everything on it. Undo brings it back." The last floor can't be deleted. After a floor disappears (delete, or undoing its addition) the editor shows the remaining floor nearest it in elevation.
- **Heatmap and summary:** the heatmap shows when an access point on any floor broadcasts on the band (D51). On a floor without one of its own, the notice says "The heatmap shows signal from other floors." With more than one floor, the coverage summary names the floor ("Upstairs: 86% of …", your choice). A coverage result for another floor than the one on show is held back, so switching never draws one floor's heatmap under another's walls. PNG export already follows the floor on show and names it.
- **Optimizer:** access points on other floors now count as fixed signal in the scorer, computed as in the heatmap, so the panel's before → after figures match the status bar on multi-floor plans (your choice, taking this part of #91 early). It still only moves and adds access points on the floor on show, and only scores that floor. _Superseded by D55: the optimizer scores the whole home and moves access points on every floor; switching floors no longer stops a search or drops a suggestion._
- **Why:** these were your choices. A stack in the canvas corner is always visible, also on phones, and reads like the building. Letting elevation set the order means there is one truth for the engine and the list, and real slab thicknesses give sensible elevations without typing. Undo makes a dialog unnecessary, as for every other edit.
- **Revisit if:** people lose track of which floor they're on, the stack gets in the way of drawing near the corner, or they want floors added between two others.

### D53. The ghosted floor below — 2026-09-28

- **Decision:** while a floor is on show, the floor directly below it is drawn faintly under its walls and above the heatmap, at 55% opacity in the muted text colour rather than the material colours: walls as thin lines, doors and windows dashed, and its access points as dashed circles labelled "… (below)" (your choice). None of it can be selected. Nothing shows on the lowest floor (your choice); to trace a basement, draw it and view the floor above.
- **Toggle:** a "Show floor below" checkbox at the bottom of the floor stack, on by default and only shown when there is a floor below (your choice). Like the Heatmap setting it isn't saved and resets on reload. Exported images never include the ghost.
- **Snapping:** the ghost's corners and then points on its walls snap, after this floor's own corners and walls and before the 15° step and the grid (your choice). The snap marker is dashed on the floor below. Alt still turns off all snapping, and dragged corners snap the same way. A wall snapped to a corner below gets its own new corner; floors don't share corners.
- **Why:** these were your choices. Walls stack on walls in most homes, so exact snapping to the floor below makes outer walls line up without measuring, which also keeps cross-floor paths (D51) consistent. A single neutral colour keeps the ghost from being read as this floor's walls, and showing the access points below helps put a mesh node over the router.
- **Revisit if:** people draw on the ghost by mistake thinking it's this floor, snapping to the floor below gets in the way of drawing interior walls, or they want the floor above too.

### D54. Stairwells and atriums — 2026-09-28

- **Decision:** a floor can have openings in its slab (`floorOpenings`, optional, no `schemaVersion` bump): polygons of three or more corners (your choice). A path between two floors skips a slab's loss when it passes through one of that slab's openings at the slab's middle height, halfway between the ceiling below and the floor's surface. Everything else in D51 stays: one straight 3D line, each storey's walls along its own stretch.
- **Which floor:** an opening belongs to the floor whose slab has the hole, the upper of the two, where the stairs arrive, and is drawn there over the ghosted floor below (your choice). It spares only that slab. The Floor opening tool is unavailable on the lowest floor, whose slab no path crosses; its toolbar button is greyed out, with a tooltip saying why. An opening that ends up on the lowest floor (after floors are moved or deleted) stays and only leaves its area out.
- **Floor area:** cells whose centre lies in an opening aren't floor (your choice), so the coverage summary leaves them out and the optimizer never suggests an access point there. The heatmap is still drawn over them.
- **Editor:** a Floor opening tool (O, "Opening" in the toolbar), after Window (your choice). Click corners, snapping as the Wall tool does (corners, walls, the floor below, 15° steps, the grid; Alt places freely); click the first corner, double-click or press Enter to close; Esc drops the outline; undo steps back one corner while drawing. The outline becomes one undo step when it closes. Openings are drawn hatched with a solid edge, and with the Select tool they can be selected (inside or by the edge, after walls), dragged whole in grid steps (freely with Alt), reshaped by dragging a corner of a selected opening (corners snap like wall corners), nudged with the arrow keys and deleted, all with undo. A corner can't be moved so that the opening loses its area, and outlines under 0.01 m² aren't added.
- **Checks:** hand-worked cases: straight up and straight down through a stairwell pay only the distance; on a slanted path, an opening where the path meets the slab's middle spares it, and one under the receiver doesn't; with three storeys only the holed slab is spared; an opening on the lowest floor changes nothing. Property tests: an opening never lowers the signal on either floor, and loss stays the same both ways along a path with openings. The two-storey speed plan now has a stairwell and still takes about 20 ms per floor.
- **Why:** these were your choices. Polygons cover L-shaped atriums as well as rectangular stairwells, and drawing them corner by corner works like drawing walls. Putting the opening on the floor with the hole matches the slab model of D51, where a floor's `material` is the slab under it, and tracing it over the ghosted floor below lines it up with the stairs. Testing at the slab's middle height keeps the path straight, as elsewhere in the model, and gives the same answer in both directions.
- **Revisit if:** people expect signal to reach round the edge of a stairwell (diffraction isn't modelled), want openings shared between several floors of a tall atrium without drawing each one, or find a whole-cell floor area too coarse for small openings.

### D55. The optimizer across floors — 2026-09-28

- **Objective:** the share of the whole home at the target: every floor's floor area together, so each floor counts by its area (your choice). A floor without a closed outline adds nothing. On a single-floor plan nothing changes. Texts say "of the home" when a plan has several floors, "of the floor" otherwise.
- **Where access points go:** an existing access point only moves within its own floor; added ones may go on any floor, whichever scores best (your choice). The lattice covers every floor, and annealing may jump an added one to another floor. A moving access point on a floor with no floor area stays where it is.
- **What moves:** with nothing selected, every unlocked access point that broadcasts on the band, on any floor, moves together (your choice). A selected access point still moves alone, and locked ones stay put and count. "Suggest one more" and "How many" are available whenever the plan has an access point, and a new one copies an access point on the floor on show if there is one, else the first on the band. "Find the best spot" adds one only when the plan has none, and it goes wherever it helps most.
- **Display:** a search or suggestion covers the whole home, so switching floors keeps it (your choice). Each floor shows its own suggested spots and its preview heatmap, and the floor stack marks floors with suggested spots (◌, "suggested spots" for screen readers). The panel gives the whole-home before → after, with one line per floor from the top down ("Upstairs: 0% → 94%"), and each spot names its floor. Apply is still one undo step; it selects what moved or was added on the floor on show.
- **Engine:** positions are `Spot`s (a point and a floor id). The scorer holds every floor's cells, works out signal to other floors as `evaluateCoverage` does (D51), and reports each floor's share, so every result carries `floors` with each floor's before and after. `PlacementProblem` no longer names a floor.
- **Speed:** the two-storey house (two 150 m² floors, a stairwell, scored over both) is in `optimizer.speed.ts`: 1.8 s for the best spot, 4.2 s for one more and 7.1 s for how many for 100% at Excellent on the development machine, within the 10 s budget. It has as many cells and lattice spots as the 300 m² big house, whose times are unchanged. On CI in the runs for #100 and #101, where the runner was about 1.8× the desktop (the big house's how-many took 10.2–10.4 s against 7.4 s for #84), it took 3.3 / 7.5 / 12.7 s and then 13.0 s for how many: under the 15 s CI limit, with little room.
- **Checks:** hand-worked cases on two 4 × 4 m rooms, one over the other across a concrete slab, where each floor needs its own access point: the scorer counts both floors by area and per floor; a moving access point stays on its floor; a new one goes upstairs when the router covers downstairs; one more goes upstairs while the router stays down; how many adds exactly one; access points on both floors move together; one on a floor with no outline stays put. An e2e test runs "Suggest one more" on a two-storey sample home, switches floors, and applies.
- **Why:** these were your choices. Scoring the whole home is what people want to know ("is my house covered?"), and a router move is judged by everything it changes. Keeping existing access points on their floor matches how routers are placed, where the line comes in, and keeps the search the same size; added ones choosing their floor is what makes "one more" useful in a two-storey home. Keeping the suggestion across floor switches lets people check each floor before applying.
- **Revisit if:** people want to leave floors out (a garage, an unfinished basement), want an existing access point moved to another floor, a three-storey home pushes how-many past the 10 s budget, or the two-storey speed check starts failing on CI.

### D56. Walls sorted by direction from each access point — 2026-09-28

- **Decision:** before a coverage grid or an optimizer signal is filled for an access point, each floor's wall segments are sorted into 256 sectors of direction as seen from it, and each cell tests only the segments in its ray's sector. It applies on the access point's own floor and to each storey's stretch of a path between floors, since every stretch lies on a ray from the access point. I recommended speeding up the search before #92 after D55 left little CI headroom, and you asked me to carry on with the next step.
- **Same results:** a segment is listed in every sector its angle range touches, plus one each side, with its ends stretched by the crossing slack (1 µm); segments within 0.1 mm of the access point are in every sector; paths shorter than 1 nm test every segment, because the crossing arithmetic overflows for subnormal lengths (a case fast-check found). Segments are tested in the same order as before, so totals are identical, not just close. A property test compares it with testing every segment over 5,000 random layouts, including paths from wall corners and points on walls and stretches that start partway along the ray; a one-off run of 600,000 more cases found no difference. The existing tests that the grid matches `predictDbm` bit for bit, and the scorer matches the coverage summary, still pass.
- **Speed:** on the development machine the optimizer's searches take about half as long (two-storey how-many 7.1 → 3.6 s, big house 5.6 → 2.6 s) and the grid too on large homes (big house 28 → 11.5 ms, each floor of the two-storey house 20 → 8.7 ms). That restores CI headroom after the runner slowed to about 1.8× the desktop (D55): on CI, in the run for #103, the two-storey how-many took 6.4 s (13.0 s before) and the big-house grid 22 ms (50 ms before).
- **Why:** profiling showed 83% of the search time in the wall test, and paths between floors do it once per storey. Sorting by direction uses the one thing every path from an access point shares, its origin, keeps the arithmetic untouched, and costs a few thousand list entries per access point against millions of cell tests. A general spatial grid would help every path but change the order of hits for no gain here.
- **Revisit if:** plans with far more walls make the per-access-point sorting cost noticeable, or paths that don't start at an access point (reflections, Phase 6) need a different index.

### D57. The 3D view — 2026-09-28

- **Opening:** a 2D | 3D switch in the top bar, next to the bands; 3D replaces the canvas (your choice). It's view only (D49): the tools are greyed out ("Switch to 2D to edit") and their shortcuts and Delete do nothing, while undo, redo, the band, units, coverage target and Heatmap setting still work. Switching ends a wall chain, floor opening outline or calibration in progress, isn't an undo step, and returns to the same floor and camera. The status bar's 2D zoom buttons are hidden in 3D, which has its own.
- **Walls:** cut away at 1 m (never above the ceiling) in their material colours, so each floor's heatmap shows, with a "Full-height walls" checkbox (your choice). Glass is see-through. Doorways without a door leave a gap, as in 2D.
- **Floors:** a checkbox per floor, all on, and a "Spread floors apart" slider (0–6 m) that lifts each floor by that much per floor below it, hidden ones included, so hiding a floor never moves the others (your choice). Floors above the lowest get a faint slab plate over their extent with floor openings cut out. None of these settings is saved.
- **Heatmap:** each floor shows its coverage for the band on show, worked out floor by floor in its own worker while the view is open, including a waiting suggestion's preview. Inside the walls cells take their quality colour, or grey with no signal; outside and in floor openings they're clear, so each floor reads as its shape. A floor with no closed outline shows its whole grid, fainter. The Heatmap setting turns them off.
- **Access points:** white markers at their floor's elevation plus mounting height, on a thin stand, with name labels that keep about 13 px on screen and show through floors.
- **Camera:** three.js `OrbitControls` (drag to rotate, scroll or pinch to zoom, right-drag or two fingers to move), kept above the ground. Buttons rotate and tilt by 15°, zoom and reset, so it works from the keyboard. It frames the drawn floors from the front, above and to the right, further back in portrait, and reframes only when what's drawn changes shape. It draws only when something changes.
- **Library:** plain three.js (your choice), in `view3d/View3D.tsx`, the only module importing it and loaded with `React.lazy` when the view first opens: a 149 kB gzipped chunk. The initial load went from 144 to 148 kB gzipped for the switch, panel section and hook. Without WebGL, the view says so. Layout maths (stacking, wall boxes, heatmap pixels, markers, bounds) is in `layout.ts` without three.js and unit-tested.
- **Accessibility:** the view is an image described by a visually hidden list: for each floor shown, top first, its name, elevation, walls, access points and coverage summary. The camera buttons have labels.
- **Frame rate:** measured by rotating a step on every animation frame for 180 frames, with both sample floors, full-height walls and a 3 m spread, in Chromium drawing in software (SwiftShader, no GPU): frames came every 16.6 ms at the median and 18.2 ms at the 95th percentile, so 60 fps with no GPU at all. An e2e test checks each drag step draws a frame and the median drawing work stays under 8 ms; it checks the median because other tests share the CPU.
- **Why:** these were your choices. A switch keeps one place to look at the plan and keeps the panel's settings in reach; cut-away walls and spreading floors apart are the usual ways to see into a building; plain three.js is one dependency with direct control, and loading it lazily keeps the 2D editor as fast as before.
- **Revisit if:** people try to edit in 3D (D49's revisit), labels overlap badly in large homes, or phones struggle with bigger plans.

### D58. M3 exit gate: one router in a two-storey home — 2026-09-28

- **Fixture:** `two-storey-home.json`, the sample bungalow with a 150 m² upper floor over a timber joist floor at 2.666 m (your choice): two bedrooms, bathroom, laundry, a landing with a 1 × 3 m stairwell, and a primary bedroom with ensuite, drywall inside brick outer walls with low-E windows. The router stays downstairs by the front door.
- **"Sensible" against ITU-R P.1238-13 (your choice):** P.1238-13 has no single cross-floor model for a house at 2.4 or 5 GHz. Its site-general eq. (1) is for both ends on one floor, and its floor factors (Table 5) belong to eq. (2), whose distance coefficient isn't given in these bands. So the reference combines eq. (1) with Table 2's office NLoS coefficients (α 2.39, β 30.13, γ 2.40, σ 5.01 dB) and Table 5's house factor upstairs (5 dB at 2.4 GHz, 7 dB at 5.2 GHz). Each floor's median gap, over cells 4–30 m from the router, must be within 2σ, 10 dB (your choice). The gaps are +0.7 / −2.3 dB on 2.4 GHz and −0.8 / −5.5 dB on 5 GHz (main / upper). The upper floor on 5 GHz is optimistic by just over 1σ, 4.3 dB of it the timber floor (2.7 dB, D50) against the house factor (7 dB); nothing in the model changed, and MODEL.md says so. A snapshot records the four gaps. _Since D60 (slabs by angle) the upper floor's gaps are −0.7 dB on 2.4 GHz and −3.4 dB on 5 GHz; the main floor's are unchanged._
- **Coverage:** the router must reach Fair on at least 85% of each floor on 2.4 GHz (your choice). It reaches 93.4% and 100% (86.9% and 100% on 5 GHz).
- **Correction:** MODEL.md and D50 said P.1238-13's floor factors belonged to its site-general model, and MODEL.md that P.1238 advises office values for homes in eq. (1). Reading the recommendation again for this gate showed both were wrong: the factors belong to eq. (2), and the office advice is for eq. (2)'s power loss coefficient. Both are corrected; neither changed a number in the model.
- **Frame rate:** with `?fps` in the address, the 3D view shows a "Measure frame rate" button that rotates a step on each of 180 frames and reports the median and 95th percentile frame time. In software rendering (no GPU) on the development machine it gave 16.6 / 18.2 ms. On your laptop (Lenovo ThinkPad T16 Gen 4, Intel Core Ultra 7 265U, 32 GB RAM, Windows, Chrome) it gave 16.7 ms median (60 fps, the display's refresh rate) and 16.9 ms at the 95th percentile, and it felt responsive even when flicking the view around quickly. That meets the exit gate's "runs smoothly on a laptop".
- **MODEL.md:** a "Floors and their limits" section: flat floors only (no split levels or sloped ceilings), whole-plan slabs, head-on slab loss, no paths around floors, and the timber floor against P.1238's house factor.
- **Why:** these were your choices. The sample home keeps the numbers familiar; P.1238 is the only primary source with a floor factor for houses in these bands, and combining its two parts, stated as such, is closer to a sourced check than hand-worked cases alone; 2σ passes what the model does today while failing a floor model that makes upstairs dark or bright by more than P.1238's spread allows.
- **Revisit if:** a head-on or in-situ measurement of a timber floor turns up (D50), the upper-floor gap grows past 2σ after a model change, or people find upstairs predictions too optimistic in real homes.

### D59. M3 closed on the exit gate and the author's pass — 2026-09-28

- **Decision:** close the M3 milestone on the exit gate (D58: one router gives sensible coverage on both floors of the two-storey sample home, within 2σ of ITU-R P.1238-13, and the 3D view runs at 60 fps on a laptop) and the author's own pass through the M3 features ([notes](usability/2026-09-28-m3-functional-pass.md)). Tag the result as v0.3.0. The first-time-user test (#77) moves to M4 and, as D39 and D48 say, must happen before any launch post (your choice).
- **Why:** your choice. The gate's measurable parts are met and your pass found nothing to fix. An author's use shows the features work, not where a newcomer gets stuck, and M3 adds floors, openings and a 3D view for newcomers to find, so the stranger test stays a launch condition.
- **Revisit if:** the first-time-user test finds that people miss the floor stack or the 3D switch, or misread cross-floor coverage. Fix that before announcing anything.

### D60. Slab loss follows the path's angle — 2026-09-28

- **Decision:** a path between floors pays each slab's loss at the angle it meets the slab, θ = atan(distance across the plan / rise), instead of head-on (D49, D50). The loss comes from the same P.2040-4 multi-layer method as before, with TE and TM averaged over each band and, for the timber floor, over its three joist depths. It stops growing at 75° from the vertical, and a flatter path pays the 75° loss. Walls stay head-on (D30). Each floor's loss is tabulated every 0.5° up to 75°, built the first time that floor and band are needed, and interpolated, within 0.06 dB of the exact value. Closes #108.
- **Why:** you asked whether the upstairs optimism in the M3 gate (D58: −2.3 / −5.5 dB on 2.4 / 5 GHz) could be fixed. Most of it came from the head-on slab: paths to the floor above rise about 2.7 m over several metres across, so most meet the slab at a shallow angle (10 m across is 75°), where the timber floor loses 5.4 / 6.6 dB rather than 2.5 / 2.7 dB. D30's reason for keeping walls head-on doesn't carry over: walls are met at every angle and angles moved them by at most 0.5 dB in the median, while floors are mostly met at shallow ones. This uses the calculation already in `slab.ts` and adds no fitted numbers (your choice over also fitting the timber floor to P.1238's house factor, or fitting only).
- **Cap (your choice):** 75°, the top of the 60–75° range D30 suggested for walls. Past about 80°, loss climbs steeply towards grazing, where real signal takes other routes (stairwells, windows, the slab's edge) that one straight path can't show. The gate's median gaps are the same for any cap from 75° up; a 60° cap would have left −1.4 / −4.0 dB.
- **Result:** the exit gate's upper-floor gaps are −0.7 dB on 2.4 GHz and −3.4 dB on 5 GHz, and the main floor's are unchanged (+0.7 / −0.8 dB). The Fair coverage shares in D58 are unchanged. Per-floor grids in the two-storey speed plan went from 8.7 to 9.6 ms on the desktop, and its how-many search from 3.6 to 3.9 s, both well within budget.
- **The remaining 3.4 dB on 5 GHz (your choice: search for a measurement first, then accept and document):** no usable measurement of a wood-frame floor at 2.4 or 5 GHz was found. ITU-R Report P.2346-1's wood-frame house study at 5.2 GHz measures the loss out of the house (about 18 dB), not through a floor; its UK house data are broadcast signals entering from outside. Kodra et al. (URSI AT-RASC 2024) measured concrete university floors at 7.5–14.5 GHz, and Niedźwiecki et al. (MIKON 2024) at 18–30 GHz. Chrysikos et al. (WTS 2011, a home at 2.4 GHz with a multi-wall-and-floor model) is paywalled and wasn't read. Raghavan et al. (Qualcomm, arXiv 1709.05590) report a 4.7 dB median for OSB sheathing at 2.5–3.5 GHz, which hints that P.2040's chipboard may be light for OSB, but the thickness isn't given and the median is over angles and polarisations, so nothing was fitted to it. The likely causes left are the joists (a shallow path through a 235 mm cavity runs about 0.9 m along it) and the reference itself, which joins two parts of P.1238.
- **Property:** adding a floor between is no longer guaranteed never to raise the signal on a plan with no walls, because a steeper path makes every other slab a little cheaper. The property test still holds (100 cases in CI; 9,000 more across three seeds when this was checked), and MODEL.md now says it's checked rather than guaranteed.
- **Revisit if:** a measured timber or OSB floor at 2–7 GHz turns up (check it at the angles it was measured at), people find upstairs predictions off in real homes, or the property test finds a case where a floor between raises the signal.

### D61. Scope for Phase 6: overlap, roaming and channel planning — 2026-09-28

- **Channels:** a versioned data file lists the channels for each region and band, with centre frequency, allowed widths and whether each is DFS, and every row is sourced to the regulator's table. It starts with the US (FCC Part 15) and the EU (ETSI). A region is an optional plan field, and a new plan's region is guessed from the browser language. Adding a region means editing the data file, not code (#110).
- **DFS:** an "Allow DFS channels" checkbox, saved with the plan and off by default, with a two-line explanation: you get more channels, but the router waits before using one and must leave it if it hears radar. When DFS is off and it's the reason a plan can't avoid same-channel neighbours, the planner says so (#110, #115).
- **Channel and width:** optional `channel` and `channelWidthMHz` on each radio (#111). Omitted means the planner chooses. A channel set by hand is fixed for the planner, the way a locked AP is fixed for the optimizer (D43).
- **Neighbours' networks:** typed in by hand as band, channel, width and a rough strength, and treated as flat background interference with no position (#114). Importing from a phone scan waits for Phase 7, which decides how readings get imported.
- **Views:** a view menu next to the band choice: Signal, Overlap, Roaming, Interference. Each has its own legend, and the status bar summary, PNG export and 3D view follow the chosen view. The view isn't saved. Neither is the band today, although the question put to you said it was. Overlap and roaming come in #112, interference in #113.
- **Thresholds:** the overlap margin and roaming threshold get defaults from primary sources, each checked against its primary source before it goes in. An Advanced section lets you change them, and they're saved with the plan so a shared plan shows the same views (#112).
- **Interference:** SINR in dB: the strongest AP's signal over same-channel APs, neighbours' networks and thermal noise for the channel width, with a sourced receiver noise figure (#113).
- **Channel plan:** graph colouring per band. Two APs are neighbours when either receives the other above the 802.11 clear-channel-assessment level for its width, counting walls and floors. The search is exact on small homes, so a plan with no same-channel neighbours is found whenever one exists; otherwise it gives the least-bad plan and says so. It's shown as suggest-then-Apply with a one-line reason per radio, like the optimizer (D44), and Apply is one undo step (#115).
- **Schema:** every new field is optional, so there's no `schemaVersion` bump.
- **Issues (label `phase-6`, milestone M4), in order:** channels by region #110 → channel and width per radio #111 → view menu with overlap and roaming #112 → SINR and the interference view #113 → neighbours' networks #114 → channel planner #115 → exit gate #116. The first-time-user test #77 stays in M4 and still comes before any launch post.
- **Why:** these were your choices (the recommended option on all eight questions). A data file keeps the regulator rules out of code and lets them change with the rules. DFS off by default is the cautious choice, since not every router supports it, and the explanation covers the case where it matters. The hear-each-other rule for neighbours is the one that reflects APs taking turns on the air, rather than just sharing coverage. SINR is what limits the data rate, and unlike signal-to-interference alone it shows what a wider channel costs in noise. Adjustable, saved thresholds cover the difference between how phones and laptops roam without making the defaults unsourced.
- **Revisit if:** people ask for regions beyond the US and EU, a CCA-based neighbour graph clearly disagrees with what routers do (for example with OBSS/BSS colouring on Wi-Fi 6), exact search gets too slow for the homes people draw, or Phase 7 settles an import format that neighbours' networks could reuse.

### D62. Channels by region — 2026-09-28

- **Decision:** channels and power limits per region and band live in `packages/engine/src/regions.json` (US and EU), read by `regions.ts`. Channel numbers follow the IEEE 802.11 grid, a channel spans its centre ± half its width, and a channel needs DFS only if its span overlaps a DFS range (touching the edge doesn't count). Plans get optional `region` (omitted means US, so older plans are unchanged) and `allowDfs` (omitted means off). New plans and the sample take their region from the browser's first language, with its most likely country when it names none (`de` is Germany): an EU country gives EU, anything else US. The panel, with nothing selected, has a Channels section with the region, a note that only US and EU rules exist so far, and "Allow DFS channels" with a one-line explanation. Both are undoable edits. The power note now uses the region's limit ("Above the legal limit in the EU. …"). Widths are 20 and 40 MHz on 2.4 GHz, and 20–160 MHz on 5 and 6 GHz. Closes #110.
- **Sources:** every range, DFS rule, limit and channel list was checked against FCC Part 15, ETSI EN 300 328 / 301 893 / 303 687, EU Decisions 2021/1067 (as replaced by 2025/913) and 2022/179, and IEEE 802.11-2020 Annex E. MODEL.md lists each source. Each claim was checked separately against its primary source.
- **What the checks changed:** the US 5 GHz note names channels rather than U-NII bands, because the CFR doesn't define the U-NII names. The EU 2.4 GHz note adds the 10 dBm/MHz density limit.
- **Your choices on what the checks found:**
  - US 2.4 GHz stays at channels 1–11. No primary source says 1–11 only: § 15.247 allows the whole band, and the FCC says 12 and 13 need reduced power at the band edge. SignalPlan has no per-channel power limits, so they're left out and MODEL.md says why.
  - 20 MHz channels 32, 68 and 96 stay out of both regions, as does 6 GHz channel 2. EN 301 893 allows the first three in the EU, but all of them are 20 MHz-only edge channels, like the U-NII-4 channels you chose to leave out.
  - 320 MHz is dropped for now. Its channel numbers appear only in IEEE working-group drafts. The 6 GHz 40–160 MHz channels also come from working-group text (P802.11ax D6.0), not the published 802.11ax, and MODEL.md says so.
- **Also your choices:** EIRP limits follow the region in this issue; U-NII-4 and the EU's 5.8 GHz band are left out; a browser outside the US and EU gets US rules with a note.
- **Why:** a data file keeps regulator rules out of code (D61), and a unit test checks every channel against its region's ranges, so an edit to the file can't slip in a channel that doesn't fit.
- **Revisit if:** a primary source for 320 MHz channel numbers turns up (IEEE 802.11be-2024), people ask for channels 12–13 or the edge channels, the EU opens 6425–7125 MHz, or the 6 GHz default EIRP should follow the region (it's 5 dB below the EU's 20 MHz limit).

### D63. Channel and width per radio — 2026-09-28

- **Decision:** each radio gets optional `channel` and `channelWidthMHz` (no `schemaVersion` bump). A channel needs a width, and the schema rejects one without it; a width alone is allowed and means "this width, any channel". Omitted means the channel planner (#115) chooses, and a hand-set channel is fixed for it, like a locked access point for the optimizer (D43). In the access point panel each band has a Width menu (Auto plus the widths the region allows) and then a Channel menu (Auto plus the channels allowed at that width, marked DFS where they are; greyed out while the width is Auto). Channel numbers depend on the width, so changing the width sets the channel back to Auto. Each change is one undo step. When a new region or DFS being turned off rules out a hand-set width or channel, it's kept, not changed: its menu shows it as "not allowed" or "DFS, off", a note under the radio says why, and the plan's Channels section lists every such radio as a button that goes to its floor and selects it. `radioChannelIssue` in the engine decides this. An access point the optimizer adds copies the first one's width but not its channel. The canvas doesn't show channels yet. Closes #111.
- **Why:** these were your choices (the recommended option on all four questions). Width then channel keeps each menu short (6 GHz alone has 59 channels at 20 MHz) and matches how channel numbers work. Flagging instead of changing means a region switch never quietly edits someone's plan, and the list means a flagged radio on another floor isn't missed. Copying a channel to a new access point would put two on the same channel on purpose. The Overlap and Interference views (#112, #113) are where channels will show on the canvas.
- **Revisit if:** people want to set a channel without picking a width first, the channel list for a region gets long enough to need grouping, or the channel planner needs a way to fix a width without fixing the channel beyond what a width alone gives.

### D64. Overlap and roaming views — 2026-09-28

- **Decision:** a **Show** menu after the band buttons picks Signal, Overlap or Roaming. It isn't saved, like the band, and the Heatmap checkbox still turns whichever map is chosen on and off. (The top bar's existing "View" is the 2D | 3D switch, so the new menu is called Show.) The engine keeps each access point's signal per cell next to the strongest, so the views are worked out on the page without running the engine again. **Overlap** counts the access points within the overlap margin of the strongest and at or above the roaming threshold, shown as 1, 2 or 3+ on a light-to-dark blue ramp; cells with none usable are left clear. **Roaming** colours each cell by its strongest access point (Okabe–Ito colours, repeating after seven), draws switch lines where the strongest changes between neighbouring cells, and hatches gaps below the threshold in grey. Each map has its own legend and summary line. For Overlap and Roaming, the share with two or more competing, or in gaps, is rounded up so 0% only means none. The 3D view, its text description and the PNG export follow the map on show, and the export's file name names a map other than Signal. The defaults are a **−70 dBm** roaming threshold and an **8 dB** overlap margin. With nothing selected, a collapsible "Overlap and roaming" section changes them, saved as the optional plan fields `overlapMarginDb` (1–20 dB) and `roamThresholdDbm` (−90 to −50 dBm). Both are undoable edits. Closes #112.
- **Sources:** Apple, "Wi-Fi roaming support in Apple devices" (Apple Platform Deployment, published 2024-09-25). iPhone and iPad keep their access point until its signal passes −70 dBm (Macs −75 dBm), and move to a candidate 8 dB stronger while sending data (12 dB when idle; Macs always 12 dB). Each value was checked separately against the page and matched. MODEL.md says how SignalPlan simplifies them: the margin applies in every cell and whatever the device is doing, and the strongest access point stands in for the one a device is on.
- **Why:** these were your choices (the recommended option on all five questions). Phones are what people carry around a home, and Apple publishes its numbers where most vendors don't. Counting only usable access points keeps faint far corners from showing as overlap. Per-access-point colours show which one owns each area, which lines alone don't.
- **Revisit if:** a vendor-neutral source for roaming triggers turns up (for example in 802.11k/v/r guidance), people want Mac or idle defaults as a preset, homes with more than seven access points need distinct colours, or the Interference view (#113) needs the per-access-point signal in a different form.

# Propagation model

How SignalPlan predicts Wi-Fi signal strength, where every number comes from, and where the model is known to be wrong. The code is in [`packages/engine`](../packages/engine/src).

## The equation

The received signal strength at a point, in dBm, is

```math
P_{rx} = \mathrm{EIRP} - \left[ PL(d_0) + 10\,n\,\log_{10}\frac{d}{d_0} + \sum_i L_{wall,i} \right]
```

| Term     | Meaning                                                 | Value                                |
| -------- | ------------------------------------------------------- | ------------------------------------ |
| EIRP     | Radio's effective radiated power, antenna gain included | Per radio, or the band default below |
| PL(d₀)   | Free-space loss at the reference distance d₀ = 1 m      | From the band's midpoint frequency   |
| n        | Path loss exponent                                      | 2 (free space)                       |
| d        | Straight-line distance from access point to point       | Metres                               |
| L_wall,i | Loss of each wall the straight line crosses             | Material table below                 |

The receiver is assumed to have 0 dBi gain, which is typical of a phone.

Distance is measured in 3D, from the access point's mounting height to a receiver held **1 m above the floor**. Within 1 m of an access point the 1 m value is used, since the formula isn't meant for the near field.

## From equation to heatmap

The engine evaluates the equation at the centre of every cell in a regular grid covering the floor's walls and access points plus a 1 m margin (on a floor with no walls yet, 5 m around each access point). The default cell size is **10 cm**. For each cell it:

1. finds every wall segment on the straight line from each access point (`crossings.ts`; a corner or door edge counts once, using the lossier material),
2. computes the predicted signal from each access point with a radio in the selected band, and
3. keeps the **strongest** one, recording which access point it came from.

Access points on other floors count too (D51); see [Signal between floors](#signal-between-floors). A floor with no walls yet reaches 5 m around access points on other floors as well, so a new floor shows what already reaches it.

### Coverage summary

The editor reports the share of the **floor area** at or above a target level (D27). Floor area is the set of cells inside the outer walls (`floorArea.ts`): the outside is flooded in from the grid's edge, stepping between neighbouring cell centres, and a step that touches a wall is blocked. Cells the flood can't reach are inside. Doors and windows sit on walls, so they count as closed. The sample home measures exactly its stated 150 m². A cell whose centre lies exactly on a wall also counts as inside, so the area can run over by up to half a cell along such walls. Cells whose centre lies in an opening in the floor, such as a stairwell (D54), aren't floor: nobody stands there, so they're left out of the summary, and the optimizer never places an access point there. The heatmap is still drawn over them.

### Overlap and roaming

The heatmap can show three maps ([D64](DECISIONS.md#d64-overlap-and-roaming-views--2026-09-28)). **Signal** is the strongest access point's signal, as above. The other two work from each access point's own signal in every cell (`views.ts`), which the engine keeps alongside the strongest.

- **Overlap** counts the access points that compete for a device in a cell: those within the **overlap margin** of the strongest there (8 dB by default) and at or above the **roaming threshold** (−70 dBm by default). Cells where no access point reaches the threshold count 0 and are left uncoloured. The summary gives the share of the floor with two or more, rounded up, so 0% only ever means none.
- **Roaming** colours each cell by its strongest access point, if that one reaches the roaming threshold, and draws a line where the strongest changes. A gap, where none reaches the threshold, is hatched grey. The summary gives the share of the floor in gaps, rounded up.

Both defaults come from Apple's _Wi-Fi roaming support in Apple devices_ (Apple Platform Deployment guide, published 2024-09-25), checked against it on 2026-09-28. iPhone and iPad keep their access point until its signal passes −70 dBm (Macs: −75 dBm), and then move to a candidate 8 dB stronger while sending data (12 dB when idle, and always on a Mac). That's a rule for when a phone moves, not a definition of overlap: SignalPlan uses the 8 dB as a fixed margin in every cell, whether the device is sending data or not and before its signal has fallen to −70 dBm, and takes the strongest access point as the one a device is on, ignoring that a device stays on its current access point until the trigger. Both numbers can be changed per plan, and are saved with it.

### Placement optimizer

The placement optimizer (M2, D40 and D41) scores a layout with the same model and floor area as the coverage summary. The score is the share of floor-area cells whose strongest signal reaches the target. While searching, cells are 25 cm, and at that size the score matches the coverage summary exactly on the same grid. Candidate positions start on a 0.5 m lattice inside the outer walls, at least 10 cm from any wall, and the best are refined to 10 cm. Signals from access points that stay put are worked out once, and only cells inside the walls are evaluated. For one access point, the best 5 lattice spots are refined to 0.25 m and then 0.1 m steps, and the winner is picked on the 10 cm grid (D42). Ties in share go to the spot whose weakest cell is strongest. Backhaul between access points isn't modelled (D40), and the optimizer panel says so next to its results (D44).

**Across floors (D55).** On a plan with several floors the score is the share of the whole home: every floor's floor-area cells together, so each floor counts by its area. A floor without a closed outline adds no cells. Signal from an access point reaches its own floor through that floor's walls and the other floors as in [Signal between floors](#signal-between-floors), so moving the router downstairs changes the score upstairs too. Access points that move stay on their own floor; the lattice covers every floor, and an added access point may go on whichever floor scores best, jumping between floors during annealing. A moving access point on a floor with no floor area stays where it is. Each search also reports every floor's share before and after, which the panel lists under the whole-home figure.

For several access points (D45), added ones go in one at a time at the best lattice spot. A second start places every moving one that way, and the better of the two starts is refined. Refining is simulated annealing: 250 steps per access point, each moving one of them, usually by a random step whose length shrinks from 2 m to 10 cm, and one step in five jumps to a random lattice spot. A worse layout is accepted with probability exp(ΔE / T), where E counts covered cells plus 0.01 × the weakest spot in dBm, and T cools geometrically from 1% of the cells to 0.05. A fixed seed makes the result repeat. Each access point is then polished by pattern search at 0.25 m and 0.1 m, and the result is compared on 10 cm cells with both starts, so refining never lowers the score. Measured on the development machine: moving the sample home's router takes 0.37 s (92.0%, as the single search), and adding one more takes 0.5 s (86.9% → 100% at Fair on 5 GHz). On the 300 m² big house, moving both access points takes 3.3 s, and moving both while adding two takes 4.6 s, within the 10 s budget.

"How many access points do I need?" (D46) runs that search with 0, 1, 2 … added, up to 4, and stops at the first count whose share reaches the goal (80–100% of the floor, 90% by default). If the access points already reach it where they are, nothing moves. Each count also starts from the previous winner plus one added greedily, so one more never scores lower. The fewest added wins among equal shares, because one more always raises the weakest spot. The counts share the candidate signals and one 10 s budget. On the development machine the sample home takes 0.4–1.0 s and the 300 m² big house 3.3–5.6 s at Excellent. Past the budget it returns the best found and says so, without claiming the goal is out of reach.

**Exit gate (D47).** Three test homes are checked in as fixtures in `packages/floorplan/fixtures/`: the 150 m² brick sample bungalow, a 65 m² concrete apartment with a concrete spine wall, and a 220 m² L-shaped brick house with drywall rooms. Each has one router where the line comes in. The naive placement is the middle of the floor's bounding box, moved to the nearest allowed spot when it falls outside the walls or on one (the L-shape's middle is outside). At Good (−60 dBm) on 5 GHz, where a router in the middle falls short in every home, the single-AP search must cover a strictly larger share (`exitGate.test.ts`):

| Home                    | Router where it is | Router in the middle | Suggested spot |
| ----------------------- | ------------------ | -------------------- | -------------- |
| Sample home (150 m²)    | 86.8%              | 87.4%                | 90.5%          |
| Apartment (65 m²)       | 57.3%              | 72.1%                | 97.4%          |
| L-shaped house (220 m²) | 53.3%              | 75.6%                | 100%           |

The gain over the middle is small in the sample home, where brick and concrete walls leave about a tenth of the floor short of Good from any single spot. It is large where the middle sits behind a strong wall from much of the floor: in the apartment's living room, or at the L-shape's inner corner.

**Speed.** `pnpm speed` also runs `optimizer.speed.ts`: the best spot for the router, one more access point, and how many for 100% of the floor, at Excellent on 5 GHz, where every home needs more access points. The big house starts from its first access point only. Each search runs once with its 10 s cap lifted, so the real time is measured. The budget is 10 s on a desktop, and CI fails at 15 s (1.5×, as D26). On the development machine (i5-12600K), from 2026-09-28, with walls sorted by direction (D56):

| Plan                    | Best spot | One more | How many for 100% |
| ----------------------- | --------- | -------- | ----------------- |
| Sample home (150 m²)    | 0.25 s    | 0.36 s   | 0.73 s (2 more)   |
| Apartment (65 m²)       | 0.05 s    | 0.12 s   | 0.13 s (1 more)   |
| L-shaped house (220 m²) | 0.51 s    | 0.74 s   | 0.85 s (1 more)   |
| Big house (300 m²)      | 1.19 s    | 1.59 s   | 2.63 s (2 more)   |
| Two-storey house (D55)  | 1.00 s    | 2.25 s   | 3.86 s (2 more)   |

The two-storey house's are with slabs by angle (D60); before, it took 0.93 / 2.08 / 3.61 s. Before D56 they were 0.35 / 0.51 / 0.98 s, 0.06 / 0.12 / 0.14 s, 0.76 / 1.05 / 1.25 s, 2.59 / 3.34 / 5.57 s and 1.84 / 4.17 / 7.11 s.

The two-storey house is the coverage speed plan's (two 150 m² floors of 25 rooms over a timber joist floor, with a stairwell), scored over both floors from its router downstairs; its second access point is left out, so added ones may go on either floor. It has as many cells and lattice spots as the big house, and each signal also crosses a floor, so it is the slowest search.

On the CI runner (GitHub ubuntu-latest), in the run for #84: sample home 0.48 / 0.70 / 1.35 s, apartment 0.08 / 0.18 / 0.21 s, L-shaped house 1.03 / 1.45 / 1.70 s, and big house 3.46 / 4.50 / 7.39 s. That is about 1.35× the desktop, less than the grid's 1.8×, and the slowest search stays under the 10 s budget itself. The runner varies: in the runs for #100 and #101 it was about 1.8× the desktop (big house 4.81 / 6.19 / 10.18 s, two-storey house 3.32 / 7.54 / 12.70 s; then 10.37 s and 13.04 s for how many), so both how-many searches went past 10 s there, under the 15 s CI limit but with little room for the two-storey house. At that speed a real search stopped at 10 s and returned the best layout found so far, which led to D56. With walls sorted by direction (D56), the run for #103 took: sample home 0.49 / 0.69 / 1.37 s, apartment 0.10 / 0.22 / 0.25 s, L-shaped house 0.93 / 1.38 / 1.58 s, big house 2.12 / 2.88 / 4.70 s and two-storey house 1.64 / 3.73 / 6.41 s, all within the 10 s budget itself.

**Limits.** The optimizer finds good spots for this model, not guaranteed best ones, and inherits every limit of the model below.

- **One band.** It optimizes the band on show. A spot that is best on 5 GHz may not be best on 2.4 or 6 GHz.
- **Access points keep their floor.** An existing access point is never moved to another floor, even if that would score better (D55); only added ones choose their floor.
- **Every square metre counts the same.** There are no rooms or priorities (D40), so a hallway counts as much as an office.
- **No allowed or forbidden zones.** Apart from locked access points (D43), any spot inside the walls and 10 cm from them is allowed, including ones with no power socket or cable.
- **Backhaul is ignored.** Added access points are assumed to have a good link to the router (D40); a mesh node placed far away may in practice have a weak link.
- **A heuristic search.** The lattice, greedy starts and annealing can miss the best layout. The search compares its candidates on 25 cm cells and confirms only the winners on 10 cm cells, so close rankings can differ slightly.
- **Slower devices.** On a phone 4–6× slower than the desktop, the big house's how-many search would take 22–33 s, so it stops at 10 s with the best layout found so far, and says so.
- **At most 4 added** by "How many access points do I need?" (D46).

### Speed

The Phase 2 budget is a 100 m² floor at 10 cm cells in under 200 ms. Large homes have a tighter one, set for dragging on phones: 200 ms on a device 4× slower than the desktop, so 50 ms here (D29). `pnpm speed` (`packages/engine/src/coverage.speed.ts`) times each band 30 times after 5 warm-up runs, on four plans:

- the sample home;
- a deliberately busy "room grid" of 25 rooms, each 2 m square, in 10 × 10 m, with 60 walls, a door or window in every wall and 2 access points;
- a "big house" of 25 rooms, each 4 × 3 m, in 20 × 15 m, laid out the same way;
- a two-storey house (D51): two floors of 25 rooms, each 3 × 2 m, in 15 × 10 m, laid out the same way, with a timber joist floor between, a 1 × 3 m stairwell through it (D54), the router downstairs and one access point upstairs. It's 300 m² in all, so it has the big house's budget, and each floor is timed with both access points, one of them through the floor.

Median on 5 GHz, from 2026-09-28, with walls sorted by direction (D56); CI from the run for #103:

| Plan                            | Grid   | Budget | Desktop (i5-12600K) | CI runner (GitHub ubuntu-latest) |
| ------------------------------- | ------ | ------ | ------------------- | -------------------------------- |
| Sample home (22 walls, 1 AP)    | 204 m² | 200 ms | 2.4 ms              | 4.8 ms                           |
| Room grid (60 walls, 2 APs)     | 144 m² | 200 ms | 4.8 ms              | 9.3 ms                           |
| Big house (300 m², 60 walls, 2) | 374 m² | 50 ms  | 11.5 ms             | 22 ms                            |
| Two-storey house, each floor    | 204 m² | 50 ms  | 9.6 ms              | 16.5 ms                          |

Before D56 the desktop took 3.5, 11, 28 and 20 ms, and CI 6.3, 21, 50 and 31 ms. Slabs by angle (D60) took the two-storey house from 8.7 to 9.6 ms on the desktop; its CI figure is from before.

CI runs about 1.8× slower than the desktop and runner hardware varies, so the CI check fails at 1.5× each budget (D26): 300 ms, or 75 ms for the big house.

**How it's fast.** Before the grid is filled, each wall segment's direction, length, bounding box and loss are worked out once. Then, for each cell, a segment whose bounding box is clear of the path's is skipped, and hits go into reused buffers instead of new arrays. The arithmetic is otherwise the one in `crossings` and `wallLoss`, in the same order. So every cell gets exactly the same value as `predictDbm`, and property tests check this bit for bit. This made the grid 5–7× faster (the big house went from about 210 ms to 28 ms) without a spatial index (D11).

**Walls sorted by direction (D56).** Every path from an access point, on its own floor or through the storeys to another, lies along a ray from the access point. So before a grid or an optimizer signal is filled, each floor's wall segments are sorted into 256 equal sectors of direction as seen from the access point: a segment goes into every sector its angle range touches, one more on each side, with its ends stretched by the crossing slack, and a segment within 0.1 mm of the access point goes into all of them. A cell then tests only the segments in its ray's sector, in the same order as before, so the totals are exactly the same; a property test checks this bit for bit over 5,000 random layouts, including stretches of paths that start partway along the ray, and paths shorter than 1 nm test every segment. Directions use a pseudo-angle (from |dx| and |dy|) rather than trigonometry. This roughly halved both the optimizer's searches and the grid on large homes.

**While dragging.** In the browser, CPU throttling of 4× and 6× keeps the editor at 56–60 frames a second: drawing the heatmap bitmap on the page is cheap. The grid runs in a Web Worker, and only the newest request waits behind the one running. Chromium's throttling doesn't reach workers, so worker time on a slow phone is estimated as the desktop time × 4–6. For the big house that's about 110–170 ms per update.

This is a **multi-wall model**, as in the COST 231 final report. Because walls are counted one by one, the distance term uses the free-space exponent n = 2 rather than a larger empirical exponent that would already include walls. Calibration (Phase 7) may adjust n and the wall losses to fit real measurements.

## Bands

US channel ranges, used for path loss in every region. The reference loss is free-space loss at 1 m, computed at the band's midpoint (`freeSpacePathLoss` in [`pathLoss.ts`](../packages/engine/src/pathLoss.ts)).

| Band    | Channels (GHz)             | Midpoint (GHz) | PL(1 m) | Default EIRP | Regulatory limit (FCC / ISED)                                               |
| ------- | -------------------------- | -------------- | ------- | ------------ | --------------------------------------------------------------------------- |
| 2.4 GHz | 2.401–2.473 (ch. 1–11)     | 2.437          | 40.2 dB | 20 dBm       | 36 dBm EIRP: 1 W with antennas up to 6 dBi (47 CFR § 15.247(b)(3), (b)(4))  |
| 5 GHz   | 5.150–5.895 (U-NII-1 to 4) | 5.523          | 47.3 dB | 23 dBm       | 36 dBm EIRP on U-NII-1, 3 and 4; 30 dBm on U-NII-2A/2C (§ 15.407(a)(1)–(3)) |
| 6 GHz   | 5.925–7.125 (U-NII-5 to 8) | 6.525          | 48.7 dB | 18 dBm       | Low-power indoor: 5 dBm/MHz, at most 30 dBm EIRP (§ 15.407(a)(5))           |

The 2.4 and 5 GHz defaults are **assumptions**: typical consumer router output, well below the legal limits. The 6 GHz default is the low-power indoor limit applied to a 20 MHz channel, which is what beacons (and so a phone's signal reading) use. Users can set any radio's EIRP in the plan. The editor accepts −10 to 40 dBm and notes when a value is above the band's highest limit in the plan's region (below); in the US the 5 GHz limit depends on the channel, so values between 30 and 36 dBm are legal only on channels 36–48 and 149–165 ([D25](DECISIONS.md#d25-access-point-tool--2026-09-27), [D62](DECISIONS.md#d62-channels-by-region--2026-09-28)). The defaults are the same in every region; the EU's 6 GHz limit (10 dBm/MHz) would allow 23 dBm on a 20 MHz channel, so the 18 dBm default is 5 dB conservative there.

## Channels and regions

Each plan has a region, `US` or `EU` (a plan without one is US), and a DFS setting, off unless the plan says otherwise ([D61](DECISIONS.md#d61-scope-for-phase-6-overlap-roaming-and-channel-planning--2026-09-28), [D62](DECISIONS.md#d62-channels-by-region--2026-09-28)). The channels and power limits come from [`regions.json`](../packages/engine/src/regions.json); `regions.ts` reads it. A channel number sits on the IEEE 802.11 grid, centre = start + 5 × channel MHz (start 2407, 5000 and 5950 MHz for 2.4, 5 and 6 GHz), and spans half its width either side. A channel needs DFS if any part of that span is inside a DFS range; one that only touches the edge, like channel 48 ending at 5250 MHz, doesn't.

| Region, band | Allowed range (MHz)  | DFS ranges (MHz)     | 20 MHz channels         | 40 MHz                   | 80 MHz                     | 160 MHz    | Highest EIRP                                |
| ------------ | -------------------- | -------------------- | ----------------------- | ------------------------ | -------------------------- | ---------- | ------------------------------------------- |
| US 2.4 GHz   | 2400–2483.5          | none                 | 1–11                    | 3–9                      | –                          | –          | 36 dBm                                      |
| US 5 GHz     | 5150–5350, 5470–5850 | 5250–5350, 5470–5725 | 36–64, 100–144, 149–165 | 38–62, 102–142, 151, 159 | 42, 58, 106, 122, 138, 155 | 50, 114    | 36 dBm (30 dBm on DFS channels)             |
| US 6 GHz     | 5925–7125            | none                 | 1–233 (59)              | 3–227 (29)               | 7–215 (14)                 | 15–207 (7) | 30 dBm, 5 dBm/MHz                           |
| EU 2.4 GHz   | 2400–2483.5          | none                 | 1–13                    | 3–11                     | –                          | –          | 20 dBm, 10 dBm/MHz                          |
| EU 5 GHz     | 5150–5350, 5470–5725 | 5250–5350, 5470–5725 | 36–64, 100–140          | 38–62, 102–134           | 42, 58, 106, 122           | 50, 114    | 30 dBm with TPC on 100–140; 23 dBm on 36–64 |
| EU 6 GHz     | 5945–6425            | none                 | 1–93 (24)               | 3–91 (12)                | 7–87 (6)                   | 15, 47, 79 | 23 dBm, 10 dBm/MHz                          |

Channels step by 4 at 20 MHz, 8 at 40 MHz, 16 at 80 MHz and 32 at 160 MHz. Every value was checked against its source on 2026-09-28:

- **US ranges and DFS:** 47 CFR § 15.247(a)(2) for 2400–2483.5 MHz; § 15.407(a) for the 5 GHz bands and (a)(5) for indoor 6 GHz; § 15.407(h)(2) requires DFS where "any part of its 26 dB emission bandwidth" is in 5.25–5.35 or 5.47–5.725 GHz. 6 GHz has no DFS, but a contention-based protocol (§ 15.407(d)(6)). The U-NII-n names aren't in the CFR, so the editor's notes name channels instead.
- **EU ranges and limits:** ETSI EN 300 328 V2.2.2 (2.4 GHz: 20 dBm e.i.r.p., cl. 4.3.2.2.3; 10 dBm/MHz, cl. 4.3.2.3.3). ETSI EN 301 893 V2.2.1 (5 GHz: sub-bands in Table 1; 23 / 23 / 30 dBm with TPC and 23 / 20 / 27 dBm without, Table 2; DFS on sub-bands 2 and 3, cl. 4.2.6.1.2). Commission Implementing Decision (EU) 2021/1067 as last replaced by (EU) 2025/913 and ETSI EN 303 687 V1.1.1 (6 GHz low-power indoor: 5945–6425 MHz, 23 dBm, 10 dBm/MHz; no radar detection). Commission Implementing Decision (EU) 2022/179 makes 5250–5350 MHz indoor only.
- **Channel grid:** IEEE Std 802.11-2020 Table E-4 (operating classes 81, 115–130: 2.4 GHz starting frequency 2.407 GHz, 5 GHz channels 36–48 / 52–64 / 100–144 / 149–165, 80 MHz 42–155, 160 MHz 50 and 114), read from the excerpt filed as Exhibit 1036 in USPTO IPR2021-01377. The 2.4 GHz 40 MHz channels come from Tables E-1 and E-2 (US classes 32–33: primary channels 1–7 with the secondary above and 5–11 with it below; Europe classes 11–12: 1–9 and 5–13), so the centres, two channels from the primary, are 3–9 in the US and 3–11 in the EU. The 5 GHz 20 MHz grid and its 40/80/160 MHz groupings are also in EN 301 893 eq. (1) and Figure 6, and the 6 GHz 20 MHz centres in EN 303 687 cl. 4.3.1.3. The 6 GHz 40, 80 and 160 MHz channels are from the IEEE 802.11 working group's text for P802.11ax D6.0 (doc. 11-20/0646r0, Table E-4 classes 132–134); the published 802.11ax-2021 wasn't available.
- **Derived:** each list is the IEEE grid's channels whose whole span lies inside the region's ranges. A unit test checks that for every channel.

**Left out on purpose:**

- US 2.4 GHz channels 12 and 13. § 15.247 doesn't forbid them, but an FCC OET presentation (TCB workshop, October 2013, KDB 248227) says they "have to operate at reduced power to satisfy adjacent band restrictions (2.4835 – 2.5 GHz)". SignalPlan has no per-channel power limits, so they're left out.
- US U-NII-4 (5850–5895 MHz, § 15.407(a)(3)(ii)) and the EU's 5.8 GHz band: newer or national, and not widely supported.
- 20 MHz channels 32, 68 and 96 (EN 301 893 eq. (1) allows them in the EU; they also fit US rules), and 6 GHz channel 2 (5935 MHz, its own IEEE operating class). Each is a 20 MHz-only edge channel that never joins a wider one.
- 320 MHz on 6 GHz. The FCC allows it (§ 15.407(a)(11)), but its channel numbers are only in IEEE working-group drafts so far.

A radio can have its width and channel set by hand ([D63](DECISIONS.md#d63-channel-and-width-per-radio--2026-09-28)). `radioChannelIssue` checks them against these lists: a width the region doesn't have on the band, or a channel not in its list at that width, is not allowed, and a DFS channel needs the plan's DFS setting. Nothing in the coverage model uses channels yet; interference comes with #113.

To add a region, or change one when the rules change: add or edit its entry in `regions.json` (ranges, DFS ranges, channel lists per width, highest EIRP and the note the editor shows), add its code to `REGIONS` in the floorplan schema, add a row above with its sources, and bump the file's `version` date. The unit tests check every channel against the ranges.

## Wall materials

### Method

Each wall material stands for a typical **North American construction**, built up in layers. Losses are calculated, not looked up:

1. **Electrical properties** of each layer come from Recommendation **ITU-R P.2040-4** (09/2025), Table 3: relative permittivity ε′ = a·f^b and conductivity σ = c·f^d (eqs. 57–58, f in GHz), with ε″ = 17.98·σ/f (eq. 59). The one exception is brick's conductivity, which is fitted to a measured wall (see below).
2. **Transmission through the layered wall** uses P.2040's general multi-layer slab method (§ 2.2.2.1, eqs. 39–42), which accounts for reflections at every surface, and for absorption and interference inside each layer.
3. The result is the mean of TE and TM polarisation (a phone's orientation is random) at normal incidence, **averaged over 25 frequencies across the band**. Averaging smooths out thickness resonances that make single-frequency results jump by several dB.

### Constructions

| Material      | Construction                             | Layers (P.2040 class)                                                                                          |
| ------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `drywall`     | Interior stud wall                       | 12.7 mm plasterboard · 89 mm air · 12.7 mm plasterboard                                                        |
| `brick`       | Exterior brick veneer wall               | 90 mm brick (fitted) · 25 mm air · 11 mm OSB (chipboard) · 89 mm insulated cavity (air) · 12.7 mm plasterboard |
| `concrete`    | Poured concrete, such as a basement wall | 200 mm concrete                                                                                                |
| `glass`       | Double-glazed window                     | 3 mm glass · 13 mm air · 3 mm glass                                                                            |
| `low-e-glass` | Double-glazed low-E window               | As `glass`, plus a metallic coating (see below)                                                                |
| `wood`        | Solid-core door                          | 44 mm wood                                                                                                     |
| `metal`       | Steel door or appliance                  | 1 mm metal, capped at 40 dB                                                                                    |

Fibreglass insulation is modelled as air; its permittivity is close to 1.

**Low-E glass.** P.2040 has no data for the metal-oxide coatings on energy-efficient windows, which block much more signal than plain glass. The coating is modelled as a 100 nm conductive film with sheet resistance R_s. R_s is one of two fitted numbers in the model (the other is brick's conductivity): it is chosen so the model matches the **29.7 dB** measured through a double-pane low-E window at 6.75 GHz by Shakya et al. (see sources). The fitted value, **9.1 Ω/sq**, falls within the range commonly quoted for real low-E coatings (roughly 2–20 Ω/sq), which suggests the film model is physically sensible.

**Brick.** P.2040's brick (ε′ = 3.91, σ = 0.0238·f^0.16 S/m) loses 1–5 dB less than a single-wythe brick wall measured head on by Muqaibel (Virginia Tech), and NIST's brick at 2.0 GHz points the same way (see [validation](#masonry-and-wood-second-sources)). The model keeps P.2040's ε′ and uses a fitted conductivity, **σ = 0.0170·f^0.92 S/m**, chosen so an 87.1 mm slab reproduces Muqaibel's line (1.0702·f + 0.9757 dB) averaged over each band: 3.58 / 6.89 / 7.81 dB against 3.58 / 6.88 / 7.94 dB measured at 2.4 / 5 / 6 GHz. In the code this is `brick-fitted` in `FITTED_MATERIALS`, next to the untouched P.2040 table ([D36](DECISIONS.md#d36-brick-conductivity-fitted-to-a-measured-wall--2026-09-28)). Muqaibel's bricks were dry-stacked without mortar; a mortared wall may lose somewhat more.

**Metal.** P.2040 treats metal as a near-perfect conductor, which gives thousands of dB of loss. Real signals leak around the edges of doors, appliances and ducts, so metal is **capped at 40 dB**, slightly below the 43.2 dB measured through a steel door (Shakya et al.).

### Loss per wall crossing (dB)

| Material      | 2.4 GHz | 5 GHz | 6 GHz |
| ------------- | ------- | ----- | ----- |
| `drywall`     | 2.9     | 2.4   | 1.4   |
| `brick`       | 6.6     | 9.0   | 9.9   |
| `concrete`    | 14.7    | 26.5  | 29.9  |
| `glass`       | 0.5     | 6.1   | 8.3   |
| `low-e-glass` | 23.5    | 29.9  | 29.8  |
| `wood`        | 0.7     | 1.8   | 2.1   |
| `metal`       | 40      | 40    | 40    |

These values are pinned by a unit test (`materials.test.ts`), so this table and the code change together.

Two results may look odd but follow from the physics. The stud wall loses **less** at 6 GHz than at 2.4 GHz because the two gypsum sheets interfere constructively in that band. Glass is almost transparent at 2.4 GHz because 3 mm panes are tiny compared with the 12 cm wavelength.

## Floor materials

Floors are built up in layers and computed the same way as walls (D49, D50): P.2040-4 Table 3 properties, the multi-layer slab method, TE and TM averaged, averaged over each band. Unlike walls, a floor's loss follows the angle at which the path meets it, up to 75° from the vertical (D60, [below](#slabs-at-an-angle)). A path to another floor pays one floor loss per slab it crosses (see below).

| Material        | Construction                                | Layers (P.2040 class)                                                                                                       |
| --------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `timber-joist`  | Wood-framed floor in a house                | 18.3 mm OSB (chipboard) · 184, 235 or 286 mm joist cavity (air) · 12.7 mm plasterboard, loss averaged over the three depths |
| `concrete-slab` | Slab between apartments, or over a basement | 150 mm concrete                                                                                                             |

**Where the layers come from.** The subfloor is 23/32 in (18.3 mm) OSB, which IRC 2021 Table R503.2.1.1(1) allows for joists 16 or 24 in apart. The cavities are the dry depths of 2×8, 2×10 and 2×12 joists from PS 20-20 Table 3 (184, 235 and 286 mm). The ceiling is 1/2 in (12.7 mm) gypsum, which IRC Table R702.3.5 allows on ceilings framed up to 24 in apart. A path through a floor mostly passes between joists, so the joists themselves are left out, as studs are in walls. The joist cavity makes the loss at 2.4 GHz swing with depth (1.7, 3.3 and 4.1 dB for the three depths), a resonance too narrow for the band average to smooth, so the construction averages the transmitted power over all three depths and stands for a typical joist floor.

**Concrete thickness.** No readable code source for a typical slab thickness was found. 150 mm is chosen because it agrees with the one head-on measurement available: ITU-R P.1238-13 reports that at 5.2 GHz a typical reinforced concrete floor with a suspended false ceiling adds 20 dB at normal incidence (σ = 1.5 dB), and the model's 150 mm slab loses 19.4 dB at 5.2 GHz. A 200 mm slab, like the `concrete` wall, would lose 25.4 dB, more than 3σ above. The steel reinforcement and the false ceiling aren't modelled.

Loss per floor crossing (dB), at normal incidence:

| Floor           | 2.4 GHz | 5 GHz | 6 GHz |
| --------------- | ------- | ----- | ----- |
| `timber-joist`  | 2.5     | 2.7   | 3.1   |
| `concrete-slab` | 11.5    | 20.2  | 22.8  |

A floor that doesn't say what it's made of is taken as `timber-joist` (D50).

### Slabs at an angle

A path to the floor above or below meets the slab at an angle from the vertical: θ = atan(across / rise), with _across_ the path's length on the plan and _rise_ the height between its ends. Every slab along one straight path meets it at the same angle. The slab's loss is computed at that angle with the same P.2040-4 method, the one D30 measured for walls (D60):

| Floor           | Band    | 0°   | 60°  | 75° and beyond |
| --------------- | ------- | ---- | ---- | -------------- |
| `timber-joist`  | 2.4 GHz | 2.5  | 3.4  | 5.4            |
| `timber-joist`  | 5 GHz   | 2.7  | 4.2  | 6.6            |
| `timber-joist`  | 6 GHz   | 3.1  | 4.0  | 6.4            |
| `concrete-slab` | 2.4 GHz | 11.5 | 12.4 | 13.6           |
| `concrete-slab` | 5 GHz   | 20.2 | 22.0 | 23.4           |
| `concrete-slab` | 6 GHz   | 22.8 | 24.7 | 26.2           |

**Why floors and not walls.** D30 kept walls head-on because angles moved the median cell by at most 0.5 dB: paths meet walls at every angle, and some materials lose less at 30–60° than head on. Paths to another floor are different. They rise one storey, about 2.7 m, over several metres across, so most meet the slab at a shallow angle: 10 m across is 75°. Charging those paths the head-on loss made the upper floor 2.3 / 5.5 dB optimistic against P.1238-13 at 2.4 / 5 GHz (D58); with the angle it is 0.7 / 3.4 dB (see the exit gate below).

**The 75° cap.** Past about 80°, the loss of every material climbs steeply towards grazing (the timber floor loses 12.8 dB at 80° on 2.4 GHz, and D30 found 40 dB or more near 89° for walls). There, real signal reaches the floor above some other way, through a stairwell, window or the slab's edge, which a single straight path can't show. So the loss stops growing at 75°, the top of the 60–75° range D30 set aside for walls. Any cap above 75° leaves the exit gate's median gaps unchanged, since the median upstairs path is within it. The cap is a judgement, not a measurement.

**How it's computed.** Each floor's loss is worked out every 0.5° from 0° to 75° in each band, the first time a floor of that kind is needed in that band (about 40 ms for the timber floor, which averages three joist depths), and read by linear interpolation. The table is within 0.06 dB of the slab worked out at the exact angle; the timber floor at 2.4 GHz is the worst, because its joist cavity's resonance moves with the angle. The head-on value at 0° is exactly the table above. Working out the angle for each cell made a two-storey house's grid about 10% slower (8.7 → 9.6 ms per floor).

**Against ITU-R P.1238-13.** The concrete slab is tested against the head-on measurement above, within 3 dB (2σ). P.1238-13 Table 5 also gives floor penetration loss factors, L_f: 5 dB (house) and 10 dB (apartment) at 2.4 GHz, and 7 dB (house, "wooden mortar") and 13 dB (apartment, per concrete wall) at 5.2 GHz. They belong to its eq. (2), L_total = L(d₀) + N·log10(d/d₀) + L_f(n), whose distance coefficients N (Table 4) aren't given at 2.4 or 5 GHz, not to the site-general eq. (1), which is for both ends on one floor. (This section said until D58 that they belonged to the site-general model; that was wrong.) They are empirical factors that include everything else between floors, so they aren't a head-on slab loss and aren't tested as one; the exit gate below compares with them another way. The timber floor is 2–4 dB below the house values head-on, and within 0.4 dB of them at 75° (5.4 / 6.6 dB, see [Slabs at an angle](#slabs-at-an-angle)); since those aren't slab losses, the gap isn't tested. A measured timber floor would be the first thing to add: a search in 2026-09 (D60) found none at 2.4 or 5 GHz. The apartment values are below the slab's head-on loss, as expected when signals also find paths around a floor.

## Signal between floors

A path from an access point on one floor to a point on another is still one straight line (D49, D51). The access point sits at its floor's elevation plus its mounting height, and the receiver 1 m above its own floor, so the distance is 3D and includes the height between floors. Floors are stacked by elevation. A floor's `material` is the slab under its rooms, so a path pays the slab of every floor above the lower end, up to and including the upper end's floor. The lowest floor's slab is never crossed. A slab's loss follows the angle at which the path meets it, up to 75° from the vertical (D60, [Slabs at an angle](#slabs-at-an-angle)).

Walls count along the part of the path inside each storey, between that floor's surface and its ceiling (or the next floor's surface, if that's lower). The path is split where its height passes each ceiling and surface, and each floor's walls are checked along its own stretch, including floors in between. For example, a router 2 m up on the ground floor (ceiling 2.4 m) and a phone 3 m across upstairs (floor at 2.7 m, phone at 3.7 m): the path leaves the ground floor 0.7 m across, passes through the slab until 1.24 m across, and is upstairs from there. A ground-floor wall 1 m from the router isn't crossed, and nor is an upstairs wall at that spot. Straight above an access point the path crosses no walls at all, only slabs. If an access point is mounted higher than a receiver on the floor above, which can't happen in a real storey, the path is split halfway.

Every slab covers the whole plan, including outside the upper floor's walls, where the lower floor's roof or ceiling would be; roofs aren't modelled otherwise.

**Stairwells and atriums (D54).** A floor can have openings: polygons cut out of its slab. A path skips a slab's loss if it passes through one of that slab's openings at the slab's middle height, halfway between the ceiling below and the floor's surface. So a phone straight above the router, over a stairwell, gets only the 3D distance, while a phone beside the stairwell pays the slab if the path meets the slab outside the opening. The path is still one straight line: signal doesn't bend round the edge of the opening, and a path that clips the slab near an edge counts as fully in or fully out. Walls on each floor count along their stretch as before, so a stairwell's own walls still cost what they're made of. An opening belongs to the floor it's cut from, the upper of the two, and only that slab is spared: a path to the floor above it still pays that floor's slab, unless that floor has an opening there too. Openings on the lowest floor change no signal, since its slab is never crossed; they only leave their area out of the floor's.

### Floors and their limits

Floors are flat and stacked (D49): each has one elevation and one floor-to-ceiling height, basements included (negative elevation). These aren't supported:

- **Split levels and sloped ceilings.** A half-storey has to be drawn as a floor of its own at its own elevation, and a room under a sloping roof as if its ceiling were flat at the given height.
- **Partial slabs.** Every slab covers the whole plan (D51), so outside a smaller upper floor, where a real house has a roof or open air, the path still pays a slab. Stairwells and atriums are the only holes (D54).
- **Slab loss at a capped angle.** A slab's loss follows the path's angle only up to 75° from the vertical (D60). A path flatter than that, to a room far across the floor above, pays the 75° loss, which is optimistic for the straight path itself but stands for the signal that finds other ways up.
- **Paths around the floor.** Signal that leaves through a window and comes back in upstairs, or leaks round the slab's edge or down a stairwell at an angle, isn't modelled; P.1238-13 notes that such outside paths limit how much isolation floors give.
- **Timber floor vs P.1238's house factor.** The timber joist floor loses 2.5 / 2.7 dB head-on and 5.4 / 6.6 dB at 75° on 2.4 / 5 GHz (D50, D60), against P.1238-13's empirical house factors of 5 / 7 dB, which include everything between two floors of a real house. Upstairs predictions on 5 GHz are still somewhat optimistic; the exit gate below measures by how much. The joists themselves are left out (D50): a shallow path through a 235 mm joist cavity runs about 0.9 m along it and may pass one or two joists, but which way they run isn't in the plan.

**Exit gate (D58).** `two-storey-home.json` is the sample bungalow with a 150 m² upper floor over a timber joist floor at 2.666 m (its 2.4 m ceiling plus the 0.266 m floor): two bedrooms, a bathroom, a laundry, a landing with a 1 × 3 m stairwell and a primary bedroom with an ensuite, in drywall inside brick outer walls with low-E windows. The router stays downstairs by the front door, 1 m up. `m3Gate.test.ts` checks two things:

- **Coverage.** The router reaches Fair on at least 85% of each floor on 2.4 GHz. It reaches 93.4% of the main floor and 100% of the upper floor (86.9% and 100% on 5 GHz).
- **Against P.1238-13.** P.1238-13 has no single model for a house across floors at these frequencies (see [Floor materials](#floor-materials)), so the reference combines two parts of it: eq. (1) with Table 2's office NLoS coefficients (α 2.39, β 30.13, γ 2.40, σ 5.01 dB), plus Table 5's house factor on the upper floor (5 dB at 2.4 GHz, 7 dB at 5.2 GHz, evaluated at 2.4 and 5.2 GHz). Over the cells of each floor 4–30 m from the router (Table 2's distance range), the median gap between this model's path loss and the reference must be within 2σ, 10 dB:

| Band    | Main floor | Upper floor |
| ------- | ---------- | ----------- |
| 2.4 GHz | +0.7 dB    | −0.7 dB     |
| 5 GHz   | −0.8 dB    | −3.4 dB     |

A negative gap means this model predicts less loss than the reference. On the main floor it agrees within 1 dB, and upstairs on 2.4 GHz too. On 5 GHz the upper floor is optimistic by 3.4 dB, under 1σ and about as close as the single-floor check [against P.1238](#against-the-itu-r-p1238-13-indoor-model) (within about 3 dB). Before D60 charged slabs by angle, the upper floor was 2.3 / 5.5 dB optimistic. What is left is likely the joists (see [Floors and their limits](#floors-and-their-limits)) and steep paths crossing fewer walls upstairs, and the reference itself joins two parts of P.1238 that weren't fitted together. That is also why the upper floor still gets 100% at Fair on 5 GHz, more than the floor the router is on. The test also records these four gaps, so a change to them shows up in review.

Two consequences follow from the geometry. Adding a floor between never raised the signal on a plan with no walls in a property test (100 cases in CI, and 9,000 more when D60 was checked): the path gets longer and crosses one more slab. Since D60 this isn't guaranteed by construction, because a steeper path makes every other slab a little cheaper, but the added slab has always outweighed that. Making a storey taller can raise the signal for the same reason. With walls it can: a steeper path spends less of its length in each storey and may pass fewer walls there. And the loss is the same in both directions (property tested).

## Validation

Only the low-E coating was fitted to a measurement; everything else is predicted from P.2040 and compared with published measurements, using each sample's actual thickness. All of them were measured head on.

### Against Shakya et al. at 6.75 GHz

Co-polarised penetration loss:

| Sample                       | Measured (dB) | Model (dB) | Difference |
| ---------------------------- | ------------- | ---------- | ---------- |
| Low-E window, 20 mm (fitted) | 29.7          | 29.7       | 0.0        |
| Wooden door, 45 mm           | 5.8           | 2.0        | −3.8       |
| Clear glass, 10 mm           | 3.6           | 1.1        | −2.5       |
| Drywall panel, 30 mm         | 0.6           | 2.1        | +1.5       |
| Plasterboard wall, 137 mm    | 2.1           | 1.5        | −0.6       |
| Steel door, 47 mm (capped)   | 43.2          | 40.0       | −3.2       |

The model is within 4 dB on every sample, but it **under-predicts wood and glass**. The measured door was a fire-rated solid-wood-core door, which is probably denser and lossier than the wood samples behind P.2040's wood class. A unit test keeps every sample within 4 dB so that later changes can't make the model silently worse.

### Against NIST at 5 and 6 GHz

NIST measured 1 m square panels of single materials from 3 to 8 GHz (Stone, NISTIR 6055). The report gives each curve as a sixth-order polynomial in frequency; the table averages it over each band as power, the same way the model averages. Loss in dB:

| Sample (NIST name)        | 5 GHz measured | 5 GHz model | Difference | 6 GHz measured | 6 GHz model | Difference |
| ------------------------- | -------------- | ----------- | ---------- | -------------- | ----------- | ---------- |
| Drywall, 6.94 mm (D25H)   | 0.0            | 1.3         | +1.3       | 0.1            | 1.3         | +1.3       |
| Drywall, 12.52 mm (D50H)  | −0.2           | 1.0         | +1.2       | 0.0            | 0.8         | +0.7       |
| Glass, 5.68 mm (G25H)     | 1.0            | 3.3         | +2.3       | 1.2            | 3.0         | +1.8       |
| Glass, 12.52 mm (G50H)    | 0.3            | 1.3         | +1.1       | 0.9            | 3.0         | +2.2       |
| Glass, 18.60 mm (G75H)    | 0.4            | 2.5         | +2.1       | 0.5            | 1.2         | +0.7       |
| Lumber, 36.95 mm (L15DH)  | 3.4            | 1.4         | −2.0       | 3.8            | 1.8         | −2.0       |
| Lumber, 75.42 mm (L30DH)  | 7.7            | 2.7         | −5.0       | 8.2            | 3.3         | −4.8       |
| **Brick, 90.4 mm (B1H)**  | 15.4           | 7.1         | −8.3       | 15.6           | 8.1         | −7.5       |
| **Concrete, 102 mm (×7)** | 17.9–26.8      | 14.2        | −4 to −13  | 19.4–28.8      | 16.0        | −3 to −13  |
| **Concrete, 203 mm (×3)** | 54.6–57.2      | 26.9        | −28 to −30 | 59.2–62.4      | 30.3        | −29 to −32 |

Lumber is dry spruce-pine-fir. Concrete rows span NIST's mixes. Only fits that reproduce their plotted curves are used: the 102 mm panels of mixes 2–8 and the 203 mm panels of mixes 3, 5 and 8. The rest, including every 305 mm panel, give thousands of dB as printed. A slightly negative loss is a real effect of thin panels near resonance, not an error.

- **Drywall and glass** agree within 2.3 dB. Unlike the Shakya comparison, the model is slightly _pessimistic_ for glass here, so the two sources bracket it.
- **Wood** is under-predicted again, by 2 dB for 37 mm and 5 dB for 75 mm, which matches the Shakya door. Muqaibel's 44.5 mm door is also lossier than the model, but only by 0.4–0.5 dB (see [below](#masonry-and-wood-second-sources)), so how far the model falls short depends on the wood.
- **Brick and concrete** are far lossier at NIST than predicted: by 7.5–8.3 dB for one wythe of brick (12 dB before brick's conductivity was fitted, D36) and up to 30 dB for 203 mm of concrete. The report doesn't give the specimens' moisture when tested; the brick is cored clay brick with 13–14 mm mortar joints (Table 3.1.1). Second sources and the likely causes are [below](#masonry-and-wood-second-sources); NIST's high-range brick isn't used for the brick fit, because it's out of line with NIST's own 2.0 GHz value and with Muqaibel's wall.

A unit test copies NIST's coefficients, checks each curve against the report's plot at 5 GHz, and keeps the drywall, glass and lumber samples within 5 dB in both bands. The 75 mm lumber is 4.97 dB under at 5 GHz, just inside that limit. A panel listed as 16 mm drywall (D625H) is left out, because the report's measured drywall panels are 6.94, 9.44 and 12.52 mm and it's unclear which one it is.

NIST's measurements skip 2 to 3 GHz, so the 2.4 GHz band is checked separately below.

### Near 2.4 GHz: NIST at 2.0 GHz and Anderson and Rappaport at 2.5 GHz

No primary lab measurement of these materials inside the 2.4 GHz band was found that could be read in full (see [D32](DECISIONS.md#d32-validation-at-24-ghz--2026-09-27)). The closest are NIST's low range, 0.5 to 2.0 GHz, compared here at its top end, and in-building measurements at 2.5 GHz. The model is evaluated at the same single frequency. P.2040's properties change smoothly with frequency: for the drywall, glass and lumber samples below, the model's value at 2.0 GHz is within about 1 dB of its 2.4 GHz band average.

**NIST at 2.0 GHz.** Same report and method as above (Tables 4.1b, 4.4b–4.11b and 4.13b–4.15b). Loss in dB:

| Sample (NIST name)        | Measured  | Model | Difference |
| ------------------------- | --------- | ----- | ---------- |
| Drywall, 12.52 mm (D50L)  | 0.6       | 0.9   | +0.3       |
| Glass, 5.68 mm (G25L)     | 1.4       | 1.4   | −0.1       |
| Glass, 12.52 mm (G50L)    | 3.3       | 3.2   | −0.2       |
| Glass, 18.60 mm (G75L)    | 3.9       | 3.0   | −0.9       |
| Lumber, 36.95 mm (L15DL)  | 3.3       | 0.7   | −2.6       |
| Lumber, 75.42 mm (L30DL)  | 4.8       | 1.3   | −3.5       |
| **Brick, 90.4 mm (B1L)**  | 5.4       | 3.8   | −1.6       |
| **Brick, 178 mm (B2L)**   | 7.6       | 5.8   | −1.8       |
| **Concrete, 102 mm (×8)** | 12.6–18.0 | 7.0   | −6 to −11  |
| **Concrete, 203 mm (×8)** | 28.6–34.9 | 13.0  | −16 to −22 |

The fits checked against their plots (brick, drywall, glass, lumber, and concrete mixes 1, 2 and 6, which include both ends of each concrete range) reproduce them, with one exception: the printed drywall table gives nearly the same curve in all three columns while the plot shows three different ones. Only D50L matches, so the other two are left out.

- **Drywall and glass** agree within 1 dB.
- **Wood** is under-predicted by 2.6–3.5 dB, the same direction as at 5, 6 and 6.75 GHz. In every source so far, P.2040's wood class is less lossy than the measured lumber and doors.
- **Brick** is within 1.8 dB here with the fitted conductivity (2.6 dB with P.2040's), unlike the 12 dB gap in NIST's own 3–8 GHz data for the same brick. NIST's two ranges jump from 5.4 dB at 2.0 GHz to 15.1 dB at 3.0 GHz for that brick, far more than P.2040's brick properties allow for a solid slab. The brick's cores or the change of antennas between ranges may explain it; this is noted for [#55](https://github.com/NC4321/SignalPlan/issues/55).
- **Concrete** is again much lossier than predicted, by 6–22 dB ([#55](https://github.com/NC4321/SignalPlan/issues/55)).

A unit test copies the six drywall, glass and lumber curves, checks each against its plot at 2.0 GHz, and keeps each within 4 dB of the model. The worst is the 75 mm lumber at 3.5 dB.

**Anderson and Rappaport at 2.5 GHz.** Partition losses measured in a working office building at Virginia Tech (Table III), each the mean over several links through that kind of partition, in excess of free space:

| Partition                                    | Measured (± s.d.) | Model | Difference |
| -------------------------------------------- | ----------------- | ----- | ---------- |
| Drywall: two 12.7 mm sheets, 7 links         | 5.4 ± 2.1         | 3.3   | −2.1       |
| Clear glass, single 3.2 mm (1/8 in), 4 links | 6.4 ± 1.9         | 0.8   | −5.6       |

The paper doesn't give the stud cavity, so the drywall row uses the `drywall` construction (89 mm cavity); that agrees within one standard deviation. The glass doesn't: a single thin pane can't absorb 6 dB at 2.5 GHz, so the measurement likely includes frames or multipath around the partition. The authors also note they can't explain why their clear glass loses less at 60 GHz than at 2.5 GHz. These are in-building averages rather than samples of known construction, so they are shown here but not tested. The Magis Networks white paper (R. Wilson, 2002) also covers 2.4 and 5 GHz but isn't peer-reviewed and isn't used.

Real homes are still unvalidated in every band until Phase 7.

### Masonry and wood: second sources

**Muqaibel (Virginia Tech).** A dissertation measured single walls and panels head on from about 1 to 14 GHz, and fitted each insertion loss as a straight line in frequency, a·f + b (Table 4.3). The table averages that line over each band as power. Loss in dB:

| Sample                             | 2.4 GHz measured / model | 5 GHz measured / model | 6 GHz measured / model |
| ---------------------------------- | ------------------------ | ---------------------- | ---------------------- |
| Wooden door, 44.5 mm               | 1.0 / 0.7                | 2.2 / 1.8              | 2.6 / 2.1              |
| Glass, 2.36 mm                     | 0.8 / 0.5                | 1.7 / 1.7              | 2.0 / 2.1              |
| **Brick wall, 87.1 mm (fitted)**   | 3.6 / 3.6                | 6.9 / 6.9              | 7.9 / 7.8              |
| Concrete block wall, 194.5 mm      | —                        | 13.6 / —               | —                      |
| NIST concrete block, 203 mm (CB1H) | —                        | 15.3 / —               | 16.3 / —               |

The brick fit is stated for 1–7 GHz, so the top of the 6 GHz band (to 7.125 GHz) is a slight extrapolation; the block was flat at 13.62 dB from 2.0 to 6.8 GHz. The door and glass agree within about 0.5 dB in every band. The dissertation's "wallboard" and "structure wood" samples are left out, because it doesn't say what they're made of.

- **Brick:** both sources measured single-wythe, three-cored clay brick, and both find more loss than P.2040's brick: 0.8–4.8 dB more for Muqaibel's wall, 12 dB more at NIST. Muqaibel's bricks were dry-stacked without mortar (Figure B2.1), while NIST's were laid in mortar, which may explain part of the 8.5 dB between them. But NIST's 3–8 GHz brick is also out of line with NIST's own 2.0 GHz value for the same wall (15.1 dB at 3.0 GHz against 5.4 dB at 2.0 GHz, [above](#near-24-ghz-nist-at-20-ghz-and-anderson-and-rappaport-at-25-ghz)), and with Muqaibel's wall, which rises smoothly to 4.2 dB at 3.0 GHz. So the 12 dB gap is probably specific to NIST's high-range brick measurement, and the gap the other data support is Muqaibel's 1–5 dB. P.2040's brick conductivity would have to be 2.6 times higher to match Muqaibel at 5 GHz and 6.2 times higher to match NIST. With P.2040's brick the model gave 2.8 / 3.3 / 3.2 dB for this wall; brick's conductivity is now fitted to it ([D36](DECISIONS.md#d36-brick-conductivity-fitted-to-a-measured-wall--2026-09-28)), so the table shows the fitted model.
- **Concrete block:** the two sources agree within 1.7 dB, which suggests NIST's set-up isn't lossy in general. P.2040 has no hollow-block class and the model has no block material.

**Concrete and moisture.** P.2040-4 doesn't say how dry its concrete and brick samples were: Table 3 is a curve fit to "examples of measured electrical characteristics" from the literature, with no note on moisture. Rhim (MIT) measured the permittivity of 4-week-old concrete cylinders of one mix, wet, saturated, air dried and oven dried, from 0.1 to 20 GHz (Table 3-3, ε′ and ε″ as straight lines in frequency). Putting those into the same slab calculation gives loss in dB:

| Concrete                   | 102 mm: 2.4 / 5 / 6 GHz   | 203 mm: 2.4 / 5 / 6 GHz   |
| -------------------------- | ------------------------- | ------------------------- |
| Rhim, oven dried           | 1.8 / 2.3 / 2.7           | 2.5 / 3.6 / 4.4           |
| Rhim, air dried            | 2.7 / 4.0 / 5.0           | 1.4 / 6.6 / 8.7           |
| Rhim, saturated            | 8.1 / 16.1 / 18.8         | 14.0 / 29.7 / 35.0        |
| Rhim, wet (watery surface) | 14.0 / 27.4 / 31.8        | 24.1 / 50.8 / 59.2        |
| **Model (P.2040)**         | 8.1 / 14.2 / 16.0         | 14.9 / 26.9 / 30.3        |
| NIST                       | — / 17.9–26.8 / 19.4–28.8 | — / 54.6–57.2 / 59.2–62.4 |

When the loss is low, thickness resonances can make a thicker slab lose less, as for air-dried concrete at 2.4 GHz.

- Moisture alone spans most of the range: from a few dB for dry concrete to more than NIST's 102 mm panels for wet concrete. **P.2040's concrete behaves like Rhim's saturated concrete**, so for a dry, above-ground wall the model is probably pessimistic rather than optimistic. NIST's panels sit between saturated and wet at 102 mm and beyond wet at 203 mm; its 2.0 GHz values (12.6–18.0 dB at 102 mm, [above](#near-24-ghz-nist-at-20-ghz-and-anderson-and-rappaport-at-25-ghz)) are likewise above the saturated case.
- NIST's 203 mm panels lose more per millimetre than its 102 mm panels of the same mix (mix 3: 22.6 dB at 102 mm, 56.4 dB at 203 mm; mix 5: 23.9 and 54.6; mix 8: 26.8 and 57.2, at 5 GHz). A uniform slab this lossy can lose at most about twice as much at twice the thickness. One explanation is thicker panels holding more water because they dry more slowly; the report doesn't give the specimens' age or moisture, so this can't be checked.
- 3GPP TR 38.901 (Table 7.4.3-1) gives concrete as 5 + 4f dB, which is 14.7, 27.1 and 31.1 dB at the band midpoints, close to the model's 200 mm wall. It doesn't state a thickness, so this is context rather than validation.

A unit test keeps the Muqaibel door and glass within 1 dB in all three bands, checks that the fitted brick reproduces Muqaibel's wall within 0.3 dB in all three, and records that P.2040's brick falls 0.5–5 dB short of it. [D36](DECISIONS.md#d36-brick-conductivity-fitted-to-a-measured-wall--2026-09-28) settles [#55](https://github.com/NC4321/SignalPlan/issues/55): brick's conductivity is fitted, and concrete stays at P.2040's values, which behave like Rhim's saturated concrete, because a plan doesn't record how damp a wall is.

### Against the ITU-R P.1238-13 indoor model

Recommendation ITU-R P.1238-13 gives an empirical site-general model for indoor path loss: L_b = 10α·log10(d) + β + 10γ·log10(f), with d in metres and f in GHz (eq. 1). Table 2 gives coefficients for offices, corridors, industrial sites and conference rooms, none for homes; for the power loss coefficient of its other form, eq. (2), it says office values could be used where residential ones aren't given. (Until D58 this section said P.1238 advises office values for homes in eq. (1); it only says so for eq. (2).) Office is the closest environment with walled rooms, and its no-line-of-sight coefficients (Table 2: α = 2.39, β = 30.13, γ = 2.40, σ = 5.01 dB) fold typical walls and clutter into the distance term.

Path loss in dB (lower is stronger), comparing that median with this model's free-space term plus one or two `drywall` walls:

| Band    | Distance | Free space | Model, 1 wall | Model, 2 walls | P.1238-13 office NLoS |
| ------- | -------- | ---------- | ------------- | -------------- | --------------------- |
| 2.4 GHz | 5 m      | 54.2       | 57.1          | 60.0           | 56.1                  |
| 2.4 GHz | 10 m     | 60.2       | 63.1          | 66.0           | 63.3                  |
| 2.4 GHz | 20 m     | 66.2       | 69.1          | 72.0           | 70.5                  |
| 5 GHz   | 5 m      | 61.3       | 63.7          | 66.1           | 64.6                  |
| 5 GHz   | 10 m     | 67.3       | 69.7          | 72.1           | 71.8                  |
| 5 GHz   | 20 m     | 73.3       | 75.7          | 78.1           | 79.0                  |

With the one or two interior walls a path typically crosses at these distances, the model sits within about 3 dB of the P.1238-13 median, well inside that model's 5 dB spread. The model therefore uses the free-space exponent n = 2 without an extra clutter term.

## Known limits

- **Straight line only.** Signals that bend around corners (diffraction) or bounce off walls (reflection) are ignored, so areas behind strong walls are predicted darker than they are. See [D24](DECISIONS.md#d24-propagation-scope-for-m1-omnidirectional-direct-path-only--2026-09-27).
- **Normal incidence.** Wall loss is computed for a wave meeting the wall head on. The slab code supports angles, but using them moved 90% of cells by at most about 3 dB in the test plans, and not always downwards, so it was left out ([D30](DECISIONS.md#d30-wall-loss-stays-at-normal-incidence--2026-09-27)).
- **Omnidirectional access points.** Antenna patterns are ignored ([D24](DECISIONS.md#d24-propagation-scope-for-m1-omnidirectional-direct-path-only--2026-09-27)).
- **Typical constructions.** A real wall may differ from its construction above: metal studs, foil-backed insulation, tile or plaster lath all add loss.
- **No furniture, people or neighbouring networks.**
- **Receiver losses aren't modelled.** A phone's antenna is less efficient than the 0 dBi assumed, and a hand or body near it absorbs signal, so a phone may read several dB below the prediction.
- **Uncalibrated.** Until Phase 7, predictions have not been checked against measurements in a real home.

## Sources

- Recommendation ITU-R P.1238-13 (09/2025), _Propagation data and prediction methods for the planning of indoor radiocommunication systems and radio local area networks in the frequency range from 300 MHz to 450 GHz_. International Telecommunication Union. Eqs. 1–2, Tables 2 and 5, and the floor loss text after Table 5.
- Recommendation ITU-R P.2040-4 (09/2025), _Effects of building materials and structures on radiowave propagation above about 100 MHz_. International Telecommunication Union. Table 3; eqs. 27a, 39–44, 57–59.
- D. Shakya, M. Ying, T. S. Rappaport, H. Poddar, P. Ma, Y. Wang and I. Al-Wazani, "Wideband Penetration Loss through Building Materials and Partitions at 6.75 GHz in FR1(C) and 16.95 GHz in the FR3 Upper Mid-band spectrum", IEEE GLOBECOM 2024. [arXiv:2405.01362](https://arxiv.org/abs/2405.01362). Table II.
- W. C. Stone, _Electromagnetic Signal Attenuation in Construction Materials_, NIST Construction Automation Program Report No. 3, NISTIR 6055, National Institute of Standards and Technology, 1997. [doi:10.6028/NIST.IR.6055](https://doi.org/10.6028/NIST.IR.6055). Tables 3.5.3, 3.6.2, 3.8.2, 4.1b, 4.1d, 4.4b–4.11b, 4.4d–4.11d, 4.13b–4.15b and 4.13d–4.15d.
- C. R. Anderson and T. S. Rappaport, "In-building wideband partition loss measurements at 2.5 and 60 GHz", _IEEE Transactions on Wireless Communications_, vol. 3, no. 3, pp. 922–928, May 2004. [arXiv:1701.03415](https://arxiv.org/abs/1701.03415). Table III.
- A. H. Muqaibel, _Characterization of Ultra Wideband Communication Channels_, PhD dissertation, Virginia Polytechnic Institute and State University, 2003. [VTechWorks](https://vtechworks.lib.vt.edu/server/api/core/bitstreams/43984a35-3d29-47bb-ab73-3fe4a685cabb/content). Table 4.3, Figure B2.1.
- H. C. Rhim, _Nondestructive Evaluation of Concrete Using Wideband Microwave Techniques_, PhD thesis, Massachusetts Institute of Technology, 1995. [hdl:1721.1/11745](https://hdl.handle.net/1721.1/11745). Table 3-3.
- International Code Council, _2021 International Residential Code_. Tables R503.2.1.1(1) (floor sheathing) and R702.3.5 (gypsum board).
- National Institute of Standards and Technology, _Voluntary Product Standard PS 20-20, American Softwood Lumber Standard_, January 2020. Table 3.
- 3GPP TR 38.901 V17.0.0 (ETSI TR 138 901, 2022-04), _Study on channel model for frequencies from 0.5 to 100 GHz_. Table 7.4.3-1.
- COST Action 231, _Digital mobile radio towards future generation systems: final report_, European Commission, 1999. Indoor multi-wall model.
- 47 CFR §§ 15.205, 15.247, 15.403 and 15.407 (FCC Part 15, eCFR as of 2026-09-24), and the matching ISED rules RSS-247 and RSS-248.
- FCC Office of Engineering and Technology, "KDB 248227 802.11 SAR Procedures Update Proposal", TCB Workshop, October 2013. Slide 7.
- ETSI EN 300 328 V2.2.2 (2019-07), _Wideband transmission systems; Data transmission equipment operating in the 2,4 GHz band; Harmonised Standard for access to radio spectrum_. Clauses 4.3.2.2, 4.3.2.3.
- ETSI EN 301 893 V2.2.1 (2024-11), _5 GHz WAS/RLAN; Harmonised Standard for access to radio spectrum_. Table 1, eq. (1), Table 2, clause 4.2.6.1.2, Figure 6.
- ETSI EN 303 687 V1.1.1 (2023-06), _6 GHz WAS/RLAN; Harmonised Standard for access to radio spectrum_. Clause 4.3.1.3, Tables 2–3.
- Commission Implementing Decision (EU) 2021/1067 on the 5 945–6 425 MHz band, OJ L 232, 30.6.2021, with its Annex as replaced by (EU) 2025/913, OJ L 2025/913, 22.5.2025. Table 1.
- Commission Implementing Decision (EU) 2022/179 on the 5 GHz band for WAS/RLANs, OJ L 29, 10.2.2022. Annex Tables 1–3.
- IEEE Std 802.11-2020, _Wireless LAN Medium Access Control (MAC) and Physical Layer (PHY) Specifications_. Annex E, Table E-4 (read from USPTO IPR2021-01377, Exhibit 1036).
- Apple, "Wi-Fi roaming support in Apple devices", _Apple Platform Deployment_, published 2024-09-25. [support.apple.com](https://support.apple.com/guide/deployment/wi-fi-roaming-support-dep98f116c0f/web). Section "Trigger threshold and cell overlap".
- IEEE 802.11 working group document 11-20/0646r0, "Update to 6GHz Operating Classes", April 2020. Proposed Table E-4 classes 131–134.

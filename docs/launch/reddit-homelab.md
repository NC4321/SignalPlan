# r/homelab draft

For people who run their own kit, read spec sheets and like to see how something works. They'll want the model, the scan formats, the code and the limits, and they're the likeliest to own a survey tool or to scan their house properly.

**Before posting:** read [the rules section](README.md#rhomelab). Rule 6 is reported to allow non-commercial personal projects, and a link without a description counts as low effort (unconfirmed, checked 2026-10-05). Rewrite it in your own words before posting ([why](README.md#these-drafts-are-not-your-words-yet)).

**Post type:** text, with a screenshot or the demo GIF if the sub allows images in text posts. **Flair:** [AUTHOR: check the sub's flairs when posting]

## Title options

1. SignalPlan: open-source predictive Wi-Fi planning for houses, in the browser (ITU-R wall physics, placement optimizer, channel planner, reads your scans)
2. I built a free Wi-Fi coverage planner for the home: P.2040 wall losses, an optimizer for AP placement, and it reads netsh, nmcli and iw scans
3. Open-source Wi-Fi heatmap planner, not yet validated in a real home. Anyone with survey data willing to test it?

## Body

[AUTHOR: one or two sentences in your own words on why you built it. The write-up's opening, which you wrote, is: "I wanted to know where to put a router, and how many access points a house needs, without a survey kit."]

SignalPlan is a predictive Wi-Fi planner for houses: draw the floor plan to scale, set wall and floor materials, place APs, and get a heatmap per floor on 2.4, 5 and 6 GHz. Free, MIT, runs entirely in the browser, no account, nothing uploaded (plans live in IndexedDB; share links carry the plan in the URL fragment).

**The model.** Free-space path loss plus a loss for every wall the straight line from AP to point crosses (a multi-wall model, as in COST 231), with the strongest AP winning each 10 cm cell. Wall losses aren't a lookup table: each material is built as layers (drywall is plasterboard, air gap, plasterboard) and computed with ITU-R P.2040's multi-layer slab method, averaged over polarisations and across the band. At 5 GHz that gives drywall 2.4 dB, brick veneer 9.0 dB and 200 mm concrete 26.5 dB. Floor loss depends on the angle the path crosses the slab. Against NIST's measurements, drywall and glass come out within 2.3 dB at 5 and 6 GHz; masonry is much worse (concrete under-predicted by 28–30 dB against NIST's 203 mm sample at 5 GHz, partly moisture), and wood is under-predicted in every source.

**The rest:**

- Placement optimizer: best spot for one AP, move several at once, add one more, or "how many do I need" for a coverage goal (up to four added). Lock the ones that can't move. Runs in a Web Worker so the heatmap stays live.
- Channel planner: a search over channels and widths (exact up to 20,000 choices per band and width, and it says when it isn't) so APs that hear each other (by the CCA thresholds) don't overlap, US or EU channels, DFS optional. Overlap, roaming and SINR interference views.
- Scans: paste the output of `netsh`, `system_profiler`, `nmcli` or `iw` (or, on Windows and macOS, SignalPlan's own PowerShell or Swift script, or a WiFi Analyzer export). Your BSSIDs become survey readings, neighbours become interference, and a neighbour heard at three spots or more can be located on the plan.
- Calibrate: bounded least-squares fit of the path loss exponent, a device offset and the materials that enough readings cross, kept within published limits, with leave-one-spot-out error before and after.

**The honest part: no real home has been surveyed or scanned with it yet.** The checks are against published lab measurements, the ITU-R P.1238 indoor model, and synthetic homes whose readings the model itself generated. Those show the fitting works, not that a real house matches. Known limits: no reflection or diffraction (shadows behind strong walls are too dark), omnidirectional APs, downlink only, no furniture or people, and every wall of one material shares one loss.

**What I'd like from you:** survey data from a real house. A floor plan (even a rough one), wall materials, AP positions and models, and RSSI per BSSID at a set of spots. `iw`/`nmcli`/`netsh` scans taken at known spots are ideal, since the app reads them directly; Ekahau or NetSpot exports are welcome too [AUTHOR: confirm you're happy to take those and convert them by hand, since the app doesn't import them]. An issue on GitHub is the best place, as is anything in the model you think is wrong.

[AUTHOR: optional line on the stack for this crowd, e.g. TypeScript, React, three.js, propagation engine in Web Workers, if you want it]

Try it: https://signalplan.pages.dev
Code and docs: https://github.com/NC4321/SignalPlan (the equations and sources are in docs/MODEL.md)
Write-up on the physics and how far to trust it: https://github.com/NC4321/SignalPlan/blob/main/docs/writeup.md

## Fact sources

| Claim                                                        | Source                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IndexedDB, URL fragment, Web Workers, stack                  | [README › For developers](../../README.md#for-developers)                                                                                                                 |
| Multi-wall, COST 231, 10 cm cells, strongest AP              | [writeup.md › The model](../writeup.md#the-model)                                                                                                                         |
| P.2040 layers; 2.4 / 9.0 / 26.5 dB at 5 GHz                  | [writeup.md › Walls are computed](../writeup.md#walls-are-computed-not-looked-up), [MODEL.md › Wall materials](../MODEL.md#wall-materials)                                |
| NIST within 2.3 dB; masonry 28–30 dB; wood                   | [writeup.md › What it was checked against](../writeup.md#what-it-was-checked-against)                                                                                     |
| Angle-dependent floors                                       | [writeup.md › Floors depend on the angle](../writeup.md#floors-depend-on-the-angle-walls-dont)                                                                            |
| Optimizer, up to four added, lock                            | [writeup.md › The optimizer](../writeup.md#the-optimizer)                                                                                                                 |
| Channel planner exact search, CCA, US/EU, DFS                | [writeup.md › Channels](../writeup.md#channels), [README › See your coverage](../../README.md#see-your-coverage)                                                          |
| Scan formats, own script, locating neighbours at three spots | [writeup.md › Scans](../writeup.md#scans-and-locating-neighbours), [README](../../README.md#check-it-against-your-home)                                                   |
| Calibrate method and held-out error                          | [writeup.md › Checking against reality](../writeup.md#checking-against-reality)                                                                                           |
| No real home; synthetic readings; limits                     | [writeup.md › Real-home results](../writeup.md#real-home-results), [What it can't do](../writeup.md#what-it-cant-do), [MODEL.md › Known limits](../MODEL.md#known-limits) |
| No Ekahau/NetSpot import (readings import is CSV or JSON)    | [README › Check it against your home](../../README.md#check-it-against-your-home)                                                                                         |

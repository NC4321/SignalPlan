# r/HomeNetworking draft

For people working out their own home's Wi-Fi: where the router goes, whether they need a mesh node, why one room is dead. Keep it practical and light on physics; link the explainer for anyone who wants more.

**Before posting:** read [the rules section](README.md#rhomenetworking) and message the moderators first. Self-promotion has been forbidden there in all forms, with a relaxation under discussion (unconfirmed, checked 2026-10-05). This draft is written to fit the proposed criteria: a text post, understandable without leaving Reddit, link at the bottom, nothing to buy. Rewrite it in your own words before posting ([why](README.md#these-drafts-are-not-your-words-yet)).

**Post type:** text. **Flair:** [AUTHOR: whatever the sub or the moderators say fits, if any]

## Title options

1. I made a free browser tool that predicts Wi-Fi coverage from your floor plan. It hasn't been tested in a real home yet, and I'd like help with that
2. Free, open-source Wi-Fi planner: draw your floor plan, see predicted coverage on each floor, and get a suggestion for where the router should go
3. Looking for people who've measured their home's Wi-Fi, to test a free coverage planner against real readings

## Body

[AUTHOR: one or two sentences in your own words on why you built it. The write-up's opening, which you wrote, is: "I wanted to know where to put a router, and how many access points a house needs, without a survey kit."]

It's called SignalPlan. You draw your floor plan to scale (or trace over an image of one), pick what each wall is made of, drop in your router or access points, and it shows a heatmap of the predicted signal on 2.4, 5 and 6 GHz, floor by floor, including how signal gets between storeys.

It's free and open source (MIT), runs entirely in your browser, and needs no account. Plans are saved in your browser and nothing is uploaded; even a share link carries the plan in the part of the address that never reaches the server.

What it can do:

- **Show where coverage is weak** before you buy or move anything, with the share of your floor that's Excellent, Good, Fair or Weak.
- **Suggest a better spot** for your router, suggest one more access point, or tell you how many you need to cover a target share of the floor (up to four added). You can lock the router where the line comes in so it stays put. On the built-in sample home, moving the router takes 5 GHz coverage at Fair or better from 86.9% to 92.0%, and adding a second access point gets it to 100%.
- **Plan channels** so your access points don't share one, and show where they'd interfere, with your neighbours' networks counted.
- **Check it against your home:** type in signal readings (dBm) at a few spots, or paste a scan from Windows, macOS or Linux (or export one from WiFi Analyzer on Android), and it shows how far off the prediction is. "Calibrate" then adjusts the model to your readings.

What you should know before trusting it:

- **No real home has been surveyed or scanned with it yet.** It's checked against published lab measurements of wall materials and an ITU indoor model, and calibration is tested on made-up homes, but not on a real house. That's the biggest gap.
- It follows a straight line from each access point to each spot and ignores reflections, so rooms behind thick walls (concrete, brick, metal) will look worse than they really are.
- The wall types are typical North American constructions. Your walls may differ: metal studs, foil-backed insulation or plaster on lath all add loss it doesn't know about.
- It predicts router-to-device signal only. Your phone transmits much more weakly than the router, so at the edge of coverage the connection back can fail first.

**What I'm asking for:** if you've ever measured signal around your home (a phone app showing dBm, NetSpot, Ekahau, anything), I'd love to compare it with what SignalPlan predicts. A rough floor plan, what the walls are made of, where the access points are, and readings at a handful of spots is enough. You can open an issue on GitHub with them, or draw it in the app and send me a share link. Bug reports and "this confused me" are just as welcome.

[AUTHOR: say whether you're happy for people to DM you, or prefer GitHub issues only]

Try it: https://signalplan.pages.dev
How it works, in plain words: https://github.com/NC4321/SignalPlan/blob/main/docs/HOW-IT-WORKS.md
Code: https://github.com/NC4321/SignalPlan

## Fact sources

Every claim above, where it's backed up. Re-check them on the day.

| Claim                                                         | Source                                                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free, MIT, browser, no account, nothing uploaded, share links | [README](../../README.md), [D87](../DECISIONS.md#d87-scope-for-phase-9-polish-documentation-and-launch--2026-10-04)                                                                 |
| 2.4/5/6 GHz, floors, tracing, materials                       | [README › Features](../../README.md#features)                                                                                                                                       |
| 86.9% → 92.0% → 100% on the sample home                       | [writeup.md, Figure 2](../writeup.md#the-optimizer) and its footnote                                                                                                                |
| Up to four added, lock                                        | [README › Let it place access points](../../README.md#let-it-place-access-points)                                                                                                   |
| Scans from Windows, macOS, Linux, WiFi Analyzer               | [README › Check it against your home](../../README.md#check-it-against-your-home)                                                                                                   |
| No real home surveyed or scanned                              | [writeup.md › Real-home results](../writeup.md#real-home-results), [#132](https://github.com/NC4321/SignalPlan/issues/132), [#144](https://github.com/NC4321/SignalPlan/issues/144) |
| Straight line, constructions, downlink only                   | [MODEL.md › Known limits](../MODEL.md#known-limits)                                                                                                                                 |
| North American constructions                                  | [HOW-IT-WORKS.md › Walls](../HOW-IT-WORKS.md#3-walls-materials-and-how-much-each-costs)                                                                                             |

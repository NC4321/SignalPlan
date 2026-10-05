# Show HN draft

For developers who are comfortable with dB and will click through to the write-up. HN convention is a short post: what it is, how to try it, what's interesting, what's missing. The detail lives in [the write-up](../writeup.md).

**Before posting:** Reddit has gone first and the important issues it raised are fixed ([order](README.md#order)). Read [the rules section](README.md#show-hn). HN's guidelines don't allow generated or AI-edited comments (as quoted, unconfirmed), so **write the text and every reply yourself**, using this only as a guide to what to cover ([why](README.md#these-drafts-are-not-your-words-yet)).

**URL:** https://signalplan.pages.dev (the app, not the write-up: Show HN is for things people can try, and puts reading material off topic).

**Text:** the body below. [AUTHOR: if the submit form doesn't show the text with a URL, post it as the first comment instead]

## Title options

All under the 80-character limit, counted with the prefix.

1. `Show HN: SignalPlan – predict home Wi-Fi coverage from a floor plan` (69)
2. `Show HN: SignalPlan – plan home Wi-Fi from a floor plan, in the browser` (73)
3. `Show HN: SignalPlan, an open-source Wi-Fi coverage planner for houses` (69)

D96 leaves the title to you. [AUTHOR: pick or write the title]

## Body

[AUTHOR: one sentence in your own words on why you built it. The write-up opens: "I wanted to know where to put a router, and how many access points a house needs, without a survey kit."]

SignalPlan predicts Wi-Fi coverage from a floor plan you draw: free-space loss plus a loss for each wall crossed, with wall losses computed from ITU-R P.2040's layered-slab method rather than looked up, and floor loss that depends on the angle. On top of that are a placement optimizer, a channel planner, and a calibration step that fits the model to readings or scans of your own network.

It's free and open source (MIT), runs in the browser, and needs no account; plans stay on your device.

The important caveat: no real home has been surveyed or scanned with it yet. It's checked against published lab measurements and an ITU-R indoor model, and calibration only on synthetic homes, so it's unknown how well it predicts a real house. If you have survey data for your home and a floor plan, I'd like to compare (GitHub issue).

Write-up on the physics, the optimizer, and how far to trust them: https://github.com/NC4321/SignalPlan/blob/main/docs/writeup.md

Code: https://github.com/NC4321/SignalPlan

## Questions to expect

Answers the repo backs up, to have ready (in your own words when you reply).

- **Why not ray tracing?** No router data to source antenna patterns from, multi-wall is the standard citable approach, and one wall check per cell redraws while you drag: a 300 m² house with 60 walls and two APs takes a median 11.5 ms on the development machine. Cost: no reflection or diffraction. ([writeup › Why not ray tracing](../writeup.md#why-not-ray-tracing), D24)
- **How accurate is it?** Drywall and glass within 2.3 dB of NIST at 5 and 6 GHz; masonry badly under-predicted against NIST (28–30 dB for 203 mm concrete at 5 GHz), wood under-predicted in every source. Nothing yet from a real home. ([writeup › What it was checked against](../writeup.md#what-it-was-checked-against))
- **Does the optimizer find the best spot?** Good spots for this model, not guaranteed best ones: it's compared against a router in the middle of the floor, invariants and toy rooms, not exhaustive search. ([writeup › The optimizer](../writeup.md#the-optimizer))
- **How does it compare with Ekahau or Hamina?** Those do predictive planning for enterprise Wi-Fi engineers; this is the same kind of model for a house, free and open. [AUTHOR: confirm you're comfortable with this comparison; D96 left the write-up's sentence for you to confirm]
- **Does anything leave the browser?** No: plans in IndexedDB, share links in the URL fragment, scans pasted or opened by you. No analytics (D87).
- **How was it built?** [AUTHOR: your answer, including whether you used an AI coding assistant; the commit trailers show it]

# M3 functional pass by the author — 2026-09-28

Part of closing M3 (whole home), done after the exit gate ([#93](https://github.com/NC4321/SignalPlan/issues/93), D58) merged.

## What was tried

The project's author used the M3 features themselves on the live site, on a Lenovo ThinkPad T16 Gen 4 (Intel Core Ultra 7 265U, 32 GB RAM) in Chrome on Windows:

- floors: the floor list, floor constructions, the ghosted floor below, and signal between floors (D50–D53);
- stairwells and atriums (D54);
- the optimizer across floors (D55);
- the 3D view (D57), including the frame-rate measurement with `?fps`: 16.7 ms median (60 fps) and 16.9 ms at the 95th percentile (D58).

## Result

The author reported that everything seemed to work very well and was clear and straightforward to use, and that the 3D view felt very responsive even when flicked around quickly. No new issues were filed.

## What this doesn't cover

As with the [M1](2026-09-28-functional-pass.md) and [M2](2026-09-28-m2-functional-pass.md) passes, this was a check by someone who knows the app, not the first-time-user test in the [test script](test-script.md). Watching 2–3 first-time users ([#77](https://github.com/NC4321/SignalPlan/issues/77)) moves to M4 and still must happen before any launch post (D39, D48, D59).

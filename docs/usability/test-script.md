# Usability test script

For watching 2–3 people use SignalPlan for the first time ([#77](https://github.com/NC4321/SignalPlan/issues/77)), as part of the Phase 9 exit gate in [#163](https://github.com/NC4321/SignalPlan/issues/163). About 15 minutes per person.

## Before each session

- Use a fresh browser profile or a private window, so there are no saved plans and the guided first run (D90) appears. Open https://signalplan.pages.dev on a laptop. If someone uses a phone, note that too.
- Don't show or explain the app first. Sit beside the person, not in front of the screen.
- Have the note table below ready, and a timer.

## What to say

Read this aloud, word for word:

> I'm testing the app, not you, so there are no wrong answers. Please think out loud: say what you're looking for, what you expect to happen, and what surprises you. I'll mostly stay quiet, even if you get stuck, because that's what I need to see.

Then open the app in front of them and start the timer. Say only:

> Have a look, and tell me what you think this is for.

Note what they say and how long it takes. The guide appears on its own; let them use it, skip it or ignore it, and note which. Stop the timer when they say what it's for.

Then give one task at a time. Read it, and don't point at anything:

1. "Start a new plan of your own."
2. "Draw one room, about the size of the room we're in."
3. "Add a door and a window to that room."
4. "Put a Wi-Fi router in the room, then move it to a different spot."
5. "Look at the signal on each Wi-Fi band the app offers."
6. "How much of your room has good enough Wi-Fi? Tell me the number."

If they ask what something means, reply: "What do you think it means?"

## What to watch for

- In the first 30 seconds: what they read first (the guide, the heatmap, the title), and whether they follow the guide to its end.
- Where they look first for each task (toolbar, File menu, panel, canvas).
- Hesitations over about 10 seconds, and what they're looking at during them.
- Wrong turns: drawing over the sample home, adding a second router instead of moving one, starting a wall by accident, not scrolling the right panel.
- Whether they notice the heatmap change when they move the router or switch bands.
- Whether they find the coverage percentage, and how.
- Anything they say is confusing, and any words they use that differ from the app's.

## When to step in

Only if they're stuck for **2 minutes** on one task, or getting frustrated. Then give the smallest hint that works, in this order:

1. "What are you trying to do right now?"
2. "Is there anything on screen that might help?"
3. Point to the area (for example the left toolbar) without naming the control.

Log every hint. A task that needed a hint counts as **not completed unaided**.

## Notes

One row per task per person:

| Person | Task        | Done unaided? (Y / hint / N) | Time | Where they got stuck | Quote |
| ------ | ----------- | ---------------------------- | ---- | -------------------- | ----- |
| P1     | What is it? |                              |      |                      |       |
| P1     | 1           |                              |      |                      |       |
| P1     | 2           |                              |      |                      |       |
| P1     | 3           |                              |      |                      |       |
| P1     | 4           |                              |      |                      |       |
| P1     | 5           |                              |      |                      |       |
| P1     | 6           |                              |      |                      |       |

Afterwards, ask:

- "What was hardest?"
- "What would you use this for, if anything?"
- "Was anything missing?"

## After the sessions

- The gate passes if every person says what SignalPlan is for within 30 seconds and completes tasks 1–4 unaided, and at least two of three complete 5 and 6 unaided. For "what it is", any answer along the lines of "it predicts Wi-Fi coverage in a home" counts.
- File an issue for anything that stopped two or more people, or needed a hint. Compare with the [agent walkthrough](2026-09-27-agent-walkthrough.md) and note which of its findings real people did or didn't hit.
- Write the notes up in `docs/usability/` and record the result in #77 and #163 (and a `Dn` entry if it changes the plan).

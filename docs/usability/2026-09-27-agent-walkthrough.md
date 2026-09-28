# Agent cold-start walkthrough — 2026-09-27

A first pass at the M1 exit gate ([#46](https://github.com/NC4321/SignalPlan/issues/46)): "a stranger can use it without instructions". It is **not** a substitute for watching real people; that still has to happen, using the [test script](test-script.md).

## Method

An agent drove a local production build (`pnpm build` + `vite preview`) in Chromium through Playwright, judging each step only from what was on screen, with no docs. It took screenshots at every step and watched for page errors and console errors or warnings; there were **none**.

Tasks, as in #46:

1. Start a plan of your own.
2. Draw a room (four walls).
3. Add a door and a window.
4. Place a router, then drag it somewhere else.
5. Switch between 2.4, 5 and 6 GHz.
6. Find how much of the room is covered.

Repeated at 1280 × 800 (laptop), with the Imperial units toggle (including a length typed as `10'`), and at 390 × 844 with touch (phone).

## What worked

- **Drawing walls** is discoverable: once Wall is picked, the panel explains clicking corners, closing a room, typed lengths and snapping, and a live length and angle label follows the pointer. Double-tap ends a chain on a phone.
- **Doors and windows**: the panel says "Click a wall to add a door", a preview snaps to the wall under the pointer, and the new opening is selected with its width and material.
- **Dragging an access point** with Select shows a grab cursor, and undo names the move ("Undo Move Router").
- **Bands** switch instantly; the coverage share updates per band.
- **Imperial** works throughout, including typed feet (`10'` → a 3.05 m wall) and "sq ft" in the summary.
- **Phone**: no horizontal scrolling; the toolbar moves to the bottom and the panel becomes a drawer.

## Findings

Severity: **blocker** = can't finish the task; **major** = likely to stall or mislead a newcomer; **minor** = friction or polish.

### Major

**1. The Access point tool stacks a new access point on top of an existing one.** _Fixed in this pass ([#60](https://github.com/NC4321/SignalPlan/issues/60))._
The tool stays active after placing (D25). Pressing on the access point just placed (or the router) to drag it added "Access point 1" at the same spot, and the drag did nothing. Two access points stacked exactly are invisible and double the signal from that spot. Now a press on an existing access point grabs it, as with Select (D34).

**2. The coverage summary is below the fold** ([#61](https://github.com/NC4321/SignalPlan/issues/61), needs a decision).
The one-line answer ("86% of 150 m² at Fair or better") is the last thing in the Properties panel, below the wall and signal legends. At 1280 × 800 it's off-screen on first load, and much further down while something is selected. On a phone it's inside the **Details** drawer, and that label gives no hint it's there. Suggested: pin the share and target near the top of the panel or in the status bar.

**3. With the Wall tool still active, dragging the router starts a wall** ([#62](https://github.com/NC4321/SignalPlan/issues/62), needs a decision).
After closing a room, the Wall tool stays active (D17). Pressing on the router to move it started a new wall from its centre. Only the crosshair cursor hints that Wall is still on. Suggested: in the Wall tool with no chain in progress, a press on an access point grabs it.

### Minor

**4. An empty New plan gives no hint where to start.** _Fixed in this pass._
The panel showed "Walls 0" and the status bar "Point at the plan", but nothing suggested the Wall tool. The panel now says: "To start, pick **Wall** (W) and click to place each corner; click the first corner again to close a room. Drag an access point to move it." It disappears once there's a wall.

**5. A New plan shows nothing on 6 GHz, and the notice didn't say why.** _Fixed in this pass._
A New plan's router is dual-band (D20), while the Access point tool adds tri-band ones, so 6 GHz starts blank. The notice "No access point on this floor broadcasts on this band." now adds "Select one and turn the band on under Bands."

**6. An empty plan's heatmap is a hard-edged 10 m square of solid "Excellent".** It fills the whole starting view and can look like a rendering fault rather than coverage. It's correct (5 m around the router, D20), but a fade or outline at the grid edge would read better.

**7. The Door and Window tools give no feedback when you click away from a wall.** Nothing happens and nothing says why. The panel does say "Click a wall", so this is recoverable.

**8. Opening materials are a little odd.** Windows offer "Open (no door)", and doors offer Drywall, Brick and Concrete. Harmless, but "Open (no window)" or "Open" would read better for windows.

**9. There's no scale bar on the canvas.** The grid has no labelled spacing; distances come only from the pointer readout and wall labels. (The PNG export has a scale bar.)

**10. Wall-tool hints use desktop terms on a phone.** "Double-click, Enter or Esc", "Hold Alt" and "Ctrl+Z" don't map to touch, though double-tap and the Undo button do work.

**11. The first visit opens the sample home.** That's good for a demo, but starting your own plan is only under File › New plan. A tester told "draw your home" may start drawing over the sample. Watch for this with real people.

**12. A small room with the router inside is uniformly "Excellent".** Adding a door or window changes nothing visible. That's physically right, but a tester may think the door did nothing. Also one to watch for with real people.

## Not tested

- Tracing over a floor-plan image, saving and opening files, the plans list, and export. They're outside the #46 tasks.
- Screen-reader use (covered by D23 and the axe checks in e2e).
- Real touch hardware; phone results come from Chromium's touch emulation.

<div align="center">

# SignalPlan

**Plan your home's Wi-Fi before you buy a single router.**

Draw your floor plan to scale, drop in access points, and see predicted coverage on 2.4, 5 and 6 GHz, floor by floor, in 2D and 3D.<br>
Then let the optimizer tell you where they should go and how many you need, and check the prediction against a scan of your own Wi-Fi.

[![CI](https://github.com/NC4321/SignalPlan/actions/workflows/ci.yml/badge.svg)](https://github.com/NC4321/SignalPlan/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/NC4321/SignalPlan)](https://github.com/NC4321/SignalPlan/releases) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](tsconfig.base.json)

### [Open SignalPlan →](https://signalplan.pages.dev)

Free · Runs in your browser · No account · Plans stay on your device

<br>

<img src="docs/demo.gif" width="800" alt="Drawing a brick room with a concrete wall partway across it in SignalPlan, placing an access point, then dragging it around while the coverage heatmap updates and shows the shadow behind the concrete wall">

</div>

<br>

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/demo-optimizer.gif" alt="The optimizer moves the sample home's router from 86% to 92% coverage, then suggests a second access point, moving the router again, which brings it to 100%">
      <h3>Smart placement</h3>
      Find the best spot for your router, add one more access point, or ask how many you need to hit a coverage goal.
    </td>
    <td width="50%" valign="top">
      <img src="docs/demo-3d.gif" alt="A two-storey home in the 3D view, with each floor's heatmap, spread apart and rotated">
      <h3>Whole-home 3D</h3>
      Stack floors, cut stairwells, and see how signal passes between storeys in an interactive 3D view.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/demo-views.gif" alt="The upper floor of a home with three access points shown as a roaming map, then an overlap map, then an interference map where 19% of the floor is too noisy; after the channels are planned again with DFS allowed, none of it is">
      <h3>Roaming, overlap and channels</h3>
      See which access point a phone would use, where they compete and where they interfere, then plan channels so they don't.
    </td>
    <td width="50%" valign="top">
      <img src="docs/demo-survey.gif" alt="Survey pins on a bungalow show the prediction off by 4 to 8 dB. A scan is added at a new spot, then Calibrate and Apply bring the errors down to between minus 3 and plus 2 dB">
      <h3>Check it against your home</h3>
      Scan your Wi-Fi where you stand, see how far the prediction is off, then calibrate the model to your home.
    </td>
  </tr>
</table>

## Features

### Draw your home

- **Walls to scale** with snapping, typed lengths and angles, and seven materials: drywall, brick, concrete, glass, low-E glass, wood and metal.
- **Doors and windows** that slide along walls, including open doorways.
- **Trace a floor plan** from a PNG, JPEG or WebP image: set its scale with two clicks and draw over it.
- **Metric or imperial**, with undo and redo for every edit.

### See your coverage

- **Live heatmap** on 2.4, 5 or 6 GHz that updates while you drag an access point, with a colour-blind-safe legend.
- **Coverage summary**: the share of your floor area that reaches Excellent, Good, Fair or Weak.
- **Access points** with their own mounting height, bands, transmit power, and channel and width per radio.
- **Channels by region** (United States or European Union), with an option for 5 GHz DFS channels.
- **Overlap and Roaming views**, with defaults taken from Apple's roaming rules for iPhone and iPad.
- **Interference view**: signal to interference and noise (SINR) in each spot, banded by the Wi-Fi rate it allows, so you can see where access points on the same or overlapping channels get in each other's way, with your neighbours' networks, typed in or taken from a scan, as background interference.
- **Channel planner** that suggests a channel and width for every radio, so access points that hear each other don't share one, with a reason for each.

### Check it against your home

- **Survey spots**: click where you measured signal and enter each access point's reading in dBm (the signal strength your device reports), or import a CSV or JSON file of readings.
- **Scan your network**: run a one-line command or SignalPlan's script on Windows, macOS or Linux (or export a scan from WiFi Analyzer on Android), paste it or open the file, and mark which networks are yours. Your radios' channels and the neighbours' networks fill in from it. Place it at the spot you stood to use it as that spot's readings.
- **Error report**: each pin shows how far the prediction is from your reading, coloured by size, with the average error per band.
- **Calibrate** adjusts the model to your readings, band by band: how quickly signal fades, your device's offset, and the loss of each wall and floor material that enough readings cross, kept within published limits. Preview the fit and the error before and after, then Apply (one undo step) or Reset to defaults.
- **Located neighbours**: a neighbour's network heard at three survey spots or more can be placed on the plan, with a circle for how sure the position is, and then counts in the Interference view and the channel plan where it was located. "Check its position" does the same for your own access points, saying whether the readings agree with where you put them.

### Plan the whole home

- **Multiple floors**, basements included, over timber joist or concrete slab floors.
- **Stairwells and atriums** where signal skips the floor loss.
- **Floor below shown faintly** while you draw, so walls line up between storeys.
- **3D view** of every floor and its heatmap, which you can rotate, zoom and spread apart.

### Let it place access points

- **Suggest a spot** for one access point, previewed on the heatmap before you apply it.
- **Several at once**: move every access point together, or add one more.
- **How many do I need?** Pick a goal from 80 to 100% of the floor and it finds the fewest access points that reach it, up to four added.
- **Lock** access points that can't move, such as the router where the line comes in.

### Keep and share it

- **Autosaves in your browser**, with a list of your plans.
- **Save and open** `.signalplan.json` files.
- **Share a link** with the plan in it; nothing is uploaded.
- **Export a PNG** of the floor with its heatmap, legend, coverage summary and scale bar.
- **Keyboard and screen-reader support**, with every shortcut a ? away, and a layout that works on phones.
- **A short guided first run** over the sample home on your first visit, shown once and replayed from the shortcuts dialog.

## How the model works

For each cell of the floor, SignalPlan starts from how much a radio's signal fades over open air, then takes off a fixed amount for every wall the straight line from the access point to that cell passes through and, for a floor, an amount that depends on how steeply the line crosses it. What a wall or floor takes off depends on what it is made of and on the band: a drywall partition costs a few dB, a concrete wall many more.

The strongest access point sets the cell's colour. The same model feeds the coverage summary, the overlap, roaming and interference views, the channel planner and the optimizer. Calibrating swaps the defaults for values fitted to your own readings.

**[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)** explains this without the maths, with diagrams. **[docs/MODEL.md](docs/MODEL.md)** has the equations, the sources and the tests.

### Built on published measurements

Every material loss and constant is traced to a primary source.

- **Wall and floor losses** are computed from the electrical properties in [ITU-R P.2040](https://www.itu.int/rec/R-REC-P.2040), using layered constructions such as drywall on studs or a brick veneer.
- **Checked against lab measurements** from NIST, Shakya et al., and Muqaibel at Virginia Tech. Drywall and glass agree with NIST within 2.3 dB at 5 and 6 GHz and within 1 dB at 2.0 GHz, and a wooden door and glass agree with Muqaibel within about 0.5 dB.
- **Checked against the ITU-R P.1238-13 indoor model.** A two-storey test home stays within 1 dB of it on the main floor, and within 0.7 dB (2.4 GHz) and 3.4 dB (5 GHz) upstairs.
- **Honest about its limits.** The model follows the straight line from each access point and ignores reflections and diffraction, so areas behind strong walls look darker than they are. It under-predicts the loss of some wood by up to 5 dB. Predictions haven't yet been checked against measurements in a real home ([#132](https://github.com/NC4321/SignalPlan/issues/132), [#144](https://github.com/NC4321/SignalPlan/issues/144)). [All known limits →](docs/MODEL.md#known-limits)

Every design choice and its reasoning is recorded in the [decision log](docs/DECISIONS.md).

## Roadmap

| Version                                                            | Milestone       | Highlights                                                                        |
| ------------------------------------------------------------------ | --------------- | --------------------------------------------------------------------------------- |
| [v0.3.0](https://github.com/NC4321/SignalPlan/releases/tag/v0.3.0) | Whole home      | Multiple floors, signal between floors, stairwells, 3D view                       |
| [v0.2.0](https://github.com/NC4321/SignalPlan/releases/tag/v0.2.0) | Smart placement | Placement optimizer, several access points, "How many do I need?", locking        |
| [v0.1.0](https://github.com/NC4321/SignalPlan/releases/tag/v0.1.0) | Single floor    | Walls to scale, doors and windows, tracing, heatmap, coverage summary, PNG export |

**On the site, not yet released:** everything since v0.3.0, including channel planning and the Overlap, Roaming and Interference views, survey spots and Calibrate, Scan your network and located neighbours, share links, shortcuts and the guided first run. See the [changelog](CHANGELOG.md).

The phase-by-phase plan is in [docs/OUTLINE.md](docs/OUTLINE.md); the [milestones](https://github.com/NC4321/SignalPlan/milestones) list what's next.

**Next**, the rest of the polish and launch phase (the README and [how it works](docs/HOW-IT-WORKS.md) are done): a short write-up on the physics and the optimizer ([#161](https://github.com/NC4321/SignalPlan/issues/161)), launch posts ([#162](https://github.com/NC4321/SignalPlan/issues/162)), and the exit gate: a stranger lands on the demo, understands it in 30 seconds and plans a room without help, tested with first-time users ([#163](https://github.com/NC4321/SignalPlan/issues/163)).

**Still open: checks in a real home.** Calibration lowering the error on a real home ([#132](https://github.com/NC4321/SignalPlan/issues/132)), and scanning your own network from a laptop and a phone, then planning from it ([#144](https://github.com/NC4321/SignalPlan/issues/144)). Both are tested on synthetic homes only so far.

## For developers

SignalPlan is a TypeScript monorepo of three parts: a React editor, a propagation engine with no DOM, and a floor plan package that defines the plan format and checks it.

### Architecture

```mermaid
flowchart TB
  subgraph web["apps/web"]
    ui["Editor UI<br>canvas, panels, 3D view"]
    store["Editor store"]
    lib[("Plan library<br>IndexedDB")]
    subgraph workers["Web Workers"]
      cw["Coverage"]
      pw["Placement"]
      kw["Calibration"]
    end
  end
  engine["packages/engine<br>propagation model"]
  fp["packages/floorplan<br>schema, migrations, scan parsers"]

  ui -->|edits| store
  store -->|plan| ui
  store <-->|autosave, load| lib
  store -->|plan| cw & pw & kw
  cw -->|coverage grid| ui
  pw & kw -->|suggestion, fit| store
  workers -.->|imports| engine
  engine -.->|imports| fp
```

Solid arrows carry data; dotted ones are imports. The diagram is simplified, and what it leaves out is here. The store keeps the plan, and every edit goes through it; the autosaver saves it to the library a moment after the last change, and My plans and Open file talk to the library directly too. The coverage worker takes a plan, a floor and a band and returns a grid, which the 2D canvas, the 3D view (through a second coverage worker) and the summaries read. The placement and calibration workers return a suggestion or a fit, which waits in the store as a preview until you apply it. The editor (UI and store) also uses the floor plan package directly: for plan edits, for checking a plan on load (files, share links and the library) and for reading pasted or opened scans. The engine imports geometry and band tables from the floor plan package, not just types. Several quick engine functions also run on the main thread: the PNG export's coverage, the error report's predictions, the view summaries, the channel planner and locating a neighbour.

The rules that hold it together:

- The engine and the floor plan package have no DOM or React, so the engine's heavy work runs in Web Workers and the heatmap keeps updating while a search runs.
- A plan is migrated and validated against the schema every time it is loaded: from a file, a share link, the library or the sample home.
- Nothing leaves the browser: plans live in IndexedDB, share links carry the plan in the part of the address after `#`, and scans are pasted or opened by you.

| Path                 | Contents                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | React + Vite editor, Canvas 2D, three.js 3D view                                                                     |
| `packages/engine`    | Propagation engine and placement optimizer, pure TypeScript                                                          |
| `packages/floorplan` | Floor plan JSON schema (Zod), validation, migrations, scan parsers and test homes                                    |
| `docs/`              | [Model](docs/MODEL.md), [file format](docs/FLOORPLAN.md), [decisions](docs/DECISIONS.md), [outline](docs/OUTLINE.md) |

### Setup

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm dev                              # start the web app
pnpm check                            # typecheck, lint, format check and unit tests
pnpm --filter @signalplan/web e2e     # browser tests (Playwright)
```

The demo GIFs are recorded by [`scripts/record-demo.mjs`](scripts/record-demo.mjs). Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Nathan

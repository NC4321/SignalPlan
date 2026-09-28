# Floor plan format

A SignalPlan floor plan is a JSON document. The editor writes it, the engine reads it, and users save and load it as a file named `<plan name>.signalplan.json`. The schema lives in [`packages/floorplan`](../packages/floorplan/src/schema.ts); this page explains its shape and rules.

## Conventions

- **Units:** every length is in metres. Display units (metric or imperial) are a user setting and are never stored in the plan.
- **Axes:** x increases to the right and y increases downward, matching the canvas.
- **Walls** are thin segments between two shared nodes, plus a material. Moving a node moves every wall attached to it.
- **Openings** (doors and windows) sit inside one wall, placed by their distance from the wall's `from` node.

## Shape (version 1)

```text
Plan
├─ schemaVersion: 1
├─ name
├─ floors[]            at least one
│  ├─ id, name
│  ├─ elevationM       height of this floor above the lowest one
│  ├─ heightM          floor-to-ceiling height
│  ├─ material?        the slab under this floor: timber-joist | concrete-slab
│  ├─ nodes[]          { id, x, y }
│  ├─ walls[]          { id, from, to, material }
│  ├─ openings[]       { id, wallId, kind: door | window, offsetM, widthM, material }
│  ├─ floorOpenings[]? { id, points[]: { x, y } }  holes in the slab: stairwells, atriums
│  └─ background?      { imageId | dataUrl, x, y, metresPerPixel, widthPx, heightPx,
│                        opacity, visible, locked }
├─ accessPoints[]
│  └─ { id, name, floorId, x, y, heightM, radios[]: { band, txPowerDbm? } }
├─ coverageTarget?     excellent | good | fair | weak
├─ region?             US | EU
└─ allowDfs?           boolean
```

Wall materials are `drywall`, `brick`, `concrete`, `glass`, `low-e-glass`, `wood` and `metal`; each stands for a typical North American construction described in [MODEL.md](MODEL.md#wall-materials). Openings can use any of these, or `open` for a doorway with no door. Bands are `2.4GHz`, `5GHz` and `6GHz`. `txPowerDbm` is the radio's EIRP (antenna gain included); a radio without it uses the engine's default for its band.

A floor's `material` is its slab, the floor under its rooms, which signal crosses to and from the storey below: `timber-joist` or `concrete-slab`, described in [MODEL.md](MODEL.md#floor-materials). Without it the floor is `timber-joist`. The lowest floor's slab is never crossed. See [D51](DECISIONS.md#d51-signal-between-floors--2026-09-28).

A floor's optional `floorOpenings` are holes in its slab, such as stairwells and atriums: each is a polygon of at least three corners in order, in plan metres. Signal crossing the slab inside one pays no floor loss, and its area isn't counted as floor. Validation checks that ids are unique within the floor and that each opening has some area. `addFloorOpening`, `moveFloorOpening`, `moveFloorOpeningCorner` and `deleteFloorOpening` in `floorOpenings.ts` edit them; adding refuses an outline under 0.01 m², and moving a corner refuses a move that would leave one. The field was added without a version bump, since older plans simply have none. See [D54](DECISIONS.md#d54-stairwells-and-atriums--2026-09-28).

Floors stack by `elevationM`; their order in `floors[]` doesn't matter. `addFloor`, `moveFloor` and `deleteFloor` in `floors.ts` add a floor on top or at the bottom (on a slab of the construction's real thickness), swap a floor with its neighbour, and delete a floor with its access points. See [D52](DECISIONS.md#d52-the-floor-list--2026-09-28).

An access point with `locked: true` can't be moved, by hand or by the placement optimizer; without it the access point is unlocked. See [D43](DECISIONS.md#d43-locking-access-points-in-place--2026-09-28).

`coverageTarget` is the signal level the coverage summary counts towards, named after the heatmap bands; without it the summary uses `fair`. See [D27](DECISIONS.md#d27-coverage-summary--2026-09-27).

`region` says whose channel and power rules the plan follows; without it the plan is `US`. `allowDfs: true` lets 5 GHz DFS channels be used; without it they aren't. The rules themselves live in the engine, not the plan ([MODEL.md](MODEL.md#channels-and-regions), [D62](DECISIONS.md#d62-channels-by-region--2026-09-28)).

A floor may have a **background** image to trace over. `x` and `y` place its top-left corner and `metresPerPixel` sets its scale. In the browser the image lives in its own store and is referenced by `imageId`; saved files embed it as a `dataUrl` instead. At least one of the two is needed. `widthPx` and `heightPx` are the image's size in pixels, `opacity` runs from 0 to 1, and `locked` stops the image being dragged by accident. See [D22](DECISIONS.md#d22-tracing-over-a-floor-plan-image--2026-09-27).

## Validation

`parsePlan` and `loadPlan` return either the plan or a list of issues, each with a path such as `floors[0].walls[3].to` and a readable message. They check:

- **Shape:** required fields, types, known materials and bands, finite numbers.
- **References:** walls point at nodes on the same floor, openings at walls on the same floor, access points at existing floors.
- **Geometry:** walls are at least 1 cm long, openings fit inside their wall and don't overlap.
- **Uniqueness:** ids are unique within each list, and each access point has at most one radio per band.

## Versions and migrations

Every plan carries `schemaVersion`. When the format changes, the version goes up by one and a migration from the previous version is added to [`migrate.ts`](../packages/floorplan/src/migrate.ts). Older files are upgraded step by step when loaded; files from a newer version are rejected with a message asking the user to update.

Adding an optional field does not need a new version. Renaming, removing or changing the meaning of a field does.

## Example

[`fixtures/two-storey-home.json`](../packages/floorplan/fixtures/two-storey-home.json) is the same home with an upper floor of bedrooms, a stairwell (`floorOpenings`) and a timber joist floor, used by the M3 exit gate (D58). [`fixtures/sample-home.json`](../packages/floorplan/fixtures/sample-home.json) is a 15 m × 10 m single-storey home: three bedrooms, a bathroom, an office, open-plan living and kitchen, and a poured-concrete utility room with a steel door. Exterior walls are brick with low-E windows, and a tri-band Wi-Fi 6E router sits near the front door. Tests and the thin-slice heatmap use it.

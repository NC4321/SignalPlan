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
│  ├─ surveySpots[]?   { id, x, y, note?, readings[]: { apId, band, dbm: −120 to 0 } }
│  └─ background?      { imageId | dataUrl, x, y, metresPerPixel, widthPx, heightPx,
│                        opacity, visible, locked }
├─ accessPoints[]
│  └─ { id, name, floorId, x, y, heightM,
│       radios[]: { band, txPowerDbm?, channelWidthMHz?, channel?, bssids[]? } }
├─ coverageTarget?     excellent | good | fair | weak
├─ region?             US | EU
├─ allowDfs?           boolean
├─ overlapMarginDb?    1 to 20
├─ roamThresholdDbm?   −90 to −50
├─ neighbourNetworks[]?
│  └─ { id, name?, band, channel?, channelWidthMHz, strengthDbm: −100 to −20 }
├─ ignoredBssids[]?    BSSIDs marked not mine when importing readings
└─ calibration?        by band: { wallLossDb?: { material: dB }, floorLossDb?: { material: dB },
                         pathLossExponent?, deviceOffsetDb? }
```

Wall materials are `drywall`, `brick`, `concrete`, `glass`, `low-e-glass`, `wood` and `metal`; each stands for a typical North American construction described in [MODEL.md](MODEL.md#wall-materials). Openings can use any of these, or `open` for a doorway with no door. Bands are `2.4GHz`, `5GHz` and `6GHz`. `txPowerDbm` is the radio's EIRP (antenna gain included); a radio without it uses the engine's default for its band.

A floor's `material` is its slab, the floor under its rooms, which signal crosses to and from the storey below: `timber-joist` or `concrete-slab`, described in [MODEL.md](MODEL.md#floor-materials). Without it the floor is `timber-joist`. The lowest floor's slab is never crossed. See [D51](DECISIONS.md#d51-signal-between-floors--2026-09-28).

A floor's optional `floorOpenings` are holes in its slab, such as stairwells and atriums: each is a polygon of at least three corners in order, in plan metres. Signal crossing the slab inside one pays no floor loss, and its area isn't counted as floor. Validation checks that ids are unique within the floor and that each opening has some area. `addFloorOpening`, `moveFloorOpening`, `moveFloorOpeningCorner` and `deleteFloorOpening` in `floorOpenings.ts` edit them; adding refuses an outline under 0.01 m², and moving a corner refuses a move that would leave one. The field was added without a version bump, since older plans simply have none. See [D54](DECISIONS.md#d54-stairwells-and-atriums--2026-09-28).

Floors stack by `elevationM`; their order in `floors[]` doesn't matter. `addFloor`, `moveFloor` and `deleteFloor` in `floors.ts` add a floor on top or at the bottom (on a slab of the construction's real thickness), swap a floor with its neighbour, and delete a floor with its access points. See [D52](DECISIONS.md#d52-the-floor-list--2026-09-28).

An access point with `locked: true` can't be moved, by hand or by the placement optimizer; without it the access point is unlocked. See [D43](DECISIONS.md#d43-locking-access-points-in-place--2026-09-28).

`coverageTarget` is the signal level the coverage summary counts towards, named after the heatmap bands; without it the summary uses `fair`. See [D27](DECISIONS.md#d27-coverage-summary--2026-09-27).

A radio's optional `channelWidthMHz` (20, 40, 80 or 160) and `channel` (its IEEE 802.11 channel number at that width) are set by hand; without them the channel planner chooses, and a hand-set channel stays fixed for it. A channel needs a width, but a width can be set alone. Validation doesn't check them against the plan's region, so a plan keeps its channels when the region changes; the engine's `radioChannelIssue` says whether the region and DFS setting allow them, and the editor flags the ones they don't. `setRadioWidth` and `setRadioChannel` in `accessPoints.ts` edit them; a new width clears the channel. Turning a band off drops its radio, channel and width included, as it does its power. See [D63](DECISIONS.md#d63-channel-and-width-per-radio--2026-09-28).

`region` says whose channel and power rules the plan follows; without it the plan is `US`. `allowDfs: true` lets 5 GHz DFS channels be used; without it they aren't. The rules themselves live in the engine, not the plan ([MODEL.md](MODEL.md#channels-and-regions), [D62](DECISIONS.md#d62-channels-by-region--2026-09-28)).

`overlapMarginDb` and `roamThresholdDbm` set the Overlap view's margin and the Roaming view's threshold; without them the engine's defaults apply (8 dB and −70 dBm, sourced in [MODEL.md](MODEL.md#overlap-and-roaming)). They're saved so a shared plan shows the same views. See [D64](DECISIONS.md#d64-overlap-and-roaming-views--2026-09-28).

`neighbourNetworks` are networks next door, typed in by hand as background interference for the Interference view: band, width, a rough `strengthDbm`, an optional `name` to tell them apart, and the `channel` once it's picked; one without a channel isn't counted. They have no position. `addNeighbourNetwork`, `setNeighbourBand`, `setNeighbourWidth` (both clear the channel), `setNeighbourChannel`, `setNeighbourStrength`, `renameNeighbourNetwork` and `deleteNeighbourNetwork` in `neighbours.ts` edit them, and validation checks their ids are unique. Without the list there are none. See [D67](DECISIONS.md#d67-neighbours-networks--2026-09-29).

A floor's optional `surveySpots` are places where signal was measured, in plan metres, each with an optional `note` and a list of `readings`: the access point (`apId`, on any floor) and `band` it's from, and its signal in dBm as a phone or analyser shows it (−120 to 0). A spot has at most one reading per access point and band. Spot ids (`spot1`, `spot2` …) are unique across the whole plan, so a spot can be found without its floor. A radio's optional `bssids` are the BSSIDs it broadcasts, one per network name, lower case with colons (`a4:2b:b0:12:34:56`); each BSSID belongs to one radio. `addSurveySpot`, `moveSurveySpot`, `deleteSurveySpot`, `setSurveyNote`, `addSurveyReading`, `setReadingSource`, `setReadingDbm`, `deleteSurveyReading`, `setRadioBssids` and `parseBssids` in `survey.ts` edit them. Deleting an access point, or the floor it's on, also deletes the readings taken from it; turning a band off keeps them, flagged in the editor, but drops that radio's `bssids` with its channel and width. Both fields were added without a version bump. See [D71](DECISIONS.md#d71-the-survey-tool--2026-09-29).

A floor may have a **background** image to trace over. `x` and `y` place its top-left corner and `metresPerPixel` sets its scale. In the browser the image lives in its own store and is referenced by `imageId`; saved files embed it as a `dataUrl` instead. At least one of the two is needed. `widthPx` and `heightPx` are the image's size in pixels, `opacity` runs from 0 to 1, and `locked` stops the image being dragged by accident. See [D22](DECISIONS.md#d22-tracing-over-a-floor-plan-image--2026-09-27).

`ignoredBssids` lists BSSIDs marked "not mine" when importing readings, such as neighbours' networks, so later imports skip them without asking. A BSSID can't be both on a radio and in this list; typing one onto a radio takes it off the list. `forgetIgnoredBssids` in `survey.ts` clears it. See [D72](DECISIONS.md#d72-importing-survey-readings--2026-09-29).

`calibration` holds the model fitted to this home's survey, by band (`2.4GHz`, `5GHz`, `6GHz`), as Calibrate applies it. Each value replaces the engine's default where given: `wallLossDb` a wall material's loss per crossing (0 to 100 dB), `floorLossDb` a floor material's head-on loss (0 to 100 dB; its loss at other angles scales with it), and `pathLossExponent` the band's n (1 to 6). `deviceOffsetDb` (−60 to 60) is how much more the phone that took the readings shows than the model's receiver; it's added only when comparing with survey readings, never to the heatmap. These bounds only keep out nonsense; the fit keeps to tighter limits from published measurements ([MODEL.md](MODEL.md#calibration)). Without `calibration`, or for a band it doesn't list, the defaults apply. It was added without a version bump. See [D76](DECISIONS.md#d76-calibrate-suggest-preview-and-apply--2026-10-03).

## Importing survey readings

Readings can be imported from a CSV or JSON file (File › Import readings…, or the Survey section). A file whose text starts with `[` or `{` is read as JSON; anything else is CSV with a header line, separated by commas, semicolons or tabs, with quoted cells as in RFC 4180. Each row or object is one reading:

| Column             | Also accepted                                              | Meaning                                                                                                                       |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `bssid` (required) | `mac`, `mac address`                                       | The radio's BSSID, with colons, dashes or dots, in any case, leading zeros optional                                           |
| `dbm` (required)   | `rssi`, `rssi (dBm)`, `signal`, `signal strength`, `level` | The signal in dBm, −120 to 0; a unit or a minus sign (−) is fine                                                              |
| `spot`             | `spot id`, `spot name`                                     | An existing spot: `Spot 3`, `spot3` or `3`                                                                                    |
| `x`, `y`           | `x (m)`, `y (m)`                                           | A spot's position in plan metres: an existing spot within 1 cm, or else a new one; rows with the same position share one spot |
| `floor`            |                                                            | The floor a position is on, by id, or by name if no other floor has it; without it, the floor on show                         |
| `ssid`             | `network`, `network name`                                  | The network name, shown when mapping a BSSID                                                                                  |
| `band`             |                                                            | `2.4`, `5` or `6` (GHz), a hint when mapping a BSSID                                                                          |
| `frequency`        | `frequency (MHz)`, `freq`                                  | The channel's centre in MHz (or GHz), a hint for the band                                                                     |
| `channel`          | `ch`                                                       | The channel number, a weaker hint (1–14 → 2.4 GHz, 32–177 → 5 GHz)                                                            |

Column names ignore case, spaces and marks, and other columns (such as a time) are ignored. A row gives a `spot` or an `x` and `y`, not both; a row with neither goes to the spot selected when importing. Any bad row, unknown spot or unknown floor stops the whole import, with a list of where the problems are.

Readings are matched to radios by BSSID (`bssids` on each radio). The first time a file has BSSIDs that no radio has and that aren't in `ignoredBssids`, a dialog asks which radio each is, or "not mine"; the answers are saved, so later imports match on their own. A reading's band is its radio's, whatever the file says. Several readings of one radio at one spot become one: the mean of their power in mW ([MODEL.md](MODEL.md#survey-readings)). That replaces a reading the spot already has for the same access point and band. The whole import is one undo step.

```csv
ssid,bssid,rssi,frequency,x,y,floor
Home,a4:2b:b0:12:34:56,-52,5180,3.5,4,Main floor
Home-guest,a6:2b:b0:12:34:56,-53,5180,3.5,4,Main floor
```

```json
{ "readings": [{ "bssid": "a4:2b:b0:12:34:56", "dbm": -52, "spot": "Spot 1" }] }
```

## Validation

`parsePlan` and `loadPlan` return either the plan or a list of issues, each with a path such as `floors[0].walls[3].to` and a readable message. They check:

- **Shape:** required fields, types, known materials and bands, finite numbers.
- **References:** walls point at nodes on the same floor, openings at walls on the same floor, access points at existing floors, survey readings at existing access points.
- **Geometry:** walls are at least 1 cm long, openings fit inside their wall and don't overlap.
- **Uniqueness:** ids are unique within each list (survey spot ids across all floors), each access point has at most one radio per band, each survey spot has at most one reading per access point and band, and each BSSID is on one radio and not also in `ignoredBssids`.
- **Channels:** a radio with a `channel` also has a `channelWidthMHz`.

## Versions and migrations

Every plan carries `schemaVersion`. When the format changes, the version goes up by one and a migration from the previous version is added to [`migrate.ts`](../packages/floorplan/src/migrate.ts). Older files are upgraded step by step when loaded; files from a newer version are rejected with a message asking the user to update.

Adding an optional field does not need a new version. Renaming, removing or changing the meaning of a field does.

## Example

[`fixtures/two-storey-home.json`](../packages/floorplan/fixtures/two-storey-home.json) is the same home with an upper floor of bedrooms, a stairwell (`floorOpenings`) and a timber joist floor, used by the M3 exit gate (D58). [`fixtures/three-ap-home.json`](../packages/floorplan/fixtures/three-ap-home.json) is that home in the US with two mesh points added, one in the far downstairs bedroom and one upstairs, and a neighbour's network (`neighbourNetworks`), used by the Phase 6 exit gate (D69). [`fixtures/sample-home.json`](../packages/floorplan/fixtures/sample-home.json) is a 15 m × 10 m single-storey home: three bedrooms, a bathroom, an office, open-plan living and kitchen, and a poured-concrete utility room with a steel door. Exterior walls are brick with low-E windows, and a tri-band Wi-Fi 6E router sits near the front door. Tests and the thin-slice heatmap use it.

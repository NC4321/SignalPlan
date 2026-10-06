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
│  ├─ surveySpots[]?   { id, x, y, note?, readings[]: { apId, band, dbm: −120 to 0, approximate?, scans? },
│  │                     neighbourReadings[]?: { bssid, band, dbm, approximate?, scans? } }
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
│  └─ { id, name?, band, channel?, channelWidthMHz, bssid?, strengthDbm: −100 to −20,
│       location?: { floorId, x, y, heightM, eirpDbm: −10 to 40, uncertaintyM } }
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

`neighbourNetworks` are networks next door, typed in by hand as background interference for the Interference view: band, width, a rough `strengthDbm`, an optional `name` to tell them apart, and the `channel` once it's picked; one without a channel isn't counted. An optional `location` places it on a floor, perhaps outside the walls, at a height, with the `eirpDbm` it sends and the `uncertaintyM` of the fit (D83); the Interference view and the channel planner then predict its signal from there through walls and floors instead of using `strengthDbm` everywhere ([D84](DECISIONS.md#d84-located-neighbours-interfere-cell-by-cell--2026-10-04)). `setNeighbourLocation` sets or clears it; changing the band or deleting its floor clears it. A network added from a scan keeps the optional `bssid` it was seen with, so a later scan updates it rather than adding another; a BSSID can't be on two networks, on a radio, or in `ignoredBssids` as well ([D77](DECISIONS.md#d77-scope-for-phase-8-scan-your-network--2026-10-03)). `addNeighbourNetwork`, `setNeighbourBand`, `setNeighbourWidth` (both clear the channel), `setNeighbourChannel`, `setNeighbourStrength`, `renameNeighbourNetwork` and `deleteNeighbourNetwork` in `neighbours.ts` edit them, and validation checks their ids are unique. Without the list there are none. See [D67](DECISIONS.md#d67-neighbours-networks--2026-09-29).

A floor's optional `surveySpots` are places where signal was measured, in plan metres, each with an optional `note` and a list of `readings`: the access point (`apId`, on any floor) and `band` it's from, and its signal in dBm as a phone or analyser shows it (−120 to 0). A spot has at most one reading per access point and band. A reading converted from a signal percentage (a `netsh` or `nmcli` scan) has `approximate: true`; one read in dBm leaves it out (D77). A reading from scans at the spot has `scans`, how many it's the mean power of (2 or more), so a later scan is averaged in with the right weight; typing a value in, or importing a file, makes it a single reading again. A spot's optional `neighbourReadings` are the BSSIDs that aren't yours heard by scans there, one per BSSID, with band, dBm (−120 to 0), and the same optional `approximate` and `scans` ([D82](DECISIONS.md#d82-scan-at-a-spot--2026-10-03)). Spot ids (`spot1`, `spot2` …) are unique across the whole plan, so a spot can be found without its floor. A radio's optional `bssids` are the BSSIDs it broadcasts, one per network name, lower case with colons (`a4:2b:b0:12:34:56`); each BSSID belongs to one radio. `addSurveySpot`, `moveSurveySpot`, `deleteSurveySpot`, `setSurveyNote`, `addSurveyReading`, `setReadingSource`, `setReadingDbm`, `deleteSurveyReading`, `setRadioBssids` and `parseBssids` in `survey.ts` edit them. Deleting an access point, or the floor it's on, also deletes the readings taken from it; turning a band off keeps them, flagged in the editor, but drops that radio's `bssids` with its channel and width. Both fields were added without a version bump. See [D71](DECISIONS.md#d71-the-survey-tool--2026-09-29).

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

Column names ignore case, spaces and marks, and other columns (such as a time) are ignored. Numbers are plain decimals, with a decimal point or a single decimal comma (`-67.5`, `-67,5`) and an optional exponent (`1e-3`); hex, binary and thousands separators aren't read. A row gives a `spot` or an `x` and `y`, not both; a row with neither goes to the spot selected when importing. A new spot may be up to 50 m outside its floor's walls (`MAX_SPOT_OUTSIDE_M`; every floor's walls when its own has none), and the new spots mustn't make the plan more than 2 km across (`MAX_PLAN_SIZE_M`, D100); either error asks whether the file was saved in millimetres or centimetres. Any bad row, unknown spot or unknown floor stops the whole import, with a list of where the problems are.

Readings are matched to radios by BSSID (`bssids` on each radio). The first time a file has BSSIDs that no radio has and that aren't in `ignoredBssids`, a dialog asks which radio each is, or "not mine"; the answers are saved, so later imports match on their own. A reading's band is its radio's, whatever the file says. Several readings of one radio at one spot become one: the mean of their power in mW ([MODEL.md](MODEL.md#survey-readings)). That replaces a reading the spot already has for the same access point and band. The whole import is one undo step.

```csv
ssid,bssid,rssi,frequency,x,y,floor
Home,a4:2b:b0:12:34:56,-52,5180,3.5,4,Main floor
Home-guest,a6:2b:b0:12:34:56,-53,5180,3.5,4,Main floor
```

```json
{ "readings": [{ "bssid": "a4:2b:b0:12:34:56", "dbm": -52, "spot": "Spot 1" }] }
```

## Importing a scan

A scan is what a computer or phone sees of the Wi-Fi around it: each BSSID with its network name, band, channel, often its width, and its signal. `parseScan` in `scanImport.ts` reads the output of the commands in Scan your network, pasted or saved to a file, trying each format by its shape (D77, [D79](DECISIONS.md#d79-reading-scans--2026-10-03)):

| Format                    | Command                                                 | Signal         | Width                           | Checked on a real capture       |
| ------------------------- | ------------------------------------------------------- | -------------- | ------------------------------- | ------------------------------- |
| SignalPlan's scan scripts | Copy script, on Windows and macOS (D81)                 | dBm            | yes                             | not yet run on a real PC or Mac |
| Windows                   | `netsh wlan show networks mode=bssid`                   | %, approximate | no                              | not yet                         |
| macOS                     | `system_profiler SPAirPortDataType -json`               | dBm            | yes                             | not yet                         |
| Linux                     | `nmcli -t -f BSSID,SSID,CHAN,FREQ,SIGNAL dev wifi list` | %, approximate | with a sixth field, `BANDWIDTH` | not yet                         |
| Linux                     | `sudo iw dev <interface> scan`                          | dBm            | yes                             | not yet                         |
| Android                   | WiFi Analyzer's export                                  | dBm            | yes                             | not yet                         |

- **netsh** is translated with Windows, so it's read by its layout: an unindented `… n : name` line starts a network, an indented line whose value is a MAC address starts a BSSID, and under it the first percentage is the signal (`86 %`, or `%86` as Turkish Windows writes it), a value such as `5 GHz` the band (Windows 11), and the first whole number after the signal the channel. Without a band line, channels 1–14 are 2.4 GHz and 32–177 are 5 GHz.
- **Percentages** become dBm with each tool's own mapping, and the entry is marked `approximate`. Windows documents 0 % as −100 dBm and 100 % as −50 dBm, linear between (`WLAN_AVAILABLE_NETWORK`); NetworkManager maps −100 to −40 dBm onto 0–100 %, truncating (`nm_wifi_utils_level_to_quality`), so a percentage from 1 to 99 becomes the middle of its 0.6 dB step. Both clip: 100 % can be any stronger signal.
- **iw** gives the width as the Windows script reads it (D81): on 6 GHz from the HE operation's 6 GHz information, else from the VHT operation element (80 MHz, or 160 MHz when its second centre segment is set, as 802.11-2020 signals it), or else the HT operation element (40 MHz with a secondary channel, otherwise 20). A BSS without a signal line is skipped and listed. **nmcli**'s terse output has no header, so fields asked for in another order are caught by their values (CHAN a whole number, FREQ like `5180 MHz`, SIGNAL 0–100) and the scan is refused, naming the order it needs. WiFi Analyzer's export is a header line and a row per BSSID, separated by `|`, commas, semicolons or tabs, with quoted cells as a spreadsheet re-saves them. macOS leaves out a network's BSSID unless the app reading it has Location permission; such networks are skipped and listed.
- **SignalPlan's scripts** ([D81](DECISIONS.md#d81-scan-scripts-for-windows-and-macos--2026-10-03), in `apps/web/src/editor/scanScripts`) write `{ "signalplanScan": 1, "networks": [{ "bssid", "ssid", "frequencyMHz", "widthMHz", "dbm" }] }`, or `channel` and `band` (`"2.4"`, `"5"` or `"6"`) in place of `frequencyMHz`.

Every entry gets its band from the frequency where the tool gives one, and its channel from the frequency, else as given. A BSSID on a band SignalPlan doesn't model, such as 60 GHz, is skipped and listed; a BSSID without a signal (except in `iw`, where it's skipped), or with one outside −120 to 0 dBm, fails the scan with its line. Several sightings of one BSSID become one, at their mean power in mW, as for readings. `groupScanDevices` groups BSSIDs that look like one device: MAC addresses that differ only in the last octet, or also in the first octet's locally administered bit, which devices set for extra networks such as a guest one. It's a guess, so the dialog lets a group be split. Samples of each format are in [`fixtures/scans`](../packages/floorplan/fixtures/scans); until real captures replace them, they're written by hand from each tool's documented or reported output.

Applying a scan (`scanApply.ts`, D80): `unknownScanEntries` lists the BSSIDs the plan doesn't know (on no radio or neighbour network, and not in `ignoredBssids`); `planScan` works out the changes for answers given per BSSID (an access point, a neighbour's, or ignore), with BSSIDs the plan knows answered as before; and `applyScan` makes them on an Immer draft. Your BSSIDs join their band's radio, and a radio without a width takes the scan's width and the channel at that width; one that already has a different width or channel changes only when its `radioKey` is passed in `overwrite`. A neighbour's device becomes one network per band (`upsertScannedNeighbour` in `neighbours.ts`), matched to an existing one by any of its BSSIDs. The channel rules come from the engine as a `ScanTuning`.

A scan at a survey spot (`scanSpot.ts`, D82): after `applyScan`, in the same edit, `applyScanAtSpot` takes an existing spot or adds one at a point. Each of your radios heard becomes a reading, its BSSIDs at mean power, averaged with the spot's reading for it, if any, weighted by that reading's `scans` (`addScanToMean`); it's `approximate` if any scan behind it was. A BSSID given to an access point without a radio on its band becomes a reading on that band, not compared while the band is off. Each neighbour's BSSID heard is kept in the spot's `neighbourReadings`, averaged the same way, and each neighbour network the scan heard takes the strongest of its device's BSSIDs (`scanDeviceKey`) on its band at any spot, rounded to whole dB.

## Sharing as a link

File › Share link… puts the plan in a link's fragment: `https://signalplan.pages.dev/#plan=1.<data>`. `1` is the link format's version, separate from `schemaVersion`. `<data>` is the plan's JSON, compressed with raw deflate (`CompressionStream('deflate-raw')`) and encoded as base64url without padding. Floors' `background` images are left out, since they'd make the link far too long; the dialog names the floors that had one. A browser never sends the fragment to the server, so the plan stays in the link until it's pasted somewhere.

Opening a link decodes it and validates the plan as opening a file does, then opens it like the sample: it joins My plans on its first edit. The plan is then taken out of the address bar. A link with a newer format version, one cut short, or one over 20 MB once decompressed opens nothing and says why. The fixtures make links of 0.8–1.9 thousand characters; the dialog warns from 16,000. See [D88](DECISIONS.md#d88-shareable-plan-links--2026-10-04).

## Validation

`parsePlan` and `loadPlan` return either the plan or a list of issues, each with a path such as `floors[0].walls[3].to` and a readable message. They check:

- **Shape:** required fields, types, known materials and bands, finite numbers. Positions are within 1,000 km of the origin (`MAX_COORDINATE_M`), elevations from −1,000 m to 1,000 m, floor-to-ceiling heights up to 100 m and mounting heights up to 100 m ([D104](DECISIONS.md#d104-bounds-on-positions-and-heights-and-a-cap-on-walls-per-floor--2026-10-05)).
- **References:** walls point at nodes on the same floor, openings at walls on the same floor, access points and neighbours' locations at existing floors, survey readings at existing access points.
- **Geometry:** walls are at least 1 cm long, openings fit inside their wall and don't overlap.
- **Uniqueness:** ids are unique within each list (survey spot ids across all floors), each access point has at most one radio per band, each survey spot has at most one reading per access point and band and one neighbour reading per BSSID, and each BSSID is on one radio or one neighbour network and not also in `ignoredBssids`.
- **Channels:** a radio with a `channel` also has a `channelWidthMHz`.
- **Counts:** a floor has at most 2,000 walls (`MAX_WALLS_PER_FLOOR`), 4,000 corners and 4,000 doors and windows, so a short share link can't hold a plan that takes seconds to show (D104).
- **Size:** `loadPlan`, which opens files and share links, also refuses a plan more than 2 km across (`MAX_PLAN_SIZE_M`), counting where neighbours were located, asking whether it was saved in millimetres ([D100](DECISIONS.md#d100-a-cap-on-the-coverage-grid-and-on-plan-size--2026-10-05)).

## Versions and migrations

Every plan carries `schemaVersion`. When the format changes, the version goes up by one and a migration from the previous version is added to [`migrate.ts`](../packages/floorplan/src/migrate.ts). Older files are upgraded step by step when loaded; files from a newer version are rejected with a message asking the user to update.

Adding an optional field does not need a new version. Renaming, removing or changing the meaning of a field does.

## Example

[`fixtures/two-storey-home.json`](../packages/floorplan/fixtures/two-storey-home.json) is the same home with an upper floor of bedrooms, a stairwell (`floorOpenings`) and a timber joist floor, used by the M3 exit gate (D58). [`fixtures/three-ap-home.json`](../packages/floorplan/fixtures/three-ap-home.json) is that home in the US with two mesh points added, one in the far downstairs bedroom and one upstairs, and a neighbour's network (`neighbourNetworks`), used by the Phase 6 exit gate (D69). [`fixtures/sample-home.json`](../packages/floorplan/fixtures/sample-home.json) is a 15 m × 10 m single-storey home: three bedrooms, a bathroom, an office, open-plan living and kitchen, and a poured-concrete utility room with a steel door. Exterior walls are brick with low-E windows, and a tri-band Wi-Fi 6E router sits near the front door. Tests and the thin-slice heatmap use it.

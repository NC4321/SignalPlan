import { addAccessPoint, nextAccessPointName } from './accessPoints.ts'
import type { Point } from './geometry.ts'
import {
  BANDS,
  NEIGHBOUR_STRENGTH_RANGE_DBM,
  type Band,
  type ChannelWidth,
  type NeighbourNetwork,
  type Plan,
} from './schema.ts'
import { upsertScannedNeighbour } from './neighbours.ts'
import { groupScanDevices, type ScanEntry } from './scanImport.ts'
import { bssidOwners, floorCornerBounds } from './surveyImport.ts'

/**
 * Applying a scan to the plan (D77, D80): each BSSID is yours (a radio on an
 * access point), a neighbour's (a neighbour network, as background
 * interference), or ignored. BSSIDs the plan already knows are answered the
 * way they were before; the rest are asked about in the dialog, a device at a
 * time. `planScan` works out what would change, so the dialog can show it
 * and ask before changing a radio's width or channel already set, and `applyScan`
 * makes the changes on an Immer draft as one undo step.
 */

/**
 * How one BSSID is answered: a radio on this access point, a radio on an
 * access point the scan adds (one per `newAccessPoint` key, D105), or not
 * yours.
 */
export type ScanChoice =
  { apId: string } | { newAccessPoint: string } | 'neighbour' | 'ignore'

/** The plan's channel rules, from the engine. */
export interface ScanTuning {
  /** The band's usual width, for a network whose width the scan doesn't give. */
  usualWidth: (band: Band) => ChannelWidth
  /**
   * The channel number at `width` whose span holds the primary channel, or
   * undefined when the rules have none, or more than one (40 MHz at 2.4 GHz
   * without knowing which side the second channel is on).
   */
  channelAt: (
    band: Band,
    primary: number,
    width: ChannelWidth,
  ) => number | undefined
}

/** BSSIDs the plan doesn't know: on no radio, no neighbour network, and not ignored. */
export function unknownScanEntries(
  plan: Plan,
  entries: readonly ScanEntry[],
): ScanEntry[] {
  const known = knownBssids(plan)
  return entries.filter((e) => !known.has(e.bssid))
}

function knownBssids(plan: Plan): Set<string> {
  return new Set([
    ...bssidOwners(plan).keys(),
    ...(plan.ignoredBssids ?? []),
    ...(plan.neighbourNetworks ?? []).flatMap((n) =>
      n.bssid === undefined ? [] : [n.bssid],
    ),
  ])
}

/** What a scan would do to one of your radios. */
export interface ScanRadioChange {
  apId: string
  band: Band
  /** BSSIDs to add to the radio. */
  bssids: string[]
  /** The width the scan saw, when it says. */
  widthMHz?: ChannelWidth
  /** The channel at that width, when the rules give exactly one. */
  channel?: number
  /**
   * The radio already has a width (set by hand or by an earlier scan) and
   * the scan disagrees with it or its channel: it's only changed if asked.
   */
  alreadySet: boolean
}

/** What a scan would do to one neighbour network. */
export interface ScanNeighbourChange {
  /** The network it updates; undefined to add one. */
  id?: string
  bssid: string
  name?: string
  band: Band
  widthMHz: ChannelWidth
  /** The scan gave no width, so it's the band's usual one. */
  widthAssumed: boolean
  channel?: number
  strengthDbm: number
}

export interface ScanChanges {
  radios: ScanRadioChange[]
  neighbours: ScanNeighbourChange[]
  /** BSSIDs to add to `ignoredBssids`. */
  ignored: string[]
  /** BSSIDs given to an access point without a radio on their band. */
  noRadio: { bssid: string; apId: string; band: Band }[]
  /** Every neighbour's BSSID in the scan, for a scan at a spot (D82). */
  neighbourEntries: ScanEntry[]
}

/** The key for `applyScan`'s `overwrite`: a radio already set, to retune. */
export const radioKey = (apId: string, band: Band) => `${apId}\n${band}`

/** The width and channel a scan saw, at the plan's channel numbers. */
function tuningOf(
  entry: ScanEntry,
  tuning: ScanTuning,
): { widthMHz?: ChannelWidth; channel?: number } {
  if (entry.widthMHz === undefined) return {}
  const channel =
    entry.channel === undefined
      ? undefined
      : tuning.channelAt(entry.band, entry.channel, entry.widthMHz)
  return channel === undefined
    ? { widthMHz: entry.widthMHz }
    : { widthMHz: entry.widthMHz, channel }
}

/**
 * What applying a scan would change. A BSSID already on a radio retunes that
 * radio; one already on a neighbour network updates it; one already ignored
 * is left out. Every other BSSID follows `choices`, and is left out without
 * one. A radio takes the width and channel of the strongest of its BSSIDs,
 * when the scan gives a width; one that already has a width, with a
 * different width or channel, is marked `alreadySet`. Neighbours' BSSIDs are
 * grouped by device (`groupScanDevices`) into one network per device and
 * band, at the strongest signal, matching an existing network by any of its
 * BSSIDs.
 */
export function planScan(
  plan: Plan,
  entries: readonly ScanEntry[],
  choices: ReadonlyMap<string, ScanChoice>,
  tuning: ScanTuning,
): ScanChanges {
  const owners = bssidOwners(plan)
  const ignoredBefore = new Set(plan.ignoredBssids)
  const neighbourOf = new Map(
    (plan.neighbourNetworks ?? []).flatMap((n) =>
      n.bssid === undefined ? [] : [[n.bssid, n] as const],
    ),
  )
  const changes: ScanChanges = {
    radios: [],
    neighbours: [],
    ignored: [],
    noRadio: [],
    neighbourEntries: [],
  }
  const mine = new Map<
    string,
    { apId: string; band: Band; entries: ScanEntry[] }
  >()
  const neighbours: ScanEntry[] = []
  for (const entry of entries) {
    const owner = owners.get(entry.bssid)
    const choice: ScanChoice | undefined = owner
      ? { apId: owner.apId }
      : neighbourOf.has(entry.bssid)
        ? 'neighbour'
        : ignoredBefore.has(entry.bssid)
          ? undefined
          : choices.get(entry.bssid)
    if (choice === undefined) continue
    if (choice === 'ignore') changes.ignored.push(entry.bssid)
    else if (choice === 'neighbour') neighbours.push(entry)
    // Added by `addScanAccessPoints` first, which answers with its id.
    else if ('newAccessPoint' in choice) continue
    else {
      // A known BSSID stays on its radio, whatever band the scan says.
      const band = owner?.band ?? entry.band
      const ap = plan.accessPoints.find((a) => a.id === choice.apId)
      if (!ap?.radios.some((r) => r.band === band)) {
        changes.noRadio.push({ bssid: entry.bssid, apId: choice.apId, band })
        continue
      }
      const key = radioKey(choice.apId, band)
      const group = mine.get(key) ?? { apId: choice.apId, band, entries: [] }
      group.entries.push(entry)
      mine.set(key, group)
    }
  }

  for (const { apId, band, entries: group } of mine.values()) {
    const radio = plan.accessPoints
      .find((a) => a.id === apId)!
      .radios.find((r) => r.band === band)!
    const strongest = group.reduce((a, b) => (b.dbm > a.dbm ? b : a))
    const seen = tuningOf({ ...strongest, band }, tuning)
    const change: ScanRadioChange = {
      apId,
      band,
      bssids: group
        .map((e) => e.bssid)
        .filter((b) => !(radio.bssids ?? []).includes(b)),
      alreadySet: false,
    }
    const differs =
      seen.widthMHz !== undefined &&
      (radio.channelWidthMHz !== seen.widthMHz ||
        radio.channel !== seen.channel)
    if (differs) {
      change.widthMHz = seen.widthMHz!
      if (seen.channel !== undefined) change.channel = seen.channel
      change.alreadySet = radio.channelWidthMHz !== undefined
    }
    if (change.bssids.length > 0 || change.widthMHz !== undefined) {
      changes.radios.push(change)
    }
  }

  changes.neighbourEntries = neighbours
  const { min, max } = NEIGHBOUR_STRENGTH_RANGE_DBM
  for (const device of groupScanDevices(neighbours)) {
    const bands = [...new Set(device.entries.map((e) => e.band))]
    for (const band of bands) {
      const onBand = device.entries.filter((e) => e.band === band)
      const strongest = onBand[0]!
      const existing = onBand
        .map((e) => neighbourOf.get(e.bssid))
        .find((n) => n !== undefined)
      const seen = tuningOf(strongest, tuning)
      const widthMHz =
        seen.widthMHz ?? existing?.channelWidthMHz ?? tuning.usualWidth(band)
      const channel =
        seen.channel ??
        (strongest.channel === undefined
          ? undefined
          : tuning.channelAt(band, strongest.channel, widthMHz))
      const change: ScanNeighbourChange = {
        bssid: existing?.bssid ?? strongest.bssid,
        band,
        widthMHz,
        widthAssumed: seen.widthMHz === undefined && !existing,
        strengthDbm: Math.round(Math.min(max, Math.max(min, strongest.dbm))),
      }
      if (existing) change.id = existing.id
      const name = device.ssids.find((s) => s !== '')
      if (name !== undefined) change.name = name.slice(0, 100)
      if (channel !== undefined) change.channel = channel
      changes.neighbours.push(change)
    }
  }
  return changes
}

export interface ScanSummary {
  bssidsMapped: number
  radiosTuned: number
  neighboursAdded: number
  neighboursUpdated: number
  bssidsIgnored: number
}

/**
 * Makes the changes `planScan` worked out, on an Immer draft. A radio marked
 * `alreadySet` is retuned only if `overwrite` has its `radioKey`. A BSSID given
 * to a radio comes off the ignored list, as when typed in (D72).
 */
export function applyScan(
  plan: Plan,
  changes: ScanChanges,
  overwrite: ReadonlySet<string> = new Set(),
): ScanSummary {
  const summary: ScanSummary = {
    bssidsMapped: 0,
    radiosTuned: 0,
    neighboursAdded: 0,
    neighboursUpdated: 0,
    bssidsIgnored: 0,
  }
  const mapped = new Set<string>()
  for (const change of changes.radios) {
    const radio = plan.accessPoints
      .find((a) => a.id === change.apId)
      ?.radios.find((r) => r.band === change.band)
    if (!radio) continue
    for (const bssid of change.bssids) {
      radio.bssids ??= []
      if (radio.bssids.includes(bssid)) continue
      radio.bssids.push(bssid)
      mapped.add(bssid)
      summary.bssidsMapped++
    }
    if (
      change.widthMHz !== undefined &&
      (!change.alreadySet || overwrite.has(radioKey(change.apId, change.band)))
    ) {
      radio.channelWidthMHz = change.widthMHz
      if (change.channel === undefined) delete radio.channel
      else radio.channel = change.channel
      summary.radiosTuned++
    }
  }
  if (plan.ignoredBssids?.some((b) => mapped.has(b))) {
    const kept = plan.ignoredBssids.filter((b) => !mapped.has(b))
    if (kept.length === 0) delete plan.ignoredBssids
    else plan.ignoredBssids = kept
  }
  for (const change of changes.neighbours) {
    const { id } = change
    const fields: Omit<NeighbourNetwork, 'id'> = {
      bssid: change.bssid,
      band: change.band,
      channelWidthMHz: change.widthMHz,
      strengthDbm: change.strengthDbm,
    }
    if (change.name !== undefined) fields.name = change.name
    if (change.channel !== undefined) fields.channel = change.channel
    const before = JSON.stringify(
      plan.neighbourNetworks?.find((n) => n.id === id),
    )
    const after = upsertScannedNeighbour(plan, id, fields)
    if (id === undefined) summary.neighboursAdded++
    else if (
      JSON.stringify(plan.neighbourNetworks!.find((n) => n.id === after)) !==
      before
    ) {
      summary.neighboursUpdated++
    }
  }
  for (const bssid of changes.ignored) {
    plan.ignoredBssids ??= []
    if (!plan.ignoredBssids.includes(bssid)) {
      plan.ignoredBssids.push(bssid)
      summary.bssidsIgnored++
    }
  }
  return summary
}

/** An access point a scan would add, with the bands it was heard on (D105). */
export interface ScanNewAccessPoint {
  /** The `newAccessPoint` key its BSSIDs were answered with. */
  key: string
  name: string
  bands: Band[]
  bssids: string[]
}

/** How far apart, in metres, access points added by one scan are put. */
export const SCAN_ACCESS_POINT_SPACING_M = 1.5

/**
 * The access points answering `{ newAccessPoint }` would add, one per key in
 * the order first answered. Each is named after its network (the first SSID
 * among its BSSIDs), with " 2", " 3"… when the plan or an earlier one has
 * the name, or "Access point n" as the Access point tool names them when the
 * network is hidden. A BSSID the plan already knows keeps its answer, as in
 * `planScan`, so it adds nothing.
 */
export function newScanAccessPoints(
  plan: Plan,
  entries: readonly ScanEntry[],
  choices: ReadonlyMap<string, ScanChoice>,
): ScanNewAccessPoint[] {
  const known = knownBssids(plan)
  const byKey = new Map<string, ScanEntry[]>()
  for (const entry of entries) {
    const choice = choices.get(entry.bssid)
    if (known.has(entry.bssid) || typeof choice !== 'object') continue
    if (!('newAccessPoint' in choice)) continue
    const group = byKey.get(choice.newAccessPoint) ?? []
    group.push(entry)
    byKey.set(choice.newAccessPoint, group)
  }
  const names = plan.accessPoints.map((ap) => ap.name)
  return [...byKey].map(([key, group]) => {
    const ssid = group.find((e) => (e.ssid ?? '') !== '')?.ssid?.trim()
    const name = ssid
      ? uniqueName(ssid.slice(0, 95), names)
      : nextAccessPointName({ accessPoints: names.map((n) => ({ name: n })) })
    names.push(name)
    const heard = new Set(group.map((e) => e.band))
    return {
      key,
      name,
      bands: BANDS.filter((b) => heard.has(b)),
      bssids: group.map((e) => e.bssid),
    }
  })
}

function uniqueName(base: string, used: readonly string[]): string {
  if (!used.includes(base)) return base
  let n = 2
  while (used.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/**
 * The middle of a floor's walls, where a scan's new access points go until
 * dragged to where they are (D105); the middle of every floor's walls when
 * it has none, or the origin on an empty plan.
 */
export function floorMiddle(plan: Plan, floorId: string): Point {
  const box = floorCornerBounds(plan, floorId)
  if (!box) return { x: 0, y: 0 }
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
}

/**
 * Adds the access points `newScanAccessPoints` names on `floorId`, each with
 * a radio on the bands it was heard on and nothing else set, in a row from
 * `at`, on an Immer draft. Returns their ids and the answers with each
 * `{ newAccessPoint }` replaced by its access point, for `planScan`, which
 * then gives them their BSSIDs, widths and channels like any of your radios.
 */
export function addScanAccessPoints(
  plan: Plan,
  entries: readonly ScanEntry[],
  choices: ReadonlyMap<string, ScanChoice>,
  floorId: string,
  at: Point,
): { ids: string[]; choices: Map<string, ScanChoice> } {
  const added = newScanAccessPoints(plan, entries, choices)
  const idOf = new Map<string, string>()
  added.forEach((ap, i) => {
    const id = addAccessPoint(plan, floorId, {
      x: at.x + i * SCAN_ACCESS_POINT_SPACING_M,
      y: at.y,
    })
    const created = plan.accessPoints.find((a) => a.id === id)!
    created.name = ap.name
    created.radios = ap.bands.map((band) => ({ band }))
    idOf.set(ap.key, id)
  })
  const resolved = new Map<string, ScanChoice>()
  for (const [bssid, choice] of choices) {
    const id =
      typeof choice === 'object' && 'newAccessPoint' in choice
        ? idOf.get(choice.newAccessPoint)
        : undefined
    resolved.set(bssid, id === undefined ? choice : { apId: id })
  }
  return { ids: [...idOf.values()], choices: resolved }
}

import {
  SURVEY_READING_RANGE_DBM,
  type Band,
  type Plan,
  type SurveySpot,
} from './schema.ts'
import { addSurveySpot, findSurveySpot, parseBssids } from './survey.ts'
import type { PlanIssue } from './validate.ts'

/**
 * Importing survey readings from a CSV or JSON file (D72). The file is read
 * into rows, each row is matched to a spot, and BSSIDs no radio has yet are
 * mapped by the person importing; then `applyImport` adds it all to the plan
 * as one edit. The format is documented in docs/FLOORPLAN.md.
 */

/** One reading from the file. */
export interface ReadingRow {
  /** Where it is in the file, for errors: `line 3` or `readings[2]`. */
  where: string
  bssid: string
  dbm: number
  /** The network name, shown when mapping an unknown BSSID. */
  ssid?: string
  /**
   * The band, from a band, frequency or channel column when the file has
   * one. Only a hint when mapping: a reading's band is its radio's.
   */
  band?: Band
  /** An existing spot, by name ("Spot 3") or id ("spot3"). */
  spot?: string
  /** A new spot's position in plan metres, with the floor it's on. */
  x?: number
  y?: number
  floor?: string
}

export type ReadingsResult =
  { ok: true; rows: ReadingRow[] } | { ok: false; issues: PlanIssue[] }

/** Files with more readings than this are refused, as a slip or a hang. */
export const MAX_IMPORT_ROWS = 100_000

type Field = keyof Omit<ReadingRow, 'where'> | 'channel' | 'frequency'

/** Column names each field is known by, lower case without spaces or marks. */
const ALIASES: Record<Field, readonly string[]> = {
  bssid: ['bssid', 'mac', 'macaddress'],
  dbm: [
    'dbm',
    'rssi',
    'rssidbm',
    'signal',
    'signaldbm',
    'signalstrength',
    'signalstrengthdbm',
    'level',
    'leveldbm',
  ],
  ssid: ['ssid', 'network', 'networkname'],
  band: ['band'],
  channel: ['channel', 'ch'],
  frequency: ['frequency', 'frequencymhz', 'freq', 'freqmhz'],
  spot: ['spot', 'spotid', 'spotname'],
  x: ['x', 'xm'],
  y: ['y', 'ym'],
  floor: ['floor'],
}

const normalise = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

function fieldOf(column: string): Field | undefined {
  const name = normalise(column)
  for (const [field, names] of Object.entries(ALIASES)) {
    if (names.includes(name)) return field as Field
  }
  return undefined
}

/** A number from a cell such as `-67`, `−67 dBm` or `5,18`. */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const text = value
    .trim()
    .replace(/[−‒–]/g, '-')
    .replace(/\s*(dbm|mhz|ghz|m)$/i, '')
    .replace(',', '.')
  if (text === '') return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}

const textOf = (value: unknown) =>
  typeof value === 'string'
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : ''

/** The band a frequency in MHz (or GHz, below 100) is in. */
export function bandOfFrequency(value: number): Band | undefined {
  const mhz = value < 100 ? value * 1000 : value
  if (mhz >= 2400 && mhz <= 2500) return '2.4GHz'
  if (mhz >= 5150 && mhz <= 5895) return '5GHz'
  if (mhz >= 5925 && mhz <= 7125) return '6GHz'
  return undefined
}

function bandOfText(text: string): Band | undefined {
  const n = numberOf(text.replace(/\s*ghz$/i, ''))
  if (n === 2.4) return '2.4GHz'
  if (n === 5) return '5GHz'
  if (n === 6) return '6GHz'
  return n === undefined ? undefined : bandOfFrequency(n)
}

/**
 * The band a channel number most likely means: 1–14 are 2.4 GHz and 32–177
 * are 5 GHz. 6 GHz reuses both ranges, so this is only a guess for the
 * mapping dialog.
 */
function bandOfChannel(channel: number): Band | undefined {
  if (!Number.isInteger(channel)) return undefined
  if (channel >= 1 && channel <= 14) return '2.4GHz'
  if (channel >= 32 && channel <= 177) return '5GHz'
  return undefined
}

/** Reads one row's cells, by field, into a reading or an error. */
function readRow(
  cells: Partial<Record<Field, unknown>>,
  where: string,
): ReadingRow | string {
  const rawBssid = textOf(cells.bssid)
  if (rawBssid === '') return 'No BSSID.'
  const parsed = parseBssids(rawBssid)
  const bssid = parsed.bssids[0]
  if (parsed.invalid.length > 0 || parsed.bssids.length !== 1 || !bssid) {
    return `“${rawBssid}” isn’t a BSSID like a4:2b:b0:12:34:56.`
  }
  const dbm = numberOf(cells.dbm)
  if (dbm === undefined) return 'No signal in dBm.'
  const { min, max } = SURVEY_READING_RANGE_DBM
  if (dbm < min || dbm > max) {
    return `Signal ${dbm} dBm is outside ${min} to ${max} dBm.`
  }
  const row: ReadingRow = { where, bssid, dbm }
  const ssid = textOf(cells.ssid)
  if (ssid !== '') row.ssid = ssid
  const frequency = numberOf(cells.frequency)
  const channel = numberOf(cells.channel)
  const band =
    bandOfText(textOf(cells.band)) ??
    (frequency === undefined ? undefined : bandOfFrequency(frequency)) ??
    (channel === undefined ? undefined : bandOfChannel(channel))
  if (band) row.band = band
  const spot = textOf(cells.spot)
  if (spot !== '') row.spot = spot
  const xText = textOf(cells.x)
  const yText = textOf(cells.y)
  if (xText !== '' || yText !== '') {
    const x = numberOf(xText)
    const y = numberOf(yText)
    if (x === undefined || y === undefined) {
      return 'A position needs both x and y, in metres.'
    }
    row.x = x
    row.y = y
  }
  if (row.spot !== undefined && row.x !== undefined) {
    return 'Give a spot or a position, not both.'
  }
  const floor = textOf(cells.floor)
  if (floor !== '') row.floor = floor
  return row
}

/**
 * Splits CSV text into rows of cells, with quoted cells as RFC 4180 has
 * them, and the line each row starts on.
 */
function csvRows(
  text: string,
  delimiter: string,
): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let start = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const newline = c === '\n' || c === '\r'
    if (newline && text[i] === '\r' && text[i + 1] === '\n') i++
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += newline ? '\n' : c
      if (newline) line++
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (newline) {
      row.push(cell)
      rows.push({ line: start, cells: row })
      row = []
      cell = ''
      line++
      start = line
    } else cell += c
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push({ line: start, cells: row })
  }
  return rows
}

function readCsv(text: string): ReadingsResult {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? ''
  // Commas, or semicolons or tabs where a spreadsheet saved those instead.
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  )
  const [header, ...body] = csvRows(text, delimiter)
  const fields = (header?.cells ?? []).map(fieldOf)
  const missing = (['bssid', 'dbm'] as const).filter((f) => !fields.includes(f))
  if (missing.length > 0) {
    return fail(
      'line 1',
      `The first line needs ${missing.map((f) => (f === 'bssid' ? 'a BSSID column' : 'a dBm (or RSSI) column')).join(' and ')}.`,
    )
  }
  const rows: ReadingRow[] = []
  const issues: PlanIssue[] = []
  body.forEach(({ line, cells }) => {
    if (cells.every((c) => c.trim() === '')) return
    const where = `line ${line}`
    const byField: Partial<Record<Field, unknown>> = {}
    fields.forEach((field, c) => {
      if (field && byField[field] === undefined) byField[field] = cells[c]
    })
    const row = readRow(byField, where)
    if (typeof row === 'string') issues.push({ path: where, message: row })
    else rows.push(row)
  })
  return finish(rows, issues)
}

function readJson(text: string): ReadingsResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    return fail('', `The file is not valid JSON${detail}`)
  }
  const list = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && 'readings' in data
      ? (data as { readings: unknown }).readings
      : undefined
  if (!Array.isArray(list)) {
    return fail('', 'Expected a list of readings, or { "readings": [...] }.')
  }
  const rows: ReadingRow[] = []
  const issues: PlanIssue[] = []
  list.forEach((item: unknown, i) => {
    const where = `readings[${i}]`
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      issues.push({ path: where, message: 'Expected an object.' })
      return
    }
    const byField: Partial<Record<Field, unknown>> = {}
    for (const [key, value] of Object.entries(item)) {
      const field = fieldOf(key)
      if (field && byField[field] === undefined) byField[field] = value
    }
    const row = readRow(byField, where)
    if (typeof row === 'string') issues.push({ path: where, message: row })
    else rows.push(row)
  })
  return finish(rows, issues)
}

function finish(rows: ReadingRow[], issues: PlanIssue[]): ReadingsResult {
  if (issues.length > 0) return { ok: false, issues }
  if (rows.length === 0) return fail('', 'The file has no readings.')
  if (rows.length > MAX_IMPORT_ROWS) {
    return fail('', `The file has more than ${MAX_IMPORT_ROWS} readings.`)
  }
  return { ok: true, rows }
}

const fail = (path: string, message: string): ReadingsResult => ({
  ok: false,
  issues: [{ path, message }],
})

/**
 * Reads a readings file: JSON when it starts with `[` or `{`, otherwise CSV
 * with a header line. Any bad row fails the whole file, with where it is.
 */
export function parseReadings(text: string): ReadingsResult {
  const body = text.replace(/^﻿/, '')
  const first = body.trimStart()[0]
  return first === '[' || first === '{' ? readJson(body) : readCsv(body)
}

/** Where a row's reading goes: an existing spot, or a new one. */
export type RowTarget =
  { spotId: string } | { floorId: string; x: number; y: number }

/** A BSSID no radio has, and that isn't marked not mine, to map by hand. */
export interface UnknownBssid {
  bssid: string
  /** Network names it was seen with. */
  ssids: string[]
  /** Its band, when the file says. */
  band?: Band
  /** How many readings it has, and the strongest. */
  count: number
  strongestDbm: number
}

export interface PreparedImport {
  rows: { row: ReadingRow; target: RowTarget }[]
  unknown: UnknownBssid[]
}

export type PrepareResult =
  { ok: true; prepared: PreparedImport } | { ok: false; issues: PlanIssue[] }

/** A position this close to an existing spot, in metres, is that spot. */
export const SAME_SPOT_M = 0.01

const nameKey = (text: string) => text.toLowerCase().replace(/\s+/g, '')

/** The access point and band each BSSID in the plan belongs to. */
export function bssidOwners(
  plan: Plan,
): Map<string, { apId: string; band: Band }> {
  const owners = new Map<string, { apId: string; band: Band }>()
  for (const ap of plan.accessPoints) {
    for (const radio of ap.radios) {
      for (const bssid of radio.bssids ?? []) {
        owners.set(bssid, { apId: ap.id, band: radio.band })
      }
    }
  }
  return owners
}

/**
 * Matches each row to a spot, and lists the BSSIDs to map. A row names a
 * spot, gives a position (on the floor it names, or `floorId`), or else
 * goes to `selectedSpotId`.
 */
export function prepareImport(
  plan: Plan,
  rows: readonly ReadingRow[],
  context: { floorId: string; selectedSpotId?: string | undefined },
): PrepareResult {
  const spots = new Map<string, string>()
  for (const floor of plan.floors) {
    for (const { id } of floor.surveySpots ?? []) {
      spots.set(nameKey(id), id)
      const n = /^spot(\d+)$/.exec(id)?.[1]
      if (n) {
        spots.set(nameKey(`Spot ${n}`), id)
        spots.set(n, id)
      }
    }
  }
  // A floor by id, or by name when only one floor has it.
  const floors = new Map<string, string | 'ambiguous'>()
  for (const floor of plan.floors) {
    const name = nameKey(floor.name)
    const other = floors.get(name)
    floors.set(name, other && other !== floor.id ? 'ambiguous' : floor.id)
  }
  for (const floor of plan.floors) floors.set(nameKey(floor.id), floor.id)
  const selected =
    context.selectedSpotId && findSurveySpot(plan, context.selectedSpotId)
      ? context.selectedSpotId
      : undefined

  const issues: PlanIssue[] = []
  const targeted: PreparedImport['rows'] = []
  for (const row of rows) {
    if (row.spot !== undefined) {
      const spotId = spots.get(nameKey(row.spot))
      if (spotId) targeted.push({ row, target: { spotId } })
      else {
        issues.push({ path: row.where, message: `No spot “${row.spot}”.` })
      }
    } else if (row.x !== undefined && row.y !== undefined) {
      const floorId =
        row.floor === undefined
          ? context.floorId
          : floors.get(nameKey(row.floor))
      if (floorId === 'ambiguous') {
        issues.push({
          path: row.where,
          message: `More than one floor is called “${row.floor}”: rename one, or use its id.`,
        })
      } else if (floorId) {
        // A spot already at this position takes the readings, so importing
        // a file again replaces them rather than adding a spot.
        const same = plan.floors
          .find((f) => f.id === floorId)
          ?.surveySpots?.find(
            (s) =>
              Math.abs(s.x - row.x!) < SAME_SPOT_M &&
              Math.abs(s.y - row.y!) < SAME_SPOT_M,
          )
        targeted.push({
          row,
          target: same ? { spotId: same.id } : { floorId, x: row.x, y: row.y },
        })
      } else {
        issues.push({ path: row.where, message: `No floor “${row.floor}”.` })
      }
    } else if (selected) {
      targeted.push({ row, target: { spotId: selected } })
    } else {
      issues.push({
        path: row.where,
        message:
          'No spot or position: select a spot first, or add a spot column, or x and y.',
      })
    }
  }
  if (issues.length > 0) return { ok: false, issues }

  const owners = bssidOwners(plan)
  const ignored = new Set(plan.ignoredBssids)
  const unknown = new Map<string, UnknownBssid>()
  for (const { row } of targeted) {
    if (owners.has(row.bssid) || ignored.has(row.bssid)) continue
    const entry = unknown.get(row.bssid) ?? {
      bssid: row.bssid,
      ssids: [],
      count: 0,
      strongestDbm: row.dbm,
    }
    entry.count++
    entry.strongestDbm = Math.max(entry.strongestDbm, row.dbm)
    if (row.ssid && !entry.ssids.includes(row.ssid)) entry.ssids.push(row.ssid)
    if (row.band && entry.band === undefined) entry.band = row.band
    unknown.set(row.bssid, entry)
  }
  return {
    ok: true,
    prepared: {
      rows: targeted,
      // Strongest first: those are most likely the home's own.
      unknown: [...unknown.values()].sort(
        (a, b) => b.strongestDbm - a.strongestDbm,
      ),
    },
  }
}

/** What to do with an unknown BSSID: give it to a radio, or skip it for good. */
export type BssidChoice = { apId: string; band: Band } | 'not-mine'

export interface ImportSummary {
  readingsAdded: number
  readingsReplaced: number
  spotsAdded: number
  /** Rows skipped as from networks marked not mine. */
  rowsSkipped: number
  bssidsMapped: number
}

/**
 * Several readings as one: the mean of their power in mW, back in dBm, to
 * 0.1 dB (D72). Fast fading spreads readings at one spot around the local
 * mean power, which is what the model predicts; a mean of dBm values would
 * read low.
 */
export function meanPowerDbm(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('No values to average.')
  const mw = values.reduce((sum, dbm) => sum + 10 ** (dbm / 10), 0)
  return Math.round(10 * 10 * Math.log10(mw / values.length)) / 10
}

/**
 * Adds a prepared import to the plan (an Immer draft, so it's one undo
 * step): maps the chosen BSSIDs to radios, remembers the ones marked not
 * mine, adds new spots, and sets one reading per spot, access point and
 * band, the mean power of that spot's rows for it. An existing reading for
 * the same access point and band is replaced. Rows whose BSSID has no
 * choice, or a choice of a radio that's gone, are skipped.
 */
export function applyImport(
  plan: Plan,
  prepared: PreparedImport,
  choices: ReadonlyMap<string, BssidChoice>,
): ImportSummary {
  const summary: ImportSummary = {
    readingsAdded: 0,
    readingsReplaced: 0,
    spotsAdded: 0,
    rowsSkipped: 0,
    bssidsMapped: 0,
  }
  for (const [bssid, choice] of choices) {
    if (choice === 'not-mine') {
      plan.ignoredBssids ??= []
      if (!plan.ignoredBssids.includes(bssid)) plan.ignoredBssids.push(bssid)
      continue
    }
    const radio = plan.accessPoints
      .find((ap) => ap.id === choice.apId)
      ?.radios.find((r) => r.band === choice.band)
    // The radio may have gone since the choice was made: skip its rows.
    if (!radio) continue
    radio.bssids ??= []
    if (!radio.bssids.includes(bssid)) {
      radio.bssids.push(bssid)
      summary.bssidsMapped++
    }
  }

  const owners = bssidOwners(plan)
  // Readings grouped by spot (existing id or new position), then source.
  const groups = new Map<
    string,
    { target: RowTarget; apId: string; band: Band; values: number[] }
  >()
  for (const { row, target } of prepared.rows) {
    const owner = owners.get(row.bssid)
    if (!owner) {
      summary.rowsSkipped++
      continue
    }
    const place =
      'spotId' in target
        ? target.spotId
        : `${target.floorId} ${target.x} ${target.y}`
    const key = `${place}\n${owner.apId}\n${owner.band}`
    const group = groups.get(key) ?? { target, ...owner, values: [] }
    group.values.push(row.dbm)
    groups.set(key, group)
  }

  const added = new Map<string, string>()
  const spotFor = (target: RowTarget): SurveySpot => {
    let id: string
    if ('spotId' in target) id = target.spotId
    else {
      const key = `${target.floorId} ${target.x} ${target.y}`
      id =
        added.get(key) ??
        addSurveySpot(plan, target.floorId, { x: target.x, y: target.y })
      if (!added.has(key)) {
        added.set(key, id)
        summary.spotsAdded++
      }
    }
    return findSurveySpot(plan, id)!.spot
  }
  for (const { target, apId, band, values } of groups.values()) {
    const spot = spotFor(target)
    const dbm = meanPowerDbm(values)
    const existing = spot.readings.find(
      (r) => r.apId === apId && r.band === band,
    )
    if (existing) {
      existing.dbm = dbm
      delete existing.approximate
      delete existing.scans
      summary.readingsReplaced++
    } else {
      spot.readings.push({ apId, band, dbm })
      summary.readingsAdded++
    }
  }
  return summary
}

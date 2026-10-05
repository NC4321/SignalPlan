import {
  CHANNEL_WIDTHS,
  SURVEY_READING_RANGE_DBM,
  type Band,
  type ChannelWidth,
} from './schema.ts'
import { csvRows, meanPowerDbm } from './surveyImport.ts'
import type { PlanIssue } from './validate.ts'

/**
 * Reading what a computer or phone sees of the Wi-Fi around it (D77): the
 * output of a scan command, pasted or saved to a file, turned into one entry
 * per BSSID with its band, channel, width where the tool says, and signal in
 * dBm. Each format is recognised by its structure, tried in turn. The
 * formats are documented in docs/FLOORPLAN.md, with which ones have been
 * checked against a real capture.
 */

/** The tools whose output can be read. */
export type ScanFormat =
  'signalplan' | 'netsh' | 'system-profiler' | 'nmcli' | 'iw' | 'wifi-analyzer'

/** What each format is called in the editor. */
export const SCAN_FORMAT_NAMES: Record<ScanFormat, string> = {
  signalplan: 'SignalPlan scan script',
  netsh: 'Windows (netsh)',
  'system-profiler': 'macOS (system_profiler)',
  nmcli: 'Linux (nmcli)',
  iw: 'Linux (iw)',
  'wifi-analyzer': 'Android (WiFi Analyzer)',
}

/** One BSSID seen by the scan. */
export interface ScanEntry {
  /** Where it starts in the output, for messages: `line 12`. */
  where: string
  bssid: string
  /** The network name; omitted for a hidden network. */
  ssid?: string
  band: Band
  /** The primary channel, when the tool gives it or its frequency. */
  channel?: number
  /** The channel width, when the tool says. */
  widthMHz?: ChannelWidth
  /** Signal in dBm, to 0.1 dB. */
  dbm: number
  /**
   * Converted from a percentage (netsh, nmcli), so only roughly right, and
   * clipped at the tool's ends of the scale.
   */
  approximate: boolean
}

/** A BSSID left out, and why. */
export interface SkippedEntry {
  where: string
  reason: string
}

export type ScanResult =
  | {
      ok: true
      format: ScanFormat
      entries: ScanEntry[]
      skipped: SkippedEntry[]
    }
  | { ok: false; issues: PlanIssue[] }

/**
 * Windows' signal quality to dBm: Microsoft documents 0 % as −100 dBm and
 * 100 % as −50 dBm, linear between (WLAN_AVAILABLE_NETWORK,
 * wlanSignalQuality). Anything stronger than −50 dBm also shows 100 %.
 */
export function netshPercentToDbm(percent: number): number {
  return round1(-100 + clamp(percent, 0, 100) / 2)
}

/**
 * NetworkManager's signal percentage to dBm. NetworkManager maps −100 dBm
 * to 0 % and −40 dBm to 100 %, linear between, and truncates
 * (`nm_wifi_utils_level_to_quality` in src/core/nm-core-utils.c), so each
 * percentage from 1 to 99 covers 0.6 dB; this gives the middle of it.
 * 0 % and 100 % give −100 and −40 dBm, though the signal may lie beyond.
 */
export function nmcliPercentToDbm(percent: number): number {
  const q = clamp(Math.round(percent), 0, 100)
  if (q === 0) return -100
  if (q === 100) return -40
  return round1(-100.3 + 0.6 * q)
}

/** The primary channel at a centre frequency in MHz, by its band. */
export function channelOfFrequency(mhz: number): number | undefined {
  const f = Math.round(mhz)
  if (f === 2484) return 14
  if (f >= 2412 && f <= 2472 && (f - 2407) % 5 === 0) return (f - 2407) / 5
  if (f >= 5160 && f <= 5885 && f % 5 === 0) return (f - 5000) / 5
  if (f === 5935) return 2
  if (f >= 5955 && f <= 7115 && (f - 5950) % 5 === 0) return (f - 5950) / 5
  return undefined
}

/** The band a frequency in MHz is in. */
export function bandOfScanFrequency(mhz: number): Band | undefined {
  if (mhz >= 2400 && mhz <= 2500) return '2.4GHz'
  if (mhz >= 5150 && mhz <= 5895) return '5GHz'
  if (mhz >= 5925 && mhz <= 7125) return '6GHz'
  return undefined
}

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

const MAC = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i
const macOf = (text: string) =>
  MAC.test(text.trim()) ? text.trim().toLowerCase().replace(/-/g, ':') : ''

/** A number from text such as `-67`, `−67 dBm`, `5180 MHz` or `86 %`. */
function numberIn(text: string): number | undefined {
  const match = /[-−]?\d+(?:[.,]\d+)?/.exec(text)
  if (!match) return undefined
  const n = Number(match[0].replace('−', '-').replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

function widthOf(mhz: number | undefined): ChannelWidth | undefined {
  return CHANNEL_WIDTHS.find((w) => w === mhz)
}

/** A band from text such as `5 GHz`, `2,4 GHz` or `6GHz`. */
function bandOfText(text: string): Band | undefined {
  const match = /^(2[.,]4|5|6)\s*GHz$/i.exec(text.trim())
  if (!match) return undefined
  const n = match[1]!.replace(',', '.')
  return n === '2.4' ? '2.4GHz' : n === '5' ? '5GHz' : '6GHz'
}

/** A builder for one format's entries, skipped BSSIDs and issues. */
function collector() {
  const entries: ScanEntry[] = []
  const skipped: SkippedEntry[] = []
  const issues: PlanIssue[] = []
  return {
    entries,
    skipped,
    issues,
    /**
     * Adds an entry once it has a band and a signal in range; a BSSID without
     * a band is skipped, and a signal that can't be read is an issue.
     */
    add(fields: {
      where: string
      bssid: string
      ssid: string | undefined
      band: Band | undefined
      channel?: number | undefined
      widthMHz?: ChannelWidth | undefined
      dbm: number | undefined
      approximate?: boolean
    }) {
      const { band, dbm, approximate = false, ...rest } = fields
      if (dbm === undefined) {
        issues.push({
          path: rest.where,
          message: `No signal for BSSID ${rest.bssid}.`,
        })
        return
      }
      const { min, max } = SURVEY_READING_RANGE_DBM
      if (dbm < min || dbm > max) {
        issues.push({
          path: rest.where,
          message: `Signal ${dbm} dBm for BSSID ${rest.bssid} is outside ${min} to ${max} dBm.`,
        })
        return
      }
      if (!band) {
        skipped.push({
          where: rest.where,
          reason: `BSSID ${rest.bssid} is on no Wi-Fi band SignalPlan models.`,
        })
        return
      }
      const entry: ScanEntry = {
        where: rest.where,
        bssid: rest.bssid,
        band,
        dbm: round1(dbm),
        approximate,
      }
      if (rest.ssid) entry.ssid = rest.ssid
      if (rest.channel !== undefined) entry.channel = rest.channel
      if (rest.widthMHz !== undefined) entry.widthMHz = rest.widthMHz
      entries.push(entry)
    },
  }
}

type Collected = ReturnType<typeof collector>

/** Lines of text with their numbers, from 1. */
const linesOf = (text: string) =>
  text.split(/\r\n|\r|\n/).map((line, i) => ({ line, n: i + 1 }))

/**
 * `netsh wlan show networks mode=bssid` on Windows. The labels are
 * translated with Windows itself, so this reads the layout, not the words:
 * an unindented `… n : name` starts a network, an indented line whose value
 * is a MAC address starts a BSSID, and among the lines indented under that,
 * the first percentage is the signal (`86 %`, or `%86` as Turkish Windows
 * writes it), a value like `5 GHz` the band (Windows 11), and the first
 * whole number after the signal the channel.
 */
function readNetsh(text: string, out: Collected) {
  let ssid = ''
  let current:
    | {
        where: string
        bssid: string
        ssid: string
        indent: number
        percent?: number | undefined
        band?: Band | undefined
        channel?: number | undefined
      }
    | undefined
  const finish = () => {
    if (!current) return
    const { where, bssid, percent, channel } = current
    const band =
      current.band ??
      (channel === undefined
        ? undefined
        : channel <= 14
          ? '2.4GHz'
          : channel >= 32 && channel <= 177
            ? '5GHz'
            : undefined)
    out.add({
      where,
      bssid,
      ssid: current.ssid,
      band,
      channel,
      dbm: percent === undefined ? undefined : netshPercentToDbm(percent),
      approximate: true,
    })
    current = undefined
  }
  for (const { line, n } of linesOf(text)) {
    const match = /^(\s*)(.*?)\s+:\s?(.*)$/.exec(line)
    if (!match) continue
    const indent = match[1]!.replace(/\t/g, '    ').length
    const label = match[2]!
    const value = match[3]!.trim()
    if (current && indent <= current.indent) finish()
    if (indent === 0) {
      if (/\d+$/.test(label)) ssid = value
      continue
    }
    const bssid = macOf(value)
    if (bssid) {
      finish()
      current = { where: `line ${n}`, bssid, ssid, indent }
      continue
    }
    if (!current) continue
    if (current.percent === undefined) {
      const percent = /^(?:%\s*(\d{1,3})|(\d{1,3})\s*%)$/.exec(value)
      if (percent) current.percent = Number(percent[1] ?? percent[2])
      continue
    }
    const band = bandOfText(value)
    if (band) current.band ??= band
    else if (current.channel === undefined && /^\d{1,3}$/.test(value)) {
      current.channel = Number(value)
    }
  }
  finish()
}

/** Splits a terse nmcli line on colons that aren't escaped. */
function nmcliFields(line: string): string[] {
  const fields: string[] = []
  let field = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '\\' && i + 1 < line.length) field += line[++i]
    else if (c === ':') {
      fields.push(field)
      field = ''
    } else field += c
  }
  fields.push(field)
  return fields
}

const NMCLI_ORDER =
  'Expected BSSID:SSID:CHAN:FREQ:SIGNAL, as nmcli -t -f BSSID,SSID,CHAN,FREQ,SIGNAL gives.'

/**
 * `nmcli -t -f BSSID,SSID,CHAN,FREQ,SIGNAL dev wifi list` on Linux, with
 * an optional sixth field, BANDWIDTH, where NetworkManager has it. Terse
 * output has no header, so fields asked for in another order are caught by
 * their values: CHAN a whole number, FREQ like `5180 MHz`, SIGNAL 0 to 100.
 */
function readNmcli(text: string, out: Collected) {
  for (const { line, n } of linesOf(text)) {
    if (line.trim() === '') continue
    const where = `line ${n}`
    const fields = nmcliFields(line)
    const bssid = macOf(fields[0] ?? '')
    if (!bssid || fields.length < 5 || fields.length > 6) {
      out.issues.push({ path: where, message: NMCLI_ORDER })
      continue
    }
    const [, ssid, chan, freq, signal, bandwidth] = fields
    const wrong = !/^\d{1,3}$/.test(chan!.trim())
      ? `CHAN “${chan}” isn’t a channel number`
      : !/^\d+\s*MHz$/i.test(freq!.trim())
        ? `FREQ “${freq}” isn’t a frequency like 5180 MHz`
        : !/^\d{1,3}$/.test(signal!.trim()) || Number(signal) > 100
          ? `SIGNAL “${signal}” isn’t a percentage from 0 to 100`
          : undefined
    if (wrong) {
      out.issues.push({
        path: where,
        message: `${wrong}, so the fields may be in another order. ${NMCLI_ORDER}`,
      })
      continue
    }
    const mhz = numberIn(freq!)
    const percent = numberIn(signal!)
    out.add({
      where,
      bssid,
      ssid: ssid!,
      band: mhz === undefined ? undefined : bandOfScanFrequency(mhz),
      channel:
        (mhz === undefined ? undefined : channelOfFrequency(mhz)) ??
        numberIn(chan!),
      widthMHz: widthOf(bandwidth ? numberIn(bandwidth) : undefined),
      dbm: percent === undefined ? undefined : nmcliPercentToDbm(percent),
      approximate: true,
    })
  }
}

/**
 * `iw dev <interface> scan` on Linux: a block per `BSS <mac>` line with its
 * frequency, signal in dBm and SSID, and the width as the Windows script
 * reads it (D81): on 6 GHz from the HE operation's 6 GHz information, else
 * from the VHT operation element (80 MHz, or 160 when its second centre
 * segment is set, as 802.11-2020 signals 160 MHz; or 160 by the older,
 * deprecated widths 2 and 3), or else the HT operation element (40 MHz with
 * a secondary channel, 20 MHz without). A BSS without a signal line is
 * skipped rather than failing the whole scan.
 */
function readIw(text: string, out: Collected) {
  let current:
    | {
        where: string
        bssid: string
        ssid: string
        mhz?: number | undefined
        dbm?: number | undefined
        vhtWidth?: number | undefined
        vhtSegment2?: number | undefined
        he6Width?: ChannelWidth | undefined
        htSecondary?: boolean | undefined
        htAny?: boolean | undefined
      }
    | undefined
  const finish = () => {
    if (!current) return
    const { where, bssid, ssid, mhz, dbm, vhtWidth, vhtSegment2 } = current
    const { he6Width, htSecondary, htAny } = current
    current = undefined
    if (dbm === undefined) {
      out.skipped.push({
        where,
        reason: `BSSID ${bssid} has no signal line in iw’s output.`,
      })
      return
    }
    const band = mhz === undefined ? undefined : bandOfScanFrequency(mhz)
    let widthMHz: ChannelWidth | undefined
    if (band === '6GHz' && he6Width !== undefined) widthMHz = he6Width
    else if (vhtWidth === 1) widthMHz = vhtSegment2 ? 160 : 80
    else if (vhtWidth === 2 || vhtWidth === 3) widthMHz = 160
    else if (htSecondary !== undefined) {
      widthMHz = htSecondary && htAny !== false ? 40 : 20
    }
    out.add({
      where,
      bssid,
      ssid,
      band,
      channel: mhz === undefined ? undefined : channelOfFrequency(mhz),
      widthMHz,
      dbm,
    })
  }
  let section = ''
  for (const { line, n } of linesOf(text)) {
    const bss = /^BSS ([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i.exec(line)
    if (bss) {
      finish()
      current = { where: `line ${n}`, bssid: bss[1]!.toLowerCase(), ssid: '' }
      section = ''
      continue
    }
    if (!current) continue
    const trimmed = line.trim()
    if (/^\S/.test(line.replace(/^\t/, ''))) {
      // A line one tab in starts a field or an element's section.
      section = trimmed.replace(/:.*$/, '').toLowerCase()
    }
    const value = trimmed.replace(/^\*\s*/, '')
    if (/^freq:/.test(value)) current.mhz = numberIn(value)
    else if (/^signal:/.test(value)) current.dbm = numberIn(value)
    else if (/^SSID:/.test(value)) current.ssid = value.slice(5).trim()
    else if (section === 'vht operation' && /^channel width:/.test(value)) {
      current.vhtWidth = numberIn(value)
    } else if (
      section === 'vht operation' &&
      /^center freq segment 2:/.test(value)
    ) {
      current.vhtSegment2 = numberIn(value.replace(/^.*?:/, ''))
    } else if (section === 'he operation' && /^Channel Width:/.test(value)) {
      // 6 GHz Operation Information: `20 MHz` … `80+80 or 160 MHz`.
      const mhz = /(\d+)\s*MHz/.exec(value)
      current.he6Width = /160/.test(value)
        ? 160
        : widthOf(mhz ? Number(mhz[1]) : undefined)
    } else if (
      section === 'ht operation' &&
      /^secondary channel offset:/.test(value)
    ) {
      current.htSecondary = /above|below/.test(value)
    } else if (
      section === 'ht operation' &&
      /^STA channel width:/.test(value)
    ) {
      current.htAny = /any/.test(value)
    }
  }
  finish()
}

/** Column names for WiFi Analyzer's export, lower case without spaces or marks. */
const ANALYZER_COLUMNS = {
  bssid: ['bssid', 'mac', 'macaddress'],
  ssid: ['ssid', 'name'],
  dbm: ['strength', 'level', 'rssi', 'signal', 'dbm'],
  frequency: ['primaryfrequency', 'frequency', 'freq'],
  channel: ['primarychannel', 'channel'],
  width: ['widthrange', 'width', 'channelwidth', 'bandwidth'],
} as const

const columnKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * WiFi Analyzer's (com.vrem.wifianalyzer) export on Android: a header line
 * and a row per BSSID, separated by `|`, commas, semicolons or tabs, with
 * the BSSID, SSID, strength in dBm, primary frequency or channel, and width
 * such as `80MHz (5170 - 5250)`.
 */
function readAnalyzer(text: string, out: Collected) {
  // Quoted cells, as a spreadsheet re-saves them, may hold the delimiter.
  const rowsBy = (d: string) =>
    csvRows(text, d).filter(({ cells }) => cells.some((c) => c.trim() !== ''))
  const delimiter = ['|', ',', ';', '\t'].reduce((best, d) =>
    (rowsBy(d)[0]?.cells.length ?? 0) > (rowsBy(best)[0]?.cells.length ?? 0)
      ? d
      : best,
  )
  const [header, ...rows] = rowsBy(delimiter)
  const names = (header?.cells ?? []).map(columnKey)
  const column = (field: keyof typeof ANALYZER_COLUMNS) =>
    names.findIndex((name) =>
      (ANALYZER_COLUMNS[field] as readonly string[]).includes(name),
    )
  const at = {
    bssid: column('bssid'),
    ssid: column('ssid'),
    dbm: column('dbm'),
    frequency: column('frequency'),
    channel: column('channel'),
    width: column('width'),
  }
  if (at.dbm < 0) {
    out.issues.push({
      path: 'line 1',
      message: 'The first line needs a strength (or level) column.',
    })
    return
  }
  for (const row of rows) {
    const cells = row.cells.map((c) => c.trim())
    const where = `line ${row.line}`
    const bssid = macOf(cells[at.bssid] ?? '')
    if (!bssid) {
      out.issues.push({
        path: where,
        message: `“${cells[at.bssid] ?? ''}” isn’t a BSSID like a4:2b:b0:12:34:56.`,
      })
      continue
    }
    const cell = (i: number) => (i < 0 ? undefined : cells[i])
    const mhz = numberIn(cell(at.frequency) ?? '')
    const channel = numberIn(cell(at.channel) ?? '')
    out.add({
      where,
      bssid,
      ssid: cell(at.ssid) ?? '',
      band: mhz === undefined ? undefined : bandOfScanFrequency(mhz),
      channel:
        (mhz === undefined ? undefined : channelOfFrequency(mhz)) ?? channel,
      widthMHz: widthOf(numberIn(cell(at.width) ?? '')),
      dbm: numberIn(cell(at.dbm) ?? ''),
    })
  }
}

/**
 * `system_profiler SPAirPortDataType -json` on macOS: the networks in
 * `spairport_airport_other_local_wireless_networks` and the one in
 * `spairport_current_network_information`, each with its channel as
 * `36 (5GHz, 80MHz)` and signal as `-56 dBm / -92 dBm`. macOS leaves out
 * BSSIDs unless the app reading them has Location permission, and a network
 * without one is skipped.
 */
function readSystemProfiler(data: unknown, out: Collected) {
  const networks: { network: Record<string, unknown>; where: string }[] = []
  // system_profiler nests a handful deep; deeper is never its output, and
  // walking it would overflow the stack.
  const walk = (value: unknown, path: string, depth = 0) => {
    if (depth > 32) return
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1))
    } else if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>
      if ('spairport_network_channel' in record) {
        networks.push({ network: record, where: path })
      }
      for (const [key, item] of Object.entries(record)) {
        walk(item, path ? `${path}.${key}` : key, depth + 1)
      }
    }
  }
  walk(data, '')
  for (const { network, where } of networks) {
    const text = (key: string) =>
      typeof network[key] === 'string' || typeof network[key] === 'number'
        ? String(network[key])
        : ''
    const ssid = text('_name')
    const bssid = macOf(text('spairport_network_bssid'))
    if (!bssid) {
      out.skipped.push({
        where,
        reason: `${ssid === '' ? 'A network' : `“${ssid}”`} has no BSSID: macOS hides them unless Location is allowed.`,
      })
      continue
    }
    const channelText = text('spairport_network_channel')
    const channel = numberIn(channelText)
    const bandMatch = /(2|5|6)\s*GHz/i.exec(channelText)
    const band: Band | undefined = bandMatch
      ? bandMatch[1] === '2'
        ? '2.4GHz'
        : bandMatch[1] === '5'
          ? '5GHz'
          : '6GHz'
      : channel !== undefined && channel <= 14
        ? '2.4GHz'
        : undefined
    const widthMatch = /(\d+)\s*MHz/i.exec(channelText)
    out.add({
      where,
      bssid,
      ssid,
      band,
      channel,
      widthMHz: widthOf(widthMatch ? Number(widthMatch[1]) : undefined),
      dbm: numberIn(text('spairport_signal_noise')),
    })
  }
}

/**
 * The JSON SignalPlan's own scan scripts write: `{ "signalplanScan": 1,
 * "networks": [{ "bssid", "ssid", "frequencyMHz", "widthMHz", "dbm" }] }`,
 * or `channel` and `band` (`"2.4"`, `"5"` or `"6"`) in place of the
 * frequency (D81).
 */
function readSignalplan(data: Record<string, unknown>, out: Collected) {
  if (data.signalplanScan !== 1) {
    out.issues.push({
      path: 'signalplanScan',
      message: `This scan is version ${String(data.signalplanScan)}; this SignalPlan reads version 1.`,
    })
    return
  }
  if (!Array.isArray(data.networks)) {
    out.issues.push({ path: 'networks', message: 'Expected a list.' })
    return
  }
  data.networks.forEach((item: unknown, i) => {
    const where = `networks[${i}]`
    if (typeof item !== 'object' || item === null) {
      out.issues.push({ path: where, message: 'Expected an object.' })
      return
    }
    const network = item as Record<string, unknown>
    const bssid = macOf(String(network.bssid ?? ''))
    if (!bssid) {
      out.issues.push({
        path: where,
        message: `“${String(network.bssid ?? '')}” isn’t a BSSID like a4:2b:b0:12:34:56.`,
      })
      return
    }
    const number = (key: string) =>
      typeof network[key] === 'number' && Number.isFinite(network[key])
        ? network[key]
        : undefined
    const mhz = number('frequencyMHz')
    // Without a frequency, a channel and band (as CoreWLAN gives them).
    const band =
      mhz === undefined
        ? typeof network.band === 'string'
          ? bandOfText(`${network.band} GHz`)
          : undefined
        : bandOfScanFrequency(mhz)
    out.add({
      where,
      bssid,
      ssid: typeof network.ssid === 'string' ? network.ssid : '',
      band,
      channel: mhz === undefined ? number('channel') : channelOfFrequency(mhz),
      widthMHz: widthOf(number('widthMHz')),
      dbm: number('dbm'),
    })
  })
}

/** Which format some text is, from its shape, or undefined. */
function formatOf(text: string): ScanFormat | undefined {
  const first = text.trimStart()[0]
  if (first === '{' || first === '[') return undefined // JSON, read apart
  if (/^BSS [0-9a-f]{2}(:[0-9a-f]{2}){5}/im.test(text)) return 'iw'
  const firstLine =
    text.split(/\r\n|\r|\n/).find((line) => line.trim() !== '') ?? ''
  if (/^[0-9a-f]{2}(\\:[0-9a-f]{2}){5}:/i.test(firstLine)) return 'nmcli'
  if (
    /bssid/i.test(firstLine) &&
    !/\s:\s/.test(firstLine) &&
    /[|,;\t]/.test(firstLine)
  ) {
    return 'wifi-analyzer'
  }
  if (/^\s+\S.*?\s+:\s?[0-9a-f]{2}([:-][0-9a-f]{2}){5}\s*$/im.test(text)) {
    return 'netsh'
  }
  return undefined
}

/**
 * Reads a scan, in whichever supported format it is. Several sightings of
 * one BSSID become one entry, at the mean of their power in mW (as for
 * imported readings, D72). Fails with where each problem is when the output
 * can't be read; BSSIDs on a band SignalPlan doesn't model, or that macOS
 * hid, are skipped and listed.
 */
export function parseScan(text: string): ScanResult {
  const body = text.replace(/^﻿/, '')
  const out = collector()
  let format: ScanFormat | undefined
  const first = body.trimStart()[0]
  if (first === '{' || first === '[') {
    let data: unknown
    try {
      data = JSON.parse(body)
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : ''
      return fail(`The scan is not valid JSON${detail}`)
    }
    if (typeof data === 'object' && data !== null && 'signalplanScan' in data) {
      format = 'signalplan'
      readSignalplan(data as Record<string, unknown>, out)
    } else if (
      typeof data === 'object' &&
      data !== null &&
      'SPAirPortDataType' in data
    ) {
      format = 'system-profiler'
      readSystemProfiler(data, out)
    }
  } else {
    format = formatOf(body)
    if (format === 'iw') readIw(body, out)
    else if (format === 'nmcli') readNmcli(body, out)
    else if (format === 'wifi-analyzer') readAnalyzer(body, out)
    else if (format === 'netsh') readNetsh(body, out)
  }
  if (!format) {
    return fail(
      'This isn’t a scan SignalPlan can read: paste the whole output of one of the commands in Scan your network.',
    )
  }
  if (out.issues.length > 0) return { ok: false, issues: out.issues }
  if (out.entries.length === 0 && out.skipped.length === 0) {
    return fail('The scan has no networks in it.')
  }
  return {
    ok: true,
    format,
    entries: mergeSightings(out.entries),
    skipped: out.skipped,
  }
}

const fail = (message: string): ScanResult => ({
  ok: false,
  issues: [{ path: '', message }],
})

/** One entry per BSSID, in the order first seen. */
function mergeSightings(entries: readonly ScanEntry[]): ScanEntry[] {
  const byBssid = new Map<string, ScanEntry[]>()
  for (const entry of entries) {
    const list = byBssid.get(entry.bssid) ?? []
    list.push(entry)
    byBssid.set(entry.bssid, list)
  }
  return [...byBssid.values()].map((list) => {
    if (list.length === 1) return list[0]!
    const merged: ScanEntry = {
      ...list[0]!,
      dbm: meanPowerDbm(list.map((e) => e.dbm)),
      approximate: list.some((e) => e.approximate),
    }
    for (const e of list) {
      if (merged.ssid === undefined && e.ssid !== undefined)
        merged.ssid = e.ssid
      if (merged.channel === undefined && e.channel !== undefined) {
        merged.channel = e.channel
      }
      if (merged.widthMHz === undefined && e.widthMHz !== undefined) {
        merged.widthMHz = e.widthMHz
      }
    }
    return merged
  })
}

/** BSSIDs that look like one device's radios and networks. */
export interface ScanDevice {
  /** Strongest first. */
  entries: ScanEntry[]
  /** Every network name the device broadcasts, in the order first seen. */
  ssids: string[]
}

/**
 * The same for every BSSID `groupScanDevices` takes for one device: the
 * MAC address without its last octet or the first octet's locally
 * administered bit.
 */
export function scanDeviceKey(bssid: string): string {
  const octets = bssid.split(':')
  const firstOctet = (parseInt(octets[0]!, 16) & ~0x02)
    .toString(16)
    .padStart(2, '0')
  return [firstOctet, ...octets.slice(1, 5)].join(':')
}

/**
 * Groups BSSIDs that look like one device (D77): MAC addresses that differ
 * only in the last octet, or also in the first octet's locally administered
 * bit, which devices set for their extra networks. It's a guess, so the
 * dialog lets a group be split. Devices come strongest first.
 */
export function groupScanDevices(entries: readonly ScanEntry[]): ScanDevice[] {
  const groups = new Map<string, ScanEntry[]>()
  for (const entry of entries) {
    const key = scanDeviceKey(entry.bssid)
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  const devices = [...groups.values()].map((group) => {
    const sorted = [...group].sort((a, b) => b.dbm - a.dbm)
    const ssids: string[] = []
    for (const e of group) {
      if (e.ssid !== undefined && !ssids.includes(e.ssid)) ssids.push(e.ssid)
    }
    return { entries: sorted, ssids }
  })
  return devices.sort((a, b) => b.entries[0]!.dbm - a.entries[0]!.dbm)
}

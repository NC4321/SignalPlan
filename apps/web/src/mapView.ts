import {
  autoChannelCount,
  neighbourBackground,
  overlapCounts,
  requiredSinrDb,
  roamingEdges,
  roamingOwners,
  sinrDb,
  sourceTunings,
  summariseCoverage,
  PHONE_EIRP_DBM,
  uplinkDbm,
  uplinkShares,
  viewShares,
  type Coverage,
  type Rate,
  type ViewSettings,
} from '@signalplan/engine'
import type { Band, CoverageTarget, Plan } from '@signalplan/floorplan'
import { BAND_LABELS, coverageMessage } from './editor/coverageText.ts'
import { formatArea, type Units } from './editor/units.ts'
import { QUALITY_BANDS, qualityOf, targetBand } from './quality.ts'

/**
 * What the heatmap shows (D61, D64, D66, D99): signal strength, the phone's
 * signal at the access point (upload), how many access points compete for a
 * device, which one it would be on, or signal over interference and noise.
 * Not saved, like the band.
 */
export const MAP_KINDS = [
  'signal',
  'upload',
  'overlap',
  'roaming',
  'interference',
] as const
export type MapKind = (typeof MAP_KINDS)[number]

export const MAP_LABELS: Record<MapKind, string> = {
  signal: 'Signal',
  upload: 'Upload',
  overlap: 'Overlap',
  roaming: 'Roaming',
  interference: 'Interference',
}

export type Rgb = readonly [number, number, number]

/**
 * The Interference view's bands (D66), each the SINR an 802.11 receiver
 * needs for a rate, best first, on the Signal view's viridis ramp. Below the
 * slowest rate is hatched as unusable.
 */
export const SINR_BANDS: readonly {
  rate: Rate
  label: string
  detail: string
  rgb: Rgb
}[] = [
  {
    rate: 'mcs11',
    label: 'Fastest',
    detail: "Wi-Fi 6's top rate",
    rgb: [0xfd, 0xe7, 0x25],
  },
  {
    rate: 'mcs9',
    label: 'Very fast',
    detail: "Wi-Fi 5's top rate",
    rgb: [0x5e, 0xc9, 0x62],
  },
  {
    rate: 'mcs7',
    label: 'Fast',
    detail: "Wi-Fi 4's top rate",
    rgb: [0x21, 0x91, 0x8c],
  },
  { rate: 'mcs4', label: 'Medium', detail: '16-QAM', rgb: [0x3b, 0x52, 0x8b] },
  {
    rate: 'mcs0',
    label: 'Slow',
    detail: 'the slowest rate',
    rgb: [0x44, 0x01, 0x54],
  },
]

/** SINR bands with their thresholds in dB, worked out once. */
const SINR_STEPS = SINR_BANDS.map((b) => ({
  ...b,
  minDb: requiredSinrDb(b.rate),
}))

/** The SINR the slowest rate needs: below it a cell is unusable. */
export const MIN_USABLE_SINR_DB = SINR_STEPS.at(-1)!.minDb

/**
 * Overlap colours for 1, 2 and 3 or more access points: a light-to-dark blue
 * ramp, so the count reads from lightness alone.
 */
const OVERLAP_RGB: readonly Rgb[] = [
  [0xc6, 0xdb, 0xef],
  [0x42, 0x92, 0xc6],
  [0x08, 0x30, 0x6b],
]

/**
 * One colour per access point in the Roaming view: the Okabe–Ito palette,
 * which stays distinct with common colour-vision deficiencies. After seven
 * access points the colours repeat.
 */
const ACCESS_POINT_RGB: readonly Rgb[] = [
  [0xe6, 0x9f, 0x00],
  [0x56, 0xb4, 0xe9],
  [0x00, 0x9e, 0x73],
  [0xf0, 0xe4, 0x42],
  [0x00, 0x72, 0xb2],
  [0xd5, 0x5e, 0x00],
  [0xcc, 0x79, 0xa7],
]

/** Where a device would switch access points. */
export const EDGE_RGB: Rgb = [0x1a, 0x1a, 0x1a]

/** The switch line's legend key sits on this light grey, so it shows in both themes. */
export const EDGE_KEY_RGB: Rgb = [0xe0, 0xe0, 0xe0]

/** Gaps are hatched: a darker grey every fourth diagonal. */
export const GAP_RGB: Rgb = [0xbd, 0xbd, 0xbd]
export const GAP_HATCH_RGB: Rgb = [0x73, 0x73, 0x73]

export const accessPointRgb = (index: number): Rgb =>
  ACCESS_POINT_RGB[index % ACCESS_POINT_RGB.length]!

export const rgbCss = (rgb: Rgb) => `rgb(${rgb.join(' ')})`

/** A coverage result with what the chosen map needs worked out from it. */
export interface MapData {
  kind: MapKind
  coverage: Coverage
  settings: ViewSettings
  counts: Uint8Array | undefined
  owners: Int16Array | undefined
  edges: Uint8Array | undefined
  /** SINR in dB per cell, for the Interference view. */
  sinr: Float32Array | undefined
  /** The phone's signal at its access point in dBm per cell, for the Upload view. */
  uplink: Float32Array | undefined
  /** The coverage target's level in dBm (D27). */
  targetDbm: number
  /** How many access points leave their channel on Auto; 0 outside Interference. */
  autoChannels: number
  /**
   * Neighbours' networks counted on the band at one strength everywhere,
   * and those counted from where they were located; 0 outside Interference
   * (D67, D84).
   */
  neighbours: number
  locatedNeighbours: number
  /** Names in the order of `accessPointIds`, for the Roaming legend. */
  accessPointNames: string[]
}

/**
 * `plan` is the plan the coverage was worked out for, suggestion included,
 * so the Roaming legend names every access point on the map in its colour
 * and the Interference view uses every access point's channel and the
 * neighbours' networks.
 */
export function mapData(
  coverage: Coverage,
  kind: MapKind,
  settings: ViewSettings,
  plan: Pick<
    Plan,
    'accessPoints' | 'region' | 'neighbourNetworks' | 'coverageTarget'
  >,
): MapData {
  const accessPointNames = coverage.accessPointIds.map(
    (id) => plan.accessPoints.find((ap) => ap.id === id)?.name ?? id,
  )
  const counts =
    kind === 'overlap' || kind === 'roaming'
      ? overlapCounts(coverage, settings)
      : undefined
  const owners =
    kind === 'roaming' ? roamingOwners(coverage, settings) : undefined
  const edges = owners ? roamingEdges(owners, coverage.grid.cols) : undefined
  const tunings =
    kind === 'interference' ? sourceTunings(coverage, plan) : undefined
  const background =
    kind === 'interference'
      ? neighbourBackground(plan, coverage.band, coverage)
      : []
  return {
    kind,
    coverage,
    settings,
    counts,
    owners,
    edges,
    sinr: tunings ? sinrDb(coverage, tunings, background) : undefined,
    uplink: kind === 'upload' ? uplinkDbm(coverage, plan) : undefined,
    targetDbm: targetBand(plan.coverageTarget).minDbm,
    autoChannels: tunings ? autoChannelCount(tunings) : 0,
    neighbours: background.filter((b) => !b.cells).length,
    locatedNeighbours: background.filter((b) => b.cells).length,
    accessPointNames,
  }
}

/** The SINR band a value falls in, or undefined below the slowest rate. */
export function sinrBand(db: number) {
  return SINR_STEPS.find((band) => db >= band.minDb)
}

/**
 * The share of a floor too noisy for any rate, 0 to 1; undefined without
 * floor. Cells no access point reaches are left out: they have no signal to
 * drown, and the map leaves them clear.
 */
export function unusableShare(coverage: Coverage, sinr: Float32Array) {
  let area = 0
  let unusable = 0
  coverage.floorArea.forEach((inside, i) => {
    if (!inside) return
    area++
    const db = sinr[i]!
    if (db !== Number.NEGATIVE_INFINITY && db < MIN_USABLE_SINR_DB) unusable++
  })
  return area === 0 ? undefined : unusable / area
}

/**
 * A cell's colour: an RGB triple, or `none` where there's nothing to show
 * (no signal, or no access point usable for overlap). Roaming gaps are
 * hatched grey rather than `none`, so they stand out.
 */
export function cellColour(data: MapData, i: number): Rgb | 'none' {
  switch (data.kind) {
    case 'signal':
      return qualityOf(data.coverage.dbm[i]!)?.rgb ?? 'none'
    case 'upload': {
      // Hatched where download reaches the target and upload doesn't.
      const up = data.uplink![i]!
      if (up < data.targetDbm && data.coverage.dbm[i]! >= data.targetDbm) {
        return hatch(data, i)
      }
      return qualityOf(up)?.rgb ?? 'none'
    }
    case 'overlap': {
      const count = data.counts![i]!
      return count === 0 ? 'none' : OVERLAP_RGB[Math.min(count, 3) - 1]!
    }
    case 'roaming': {
      const owner = data.owners![i]!
      if (owner < 0) return hatch(data, i)
      return data.edges![i] ? EDGE_RGB : accessPointRgb(owner)
    }
    case 'interference': {
      const sinr = data.sinr![i]!
      if (sinr === Number.NEGATIVE_INFINITY) return 'none'
      const band = sinrBand(sinr)
      if (band) return band.rgb
      return hatch(data, i)
    }
  }
}

/** Grey with a darker diagonal every fourth cell. */
function hatch(data: MapData, i: number): Rgb {
  const cols = data.coverage.grid.cols
  const diagonal = (i % cols) + Math.floor(i / cols)
  return diagonal % 4 === 0 ? GAP_HATCH_RGB : GAP_RGB
}

export type Swatch =
  | { kind: 'fill'; rgb: Rgb }
  | { kind: 'none' }
  | { kind: 'hatch' }
  | { kind: 'edge' }

export interface LegendRow {
  label: string
  detail: string
  swatch: Swatch
}

export interface Legend {
  title: string
  rows: LegendRow[]
  /** A sentence on how to read it, or undefined for the signal legend. */
  note: string | undefined
}

/**
 * The legend for a map. `accessPointNames` are in the order of the
 * coverage's `accessPointIds`, for the Roaming view's colours.
 */
export function mapLegend(
  kind: MapKind,
  settings: ViewSettings,
  accessPointNames: readonly string[],
  autoChannels = 0,
  neighbours = 0,
  locatedNeighbours = 0,
  target?: CoverageTarget,
  band?: Band,
): Legend {
  const threshold = `${settings.roamThresholdDbm} dBm`
  const qualityRows: LegendRow[] = QUALITY_BANDS.map((q, i) => ({
    label: q.label,
    detail:
      i === 0
        ? `≥ ${q.minDbm} dBm`
        : `${q.minDbm} to ${QUALITY_BANDS[i - 1]!.minDbm} dBm`,
    swatch: { kind: 'fill', rgb: q.rgb } as const,
  }))
  const noSignal: LegendRow = {
    label: 'No signal',
    detail: `< ${QUALITY_BANDS.at(-1)!.minDbm} dBm`,
    swatch: { kind: 'none' },
  }
  switch (kind) {
    case 'signal':
      return {
        title: 'Signal quality',
        rows: [...qualityRows, noSignal],
        note: undefined,
      }
    case 'upload': {
      const goal = targetBand(target)
      const phone =
        band === undefined
          ? 'a phone'
          : `a phone sending ${PHONE_EIRP_DBM[band]} dBm on ${BAND_LABELS[band]}`
      return {
        title: 'Upload signal',
        rows: [
          ...qualityRows,
          {
            label: 'Upload short',
            detail: `Download ${goal.label} or better`,
            swatch: { kind: 'hatch' },
          },
          noSignal,
        ],
        note: `What the access point receives from ${phone}, a typical phone's power, over the same walls and floors. Hatched where download reaches ${goal.label} (${goal.minDbm} dBm) and upload doesn't.`,
      }
    }
    case 'overlap':
      return {
        title: 'Overlap',
        rows: [
          ...['1 access point', '2 access points', '3 or more'].map(
            (label, i) => ({
              label,
              detail: i === 0 ? 'No competition' : 'Competing',
              swatch: { kind: 'fill', rgb: OVERLAP_RGB[i]! } as const,
            }),
          ),
          {
            label: 'None usable',
            detail: `< ${threshold}`,
            swatch: { kind: 'none' },
          },
        ],
        note: `Counts access points within ${settings.overlapMarginDb} dB of the strongest and at least ${threshold}.`,
      }
    case 'roaming':
      return {
        title: 'Roaming',
        rows: [
          ...accessPointNames.map((name, i) => ({
            label: name,
            detail: '',
            swatch: { kind: 'fill', rgb: accessPointRgb(i) } as const,
          })),
          { label: 'Switch', detail: '', swatch: { kind: 'edge' } },
          { label: 'Gap', detail: `< ${threshold}`, swatch: { kind: 'hatch' } },
        ],
        note: `Each area is on its strongest access point. Below ${threshold} a phone looks for another, and a gap has none.`,
      }
    case 'interference':
      return {
        title: 'Signal to interference and noise',
        rows: [
          ...SINR_STEPS.map((band, i) => ({
            label: band.label,
            detail:
              i === 0
                ? `≥ ${Math.round(band.minDb)} dB`
                : `${Math.round(band.minDb)} to ${Math.round(SINR_STEPS[i - 1]!.minDb)} dB`,
            swatch: { kind: 'fill', rgb: band.rgb } as const,
          })),
          {
            label: 'Unusable',
            detail: `< ${Math.round(MIN_USABLE_SINR_DB)} dB`,
            swatch: { kind: 'hatch' },
          },
          { label: 'No signal', detail: '', swatch: { kind: 'none' } },
        ],
        note: [
          `The strongest access point over others on overlapping channels and the noise for its width; wider channels hear more noise. Each band starts at the SINR 802.11 needs for a rate, from ${SINR_BANDS[0]!.detail} down to the slowest.`,
          autoChannels === 0
            ? undefined
            : autoChannels === 1
              ? '1 access point has its channel on Auto, taken as a channel no one else uses: the best case.'
              : `${autoChannels} access points have their channels on Auto, each taken as a channel no one else uses: the best case.`,
          neighbours === 0
            ? undefined
            : neighbours === 1
              ? '1 neighbour’s network counts everywhere at the strength typed in for it.'
              : `${neighbours} neighbours’ networks count everywhere at the strengths typed in for them.`,
          locatedNeighbours === 0
            ? undefined
            : locatedNeighbours === 1
              ? '1 neighbour’s network counts from where scans located it, through walls and floors.'
              : `${locatedNeighbours} neighbours’ networks count from where scans located them, through walls and floors.`,
        ]
          .filter((s) => s !== undefined)
          .join(' '),
      }
  }
}

/**
 * The summary line for a map (D27, D64). Signal gives the share at the plan's
 * target, rounded down. Upload, Overlap, Roaming and Interference give the
 * share where download reaches the target but upload doesn't, with competing
 * access points, in gaps or too noisy for any rate, rounded up, so 0% only
 * ever means none.
 */
export function mapMessage(
  data: MapData,
  target: CoverageTarget | undefined,
  units: Units,
  floorName?: string,
): string {
  const { coverage } = data
  if (data.kind === 'signal') {
    return coverageMessage(coverage, target, units, floorName)
  }
  const goal = targetBand(target)
  const band = BAND_LABELS[coverage.band]
  const { areaM2 } = summariseCoverage(coverage, goal.minDbm)
  const area = formatArea(areaM2, units)
  const percent = (share: number) => `${Math.ceil(share * 100)}%`
  const closeWalls =
    'Close the outer walls to see how much of the floor is covered.'
  let message: string
  if (data.kind === 'upload') {
    const shares = uplinkShares(coverage, data.uplink!, goal.minDbm)
    message =
      shares === undefined
        ? closeWalls
        : `${percent(shares.downloadOnly)} of ${area} has download at ${goal.label} or better but upload below it on ${band}.`
  } else if (data.kind === 'interference') {
    const unusable = unusableShare(coverage, data.sinr!)
    message =
      unusable === undefined
        ? closeWalls
        : `${percent(unusable)} of ${area} is too noisy for any rate (below ${Math.round(MIN_USABLE_SINR_DB)} dB) on ${band}.`
  } else {
    const shares = viewShares(coverage, data.counts!)
    message =
      shares === undefined
        ? closeWalls
        : data.kind === 'overlap'
          ? `${percent(shares.overlap)} of ${area} has two or more access points competing on ${band}.`
          : `${percent(shares.gaps)} of ${area} is a gap below ${data.settings.roamThresholdDbm} dBm on ${band}.`
  }
  return floorName === undefined ? message : `${floorName}: ${message}`
}

/** CSS backgrounds for the hatch and switch legend keys, from the map's own colours. */
export const HATCH_KEY_CSS = `repeating-linear-gradient(-45deg, ${rgbCss(GAP_HATCH_RGB)} 0 2px, ${rgbCss(GAP_RGB)} 2px 6px)`
export const EDGE_KEY_CSS = `linear-gradient(${rgbCss(EDGE_KEY_RGB)} 0 40%, ${rgbCss(EDGE_RGB)} 40% 60%, ${rgbCss(EDGE_KEY_RGB)} 60%)`

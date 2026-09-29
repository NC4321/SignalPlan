import {
  overlapCounts,
  roamingEdges,
  roamingOwners,
  summariseCoverage,
  viewShares,
  type Coverage,
  type ViewSettings,
} from '@signalplan/engine'
import type { CoverageTarget, Plan } from '@signalplan/floorplan'
import { BAND_LABELS, coverageMessage } from './editor/coverageText.ts'
import { formatArea, type Units } from './editor/units.ts'
import { QUALITY_BANDS, qualityOf, targetBand } from './quality.ts'

/**
 * What the heatmap shows (D61, D64): signal strength, how many access points
 * compete for a device, or which one it would be on. Not saved, like the band.
 */
export const MAP_KINDS = ['signal', 'overlap', 'roaming'] as const
export type MapKind = (typeof MAP_KINDS)[number]

export const MAP_LABELS: Record<MapKind, string> = {
  signal: 'Signal',
  overlap: 'Overlap',
  roaming: 'Roaming',
}

type Rgb = readonly [number, number, number]

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
  /** Names in the order of `accessPointIds`, for the Roaming legend. */
  accessPointNames: string[]
}

/**
 * `plan` is the plan the coverage was worked out for, suggestion included,
 * so the Roaming legend names every access point on the map in its colour.
 */
export function mapData(
  coverage: Coverage,
  kind: MapKind,
  settings: ViewSettings,
  plan: Pick<Plan, 'accessPoints'>,
): MapData {
  const accessPointNames = coverage.accessPointIds.map(
    (id) => plan.accessPoints.find((ap) => ap.id === id)?.name ?? id,
  )
  const counts =
    kind === 'signal' ? undefined : overlapCounts(coverage, settings)
  const owners =
    kind === 'roaming' ? roamingOwners(coverage, settings) : undefined
  const edges = owners ? roamingEdges(owners, coverage.grid.cols) : undefined
  return { kind, coverage, settings, counts, owners, edges, accessPointNames }
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
    case 'overlap': {
      const count = data.counts![i]!
      return count === 0 ? 'none' : OVERLAP_RGB[Math.min(count, 3) - 1]!
    }
    case 'roaming': {
      const owner = data.owners![i]!
      if (owner < 0) {
        const cols = data.coverage.grid.cols
        const diagonal = (i % cols) + Math.floor(i / cols)
        return diagonal % 4 === 0 ? GAP_HATCH_RGB : GAP_RGB
      }
      return data.edges![i] ? EDGE_RGB : accessPointRgb(owner)
    }
  }
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
): Legend {
  const threshold = `${settings.roamThresholdDbm} dBm`
  switch (kind) {
    case 'signal':
      return {
        title: 'Signal quality',
        rows: [
          ...QUALITY_BANDS.map((q, i) => ({
            label: q.label,
            detail:
              i === 0
                ? `≥ ${q.minDbm} dBm`
                : `${q.minDbm} to ${QUALITY_BANDS[i - 1]!.minDbm} dBm`,
            swatch: { kind: 'fill', rgb: q.rgb } as const,
          })),
          {
            label: 'No signal',
            detail: `< ${QUALITY_BANDS.at(-1)!.minDbm} dBm`,
            swatch: { kind: 'none' },
          },
        ],
        note: undefined,
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
  }
}

/**
 * The summary line for a map (D27, D64). Signal gives the share at the plan's
 * target, rounded down. Overlap and Roaming give the share with competing
 * access points or in gaps, rounded up, so 0% only ever means none.
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
  const band = BAND_LABELS[coverage.band]
  const { areaM2 } = summariseCoverage(coverage, targetBand(target).minDbm)
  const area = formatArea(areaM2, units)
  const shares = viewShares(coverage, data.counts!)
  const percent = (share: number) => `${Math.ceil(share * 100)}%`
  const message =
    shares === undefined
      ? 'Close the outer walls to see how much of the floor is covered.'
      : data.kind === 'overlap'
        ? `${percent(shares.overlap)} of ${area} has two or more access points competing on ${band}.`
        : `${percent(shares.gaps)} of ${area} is a gap below ${data.settings.roamThresholdDbm} dBm on ${band}.`
  return floorName === undefined ? message : `${floorName}: ${message}`
}

/** CSS backgrounds for the hatch and switch legend keys, from the map's own colours. */
export const HATCH_KEY_CSS = `repeating-linear-gradient(-45deg, ${rgbCss(GAP_HATCH_RGB)} 0 2px, ${rgbCss(GAP_RGB)} 2px 6px)`
export const EDGE_KEY_CSS = `linear-gradient(${rgbCss(EDGE_KEY_RGB)} 0 40%, ${rgbCss(EDGE_RGB)} 40% 60%, ${rgbCss(EDGE_KEY_RGB)} 60%)`

import { evaluateCoverage, type Coverage } from '@signalplan/engine'
import {
  materialSegments,
  openingSpans,
  type Band,
  type Plan,
} from '@signalplan/floorplan'
import {
  cssColour,
  DEFAULT_TARGET,
  QUALITY_BANDS,
  targetBand,
} from '../quality.ts'
import { fitCamera, type Bounds } from './camera.ts'
import { BAND_LABELS, coverageMessage } from './coverageText.ts'
import { PALETTES, type Theme } from './palettes.ts'
import { safeBaseName } from './persistence.ts'
import { draw, heatmapBitmap } from './render.ts'
import type { Units } from './units.ts'

/** Image sizes offered for export, all 16:10 (#44). */
export const EXPORT_SIZES = [
  { id: 'small', label: 'Small', width: 1280, height: 800 },
  { id: 'medium', label: 'Medium', width: 1920, height: 1200 },
  { id: 'large', label: 'Large', width: 3840, height: 2400 },
] as const

export type ExportSize = (typeof EXPORT_SIZES)[number]['id']

/**
 * Everything is laid out on a 1280 × 800 page and scaled up to the chosen
 * size, so text and lines keep their proportions at every size.
 */
const PAGE = { width: 1280, height: 800 }
const MARGIN = 24
const HEADER = 80
const SIDEBAR = 256
const SCALE_BAR = 36

/** Where the plan is drawn on the page. */
export const PLAN_AREA = {
  x: MARGIN,
  y: HEADER + 16,
  width: PAGE.width - SIDEBAR - 3 * MARGIN,
  height: PAGE.height - HEADER - 16 - MARGIN - SCALE_BAR,
}

export interface ExportOptions {
  plan: Plan
  floorId: string
  band: Band
  units: Units
  theme: Theme
  size: ExportSize
}

/** `Sample bungalow - 5 GHz.png` */
export function exportFileName(plan: Plan, band: Band): string {
  return `${safeBaseName(plan.name)} - ${BAND_LABELS[band]}.png`
}

const NICE_METRES = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]
const NICE_FEET = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
const METRES_PER_FOOT = 0.3048

/**
 * The longest round length that fits in `maxPx` at `scale` pixels per metre:
 * 1, 2 or 5 times a power of ten, in metres or feet.
 */
export function scaleBar(
  scale: number,
  maxPx: number,
  units: Units,
): { metres: number; label: string } {
  if (units === 'metric') {
    const metres =
      NICE_METRES.findLast((m) => m * scale <= maxPx) ?? NICE_METRES[0]!
    return {
      metres,
      label: metres < 1 ? `${Math.round(metres * 100)} cm` : `${metres} m`,
    }
  }
  const feet =
    NICE_FEET.findLast((f) => f * METRES_PER_FOOT * scale <= maxPx) ??
    NICE_FEET[0]!
  return { metres: feet * METRES_PER_FOOT, label: `${feet} ft` }
}

/** What to frame: the heatmap's grid if there is one, else walls and APs. */
function planBounds(plan: Plan, floorId: string, coverage: Coverage): Bounds {
  const { grid } = coverage
  if (grid.cols > 0 && grid.rows > 0) {
    return {
      minX: grid.originX,
      minY: grid.originY,
      maxX: grid.originX + grid.cols * grid.cellM,
      maxY: grid.originY + grid.rows * grid.cellM,
    }
  }
  const floor = plan.floors.find((f) => f.id === floorId)
  const points = [
    ...(floor?.nodes ?? []),
    ...plan.accessPoints.filter((ap) => ap.floorId === floorId),
  ]
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 10, maxY: 10 }
  return {
    minX: Math.min(...points.map((p) => p.x)) - 1,
    minY: Math.min(...points.map((p) => p.y)) - 1,
    maxX: Math.max(...points.map((p) => p.x)) + 1,
    maxY: Math.max(...points.map((p) => p.y)) + 1,
  }
}

/** Splits text into lines no wider than `width`. */
function wrap(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && context.measureText(next).width > width) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

const FONT = 'system-ui, sans-serif'

/**
 * Draws the export onto a canvas of the chosen size: a title, the plan with
 * its heatmap and access point names, a scale bar, and a sidebar with the
 * legend and the coverage summary. The tracing image, grid and selection are
 * left out.
 */
export function renderExport(
  context: CanvasRenderingContext2D,
  options: ExportOptions,
) {
  const { plan, floorId, band, units, theme } = options
  const size = EXPORT_SIZES.find((s) => s.id === options.size)!
  const palette = PALETTES[theme]
  const colour = (name: string) => palette[name] ?? palette['--text']!
  const floor = plan.floors.find((f) => f.id === floorId)
  if (!floor) throw new RangeError(`No floor with id "${floorId}".`)

  context.setTransform(
    size.width / PAGE.width,
    0,
    0,
    size.height / PAGE.height,
    0,
    0,
  )
  context.fillStyle = colour('--surface')
  context.fillRect(0, 0, PAGE.width, PAGE.height)

  // Title and subtitle.
  context.textBaseline = 'alphabetic'
  context.textAlign = 'left'
  context.fillStyle = colour('--text')
  context.font = `600 22px ${FONT}`
  context.fillText(plan.name, MARGIN, MARGIN + 22)
  context.fillStyle = colour('--muted')
  context.font = `14px ${FONT}`
  context.fillText(
    `${floor.name} · Predicted ${BAND_LABELS[band]} coverage`,
    MARGIN,
    MARGIN + 46,
  )

  // The plan.
  const coverage = evaluateCoverage(plan, floorId, band)
  const broadcasting = coverage.accessPointIds.length > 0
  const area = PLAN_AREA
  const bounds = planBounds(plan, floorId, coverage)
  const camera = fitCamera(bounds, area.width, area.height, 8)
  context.save()
  context.translate(area.x, area.y)
  context.beginPath()
  context.rect(0, 0, area.width, area.height)
  context.clip()
  draw(context, colour, {
    camera,
    width: area.width,
    height: area.height,
    units,
    grid: false,
    coverage: broadcasting ? coverage : undefined,
    heatmap: broadcasting ? heatmapBitmap(coverage) : undefined,
    segments: materialSegments(floor),
    accessPoints: plan.accessPoints.filter((ap) => ap.floorId === floorId),
    selection: [],
    wallLines: [],
    openings: openingSpans(floor),
    corners: [],
  })
  context.restore()

  // Scale bar, under the plan's bottom-left corner.
  const bar = scaleBar(camera.scale, area.width / 4, units)
  // Lined up with the plan's left edge.
  const barX = area.x + camera.offsetX + bounds.minX * camera.scale
  const barY = area.y + area.height + 22
  const barPx = bar.metres * camera.scale
  context.strokeStyle = colour('--text')
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(barX, barY - 6)
  context.lineTo(barX, barY)
  context.lineTo(barX + barPx, barY)
  context.lineTo(barX + barPx, barY - 6)
  context.stroke()
  context.fillStyle = colour('--text')
  context.font = `13px ${FONT}`
  context.textBaseline = 'middle'
  context.fillText(bar.label, barX + barPx + 8, barY - 3)

  // Sidebar: legend, then the coverage summary.
  const x = PAGE.width - MARGIN - SIDEBAR
  let y = area.y + 8
  context.textBaseline = 'middle'
  context.fillStyle = colour('--text')
  context.font = `600 15px ${FONT}`
  context.fillText('Signal quality', x, y)
  y += 30
  const rows = [
    ...QUALITY_BANDS.map((q, i) => ({
      label: q.label,
      range:
        i === 0
          ? `≥ ${q.minDbm} dBm`
          : `${q.minDbm} to ${QUALITY_BANDS[i - 1]!.minDbm} dBm`,
      fill: cssColour(q) as string | undefined,
    })),
    {
      label: 'No signal',
      range: `< ${QUALITY_BANDS.at(-1)!.minDbm} dBm`,
      fill: undefined,
    },
  ]
  for (const row of rows) {
    if (row.fill) {
      context.fillStyle = row.fill
      context.fillRect(x, y - 8, 16, 16)
    } else {
      context.setLineDash([3, 2])
      context.strokeStyle = colour('--muted')
      context.lineWidth = 1
      context.strokeRect(x + 0.5, y - 7.5, 15, 15)
      context.setLineDash([])
    }
    context.fillStyle = colour('--text')
    context.font = `600 14px ${FONT}`
    context.fillText(row.label, x + 26, y)
    context.fillStyle = colour('--muted')
    context.font = `13px ${FONT}`
    context.fillText(row.range, x + 118, y)
    y += 26
  }

  y += 22
  context.fillStyle = colour('--text')
  context.font = `600 15px ${FONT}`
  context.fillText('Coverage', x, y)
  y += 26
  const target = targetBand(plan.coverageTarget ?? DEFAULT_TARGET)
  context.font = `14px ${FONT}`
  const summary = broadcasting
    ? coverageMessage(coverage, plan.coverageTarget, units)
    : `No access point on this floor broadcasts on ${BAND_LABELS[band]}.`
  for (const line of wrap(context, summary, SIDEBAR)) {
    context.fillText(line, x, y)
    y += 20
  }
  context.fillStyle = colour('--muted')
  context.font = `13px ${FONT}`
  y += 4
  for (const line of wrap(
    context,
    `Target: ${target.label}, ${target.meaning.toLowerCase()} (≥ ${target.minDbm} dBm)`,
    SIDEBAR,
  )) {
    context.fillText(line, x, y)
    y += 18
  }

  context.fillStyle = colour('--muted')
  context.font = `12px ${FONT}`
  context.textBaseline = 'alphabetic'
  const footer = wrap(
    context,
    'Predicted with a simplified model by SignalPlan, signalplan.pages.dev',
    SIDEBAR,
  )
  footer.forEach((line, i) => {
    context.fillText(
      line,
      x,
      PAGE.height - MARGIN - (footer.length - 1 - i) * 16,
    )
  })
}

/** Renders the export and offers it as a PNG download. */
export async function downloadImage(options: ExportOptions) {
  const size = EXPORT_SIZES.find((s) => s.id === options.size)!
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser can’t draw images.')
  renderExport(context, options)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  )
  if (!blob) throw new Error('The image couldn’t be created.')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = exportFileName(options.plan, options.band)
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

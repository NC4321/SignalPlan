import type { Coverage } from '@signalplan/engine'
import type {
  AccessPoint,
  MaterialSegment,
  Point,
  WallMaterial,
} from '@signalplan/floorplan'
import { qualityOf } from '../quality.ts'
import { toPlan, toScreen, type Camera } from './camera.ts'
import type { Selection } from './store.ts'
import type { SnapKind } from './snap.ts'
import { bearingDeg } from './snap.ts'
import { formatLength, type Units } from './units.ts'
import { drawWall, WALL_STYLES } from './wallStyles.ts'

export const AP_RADIUS_PX = 9

/** Grid line spacings in metres, finest first: 10 cm, 1 m, 5 m or 1″, 1′, 5′. */
const GRID_LEVELS: Record<Units, number[]> = {
  metric: [0.1, 1, 5],
  imperial: [0.0254, 0.3048, 1.524],
}

/** Grid lines closer together than this on screen are not drawn. */
const MIN_GRID_PX = 8

export interface Scene {
  camera: Camera
  width: number
  height: number
  units: Units
  coverage: Coverage | undefined
  heatmap: OffscreenCanvas | undefined
  segments: readonly MaterialSegment[]
  accessPoints: readonly AccessPoint[]
  selection: Selection
  /** Wall tool: corners to highlight, and the wall being drawn. */
  corners?: readonly Point[] | undefined
  drawing?:
    | {
        anchor: Point | undefined
        cursor: Point
        snap: SnapKind
        material: WallMaterial
      }
    | undefined
}

/** A bitmap with one pixel per coverage cell, coloured by quality band. */
export function heatmapBitmap(coverage: Coverage): OffscreenCanvas | undefined {
  const { cols, rows } = coverage.grid
  if (cols === 0 || rows === 0) return undefined
  const image = new ImageData(cols, rows)
  coverage.dbm.forEach((dbm, i) => {
    const band = qualityOf(dbm)
    if (band) image.data.set([...band.rgb, 210], i * 4)
  })
  const bitmap = new OffscreenCanvas(cols, rows)
  bitmap.getContext('2d')?.putImageData(image, 0, 0)
  return bitmap
}

export function draw(
  context: CanvasRenderingContext2D,
  colour: (name: string) => string,
  scene: Scene,
) {
  const { camera, width, height } = scene
  context.fillStyle = colour('--canvas')
  context.fillRect(0, 0, width, height)

  drawGrid(context, colour, scene)

  if (scene.heatmap && scene.coverage) {
    const { grid } = scene.coverage
    const origin = toScreen(camera, { x: grid.originX, y: grid.originY })
    context.imageSmoothingEnabled = false
    context.drawImage(
      scene.heatmap,
      origin.x,
      origin.y,
      grid.cols * grid.cellM * camera.scale,
      grid.rows * grid.cellM * camera.scale,
    )
  }

  const wallWidth = baseWallWidth(camera)
  const casing = colour('--wall-casing')
  // Solid walls first, then doors and windows on top, thinner.
  for (const opening of [false, true]) {
    for (const segment of scene.segments) {
      if ((segment.openingId !== undefined) !== opening) continue
      drawWall(
        context,
        toScreen(camera, segment.a),
        toScreen(camera, segment.b),
        WALL_STYLES[segment.material],
        opening ? wallWidth * 0.6 : wallWidth,
        casing,
      )
    }
  }

  if (scene.corners) {
    context.fillStyle = colour('--canvas')
    context.strokeStyle = colour('--wall-casing')
    context.lineWidth = 1.5
    for (const corner of scene.corners) {
      const at = toScreen(camera, corner)
      context.beginPath()
      context.arc(at.x, at.y, 3, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }
  }

  if (scene.drawing) drawPreview(context, colour, scene, wallWidth)

  context.font = '600 12px system-ui, sans-serif'
  context.textBaseline = 'middle'
  for (const ap of scene.accessPoints) {
    const at = toScreen(camera, ap)
    const selected =
      scene.selection?.kind === 'accessPoint' && scene.selection.id === ap.id
    if (selected) {
      context.beginPath()
      context.arc(at.x, at.y, AP_RADIUS_PX + 5, 0, Math.PI * 2)
      context.fillStyle = colour('--selection-halo')
      context.fill()
    }
    context.beginPath()
    context.arc(at.x, at.y, AP_RADIUS_PX, 0, Math.PI * 2)
    context.fillStyle = colour('--ap')
    context.fill()
    context.lineWidth = selected ? 3 : 2
    context.strokeStyle = colour(selected ? '--accent' : '--ap-ring')
    context.stroke()

    const x = at.x + AP_RADIUS_PX + 6
    context.lineWidth = 4
    context.lineJoin = 'round'
    context.strokeStyle = colour('--canvas')
    context.strokeText(ap.name, x, at.y)
    context.fillStyle = colour('--text')
    context.fillText(ap.name, x, at.y)
  }
}

/** Wall width on screen: 12 cm at the current zoom, kept between 2 and 10 px. */
export function baseWallWidth(camera: Camera): number {
  return Math.min(Math.max(0.12 * camera.scale, 2), 10)
}

/** The wall being drawn, its length and angle, and what it snapped to. */
function drawPreview(
  context: CanvasRenderingContext2D,
  colour: (name: string) => string,
  scene: Scene,
  wallWidth: number,
) {
  const { camera, drawing, units } = scene
  if (!drawing) return
  const cursor = toScreen(camera, drawing.cursor)

  if (drawing.anchor) {
    const anchor = toScreen(camera, drawing.anchor)
    context.globalAlpha = 0.75
    drawWall(
      context,
      anchor,
      cursor,
      WALL_STYLES[drawing.material],
      wallWidth,
      colour('--wall-casing'),
    )
    context.globalAlpha = 1

    const length = Math.hypot(
      drawing.cursor.x - drawing.anchor.x,
      drawing.cursor.y - drawing.anchor.y,
    )
    if (length > 0) {
      const angle = bearingDeg(drawing.anchor, drawing.cursor)
      const label = `${formatLength(length, units)} · ${Math.round(angle)}°`
      const mid = { x: (anchor.x + cursor.x) / 2, y: (anchor.y + cursor.y) / 2 }
      context.font = '600 12px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'bottom'
      context.lineJoin = 'round'
      context.lineWidth = 4
      context.strokeStyle = colour('--canvas')
      context.strokeText(label, mid.x, mid.y - wallWidth)
      context.fillStyle = colour('--text')
      context.fillText(label, mid.x, mid.y - wallWidth)
      context.textAlign = 'start'
    }
  }

  // Snap marker: circle on a corner, diamond on a wall, cross otherwise.
  context.strokeStyle = colour('--accent')
  context.lineWidth = 2
  context.beginPath()
  if (drawing.snap === 'node') {
    context.arc(cursor.x, cursor.y, 7, 0, Math.PI * 2)
  } else if (drawing.snap === 'wall') {
    context.moveTo(cursor.x, cursor.y - 7)
    context.lineTo(cursor.x + 7, cursor.y)
    context.lineTo(cursor.x, cursor.y + 7)
    context.lineTo(cursor.x - 7, cursor.y)
    context.closePath()
  } else {
    context.moveTo(cursor.x - 6, cursor.y)
    context.lineTo(cursor.x + 6, cursor.y)
    context.moveTo(cursor.x, cursor.y - 6)
    context.lineTo(cursor.x, cursor.y + 6)
  }
  context.stroke()
}

function drawGrid(
  context: CanvasRenderingContext2D,
  colour: (name: string) => string,
  { camera, width, height, units }: Scene,
) {
  const levels = GRID_LEVELS[units].filter(
    (spacing) => spacing * camera.scale >= MIN_GRID_PX,
  )
  const topLeft = toPlan(camera, { x: 0, y: 0 })
  const bottomRight = toPlan(camera, { x: width, y: height })

  levels.slice(0, 2).forEach((spacing, i) => {
    context.strokeStyle = colour(i === 0 ? '--grid-minor' : '--grid-major')
    context.lineWidth = 1
    context.beginPath()
    const firstX = Math.ceil(topLeft.x / spacing)
    const lastX = Math.floor(bottomRight.x / spacing)
    for (let k = firstX; k <= lastX; k++) {
      const x = Math.round(toScreen(camera, { x: k * spacing, y: 0 }).x) + 0.5
      context.moveTo(x, 0)
      context.lineTo(x, height)
    }
    const firstY = Math.ceil(topLeft.y / spacing)
    const lastY = Math.floor(bottomRight.y / spacing)
    for (let k = firstY; k <= lastY; k++) {
      const y = Math.round(toScreen(camera, { x: 0, y: k * spacing }).y) + 0.5
      context.moveTo(0, y)
      context.lineTo(width, y)
    }
    context.stroke()
  })
}

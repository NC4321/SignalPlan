import { gridForFloor, type Coverage } from '@signalplan/engine'
import {
  materialSegments,
  type AccessPoint,
  type Floor,
  type Point,
} from '@signalplan/floorplan'
import { useEffect, useMemo, useRef, useState } from 'react'
import { qualityOf } from './quality.ts'
import { fitView, toPlan, toScreen, type View } from './view.ts'

interface Props {
  floor: Floor
  accessPoints: readonly AccessPoint[]
  coverage: Coverage | undefined
  onMoveAccessPoint: (id: string, to: Point) => void
  onHover: (dbm: number | undefined) => void
}

const AP_RADIUS_PX = 9
const GRAB_RADIUS_PX = 20
/** Arrow keys move the selected access point this far; with Shift, 5×. */
const NUDGE_M = 0.1

/** The floor, its heatmap and its access points, with drag-to-move. */
export function PlanCanvas({
  floor,
  accessPoints,
  coverage,
  onMoveAccessPoint,
  onHover,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState<string>()
  const [selected, setSelected] = useState(accessPoints[0]?.id)

  const bounds = useMemo(() => {
    const grid = gridForFloor(floor, 0.1)
    return {
      minX: grid.originX,
      minY: grid.originY,
      maxX: grid.originX + grid.cols * grid.cellM,
      maxY: grid.originY + grid.rows * grid.cellM,
    }
  }, [floor])
  const segments = useMemo(() => materialSegments(floor), [floor])
  const view = useMemo(
    () => fitView(bounds, size.width, size.height),
    [bounds, size],
  )

  // Size the canvas to its box; height follows the plan's aspect ratio.
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      const aspect = (bounds.maxY - bounds.minY) / (bounds.maxX - bounds.minX)
      setSize({
        width,
        height: Math.min(width * aspect, window.innerHeight * 0.7),
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [bounds])

  // Heatmap: one pixel per cell, scaled up without smoothing.
  const heatmap = useMemo(() => {
    if (!coverage || coverage.grid.cols === 0) return undefined
    const { cols, rows } = coverage.grid
    const image = new ImageData(cols, rows)
    coverage.dbm.forEach((dbm, i) => {
      const band = qualityOf(dbm)
      if (!band) return
      image.data.set([...band.rgb, 220], i * 4)
    })
    const bitmap = new OffscreenCanvas(cols, rows)
    bitmap.getContext('2d')?.putImageData(image, 0, 0)
    return bitmap
  }, [coverage])

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context || size.width === 0) return
    const ratio = window.devicePixelRatio || 1
    element.width = Math.round(size.width * ratio)
    element.height = Math.round(size.height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    draw(context, element, view, {
      heatmap,
      coverage,
      segments,
      accessPoints,
      selected,
    })
  }, [size, view, heatmap, coverage, segments, accessPoints, selected])

  const pointer = (event: React.PointerEvent): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const clampToPlan = (p: Point): Point => ({
    x: Math.min(Math.max(p.x, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(p.y, bounds.minY), bounds.maxY),
  })

  const signalAt = (p: Point): number | undefined => {
    if (!coverage) return undefined
    const { grid } = coverage
    const col = Math.floor((p.x - grid.originX) / grid.cellM)
    const row = Math.floor((p.y - grid.originY) / grid.cellM)
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) {
      return undefined
    }
    const value = coverage.dbm[row * grid.cols + col]
    return value === undefined || value === -Infinity ? undefined : value
  }

  return (
    <canvas
      ref={canvas}
      className="plan-canvas"
      style={{ height: size.height || undefined }}
      tabIndex={0}
      role="img"
      aria-label="Floor plan with predicted Wi-Fi coverage. Drag an access point, or use the arrow keys to move the selected one."
      onPointerDown={(event) => {
        const at = pointer(event)
        const hit = accessPoints.find((ap) => {
          const s = toScreen(view, ap)
          return Math.hypot(s.x - at.x, s.y - at.y) <= GRAB_RADIUS_PX
        })
        if (!hit) return
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(hit.id)
        setSelected(hit.id)
      }}
      onPointerMove={(event) => {
        const at = toPlan(view, pointer(event))
        if (dragging) onMoveAccessPoint(dragging, clampToPlan(at))
        onHover(signalAt(at))
      }}
      onPointerUp={() => setDragging(undefined)}
      onPointerCancel={() => setDragging(undefined)}
      onPointerLeave={() => onHover(undefined)}
      onKeyDown={(event) => {
        const ap = accessPoints.find((a) => a.id === selected)
        const step = event.shiftKey ? NUDGE_M * 5 : NUDGE_M
        const move: Record<string, Point> = {
          ArrowLeft: { x: -step, y: 0 },
          ArrowRight: { x: step, y: 0 },
          ArrowUp: { x: 0, y: -step },
          ArrowDown: { x: 0, y: step },
        }
        const delta = move[event.key]
        if (!ap || !delta) return
        event.preventDefault()
        const to = clampToPlan({ x: ap.x + delta.x, y: ap.y + delta.y })
        onMoveAccessPoint(ap.id, to)
        onHover(signalAt(to))
      }}
      data-dragging={dragging !== undefined || undefined}
    />
  )
}

function draw(
  context: CanvasRenderingContext2D,
  element: HTMLCanvasElement,
  view: View,
  scene: {
    heatmap: OffscreenCanvas | undefined
    coverage: Coverage | undefined
    segments: ReturnType<typeof materialSegments>
    accessPoints: readonly AccessPoint[]
    selected: string | undefined
  },
) {
  const style = getComputedStyle(element)
  const colour = (name: string) => style.getPropertyValue(name).trim()
  const { width, height } = element.getBoundingClientRect()

  context.clearRect(0, 0, width, height)
  context.fillStyle = colour('--canvas')
  context.fillRect(0, 0, width, height)

  if (scene.heatmap && scene.coverage) {
    const { grid } = scene.coverage
    const origin = toScreen(view, { x: grid.originX, y: grid.originY })
    context.imageSmoothingEnabled = false
    context.drawImage(
      scene.heatmap,
      origin.x,
      origin.y,
      grid.cols * grid.cellM * view.scale,
      grid.rows * grid.cellM * view.scale,
    )
  }

  context.lineCap = 'round'
  for (const segment of scene.segments) {
    const a = toScreen(view, segment.a)
    const b = toScreen(view, segment.b)
    const isOpening = segment.openingId !== undefined
    context.strokeStyle = colour(isOpening ? '--opening' : '--wall')
    context.lineWidth = isOpening ? 3 : 5
    context.beginPath()
    context.moveTo(a.x, a.y)
    context.lineTo(b.x, b.y)
    context.stroke()
  }

  context.font = '600 12px system-ui, sans-serif'
  context.textBaseline = 'middle'
  for (const ap of scene.accessPoints) {
    const at = toScreen(view, ap)
    context.beginPath()
    context.arc(at.x, at.y, AP_RADIUS_PX, 0, Math.PI * 2)
    context.fillStyle = colour('--ap')
    context.fill()
    context.lineWidth = ap.id === scene.selected ? 3 : 2
    context.strokeStyle = colour('--ap-ring')
    context.stroke()
    const label = ap.name
    const x = at.x + AP_RADIUS_PX + 6
    context.lineWidth = 4
    context.strokeStyle = colour('--canvas')
    context.strokeText(label, x, at.y)
    context.fillStyle = colour('--text')
    context.fillText(label, x, at.y)
  }
}

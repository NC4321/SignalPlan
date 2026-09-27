import { gridForFloor, type Coverage } from '@signalplan/engine'
import { materialSegments, type Point } from '@signalplan/floorplan'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCamera, panBy, toPlan, toScreen, zoomAt } from './camera.ts'
import { useEditor, useEditorStore } from './context.ts'
import { AP_RADIUS_PX, draw, heatmapBitmap } from './render.ts'
import { isTyping } from './util.ts'

/** Pointer distance within which an access point can be grabbed. */
const GRAB_RADIUS_PX = AP_RADIUS_PX + 8
/** Arrow keys move the selected access point this far; with Shift, 5×. */
const NUDGE_M = 0.1

type Drag =
  | { kind: 'pan'; last: Point }
  | { kind: 'accessPoint'; id: string; grabOffset: Point }

/** The plan, its heatmap and access points, with pan, zoom and drag. */
export function EditorCanvas({ coverage }: { coverage: Coverage | undefined }) {
  const store = useEditorStore()
  const plan = useEditor((s) => s.plan)
  const floorId = useEditor((s) => s.floorId)
  const camera = useEditor((s) => s.camera)
  const units = useEditor((s) => s.units)
  const selection = useEditor((s) => s.selection)
  const showHeatmap = useEditor((s) => s.showHeatmap)

  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [spaceDown, setSpaceDown] = useState(false)
  const drag = useRef<Drag>(undefined)
  const touches = useRef(new Map<number, Point>())
  const [cursor, setCursor] = useState<'default' | 'grab' | 'grabbing'>(
    'default',
  )

  const floor = plan.floors.find((f) => f.id === floorId)!
  const accessPoints = useMemo(
    () => plan.accessPoints.filter((ap) => ap.floorId === floorId),
    [plan.accessPoints, floorId],
  )
  const segments = useMemo(() => materialSegments(floor), [floor])
  const heatmap = useMemo(
    () => (coverage ? heatmapBitmap(coverage) : undefined),
    [coverage],
  )

  // Track the canvas's size.
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Fit the plan into view the first time there's room for it.
  useEffect(() => {
    if (camera || size.width === 0 || size.height === 0) return
    const grid = gridForFloor(floor, 1)
    store.getState().setCamera(
      fitCamera(
        {
          minX: grid.originX,
          minY: grid.originY,
          maxX: grid.originX + grid.cols,
          maxY: grid.originY + grid.rows,
        },
        size.width,
        size.height,
      ),
    )
  }, [camera, size, floor, store])

  // Space + drag pans, as in design tools.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTyping(event)) {
        event.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // Wheel pans; Ctrl/⌘ + wheel (and trackpad pinch) zooms at the cursor.
  // Registered by hand because React's wheel listener is passive.
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const current = store.getState().camera
      if (!current) return
      const lineScale = event.deltaMode === 1 ? 16 : 1
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect()
        const at = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const factor = Math.exp(-event.deltaY * lineScale * 0.01)
        store.getState().setCamera(zoomAt(current, at, factor))
      } else {
        store
          .getState()
          .setCamera(
            panBy(
              current,
              -event.deltaX * lineScale,
              -event.deltaY * lineScale,
            ),
          )
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [store])

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context || !camera || size.width === 0) return
    const ratio = window.devicePixelRatio || 1
    element.width = Math.round(size.width * ratio)
    element.height = Math.round(size.height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const style = getComputedStyle(element)
    draw(context, (name) => style.getPropertyValue(name).trim(), {
      camera,
      width: size.width,
      height: size.height,
      units,
      coverage: showHeatmap ? coverage : undefined,
      heatmap: showHeatmap ? heatmap : undefined,
      segments,
      accessPoints,
      selection,
    })
  }, [
    camera,
    size,
    units,
    coverage,
    heatmap,
    showHeatmap,
    segments,
    accessPoints,
    selection,
  ])

  const local = (event: React.PointerEvent): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const accessPointAt = (screen: Point) => {
    if (!camera) return undefined
    return accessPoints.find((ap) => {
      const s = toScreen(camera, ap)
      return Math.hypot(s.x - screen.x, s.y - screen.y) <= GRAB_RADIUS_PX
    })
  }

  const moveAccessPoint = (id: string, to: Point) => {
    store.getState().updateGesture((draft) => {
      const ap = draft.accessPoints.find((a) => a.id === id)
      if (ap) {
        ap.x = to.x
        ap.y = to.y
      }
    })
  }

  return (
    <canvas
      ref={canvas}
      className="editor-canvas"
      style={{ cursor: spaceDown && cursor === 'default' ? 'grab' : cursor }}
      tabIndex={0}
      data-scale={camera?.scale}
      data-offset-x={camera?.offsetX}
      data-offset-y={camera?.offsetY}
      role="application"
      aria-roledescription="floor plan editor"
      aria-label="Floor plan with predicted Wi-Fi coverage. Arrow keys move the selected access point."
      onPointerDown={(event) => {
        const at = local(event)
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus()

        if (event.pointerType === 'touch') {
          touches.current.set(event.pointerId, at)
          if (touches.current.size > 1) {
            // A second finger turns any drag into pinch-and-pan.
            if (drag.current?.kind === 'accessPoint') {
              store.getState().cancelGesture()
            }
            drag.current = undefined
            return
          }
        }

        if (event.button === 1 || (event.button === 0 && spaceDown)) {
          drag.current = { kind: 'pan', last: at }
          setCursor('grabbing')
          return
        }
        if (event.button !== 0) return

        const hit = accessPointAt(at)
        if (hit && camera) {
          const s = toScreen(camera, hit)
          drag.current = {
            kind: 'accessPoint',
            id: hit.id,
            grabOffset: { x: s.x - at.x, y: s.y - at.y },
          }
          store.getState().select({ kind: 'accessPoint', id: hit.id })
          store.getState().beginGesture()
          setCursor('grabbing')
          return
        }

        store.getState().select(undefined)
        // On touch, dragging empty space pans.
        if (event.pointerType === 'touch') {
          drag.current = { kind: 'pan', last: at }
        }
      }}
      onPointerMove={(event) => {
        const at = local(event)
        const current = store.getState().camera
        if (!current) return

        if (event.pointerType === 'touch' && touches.current.size > 1) {
          const previous = [...touches.current.values()]
          touches.current.set(event.pointerId, at)
          const next = [...touches.current.values()]
          if (previous.length >= 2 && next.length >= 2) {
            store.getState().setCamera(pinch(current, previous, next))
          }
          return
        }
        if (event.pointerType === 'touch') {
          touches.current.set(event.pointerId, at)
        }

        store.getState().setPointer(toPlan(current, at))
        const active = drag.current
        if (active?.kind === 'pan') {
          store
            .getState()
            .setCamera(
              panBy(current, at.x - active.last.x, at.y - active.last.y),
            )
          active.last = at
        } else if (active?.kind === 'accessPoint') {
          moveAccessPoint(
            active.id,
            toPlan(current, {
              x: at.x + active.grabOffset.x,
              y: at.y + active.grabOffset.y,
            }),
          )
        } else {
          setCursor(accessPointAt(at) ? 'grab' : 'default')
        }
      }}
      onPointerUp={(event) => {
        touches.current.delete(event.pointerId)
        const active = drag.current
        if (active?.kind === 'accessPoint') {
          const name = accessPoints.find((ap) => ap.id === active.id)?.name
          store.getState().endGesture(`Move ${name ?? 'access point'}`)
        }
        drag.current = undefined
        setCursor(accessPointAt(local(event)) ? 'grab' : 'default')
      }}
      onPointerCancel={(event) => {
        touches.current.delete(event.pointerId)
        if (drag.current?.kind === 'accessPoint') {
          store.getState().cancelGesture()
        }
        drag.current = undefined
        setCursor('default')
      }}
      onPointerLeave={() => store.getState().setPointer(undefined)}
      onKeyDown={(event) => {
        const state = store.getState()
        const { selection: selected } = state
        if (selected?.kind !== 'accessPoint') return
        const step = event.shiftKey ? NUDGE_M * 5 : NUDGE_M
        const deltas: Record<string, Point> = {
          ArrowLeft: { x: -step, y: 0 },
          ArrowRight: { x: step, y: 0 },
          ArrowUp: { x: 0, y: -step },
          ArrowDown: { x: 0, y: step },
        }
        const delta = deltas[event.key]
        if (!delta) return
        event.preventDefault()
        const ap = state.plan.accessPoints.find((a) => a.id === selected.id)
        if (!ap) return
        state.edit(`Move ${ap.name}`, (draft) => {
          const target = draft.accessPoints.find((a) => a.id === selected.id)
          if (target) {
            target.x += delta.x
            target.y += delta.y
          }
        })
        state.setPointer({ x: ap.x + delta.x, y: ap.y + delta.y })
      }}
    />
  )
}

/** Camera after a two-finger gesture: pan by the midpoint, zoom by the spread. */
function pinch(
  camera: Parameters<typeof zoomAt>[0],
  before: Point[],
  after: Point[],
) {
  const mid = (points: Point[]) => ({
    x: (points[0]!.x + points[1]!.x) / 2,
    y: (points[0]!.y + points[1]!.y) / 2,
  })
  const spread = (points: Point[]) =>
    Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y)
  const from = mid(before)
  const to = mid(after)
  const factor = spread(before) > 0 ? spread(after) / spread(before) : 1
  return zoomAt(panBy(camera, to.x - from.x, to.y - from.y), to, factor)
}

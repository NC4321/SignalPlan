import type { MapData } from '../mapView.ts'
import { toolKeysHint } from './shortcuts.ts'
import { gridForFloor, type Coverage } from '@signalplan/engine'
import {
  addAccessPoint,
  addOpening,
  fitOpeningAt,
  materialSegments,
  openingSpans,
  surveySpotName,
  type Floor,
  type Point,
} from '@signalplan/floorplan'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  describeForScreenReader,
  keyboardOrder,
  nextKeyboardItem,
} from './a11y.ts'
import {
  fitCamera,
  panBy,
  toPlan,
  toScreen,
  zoomAt,
  type Camera,
} from './camera.ts'
import { useEditor, useEditorStore } from './context.ts'
import { forgetImagesOutside, useBackgroundImage } from './images.ts'
import { LengthInput } from './LengthInput.tsx'
import { BAND_LABELS } from './coverageText.ts'
import { BLANK_BOUNDS } from './persistence.ts'
import { draw, heatmapBitmap } from './render.ts'
import {
  accessPointAt,
  describeSelection,
  floorOpeningCornerAt,
  hitTest,
  LOCKED_NOTICE,
  moveFloorOpeningCornerRecipe,
  moveFloorOpeningRecipe,
  moveNodeRecipe,
  pressGrabsAccessPoint,
  moveOpeningRecipe,
  moveSurveySpotRecipe,
  moveWallRecipe,
  nudgeRecipe,
  onlySurveySpots,
  selectionHasLocked,
  snapDraggedNode,
  splitRecipe,
  surveySpotAt,
  wallAt,
  wallDragDelta,
} from './selectTool.ts'
import { SNAP_RADIUS_PX, snapPoint, type SnapKind } from './snap.ts'
import {
  canCutFloor,
  DEFAULT_OPENING_WIDTH_M,
  ghostFloor,
  heatmapFaded,
  heatmapShown,
  sameItem,
  type SelectionItem,
} from './store.ts'
import { useServices } from './services.ts'
import { pinError, spotCardLines, useSurveyErrors } from './surveyErrors.ts'
import { onImage } from './tracing.ts'
import { snapStep } from './units.ts'
import { inOpenDialog, isTyping } from './util.ts'

/** Arrow keys move the selection this far; with Shift, 5×. */
const NUDGE_M = 0.1
/** A press that moves less than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 3

type Drag =
  | { kind: 'pan'; last: Point }
  | { kind: 'background'; startPlan: Point; origin: Point; moved: boolean }
  | {
      kind: 'item'
      item: SelectionItem
      /** Where the press started, on screen and on the plan. */
      startScreen: Point
      startPlan: Point
      /** The dragged thing's position when the press started. */
      origin: Point
      /** A floor opening dragged by one of its corners: which one (D54). */
      corner?: number
      moved: boolean
    }
  /** A press on a locked access point: it selects, but won't move (D43). */
  | { kind: 'locked'; startScreen: Point }

type Cursor =
  'default' | 'pointer' | 'grab' | 'grabbing' | 'move' | 'not-allowed'

/** The point `d` metres along a wall from its start corner. */
function pointAlong(floor: Floor, wallId: string, d: number): Point {
  const wall = floor.walls.find((w) => w.id === wallId)!
  const a = floor.nodes.find((n) => n.id === wall.from)!
  const b = floor.nodes.find((n) => n.id === wall.to)!
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  return {
    x: a.x + ((b.x - a.x) * d) / length,
    y: a.y + ((b.y - a.y) * d) / length,
  }
}

/** The plan, its heatmap and access points, with pan, zoom and editing. */
export function EditorCanvas({
  coverage,
  map,
}: {
  coverage: Coverage | undefined
  /** The coverage coloured for the map on show (D64). */
  map: MapData | undefined
}) {
  const store = useEditorStore()
  const plan = useEditor((s) => s.plan)
  const floorId = useEditor((s) => s.floorId)
  const camera = useEditor((s) => s.camera)
  const units = useEditor((s) => s.units)
  const selection = useEditor((s) => s.selection)
  const showHeatmap = useEditor(heatmapShown)
  const fadeHeatmap = useEditor(heatmapFaded)
  const tool = useEditor((s) => s.tool)
  const placingScan = useEditor((s) => s.placeScan !== undefined)
  const chain = useEditor((s) => s.chain)
  const outline = useEditor((s) => s.outline)
  const wallMaterial = useEditor((s) => s.wallMaterial)
  const openingMaterial = useEditor((s) => s.openingMaterial)
  const openingTool = tool === 'door' || tool === 'window' ? tool : undefined
  /** Door and window tools: where a click would place one. */
  const [placement, setPlacement] = useState<{
    wallId: string
    centre: number
    a: Point
    b: Point
  }>()
  const calibrationPoints = useEditor((s) => s.calibrationPoints)
  const optimizer = useEditor((s) => s.optimizer)
  // A suggestion covers the whole home (D55): this floor shows its own spots.
  const suggestion =
    optimizer?.status === 'suggestion' ? optimizer.suggestion : undefined
  const suggestedHere = useMemo(
    () => suggestion?.moves.filter((move) => move.to.floorId === floorId),
    [suggestion, floorId],
  )
  const positionCheck = useEditor((s) => s.positionCheck)
  // Located neighbours on this floor, and where a position check puts an
  // access point, each with its uncertainty (D84, D85).
  const located = useMemo(() => {
    const neighbours = (plan.neighbourNetworks ?? []).flatMap((n, i) =>
      n.location?.floorId === floorId
        ? [
            {
              x: n.location.x,
              y: n.location.y,
              radiusM: n.location.uncertaintyM,
              label: n.name ?? `Network ${i + 1}`,
            },
          ]
        : [],
    )
    const check =
      positionCheck?.location.floorId === floorId
        ? [
            {
              x: positionCheck.location.x,
              y: positionCheck.location.y,
              radiusM: positionCheck.location.uncertaintyM,
              label: undefined,
            },
          ]
        : []
    return [...neighbours, ...check]
  }, [plan.neighbourNetworks, positionCheck, floorId])
  const checkedHere = useMemo(() => {
    if (positionCheck?.location.floorId !== floorId) return undefined
    const ap = plan.accessPoints.find((a) => a.id === positionCheck.apId)
    if (!ap) return undefined
    return {
      apId: ap.id,
      from: ap.floorId === floorId ? { x: ap.x, y: ap.y } : undefined,
      to: { x: positionCheck.location.x, y: positionCheck.location.y },
      label: `${ap.name}, by its readings`,
    }
  }, [positionCheck, plan.accessPoints, floorId])
  const { library } = useServices()
  const anchor =
    tool === 'floorOpening' ? outline?.at(-1) : chain?.at(-1)?.point
  /** Wall and floor opening tools: where the next click would land. */
  const [preview, setPreview] = useState<{ cursor: Point; snap: SnapKind }>()

  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [spaceDown, setSpaceDown] = useState(false)
  const drag = useRef<Drag>(undefined)
  const touches = useRef(new Map<number, Point>())
  const [cursor, setCursor] = useState<Cursor>('default')
  // The pointer is written to the store on every move. Only the tools that
  // draw at it subscribe, so hovering with the others doesn't redraw.
  const cursorDefault = cursor === 'default'
  const drawsPointer =
    tool === 'calibrate' ||
    ((tool === 'accessPoint' || tool === 'survey' || placingScan) &&
      cursorDefault)
  const pointer = useEditor((s) => (drawsPointer ? s.pointer : undefined))

  const floor = plan.floors.find((f) => f.id === floorId)!
  const band = useEditor((s) => s.band)
  // Each pin shows its mean error on the band on show (D73).
  const errors = useSurveyErrors()
  // Rooms Calibrate still needs a spot in, on the band on show (D76).
  const modelCalibration = useEditor((s) => s.modelCalibration)
  const emptyRooms = useMemo(() => {
    if (modelCalibration?.status !== 'result') return undefined
    const result = modelCalibration.results.find((r) => r.band === band)
    if (!result || result.fit) return undefined
    const here = result.readiness.floors.find((f) => f.floorId === floorId)
    return here && here.roomsWithSpots < here.roomsNeeded
      ? here.emptyRooms
      : undefined
  }, [modelCalibration, band, floorId])
  const surveySpots = useMemo(
    () =>
      (floor.surveySpots ?? []).map((spot) => ({
        id: spot.id,
        x: spot.x,
        y: spot.y,
        ...pinError(errors.spots, spot.id, band),
      })),
    [floor.surveySpots, errors, band],
  )
  // The pin under a mouse or pen, for its card of readings (D73). It's found
  // from the pointer each time, so zooming or moving the pin updates it.
  const [hovering, setHovering] = useState(false)
  // Subscribes to the pin under the pointer, not the pointer itself.
  const spot = useEditor((s) => {
    if (!hovering || !s.camera || !s.pointer) return undefined
    const spots = s.plan.floors.find((f) => f.id === s.floorId)?.surveySpots
    return surveySpotAt(s.camera, spots ?? [], toScreen(s.camera, s.pointer))
  })
  const surveyCard = useMemo(() => {
    if (!spot) return undefined
    return {
      at: spot,
      label: pinError(errors.spots, spot.id, band).label,
      title: `${surveySpotName(spot.id)}, ${BAND_LABELS[band]}`,
      lines: spotCardLines(spot, band, errors.readings, plan.accessPoints),
    }
  }, [spot, band, errors, plan.accessPoints])
  const ghost = useEditor(ghostFloor)
  const ghostScene = useMemo(
    () =>
      ghost && {
        segments: materialSegments(ghost),
        accessPoints: plan.accessPoints.filter((ap) => ap.floorId === ghost.id),
      },
    [ghost, plan.accessPoints],
  )
  const background = floor.background
  const backgroundImage = useBackgroundImage(background, library)
  // Free decoded tracing images the open plan no longer uses: another plan
  // was opened, or a floor's image was replaced or removed.
  useEffect(() => forgetImagesOutside(plan), [plan])
  const accessPoints = useMemo(
    () => plan.accessPoints.filter((ap) => ap.floorId === floorId),
    [plan.accessPoints, floorId],
  )
  const segments = useMemo(() => materialSegments(floor), [floor])
  const order = useMemo(
    () => keyboardOrder(floor, accessPoints),
    [floor, accessPoints],
  )
  const hintId = useId()
  const openings = useMemo(() => openingSpans(floor), [floor])
  const wallLines = useMemo(() => {
    const nodes = new Map(floor.nodes.map((n) => [n.id, n]))
    return floor.walls.flatMap((w) => {
      const a = nodes.get(w.from)
      const b = nodes.get(w.to)
      return a && b ? [{ id: w.id, a, b }] : []
    })
  }, [floor])
  const heatmap = useMemo(() => (map ? heatmapBitmap(map) : undefined), [map])

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
    // A floor with no walls yet opens on a room-sized view around the router.
    const bounds =
      floor.nodes.length === 0
        ? BLANK_BOUNDS
        : {
            minX: grid.originX,
            minY: grid.originY,
            maxX: grid.originX + grid.cols * grid.cellM,
            maxY: grid.originY + grid.rows * grid.cellM,
          }
    store.getState().setCamera(fitCamera(bounds, size.width, size.height))
  }, [camera, size, floor, store])

  // Space + drag pans, as in design tools. Only from the canvas (or with
  // nothing focused), so Space still presses buttons and ticks checkboxes.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const onCanvas =
        event.target === canvas.current || event.target === document.body
      if (event.code !== 'Space' || !onCanvas || isTyping(event)) return
      if (event.defaultPrevented || inOpenDialog(event)) return
      event.preventDefault()
      setSpaceDown(true)
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
    // Setting the size clears and reallocates the backing store, so only
    // when it changes; otherwise clear it and start from default state.
    const width = Math.round(size.width * ratio)
    const height = Math.round(size.height * ratio)
    if (element.width !== width) element.width = width
    if (element.height !== height) element.height = height
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, size.width, size.height)
    context.save()
    const style = getComputedStyle(element)
    draw(context, (name) => style.getPropertyValue(name).trim(), {
      camera,
      width: size.width,
      height: size.height,
      units,
      coverage: showHeatmap ? coverage : undefined,
      heatmap: showHeatmap ? heatmap : undefined,
      heatmapFaded: fadeHeatmap,
      segments,
      accessPoints,
      ghost: ghostScene,
      selection,
      wallLines,
      openings,
      floorOpenings: floor.floorOpenings ?? [],
      outline:
        tool === 'floorOpening' && (outline || preview)
          ? {
              points: outline ?? [],
              cursor: preview?.cursor,
              snap: preview?.snap ?? 'none',
            }
          : undefined,
      openingPreview:
        openingTool && placement
          ? {
              a: placement.a,
              b: placement.b,
              material: openingMaterial[openingTool],
            }
          : undefined,
      background:
        background?.visible && backgroundImage
          ? {
              bitmap: backgroundImage,
              x: background.x,
              y: background.y,
              width: background.widthPx * background.metresPerPixel,
              height: background.heightPx * background.metresPerPixel,
              opacity: background.opacity,
            }
          : undefined,
      calibration:
        tool === 'calibrate'
          ? { points: calibrationPoints, cursor: pointer }
          : undefined,
      // No ghost while over (or dragging) an existing access point.
      accessPointPreview:
        tool === 'accessPoint' && cursorDefault ? pointer : undefined,
      surveySpots,
      surveyCard,
      emptyRooms,
      surveyPreview:
        (tool === 'survey' || placingScan) && cursorDefault
          ? pointer
          : undefined,
      suggestions: [
        ...(suggestedHere?.map((move) => ({
          apId: move.apId,
          from: move.from,
          to: move.to,
          label: move.apId === undefined ? `New: ${move.name}` : 'Suggested',
        })) ?? []),
        ...(checkedHere ? [checkedHere] : []),
      ],
      located,
      corners: floor.nodes,
      drawing:
        tool === 'wall' && preview
          ? { anchor, ...preview, material: wallMaterial }
          : undefined,
    })
    context.restore()
  }, [
    camera,
    size,
    units,
    coverage,
    heatmap,
    showHeatmap,
    fadeHeatmap,
    segments,
    accessPoints,
    selection,
    wallLines,
    openings,
    openingTool,
    placement,
    openingMaterial,
    background,
    backgroundImage,
    calibrationPoints,
    pointer,
    floor.nodes,
    floor.floorOpenings,
    outline,
    tool,
    placingScan,
    cursorDefault,
    preview,
    anchor,
    wallMaterial,
    suggestedHere,
    checkedHere,
    located,
    ghostScene,
    surveySpots,
    surveyCard,
    emptyRooms,
  ])

  const snapForWallTool = (screen: Point, altKey: boolean) => {
    const current = store.getState().camera!
    // The floor opening tool closes its outline on the first corner (D54).
    const first = tool === 'floorOpening' ? outline?.[0] : undefined
    if (
      first &&
      !altKey &&
      outline!.length >= 3 &&
      Math.hypot(
        toScreen(current, first).x - screen.x,
        toScreen(current, first).y - screen.y,
      ) <= SNAP_RADIUS_PX
    ) {
      return { point: first, kind: 'node' as const }
    }
    return snapPoint(floor, toPlan(current, screen), {
      scale: current.scale,
      units,
      anchor,
      disabled: altKey,
      ghost,
    })
  }

  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvas.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /** Door and window tools: the placement a click at `screen` would make. */
  const placementAt = (screen: Point) => {
    if (!camera || !openingTool) return undefined
    const onWall = wallAt(camera, floor, screen)
    if (!onWall) return undefined
    const width = DEFAULT_OPENING_WIDTH_M[openingTool]
    const offset = fitOpeningAt(floor, onWall.wallId, onWall.along, width)
    if (offset === undefined) return undefined
    return {
      wallId: onWall.wallId,
      centre: onWall.along,
      a: pointAlong(floor, onWall.wallId, offset),
      b: pointAlong(floor, onWall.wallId, offset + width),
    }
  }

  /**
   * True if a press here would grab an access point instead of doing the
   * current tool's action (D38).
   */
  const grabsAccessPoint = (screen: Point, altKey: boolean) =>
    !!camera &&
    pressGrabsAccessPoint(
      tool,
      !!store.getState().chain || !!store.getState().outline,
      altKey,
    ) &&
    !!accessPointAt(camera, accessPoints, screen)

  /** Whether this hit is an access point that is locked in place (D43). */
  const isLocked = (item: SelectionItem | undefined) =>
    item?.kind === 'accessPoint' &&
    accessPoints.some((a) => a.id === item.id && a.locked)

  const hoverCursor = (screen: Point, altKey: boolean): Cursor => {
    if (!camera) return 'default'
    if (tool !== 'select' && grabsAccessPoint(screen, altKey)) {
      const ap = accessPointAt(camera, accessPoints, screen)
      return ap?.locked ? 'pointer' : 'grab'
    }
    if (tool === 'survey') {
      return surveySpotAt(camera, floor.surveySpots ?? [], screen)
        ? 'grab'
        : 'default'
    }
    if (openingTool) {
      if (placementAt(screen)) return 'default'
      return wallAt(camera, floor, screen) ? 'not-allowed' : 'default'
    }
    if (tool !== 'select') return 'default'
    if (floorOpeningCornerAt(camera, floor, selection, screen)) return 'grab'
    const hit = hitTest(camera, floor, accessPoints, openings, screen)
    if (!hit) return draggableImageAt(screen) ? 'move' : 'default'
    if (isLocked(hit)) return 'pointer'
    return hit.kind === 'wall' || hit.kind === 'floorOpening' ? 'move' : 'grab'
  }

  /** True if the pointer is over the tracing image and it can be dragged. */
  const draggableImageAt = (screen: Point) =>
    !!camera &&
    !!background &&
    background.visible &&
    !background.locked &&
    onImage(background, toPlan(camera, screen))

  /** Where the dragged item's position starts, for computing moves. */
  const originOf = (item: SelectionItem): Point | undefined => {
    if (item.kind === 'accessPoint') {
      return accessPoints.find((a) => a.id === item.id)
    }
    if (item.kind === 'node') return floor.nodes.find((n) => n.id === item.id)
    if (item.kind === 'surveySpot') {
      return floor.surveySpots?.find((s) => s.id === item.id)
    }
    if (item.kind === 'opening') {
      // For an opening, x holds its centre's distance along its wall.
      const opening = floor.openings.find((o) => o.id === item.id)
      return opening && { x: opening.offsetM + opening.widthM / 2, y: 0 }
    }
    return { x: 0, y: 0 }
  }

  /** Previews (or on drop, commits) the move of the dragged item. */
  const dragTo = (
    active: Extract<Drag, { kind: 'item' }>,
    screen: Point,
    altKey: boolean,
    current: Camera,
    drop: boolean,
  ) => {
    const state = store.getState()
    const here = toPlan(current, screen)
    const delta = {
      x: here.x - active.startPlan.x,
      y: here.y - active.startPlan.y,
    }
    const { item, origin } = active
    if (item.kind === 'floorOpening' && active.corner !== undefined) {
      // A corner snaps as when drawing (D54).
      const to = snapPoint(
        floor,
        { x: origin.x + delta.x, y: origin.y + delta.y },
        {
          scale: current.scale,
          units,
          disabled: altKey,
          ghost: ghostFloor(state),
        },
      ).point
      state.updateGesture(
        moveFloorOpeningCornerRecipe(floorId, item.id, active.corner, to),
      )
    } else if (item.kind === 'floorOpening') {
      // In whole grid steps, or freely with Alt, as walls move (D18).
      const step = snapStep(units)
      const move = altKey
        ? delta
        : {
            x: Math.round(delta.x / step) * step,
            y: Math.round(delta.y / step) * step,
          }
      state.updateGesture(moveFloorOpeningRecipe(floorId, item.id, move))
    } else if (item.kind === 'accessPoint') {
      state.updateGesture((draft) => {
        const ap = draft.accessPoints.find((a) => a.id === item.id)
        if (ap) {
          ap.x = origin.x + delta.x
          ap.y = origin.y + delta.y
        }
      })
    } else if (item.kind === 'surveySpot') {
      state.updateGesture(
        moveSurveySpotRecipe(item.id, {
          x: origin.x + delta.x,
          y: origin.y + delta.y,
        }),
      )
    } else if (item.kind === 'opening') {
      const opening = floor.openings.find((o) => o.id === item.id)
      if (!opening) return
      const start = pointAlong(floor, opening.wallId, 0)
      const end = pointAlong(floor, opening.wallId, 1)
      const along = delta.x * (end.x - start.x) + delta.y * (end.y - start.y)
      state.updateGesture(moveOpeningRecipe(floorId, item.id, origin.x + along))
    } else if (item.kind === 'node') {
      const base = state.gesture?.base ?? state.plan
      const baseFloor = base.floors.find((f) => f.id === floorId)!
      const to = snapDraggedNode(
        baseFloor,
        item.id,
        { x: origin.x + delta.x, y: origin.y + delta.y },
        {
          scale: current.scale,
          units,
          disabled: altKey,
          ghost: ghostFloor(state),
        },
      )
      state.updateGesture(moveNodeRecipe(floorId, item.id, to, drop))
    } else {
      const base = state.gesture?.base ?? state.plan
      const baseFloor = base.floors.find((f) => f.id === floorId)!
      const wall = baseFloor.walls.find((w) => w.id === item.id)
      const a = baseFloor.nodes.find((n) => n.id === wall?.from)
      const b = baseFloor.nodes.find((n) => n.id === wall?.to)
      if (!a || !b) return
      const move = wallDragDelta(a, b, delta, units, altKey)
      state.updateGesture(moveWallRecipe(floorId, item.id, move, drop))
    }
  }

  const cursorStyle =
    spaceDown && cursor === 'default'
      ? 'grab'
      : (tool === 'wall' ||
            tool === 'floorOpening' ||
            tool === 'accessPoint' ||
            tool === 'survey' ||
            openingTool) &&
          cursor === 'default'
        ? 'crosshair'
        : cursor

  return (
    <>
      <canvas
        ref={canvas}
        className="editor-canvas"
        style={{ cursor: cursorStyle }}
        tabIndex={0}
        data-scale={camera?.scale}
        data-offset-x={camera?.offsetX}
        data-offset-y={camera?.offsetY}
        role="application"
        aria-roledescription="floor plan editor"
        aria-label={
          placingScan
            ? 'Floor plan: click where the scan was taken'
            : openingTool
              ? `Floor plan, ${openingTool} tool`
              : tool === 'wall'
                ? 'Floor plan, wall tool'
                : tool === 'floorOpening'
                  ? 'Floor plan, floor opening tool'
                  : tool === 'accessPoint'
                    ? 'Floor plan, access point tool'
                    : tool === 'survey'
                      ? 'Floor plan, survey tool'
                      : tool === 'calibrate'
                        ? 'Floor plan, calibrating: click two points on the image'
                        : 'Floor plan'
        }
        aria-describedby={hintId}
        onDoubleClick={(event) => {
          const state = store.getState()
          if (tool === 'wall') {
            state.endChain()
            return
          }
          if (tool === 'floorOpening') {
            state.finishOutline()
            return
          }
          if (!camera) return
          const at = local(event)
          const hit = hitTest(camera, floor, accessPoints, openings, at)
          if (hit?.kind !== 'wall') return
          let created: string | undefined
          state.edit(
            'Split wall',
            splitRecipe(floorId, hit.id, toPlan(camera, at), (id) => {
              created = id
            }),
          )
          if (created) state.select([{ kind: 'node', id: created }])
        }}
        onPointerDown={(event) => {
          const at = local(event)
          event.currentTarget.setPointerCapture(event.pointerId)
          // Keyboard shortcuts need focus here, but a mouse click shouldn't
          // show the keyboard focus ring.
          event.currentTarget.focus({
            preventScroll: true,
            focusVisible: false,
          } as FocusOptions)
          const state = store.getState()

          if (event.pointerType === 'touch') {
            touches.current.set(event.pointerId, at)
            if (touches.current.size > 1) {
              // A second finger turns any drag into pinch-and-pan.
              if (drag.current?.kind === 'item') state.cancelGesture()
              drag.current = undefined
              return
            }
          }

          if (event.button === 1 || (event.button === 0 && spaceDown)) {
            drag.current = { kind: 'pan', last: at }
            setCursor('grabbing')
            return
          }
          if (event.button !== 0 || !camera) return

          // Scan your network waits for where the scan was taken (D82).
          if (state.placeScan) {
            state.placeScan(toPlan(camera, at))
            return
          }

          // Between chains, a press on an access point grabs it (D38).
          if (tool === 'wall' && !grabsAccessPoint(at, event.altKey)) {
            state.clickWallPoint(snapForWallTool(at, event.altKey).point)
            return
          }

          if (tool === 'floorOpening' && !grabsAccessPoint(at, event.altKey)) {
            if (canCutFloor(state.plan, floorId)) {
              state.clickOutlinePoint(snapForWallTool(at, event.altKey).point)
            }
            return
          }

          if (tool === 'calibrate') {
            const first = state.calibrationPoints[0]
            const point = toPlan(camera, at)
            // A second click on the first point would give no distance.
            const tooClose =
              first &&
              Math.hypot(point.x - first.x, point.y - first.y) * camera.scale <
                DRAG_THRESHOLD_PX
            if (state.calibrationPoints.length < 2 && !tooClose) {
              state.addCalibrationPoint(point)
            }
            return
          }

          // A press on an existing access point grabs it, as with Select,
          // rather than stacking a new one on top (D34).
          if (tool === 'accessPoint' && !grabsAccessPoint(at, event.altKey)) {
            let created: string | undefined
            state.edit('Add access point', (draft) => {
              created = addAccessPoint(draft, floorId, toPlan(camera, at))
            })
            if (created) state.select([{ kind: 'accessPoint', id: created }])
            return
          }

          // A press on a pin grabs it; anywhere else adds a spot (D71).
          if (
            tool === 'survey' &&
            !grabsAccessPoint(at, event.altKey) &&
            !surveySpotAt(camera, floor.surveySpots ?? [], at)
          ) {
            state.addSurveySpot(toPlan(camera, at))
            return
          }

          if (openingTool && !grabsAccessPoint(at, event.altKey)) {
            const place = placementAt(at)
            if (!place) return
            let created: string | undefined
            state.edit(
              openingTool === 'door' ? 'Add door' : 'Add window',
              (draft) => {
                const target = draft.floors.find((f) => f.id === floorId)!
                created = addOpening(target, place.wallId, place.centre, {
                  kind: openingTool,
                  widthM: DEFAULT_OPENING_WIDTH_M[openingTool],
                  material: openingMaterial[openingTool],
                })
              },
            )
            if (created) state.select([{ kind: 'opening', id: created }])
            return
          }

          // A corner of a selected floor opening drags on its own (D54).
          const corner =
            event.pointerType === 'touch' || event.shiftKey
              ? undefined
              : floorOpeningCornerAt(camera, floor, state.selection, at)
          if (corner) {
            drag.current = {
              kind: 'item',
              item: { kind: 'floorOpening', id: corner.id },
              startScreen: at,
              startPlan: toPlan(camera, at),
              origin: { x: corner.point.x, y: corner.point.y },
              corner: corner.index,
              moved: false,
            }
            state.beginGesture()
            return
          }

          const hit = hitTest(camera, floor, accessPoints, openings, at)
          // On touch, editing is desktop-first: only access points and
          // survey pins drag (D16, D71).
          const draggable =
            hit &&
            (event.pointerType !== 'touch' ||
              hit.kind === 'accessPoint' ||
              hit.kind === 'surveySpot')
          if (!hit && event.pointerType !== 'touch' && draggableImageAt(at)) {
            state.select([])
            drag.current = {
              kind: 'background',
              startPlan: toPlan(camera, at),
              origin: { x: background!.x, y: background!.y },
              moved: false,
            }
            state.beginGesture()
            return
          }
          if (!hit || !draggable) {
            if (!event.shiftKey) state.select([])
            if (event.pointerType === 'touch') {
              drag.current = { kind: 'pan', last: at }
            }
            return
          }
          if (event.shiftKey) {
            state.toggleSelected(hit)
            return
          }
          if (!state.selection.some((s) => sameItem(s, hit))) {
            state.select([hit])
          }
          if (isLocked(hit)) {
            drag.current = { kind: 'locked', startScreen: at }
            return
          }
          const origin = originOf(hit)
          if (!origin) return
          drag.current = {
            kind: 'item',
            item: hit,
            startScreen: at,
            startPlan: toPlan(camera, at),
            origin: { x: origin.x, y: origin.y },
            moved: false,
          }
          state.beginGesture({ keepOptimizer: hit.kind === 'surveySpot' })
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
          setHovering(event.pointerType !== 'touch' && !drag.current)
          // Over an access point that a press would grab, show no wall or
          // opening preview, only the grab cursor.
          const grabbing = grabsAccessPoint(at, event.altKey)
          if ((tool === 'wall' || tool === 'floorOpening') && !drag.current) {
            if (grabbing) {
              setPreview(undefined)
            } else {
              const snap = snapForWallTool(at, event.altKey)
              setPreview({ cursor: snap.point, snap: snap.kind })
            }
          }
          if (openingTool && !drag.current) {
            setPlacement(grabbing ? undefined : placementAt(at))
          }
          const active = drag.current
          if (active?.kind === 'pan') {
            store
              .getState()
              .setCamera(
                panBy(current, at.x - active.last.x, at.y - active.last.y),
              )
            active.last = at
          } else if (active?.kind === 'background') {
            const here = toPlan(current, at)
            active.moved = true
            const x = active.origin.x + here.x - active.startPlan.x
            const y = active.origin.y + here.y - active.startPlan.y
            store.getState().updateGesture((draft) => {
              const bg = draft.floors.find((f) => f.id === floorId)?.background
              if (bg) Object.assign(bg, { x, y })
            })
          } else if (active?.kind === 'locked') {
            const travelled = Math.hypot(
              at.x - active.startScreen.x,
              at.y - active.startScreen.y,
            )
            if (travelled < DRAG_THRESHOLD_PX) return
            setCursor('not-allowed')
            if (store.getState().notice !== LOCKED_NOTICE) {
              store.getState().setNotice(LOCKED_NOTICE)
            }
          } else if (active?.kind === 'item') {
            const travelled = Math.hypot(
              at.x - active.startScreen.x,
              at.y - active.startScreen.y,
            )
            if (!active.moved && travelled < DRAG_THRESHOLD_PX) return
            active.moved = true
            setCursor('grabbing')
            dragTo(active, at, event.altKey, current, false)
          } else {
            setCursor(hoverCursor(at, event.altKey))
          }
        }}
        onPointerUp={(event) => {
          touches.current.delete(event.pointerId)
          const active = drag.current
          const state = store.getState()
          if (active?.kind === 'background') {
            if (active.moved) state.endGesture('Move tracing image')
            else state.cancelGesture()
          }
          if (active?.kind === 'item') {
            if (active.moved && state.camera) {
              dragTo(active, local(event), event.altKey, state.camera, true)
              const name =
                active.item.kind === 'accessPoint'
                  ? accessPoints.find((a) => a.id === active.item.id)?.name
                  : undefined
              state.endGesture(
                active.corner !== undefined
                  ? 'Move floor opening corner'
                  : `Move ${name ?? describeSelection([active.item])}`,
              )
            } else {
              state.cancelGesture()
            }
          }
          drag.current = undefined
          setCursor(hoverCursor(local(event), event.altKey))
        }}
        onPointerCancel={(event) => {
          touches.current.delete(event.pointerId)
          if (
            drag.current?.kind === 'item' ||
            drag.current?.kind === 'background'
          ) {
            store.getState().cancelGesture()
          }
          drag.current = undefined
          setCursor('default')
        }}
        onPointerLeave={() => {
          store.getState().setPointer(undefined)
          setHovering(false)
          // Mid-chain, keep the preview: it sets the direction of a typed length.
          if (!store.getState().chain && !store.getState().outline) {
            setPreview(undefined)
          }
          setPlacement(undefined)
        }}
        onKeyDown={(event) => {
          const state = store.getState()
          // Tab steps through walls, openings, corners and access points,
          // then on to the next control (D23).
          if (
            event.key === 'Tab' &&
            tool === 'select' &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const next = nextKeyboardItem(
              order,
              state.selection,
              event.shiftKey ? -1 : 1,
            )
            if (next) {
              event.preventDefault()
              state.select([next])
            }
            return
          }
          if (state.selection.length === 0) return
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
          const only =
            state.selection.length === 1 ? state.selection[0] : undefined
          const name =
            only?.kind === 'accessPoint'
              ? state.plan.accessPoints.find((a) => a.id === only.id)?.name
              : undefined
          state.edit(
            `Move ${name ?? describeSelection(state.selection)}`,
            nudgeRecipe(floorId, state.selection, delta),
            { keepOptimizer: onlySurveySpots(state.selection) },
          )
          // The rest of the selection moved; say why a locked one didn't.
          if (selectionHasLocked(state.plan, state.selection)) {
            state.setNotice(LOCKED_NOTICE)
          }
        }}
      />
      <p id={hintId} className="visually-hidden">
        {tool === 'wall'
          ? 'Click to place wall corners; double-click or press Enter to finish. Type a number for an exact length.'
          : tool === 'floorOpening'
            ? 'Click to place the corners of a stairwell or atrium; click the first corner, double-click or press Enter to close it. Esc drops it.'
            : openingTool
              ? `Click a wall to add a ${openingTool}. Esc returns to Select.`
              : tool === 'accessPoint'
                ? 'Click to add an access point. Esc returns to Select.'
                : tool === 'survey'
                  ? 'Click to add a survey spot, then type its readings in the panel. Drag a pin to move it. Esc returns to Select.'
                  : `Tab and Shift+Tab select walls, doors, windows, corners, floor openings, access points and survey spots. Arrow keys move the selection, Delete removes it. Shortcuts: ${toolKeysHint()}; ? lists them all.`}
      </p>
      <p className="visually-hidden" aria-live="polite">
        {describeForScreenReader(selection, floor, accessPoints, units, order)}
      </p>
      {tool === 'wall' && anchor && camera && (
        <LengthInput
          anchor={anchor}
          toward={preview?.cursor}
          camera={camera}
          units={units}
          onSubmit={(point) => store.getState().clickWallPoint(point)}
        />
      )}
    </>
  )
}

/** Camera after a two-finger gesture: pan by the midpoint, zoom by the spread. */
function pinch(camera: Camera, before: Point[], after: Point[]) {
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

import {
  deleteAccessPoint,
  deleteFloorOpening,
  alongWall,
  collapseShortWalls,
  deleteNode,
  deleteOpening,
  deleteWall,
  joinNode,
  moveFloorOpening,
  moveFloorOpeningCorner,
  moveNodes,
  moveOpening,
  deleteSurveySpot,
  moveSurveySpot,
  pointInPolygon,
  splitWall,
  type AccessPoint,
  type Floor,
  type OpeningSpan,
  type Plan,
  type Point,
  type SurveySpot,
} from '@signalplan/floorplan'
import type { Draft } from 'immer'
import { toPlan, toScreen, type Camera } from './camera.ts'
import {
  AP_RADIUS_PX,
  baseWallWidth,
  PIN_HEAD_PX,
  PIN_HEAD_Y_PX,
} from './render.ts'
import { nearestOnSegment, snapPoint } from './snap.ts'
import type { Recipe, Selection, SelectionItem, Tool } from './store.ts'
import { snapStep, type Units } from './units.ts'

const AP_GRAB_PX = AP_RADIUS_PX + 8
const NODE_GRAB_PX = 8

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

/** How close to a wall's line the pointer must be to hit it, in pixels. */
const wallReach = (camera: Camera) =>
  Math.max(baseWallWidth(camera) * 0.9 + 3, 6)

/** The access point within grabbing distance of a screen point, if any. */
export function accessPointAt(
  camera: Camera,
  accessPoints: readonly AccessPoint[],
  screen: Point,
): AccessPoint | undefined {
  return accessPoints.find(
    (a) => distance(toScreen(camera, a), screen) <= AP_GRAB_PX,
  )
}

/**
 * The survey spot whose pin is under a screen point, if any (D71). The pin's
 * tip is the spot; its head sits above it, and either one grabs it.
 */
export function surveySpotAt(
  camera: Camera,
  spots: readonly SurveySpot[],
  screen: Point,
): SurveySpot | undefined {
  let best: { spot: SurveySpot; d: number } | undefined
  for (const spot of spots) {
    const tip = toScreen(camera, spot)
    const head = { x: tip.x, y: tip.y - PIN_HEAD_Y_PX }
    const d = Math.min(distance(tip, screen), distance(head, screen))
    if (d <= PIN_HEAD_PX + 4 && (!best || d < best.d)) best = { spot, d }
  }
  return best?.spot
}

/**
 * Whether a press on an access point grabs it (select, and drag to move)
 * under this tool, instead of doing the tool's own action (D34, D38). The
 * wall tool grabs only between chains, and Alt still places a corner there,
 * as Alt already means "place freely"; mid-chain, clicks always place corners.
 */
export function pressGrabsAccessPoint(
  tool: Tool,
  drawingChain: boolean,
  altKey: boolean,
): boolean {
  if (tool === 'wall' || tool === 'floorOpening') {
    return !drawingChain && !altKey
  }
  return tool !== 'calibrate'
}

/**
 * What is under a screen point, in order of priority: an access point, a
 * survey spot, a corner, a door or window, a wall, then an opening in the
 * floor, by its edge or anywhere inside it.
 */
export function hitTest(
  camera: Camera,
  floor: Floor,
  accessPoints: readonly AccessPoint[],
  openings: readonly OpeningSpan[],
  screen: Point,
): SelectionItem | undefined {
  const ap = accessPointAt(camera, accessPoints, screen)
  if (ap) return { kind: 'accessPoint', id: ap.id }
  const spot = surveySpotAt(camera, floor.surveySpots ?? [], screen)
  if (spot) return { kind: 'surveySpot', id: spot.id }

  let best: { item: SelectionItem; d: number } | undefined
  for (const node of floor.nodes) {
    const d = distance(toScreen(camera, node), screen)
    if (d <= NODE_GRAB_PX && (!best || d < best.d)) {
      best = { item: { kind: 'node', id: node.id }, d }
    }
  }
  if (best) return best.item

  const reach = wallReach(camera)
  for (const span of openings) {
    const sa = toScreen(camera, span.a)
    const sb = toScreen(camera, span.b)
    const d = distance(nearestOnSegment(sa, sb, screen), screen)
    if (d <= reach && (!best || d < best.d)) {
      best = { item: { kind: 'opening', id: span.id }, d }
    }
  }
  if (best) return best.item

  const nodes = new Map(floor.nodes.map((n) => [n.id, n]))
  for (const wall of floor.walls) {
    const a = nodes.get(wall.from)
    const b = nodes.get(wall.to)
    if (!a || !b) continue
    const sa = toScreen(camera, a)
    const sb = toScreen(camera, b)
    const d = distance(nearestOnSegment(sa, sb, screen), screen)
    if (d <= reach && (!best || d < best.d)) {
      best = { item: { kind: 'wall', id: wall.id }, d }
    }
  }
  return best?.item ?? floorOpeningAt(camera, floor, screen)
}

/** The opening in the floor under a screen point: near its edge or inside. */
function floorOpeningAt(
  camera: Camera,
  floor: Floor,
  screen: Point,
): SelectionItem | undefined {
  const plan = toPlan(camera, screen)
  let best: { id: string; d: number } | undefined
  for (const { id, points } of floor.floorOpenings ?? []) {
    let d = pointInPolygon(plan, points) ? 0 : Number.POSITIVE_INFINITY
    points.forEach((a, i) => {
      const sa = toScreen(camera, a)
      const sb = toScreen(camera, points[(i + 1) % points.length]!)
      d = Math.min(d, distance(nearestOnSegment(sa, sb, screen), screen))
    })
    if (d <= NODE_GRAB_PX && (!best || d < best.d)) best = { id, d }
  }
  return best && { kind: 'floorOpening', id: best.id }
}

/**
 * A corner of a selected floor opening under a screen point, which a press
 * drags on its own (D54).
 */
export function floorOpeningCornerAt(
  camera: Camera,
  floor: Floor,
  selection: Selection,
  screen: Point,
): { id: string; index: number; point: Point } | undefined {
  let best: { id: string; index: number; point: Point; d: number } | undefined
  for (const { id, points } of floor.floorOpenings ?? []) {
    if (!selection.some((s) => s.kind === 'floorOpening' && s.id === id)) {
      continue
    }
    points.forEach((point, index) => {
      const d = distance(toScreen(camera, point), screen)
      if (d <= NODE_GRAB_PX && (!best || d < best.d)) {
        best = { id, index, point, d }
      }
    })
  }
  return best && { id: best.id, index: best.index, point: best.point }
}

/** Moves a survey spot to a point (D71). */
export function moveSurveySpotRecipe(id: string, to: Point): Recipe {
  return (plan) => {
    const spot = plan.floors
      .flatMap((f) => f.surveySpots ?? [])
      .find((s) => s.id === id)
    if (spot) moveSurveySpot(plan, id, to.x - spot.x, to.y - spot.y)
  }
}

/** Moves a whole floor opening by a vector from where it started. */
export function moveFloorOpeningRecipe(
  floorId: string,
  id: string,
  delta: Point,
): Recipe {
  return (plan) =>
    moveFloorOpening(floorOf(plan, floorId), id, delta.x, delta.y)
}

/** Moves one corner of a floor opening to a point. */
export function moveFloorOpeningCornerRecipe(
  floorId: string,
  id: string,
  index: number,
  to: Point,
): Recipe {
  return (plan) =>
    void moveFloorOpeningCorner(floorOf(plan, floorId), id, index, to)
}

/** The wall under a screen point and how far along it the point is. */
export function wallAt(
  camera: Camera,
  floor: Floor,
  screen: Point,
): { wallId: string; along: number } | undefined {
  const nodes = new Map(floor.nodes.map((n) => [n.id, n]))
  let best: { wallId: string; d: number; point: Point } | undefined
  for (const wall of floor.walls) {
    const a = nodes.get(wall.from)
    const b = nodes.get(wall.to)
    if (!a || !b) continue
    const onWall = nearestOnSegment(
      toScreen(camera, a),
      toScreen(camera, b),
      screen,
    )
    const d = distance(onWall, screen)
    if (d <= wallReach(camera) * 1.5 && (!best || d < best.d)) {
      best = { wallId: wall.id, d, point: onWall }
    }
  }
  if (!best) return undefined
  const plan = {
    x: (best.point.x - camera.offsetX) / camera.scale,
    y: (best.point.y - camera.offsetY) / camera.scale,
  }
  return { wallId: best.wallId, along: alongWall(floor, best.wallId, plan) }
}

/** Slides a door or window so its centre is `centre` metres along its wall. */
export function moveOpeningRecipe(
  floorId: string,
  openingId: string,
  centre: number,
): Recipe {
  return (plan) => moveOpening(floorOf(plan, floorId), openingId, centre)
}

const floorOf = (plan: Draft<Plan> | Plan, floorId: string) =>
  plan.floors.find((f) => f.id === floorId)!

/**
 * Where a dragged corner lands: snapped as when drawing, but never to itself
 * or the walls attached to it.
 */
export function snapDraggedNode(
  floor: Floor,
  nodeId: string,
  raw: Point,
  options: {
    scale: number
    units: Units
    disabled: boolean
    ghost?: Floor | undefined
  },
): Point {
  const others: Floor = {
    ...floor,
    nodes: floor.nodes.filter((n) => n.id !== nodeId),
    walls: floor.walls.filter((w) => w.from !== nodeId && w.to !== nodeId),
  }
  return snapPoint(others, raw, options).point
}

/** Moves a corner to a point; on drop it also joins what it landed on. */
export function moveNodeRecipe(
  floorId: string,
  nodeId: string,
  to: Point,
  drop: boolean,
): Recipe {
  return (plan) => {
    const floor = floorOf(plan, floorId)
    const node = floor.nodes.find((n) => n.id === nodeId)
    if (!node) return
    moveNodes(floor, [nodeId], { x: to.x - node.x, y: to.y - node.y })
    if (drop) {
      joinNode(floor, nodeId)
      collapseShortWalls(floor)
    }
  }
}

/**
 * How far to move a dragged wall: at right angles to itself in whole grid
 * steps, or (with Alt) freely in any direction (D18).
 */
export function wallDragDelta(
  a: Point,
  b: Point,
  pointerDelta: Point,
  units: Units,
  free: boolean,
): Point {
  if (free) return pointerDelta
  const length = distance(a, b)
  if (length === 0) return { x: 0, y: 0 }
  const nx = -(b.y - a.y) / length
  const ny = (b.x - a.x) / length
  const step = snapStep(units)
  const along =
    Math.round((pointerDelta.x * nx + pointerDelta.y * ny) / step) * step
  return { x: nx * along, y: ny * along }
}

export function moveWallRecipe(
  floorId: string,
  wallId: string,
  delta: Point,
  drop: boolean,
): Recipe {
  return (plan) => {
    const floor = floorOf(plan, floorId)
    const wall = floor.walls.find((w) => w.id === wallId)
    if (!wall) return
    moveNodes(floor, [wall.from, wall.to], delta)
    if (drop) collapseShortWalls(floor)
  }
}

/** Moves every selected corner, wall and access point by the same vector. */
export function nudgeRecipe(
  floorId: string,
  selection: Selection,
  delta: Point,
): Recipe {
  return (plan) => {
    const floor = floorOf(plan, floorId)
    const nodeIds = new Set<string>()
    for (const item of selection) {
      if (item.kind === 'opening') {
        // Openings slide along their wall by the part of the move along it.
        const opening = floor.openings.find((o) => o.id === item.id)
        const wall = floor.walls.find((w) => w.id === opening?.wallId)
        const a = floor.nodes.find((n) => n.id === wall?.from)
        const b = floor.nodes.find((n) => n.id === wall?.to)
        if (!opening || !a || !b) continue
        const length = distance(a, b)
        const along = (delta.x * (b.x - a.x) + delta.y * (b.y - a.y)) / length
        moveOpening(
          floor,
          opening.id,
          opening.offsetM + opening.widthM / 2 + along,
        )
      }
      if (item.kind === 'node') nodeIds.add(item.id)
      if (item.kind === 'floorOpening') {
        moveFloorOpening(floor, item.id, delta.x, delta.y)
      }
      if (item.kind === 'surveySpot') {
        moveSurveySpot(plan, item.id, delta.x, delta.y)
      }
      if (item.kind === 'wall') {
        const wall = floor.walls.find((w) => w.id === item.id)
        if (wall) {
          nodeIds.add(wall.from)
          nodeIds.add(wall.to)
        }
      }
      if (item.kind === 'accessPoint') {
        // Locked access points stay put; the rest of the selection moves (D43).
        const ap = plan.accessPoints.find((a) => a.id === item.id)
        if (ap && !ap.locked) {
          ap.x += delta.x
          ap.y += delta.y
        }
      }
    }
    moveNodes(floor, nodeIds, delta)
    collapseShortWalls(floor)
  }
}

/** Whether the selection includes an access point that is locked (D43). */
export function selectionHasLocked(plan: Plan, selection: Selection): boolean {
  return selection.some(
    (item) =>
      item.kind === 'accessPoint' &&
      plan.accessPoints.some((ap) => ap.id === item.id && ap.locked),
  )
}

/** The status bar's note when something locked is asked to move (D43). */
export const LOCKED_NOTICE = 'Locked: unlock it in the panel to move it'

/**
 * Deletes the selected access points, openings, walls, corners and survey
 * spots (D18, D25, D71).
 */
export function deleteRecipe(floorId: string, selection: Selection): Recipe {
  return (plan) => {
    const floor = floorOf(plan, floorId)
    for (const item of selection) {
      if (item.kind === 'accessPoint') deleteAccessPoint(plan, item.id)
      if (item.kind === 'opening') deleteOpening(floor, item.id)
      if (item.kind === 'floorOpening') deleteFloorOpening(floor, item.id)
      if (item.kind === 'surveySpot') deleteSurveySpot(plan, item.id)
    }
    for (const item of selection) {
      if (item.kind === 'wall') deleteWall(floor, item.id)
    }
    for (const item of selection) {
      if (item.kind === 'node' && floor.nodes.some((n) => n.id === item.id)) {
        deleteNode(floor, item.id)
      }
    }
  }
}

/** Splits a wall at a point, reporting the new corner's id. */
export function splitRecipe(
  floorId: string,
  wallId: string,
  at: Point,
  onSplit: (nodeId: string) => void,
): Recipe {
  return (plan) => {
    onSplit(splitWall(floorOf(plan, floorId), wallId, at))
  }
}

/** A short label for the undo button, describing what was changed. */
export function describeSelection(selection: Selection): string {
  if (selection.length !== 1) return `${selection.length} items`
  return {
    accessPoint: 'access point',
    wall: 'wall',
    node: 'corner',
    opening: 'opening',
    floorOpening: 'floor opening',
    surveySpot: 'survey spot',
  }[selection[0]!.kind]
}

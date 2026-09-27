import type { AccessPoint, Floor, Point } from '@signalplan/floorplan'
import type { Selection, SelectionItem } from './store.ts'
import { formatLength, type Units } from './units.ts'
import { WALL_STYLES } from './wallStyles.ts'

/**
 * Keyboard selection on the canvas (D23). Tab visits walls, then doors and
 * windows, then corners, then access points; each group in reading order
 * (top to bottom, then left to right) so the order matches what's on screen.
 */
export function keyboardOrder(
  floor: Floor,
  accessPoints: readonly AccessPoint[],
): SelectionItem[] {
  const node = new Map(floor.nodes.map((n) => [n.id, n]))
  const wallMid = (wallId: string, t: number): Point | undefined => {
    const wall = floor.walls.find((w) => w.id === wallId)
    const a = wall && node.get(wall.from)
    const b = wall && node.get(wall.to)
    if (!a || !b) return undefined
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  const wallLength = (wallId: string) => {
    const wall = floor.walls.find((w) => w.id === wallId)
    const a = wall && node.get(wall.from)
    const b = wall && node.get(wall.to)
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
  }

  const group = (
    kind: SelectionItem['kind'],
    items: { id: string; at: Point | undefined }[],
  ) =>
    items
      .filter((i): i is { id: string; at: Point } => i.at !== undefined)
      .sort((p, q) => readingOrder(p.at, q.at) || p.id.localeCompare(q.id))
      .map((i) => ({ kind, id: i.id }))

  return [
    ...group(
      'wall',
      floor.walls.map((w) => ({ id: w.id, at: wallMid(w.id, 0.5) })),
    ),
    ...group(
      'opening',
      floor.openings.map((o) => {
        const length = wallLength(o.wallId)
        const t = length > 0 ? (o.offsetM + o.widthM / 2) / length : 0
        return { id: o.id, at: wallMid(o.wallId, t) }
      }),
    ),
    ...group(
      'node',
      floor.nodes.map((n) => ({ id: n.id, at: n })),
    ),
    ...group(
      'accessPoint',
      accessPoints
        .filter((a) => a.floorId === floor.id)
        .map((a) => ({ id: a.id, at: a })),
    ),
  ]
}

/** Top to bottom, then left to right, ignoring differences under 1 cm. */
function readingOrder(p: Point, q: Point) {
  const dy = Math.round(p.y * 100) - Math.round(q.y * 100)
  return dy !== 0 ? dy : Math.round(p.x * 100) - Math.round(q.x * 100)
}

/**
 * The item Tab (or Shift+Tab, `step` -1) selects next, or undefined when it
 * should leave the canvas. With nothing (or several things) selected, Tab
 * starts at the first item and Shift+Tab at the last.
 */
export function nextKeyboardItem(
  order: readonly SelectionItem[],
  selection: Selection,
  step: 1 | -1,
): SelectionItem | undefined {
  const current =
    selection.length === 1
      ? order.findIndex(
          (i) => i.kind === selection[0]!.kind && i.id === selection[0]!.id,
        )
      : -1
  if (current === -1) return step === 1 ? order[0] : order.at(-1)
  return order[current + step]
}

/**
 * What a screen reader hears about the selection, e.g.
 * "Wall, drywall, 3.20 m, 2 of 14".
 */
export function describeForScreenReader(
  selection: Selection,
  floor: Floor,
  accessPoints: readonly AccessPoint[],
  units: Units,
  order: readonly SelectionItem[],
): string {
  if (selection.length === 0) return 'Nothing selected'
  if (selection.length > 1) return `${selection.length} items selected`
  const item = selection[0]!
  const index = order.findIndex((i) => i.kind === item.kind && i.id === item.id)
  const position = index === -1 ? '' : `, ${index + 1} of ${order.length}`
  const node = (id: string) => floor.nodes.find((n) => n.id === id)
  const at = (p: Point) =>
    `at ${formatLength(p.x, units)}, ${formatLength(p.y, units)}`

  if (item.kind === 'wall') {
    const wall = floor.walls.find((w) => w.id === item.id)
    const a = wall && node(wall.from)
    const b = wall && node(wall.to)
    if (!wall || !a || !b) return 'Nothing selected'
    const length = formatLength(Math.hypot(b.x - a.x, b.y - a.y), units)
    const material = WALL_STYLES[wall.material].label.toLowerCase()
    return `Wall, ${material}, ${length}${position}`
  }
  if (item.kind === 'opening') {
    const opening = floor.openings.find((o) => o.id === item.id)
    if (!opening) return 'Nothing selected'
    const noun = opening.kind === 'door' ? 'Door' : 'Window'
    const material =
      opening.material === 'open'
        ? 'open'
        : WALL_STYLES[opening.material].label.toLowerCase()
    const width = formatLength(opening.widthM, units)
    return `${noun}, ${material}, ${width} wide${position}`
  }
  if (item.kind === 'node') {
    const corner = node(item.id)
    if (!corner) return 'Nothing selected'
    const walls = floor.walls.filter(
      (w) => w.from === item.id || w.to === item.id,
    ).length
    const joins = `joining ${walls} wall${walls === 1 ? '' : 's'}`
    return `Corner ${joins}, ${at(corner)}${position}`
  }
  const ap = accessPoints.find((a) => a.id === item.id)
  if (!ap) return 'Nothing selected'
  return `Access point ${ap.name}, ${at(ap)}${position}`
}

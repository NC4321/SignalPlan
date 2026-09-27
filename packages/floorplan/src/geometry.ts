import type { Floor, OpeningMaterial, WallMaterial } from './schema.ts'

export interface Point {
  x: number
  y: number
}

/** A straight piece of wall or opening with one material, ready for the engine. */
export interface MaterialSegment {
  wallId: string
  /** Set when this segment is a door or window rather than solid wall. */
  openingId?: string
  a: Point
  b: Point
  material: WallMaterial
}

/**
 * Flattens a floor into material segments. Each wall is split at its openings;
 * solid parts keep the wall's material and each opening gets its own. Openings
 * with the `open` material leave a gap, since they block nothing.
 *
 * Assumes the floor has passed validation: references resolve and openings fit.
 */
export function materialSegments(floor: Floor): MaterialSegment[] {
  const nodes = new Map(floor.nodes.map((node) => [node.id, node]))
  const segments: MaterialSegment[] = []

  for (const wall of floor.walls) {
    const from = nodes.get(wall.from)
    const to = nodes.get(wall.to)
    if (!from || !to) continue

    const length = Math.hypot(to.x - from.x, to.y - from.y)
    // A wall collapsed to a point mid-drag has no extent to draw or cross.
    if (length === 0) continue
    const at = (distance: number): Point => {
      const t = distance / length
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      }
    }
    const push = (
      start: number,
      end: number,
      material: OpeningMaterial,
      openingId?: string,
    ) => {
      if (end <= start || material === 'open') return
      segments.push({
        wallId: wall.id,
        ...(openingId === undefined ? {} : { openingId }),
        a: at(start),
        b: at(end),
        material,
      })
    }

    const openings = floor.openings
      .filter((opening) => opening.wallId === wall.id)
      .sort((p, q) => p.offsetM - q.offsetM)

    let cursor = 0
    for (const opening of openings) {
      const end = Math.min(opening.offsetM + opening.widthM, length)
      push(cursor, opening.offsetM, wall.material)
      push(opening.offsetM, end, opening.material, opening.id)
      cursor = end
    }
    push(cursor, length, wall.material)
  }

  return segments
}

/** A door or window as a line on the plan, including open doorways. */
export interface OpeningSpan {
  id: string
  wallId: string
  kind: 'door' | 'window'
  material: OpeningMaterial
  a: Point
  b: Point
}

/** Every opening's endpoints on the plan. */
export function openingSpans(floor: Floor): OpeningSpan[] {
  const nodes = new Map(floor.nodes.map((node) => [node.id, node]))
  const walls = new Map(floor.walls.map((wall) => [wall.id, wall]))
  const spans: OpeningSpan[] = []
  for (const opening of floor.openings) {
    const wall = walls.get(opening.wallId)
    const from = wall && nodes.get(wall.from)
    const to = wall && nodes.get(wall.to)
    if (!from || !to) continue
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length === 0) continue
    const at = (d: number): Point => ({
      x: from.x + ((to.x - from.x) * d) / length,
      y: from.y + ((to.y - from.y) * d) / length,
    })
    spans.push({
      id: opening.id,
      wallId: opening.wallId,
      kind: opening.kind,
      material: opening.material,
      a: at(opening.offsetM),
      b: at(opening.offsetM + opening.widthM),
    })
  }
  return spans
}

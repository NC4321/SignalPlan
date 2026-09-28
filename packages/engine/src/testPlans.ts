import {
  parsePlan,
  type AccessPoint,
  type Floor,
  type Opening,
  type Plan,
  type PlanNode,
  type Wall,
  type WallMaterial,
} from '@signalplan/floorplan'
import apartment from '@signalplan/floorplan/fixtures/apartment.json' with { type: 'json' }
import lShapedHouse from '@signalplan/floorplan/fixtures/l-shaped-house.json' with { type: 'json' }
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json' with { type: 'json' }
import { BAND_PROFILES } from './bands.ts'
import { candidatePositions, type Scorer } from './placement.ts'

/**
 * Plans for the speed check and the engine's exactness tests.
 */

/**
 * The optimizer's exit gate homes (D47): three shapes and sizes, each with
 * one router where its line comes in.
 */
export function gateHomes(): { name: string; plan: Plan }[] {
  return [
    ['Sample home (150 m², brick bungalow)', sampleHome],
    ['Apartment (65 m², concrete)', apartment],
    ['L-shaped house (220 m², brick and drywall)', lShapedHouse],
  ].map(([name, json]) => {
    const result = parsePlan(json)
    if (!result.ok) throw new Error(`${name} is invalid`)
    return { name: name as string, plan: result.plan }
  })
}

/**
 * The naive placement the optimizer must beat (D47): the middle of the
 * floor's bounding box, or the nearest spot the scorer allows (on a 10 cm
 * lattice) when that is outside the walls or on one, as in an L-shape.
 */
export function naiveCentre(plan: Plan, floorId: string, scorer: Scorer) {
  const { nodes } = plan.floors.find((f) => f.id === floorId)!
  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  const middle = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  }
  if (scorer.allows(middle)) return middle
  const distance = (p: { x: number; y: number }) =>
    Math.hypot(p.x - middle.x, p.y - middle.y)
  return candidatePositions(scorer, 0.1).reduce((a, b) =>
    distance(b) < distance(a) ? b : a,
  )
}

/**
 * A floor of 5 × 5 rooms, each `roomW` × `roomH` metres: 60 walls, a door in
 * every interior wall and a window in every outside wall, with an access
 * point at each of `accessPoints`.
 */
function rooms(
  name: string,
  roomW: number,
  roomH: number,
  accessPoints: readonly [number, number][],
): Plan {
  const rooms = 5
  const nodes: PlanNode[] = []
  for (let row = 0; row <= rooms; row++) {
    for (let col = 0; col <= rooms; col++) {
      nodes.push({ id: `n${row}-${col}`, x: col * roomW, y: row * roomH })
    }
  }
  const walls: Wall[] = []
  const openings: Opening[] = []
  const addWall = (from: string, to: string, outside: boolean) => {
    const id = `w${walls.length}`
    walls.push({
      id,
      from,
      to,
      material: outside ? ('brick' as const) : ('drywall' as const),
    })
    openings.push(
      outside
        ? {
            id: `o${openings.length}`,
            wallId: id,
            kind: 'window' as const,
            offsetM: 0.4,
            widthM: 1.2,
            material: 'glass' as const,
          }
        : {
            id: `o${openings.length}`,
            wallId: id,
            kind: 'door' as const,
            offsetM: 0.6,
            widthM: 0.81,
            material: 'wood' as const,
          },
    )
  }
  for (let row = 0; row <= rooms; row++) {
    for (let col = 0; col < rooms; col++) {
      const outside = row === 0 || row === rooms
      addWall(`n${row}-${col}`, `n${row}-${col + 1}`, outside)
    }
  }
  for (let col = 0; col <= rooms; col++) {
    for (let row = 0; row < rooms; row++) {
      const outside = col === 0 || col === rooms
      addWall(`n${row}-${col}`, `n${row + 1}-${col}`, outside)
    }
  }
  const radios = [
    { band: '2.4GHz' as const },
    { band: '5GHz' as const },
    { band: '6GHz' as const },
  ]
  const result = parsePlan({
    schemaVersion: 1,
    name,
    floors: [
      {
        id: 'main',
        name: 'Main floor',
        elevationM: 0,
        heightM: 2.4,
        nodes,
        walls,
        openings,
      },
    ],
    accessPoints: accessPoints.map(([x, y], i) => ({
      id: `ap${i}`,
      name: `AP ${i + 1}`,
      floorId: 'main',
      x,
      y,
      heightM: 1,
      radios,
    })),
  })
  if (!result.ok) throw new Error(`${name} is invalid`)
  return result.plan
}

/**
 * A 10 × 10 m floor of 2 m square rooms with two access points: far busier
 * than a real home of this size.
 */
export const roomGrid = () =>
  rooms('Room grid', 2, 2, [
    [3, 3],
    [7, 7],
  ])

/**
 * A 20 × 15 m (300 m²) house of 4 × 3 m rooms with two access points: a large
 * home, the plan behind the 4× slower device target (D29).
 */
export const bigHouse = () =>
  rooms('Big house', 4, 3, [
    [5, 4],
    [15, 11],
  ])

/** A drywall outline of a w × h room, optionally split at x = splitX. */
export function room(
  w: number,
  h: number,
  split?: { x: number; material: WallMaterial },
): Floor {
  const corners = split
    ? [
        [0, 0],
        [split.x, 0],
        [w, 0],
        [w, h],
        [split.x, h],
        [0, h],
      ]
    : [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ]
  const walls = corners.map((_, i) => ({
    id: `w${i}`,
    from: `n${i}`,
    to: `n${(i + 1) % corners.length}`,
    material: 'drywall' as WallMaterial,
  }))
  if (split) {
    walls.push({ id: 'split', from: 'n1', to: 'n4', material: split.material })
  }
  return {
    id: 'f',
    name: 'Floor',
    elevationM: 0,
    heightM: 2.5,
    nodes: corners.map(([x, y], i) => ({ id: `n${i}`, x: x!, y: y! })),
    walls,
    openings: [],
  }
}

/** An access point at receiver height, so distances are flat. */
export const ap = (x: number, y: number): AccessPoint => ({
  id: `ap-${x}-${y}`,
  name: 'AP',
  floorId: 'f',
  x,
  y,
  heightM: 1,
  radios: [{ band: '5GHz' }],
})

/** Free-space signal at distance d on 5 GHz at the default power. */
export function freeSpaceDbm(d: number): number {
  const p = BAND_PROFILES['5GHz']
  return (
    p.defaultTxPowerDbm -
    p.referenceLossDb -
    10 * p.pathLossExponent * Math.log10(Math.max(d, 1))
  )
}

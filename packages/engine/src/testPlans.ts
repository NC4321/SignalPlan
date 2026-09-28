import {
  parsePlan,
  type Opening,
  type Plan,
  type PlanNode,
  type Wall,
} from '@signalplan/floorplan'

/**
 * Plans for the speed check and the engine's exactness tests.
 */

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

import { describe, expect, it } from 'vitest'
import {
  addOpening,
  addWall,
  deleteOpening,
  moveOpening,
  setOpeningWidth,
} from './edit.ts'
import type { Floor, Plan } from './schema.ts'
import { checkStructure } from './validate.ts'

/** One 5 m wall along the x axis. */
function wall(): Floor {
  const floor: Floor = {
    id: 'f',
    name: 'Floor',
    elevationM: 0,
    heightM: 2.5,
    nodes: [],
    walls: [],
    openings: [],
  }
  addWall(floor, { x: 0, y: 0 }, { x: 5, y: 0 }, 'brick')
  return floor
}

const door = { kind: 'door', widthM: 0.8, material: 'wood' } as const
const valid = (floor: Floor) =>
  checkStructure({
    schemaVersion: 1,
    name: 't',
    floors: [floor],
    accessPoints: [],
  } satisfies Plan)
const spans = (floor: Floor) =>
  floor.openings
    .map((o) => [+o.offsetM.toFixed(6), +(o.offsetM + o.widthM).toFixed(6)])
    .sort((a, b) => a[0]! - b[0]!)

describe('addOpening', () => {
  it('centres an opening on the click', () => {
    const floor = wall()
    expect(addOpening(floor, 'w1', 2.5, door)).toBe('d1')
    expect(spans(floor)).toEqual([[2.1, 2.9]])
  })

  it('slides away from a corner to fit', () => {
    const floor = wall()
    addOpening(floor, 'w1', 0.1, door)
    expect(spans(floor)).toEqual([[0, 0.8]])
  })

  it('slides clear of another opening', () => {
    const floor = wall()
    addOpening(floor, 'w1', 2.5, door)
    addOpening(floor, 'w1', 2.8, {
      kind: 'window',
      widthM: 1,
      material: 'glass',
    })
    expect(spans(floor)).toEqual([
      [2.1, 2.9],
      [2.9, 3.9],
    ])
    expect(valid(floor)).toEqual([])
  })

  it('uses window ids for windows', () => {
    const floor = wall()
    expect(
      addOpening(floor, 'w1', 1, {
        kind: 'window',
        widthM: 1,
        material: 'glass',
      }),
    ).toBe('win1')
  })

  it('refuses when no free stretch is wide enough', () => {
    const floor = wall()
    addOpening(floor, 'w1', 1.25, { ...door, widthM: 2.5 })
    addOpening(floor, 'w1', 3.9, { ...door, widthM: 2 })
    expect(addOpening(floor, 'w1', 4.8, door)).toBeUndefined()
    expect(floor.openings).toHaveLength(2)
  })
})

describe('moveOpening', () => {
  it('slides along the wall, stopping at the corner', () => {
    const floor = wall()
    addOpening(floor, 'w1', 2.5, door)
    moveOpening(floor, 'd1', 4.9)
    expect(spans(floor)).toEqual([[4.2, 5]])
  })

  it('stops at a neighbouring opening instead of jumping past it', () => {
    const floor = wall()
    addOpening(floor, 'w1', 1, door) // 0.6–1.4
    addOpening(floor, 'w1', 3, door) // 2.6–3.4
    moveOpening(floor, 'd1', 4.5)
    expect(spans(floor)).toEqual([
      [1.8, 2.6],
      [2.6, 3.4],
    ])
    expect(valid(floor)).toEqual([])
  })
})

describe('setOpeningWidth', () => {
  it('grows about the centre', () => {
    const floor = wall()
    addOpening(floor, 'w1', 2.5, door)
    expect(setOpeningWidth(floor, 'd1', 1.2)).toBeCloseTo(1.2, 9)
    expect(spans(floor)).toEqual([[1.9, 3.1]])
  })

  it('is limited by the free stretch it sits in', () => {
    const floor = wall()
    addOpening(floor, 'w1', 1, door) // 0.6–1.4
    addOpening(floor, 'w1', 3, door) // 2.6–3.4
    expect(setOpeningWidth(floor, 'd1', 5)).toBeCloseTo(2.6, 9)
    expect(spans(floor)[0]).toEqual([0, 2.6])
    expect(valid(floor)).toEqual([])
  })

  it('ignores widths under 1 cm', () => {
    const floor = wall()
    addOpening(floor, 'w1', 2.5, door)
    expect(setOpeningWidth(floor, 'd1', 0)).toBeUndefined()
    expect(spans(floor)).toEqual([[2.1, 2.9]])
  })
})

describe('deleteOpening', () => {
  it('removes it', () => {
    const floor = wall()
    addOpening(floor, 'w1', 2.5, door)
    deleteOpening(floor, 'd1')
    expect(floor.openings).toEqual([])
  })
})

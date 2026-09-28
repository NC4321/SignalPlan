import type { AccessPoint, Floor } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  describeForScreenReader,
  keyboardOrder,
  nextKeyboardItem,
} from './a11y.ts'

// An L of two walls: a–b along the top, b–c down the right, with a door on
// the top wall and a second floor's access point that must be left out.
const floor: Floor = {
  id: 'f',
  name: 'Floor',
  elevationM: 0,
  heightM: 2.5,
  nodes: [
    { id: 'c', x: 4, y: 3 },
    { id: 'b', x: 4, y: 0 },
    { id: 'a', x: 0, y: 0 },
  ],
  walls: [
    { id: 'bc', from: 'b', to: 'c', material: 'drywall' },
    { id: 'ab', from: 'a', to: 'b', material: 'brick' },
  ],
  openings: [
    {
      id: 'door',
      wallId: 'ab',
      kind: 'door',
      offsetM: 1,
      widthM: 0.8128,
      material: 'wood',
    },
  ],
}
const ap = (id: string, floorId: string, x: number): AccessPoint => ({
  id,
  name: `Router ${id}`,
  floorId,
  x,
  y: 1.5,
  heightM: 1,
  radios: [],
})
const accessPoints = [ap('two', 'f', 3), ap('other', 'g', 0), ap('one', 'f', 1)]

describe('keyboardOrder', () => {
  it('lists walls, openings, corners, then access points, each in reading order', () => {
    // ab's middle (2, 0) is above bc's (4, 1.5); corners a (0, 0) and b
    // (4, 0) share a row, so left comes first.
    expect(keyboardOrder(floor, accessPoints)).toEqual([
      { kind: 'wall', id: 'ab' },
      { kind: 'wall', id: 'bc' },
      { kind: 'opening', id: 'door' },
      { kind: 'node', id: 'a' },
      { kind: 'node', id: 'b' },
      { kind: 'node', id: 'c' },
      { kind: 'accessPoint', id: 'one' },
      { kind: 'accessPoint', id: 'two' },
    ])
  })
})

describe('nextKeyboardItem', () => {
  const order = keyboardOrder(floor, accessPoints)

  it('starts at the first item, or the last going backwards', () => {
    expect(nextKeyboardItem(order, [], 1)).toEqual({ kind: 'wall', id: 'ab' })
    expect(nextKeyboardItem(order, [], -1)).toEqual({
      kind: 'accessPoint',
      id: 'two',
    })
  })

  it('steps from the selected item', () => {
    expect(nextKeyboardItem(order, [{ kind: 'wall', id: 'bc' }], 1)).toEqual({
      kind: 'opening',
      id: 'door',
    })
    expect(nextKeyboardItem(order, [{ kind: 'wall', id: 'bc' }], -1)).toEqual({
      kind: 'wall',
      id: 'ab',
    })
  })

  it('returns nothing past either end, so focus leaves the canvas', () => {
    expect(
      nextKeyboardItem(order, [{ kind: 'accessPoint', id: 'two' }], 1),
    ).toBeUndefined()
    expect(
      nextKeyboardItem(order, [{ kind: 'wall', id: 'ab' }], -1),
    ).toBeUndefined()
  })

  it('restarts from an end when several items are selected', () => {
    const several = [
      { kind: 'wall', id: 'bc' },
      { kind: 'node', id: 'a' },
    ] as const
    expect(nextKeyboardItem(order, several, 1)).toEqual(order[0])
  })
})

describe('describeForScreenReader', () => {
  const order = keyboardOrder(floor, accessPoints)
  const say = (
    selection: Parameters<typeof describeForScreenReader>[0],
    units: 'metric' | 'imperial' = 'metric',
  ) => describeForScreenReader(selection, floor, accessPoints, units, order)

  it('names a wall by material and length, with its place in the order', () => {
    expect(say([{ kind: 'wall', id: 'bc' }])).toBe(
      'Wall, drywall, 3.00 m, 2 of 8',
    )
  })

  it('uses the display units', () => {
    // 4 m is 13 ft 1.5 in.
    expect(say([{ kind: 'wall', id: 'ab' }], 'imperial')).toBe(
      `Wall, brick, 13′ 1½″, 1 of 8`,
    )
  })

  it('describes openings, corners and access points', () => {
    expect(say([{ kind: 'opening', id: 'door' }])).toBe(
      'Door, wood, 0.81 m wide, 3 of 8',
    )
    expect(say([{ kind: 'node', id: 'b' }])).toBe(
      'Corner joining 2 walls, at 4.00 m, 0.00 m, 5 of 8',
    )
    expect(say([{ kind: 'accessPoint', id: 'one' }])).toBe(
      'Access point Router one, at 1.00 m, 1.50 m, 7 of 8',
    )
  })

  it('says when an access point is locked', () => {
    const locked = accessPoints.map((a) =>
      a.id === 'one' ? { ...a, locked: true } : a,
    )
    expect(
      describeForScreenReader(
        [{ kind: 'accessPoint', id: 'one' }],
        floor,
        locked,
        'metric',
        order,
      ),
    ).toBe('Access point Router one, at 1.00 m, 1.50 m, locked, 7 of 8')
  })

  it('summarises empty and multiple selections', () => {
    expect(say([])).toBe('Nothing selected')
    expect(
      say([
        { kind: 'wall', id: 'ab' },
        { kind: 'node', id: 'c' },
      ]),
    ).toBe('2 items selected')
  })
})

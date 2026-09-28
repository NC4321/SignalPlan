import { describe, expect, it } from 'vitest'
import {
  addAccessPoint,
  deleteAccessPoint,
  nextAccessPointName,
  setRadioChannel,
  setRadioOn,
  setRadioPower,
  setRadioWidth,
} from './accessPoints.ts'
import type { Plan } from './schema.ts'
import { checkStructure, parsePlan } from './validate.ts'

function plan(): Plan {
  return {
    schemaVersion: 1,
    name: 'Test',
    floors: [
      {
        id: 'f',
        name: 'Floor',
        elevationM: 0,
        heightM: 2.5,
        nodes: [],
        walls: [],
        openings: [],
      },
    ],
    accessPoints: [
      {
        id: 'router',
        name: 'Router',
        floorId: 'f',
        x: 1,
        y: 1,
        heightM: 1,
        radios: [{ band: '2.4GHz' }, { band: '5GHz', txPowerDbm: 20 }],
      },
    ],
  }
}

describe('addAccessPoint', () => {
  it('adds a radio on every band at default power, 1 m up', () => {
    const p = plan()
    const id = addAccessPoint(p, 'f', { x: 3, y: 4 })
    expect(id).toBe('ap1')
    expect(p.accessPoints[1]).toEqual({
      id: 'ap1',
      name: 'Access point 1',
      floorId: 'f',
      x: 3,
      y: 4,
      heightM: 1,
      radios: [{ band: '2.4GHz' }, { band: '5GHz' }, { band: '6GHz' }],
    })
    expect(checkStructure(p)).toEqual([])
  })

  it('numbers names and ids after the highest in use', () => {
    const p = plan()
    addAccessPoint(p, 'f', { x: 0, y: 0 })
    addAccessPoint(p, 'f', { x: 0, y: 0 })
    p.accessPoints[1]!.name = 'Access point 7'
    expect(nextAccessPointName(p)).toBe('Access point 8')
    deleteAccessPoint(p, 'ap1')
    expect(addAccessPoint(p, 'f', { x: 0, y: 0 })).toBe('ap1')
  })
})

describe('deleteAccessPoint', () => {
  it('can remove the last access point', () => {
    const p = plan()
    deleteAccessPoint(p, 'router')
    expect(p.accessPoints).toEqual([])
    expect(checkStructure(p)).toEqual([])
  })
})

describe('setRadioOn', () => {
  it('turns a band on at default power, keeping band order', () => {
    const p = plan()
    p.accessPoints[0]!.radios = [{ band: '6GHz' }]
    expect(setRadioOn(p, 'router', '2.4GHz', true)).toBe(true)
    expect(p.accessPoints[0]!.radios).toEqual([
      { band: '2.4GHz' },
      { band: '6GHz' },
    ])
  })

  it('turns a band off, but never the last one', () => {
    const p = plan()
    expect(setRadioOn(p, 'router', '5GHz', false)).toBe(true)
    expect(setRadioOn(p, 'router', '2.4GHz', false)).toBe(false)
    expect(p.accessPoints[0]!.radios).toEqual([{ band: '2.4GHz' }])
  })

  it('reports no change when the band is already in that state', () => {
    expect(setRadioOn(plan(), 'router', '5GHz', true)).toBe(false)
  })
})

describe('setRadioPower', () => {
  it('sets, clamps and clears EIRP', () => {
    const p = plan()
    setRadioPower(p, 'router', '2.4GHz', 27)
    expect(p.accessPoints[0]!.radios[0]).toEqual({
      band: '2.4GHz',
      txPowerDbm: 27,
    })
    setRadioPower(p, 'router', '2.4GHz', 55)
    expect(p.accessPoints[0]!.radios[0]!.txPowerDbm).toBe(40)
    setRadioPower(p, 'router', '2.4GHz', -30)
    expect(p.accessPoints[0]!.radios[0]!.txPowerDbm).toBe(-10)
    setRadioPower(p, 'router', '5GHz', undefined)
    expect(p.accessPoints[0]!.radios[1]).toEqual({ band: '5GHz' })
    expect(checkStructure(p)).toEqual([])
  })

  it('throws for a band that is off', () => {
    expect(() => setRadioPower(plan(), 'router', '6GHz', 10)).toThrow()
  })
})

describe('setRadioWidth and setRadioChannel', () => {
  it('sets a width, then a channel at that width', () => {
    const p = plan()
    expect(setRadioWidth(p, 'router', '5GHz', 80)).toBe(true)
    expect(setRadioChannel(p, 'router', '5GHz', 42)).toBe(true)
    expect(p.accessPoints[0]!.radios[1]).toEqual({
      band: '5GHz',
      txPowerDbm: 20,
      channel: 42,
      channelWidthMHz: 80,
    })
    expect(parsePlan(p).ok).toBe(true)
  })

  it('reports no change for the same value', () => {
    const p = plan()
    expect(setRadioWidth(p, 'router', '5GHz', undefined)).toBe(false)
    setRadioWidth(p, 'router', '5GHz', 40)
    expect(setRadioWidth(p, 'router', '5GHz', 40)).toBe(false)
    setRadioChannel(p, 'router', '5GHz', 38)
    expect(setRadioChannel(p, 'router', '5GHz', 38)).toBe(false)
  })

  it('leaves the channel to the planner when the width changes', () => {
    const p = plan()
    setRadioWidth(p, 'router', '5GHz', 80)
    setRadioChannel(p, 'router', '5GHz', 42)
    setRadioWidth(p, 'router', '5GHz', 40)
    expect(p.accessPoints[0]!.radios[1]).toEqual({
      band: '5GHz',
      txPowerDbm: 20,
      channelWidthMHz: 40,
    })
    setRadioChannel(p, 'router', '5GHz', 46)
    setRadioWidth(p, 'router', '5GHz', undefined)
    expect(p.accessPoints[0]!.radios[1]).toEqual({
      band: '5GHz',
      txPowerDbm: 20,
    })
  })

  it('clears a channel but keeps the width', () => {
    const p = plan()
    setRadioWidth(p, 'router', '2.4GHz', 20)
    setRadioChannel(p, 'router', '2.4GHz', 6)
    expect(setRadioChannel(p, 'router', '2.4GHz', undefined)).toBe(true)
    expect(p.accessPoints[0]!.radios[0]).toEqual({
      band: '2.4GHz',
      channelWidthMHz: 20,
    })
  })

  it('needs a width before a channel', () => {
    expect(() => setRadioChannel(plan(), 'router', '5GHz', 36)).toThrow(/width/)
  })

  it('rejects a saved channel without a width', () => {
    const p = plan()
    p.accessPoints[0]!.radios[1]!.channel = 36
    const result = parsePlan(p)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe(
        'accessPoints[0].radios[1].channelWidthMHz',
      )
    }
  })
})

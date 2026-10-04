import { describe, expect, it } from 'vitest'
import {
  addNeighbourNetwork,
  deleteNeighbourNetwork,
  NEW_NEIGHBOUR_STRENGTH_DBM,
  renameNeighbourNetwork,
  setNeighbourBand,
  setNeighbourChannel,
  setNeighbourLocation,
  setNeighbourStrength,
  setNeighbourWidth,
} from './neighbours.ts'
import { addFloor, deleteFloor } from './floors.ts'
import type { NeighbourLocation, Plan } from './schema.ts'
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
    accessPoints: [],
  }
}

describe('neighbours’ networks (D67)', () => {
  it('adds a network with no channel yet, at the given width', () => {
    const p = plan()
    expect(addNeighbourNetwork(p, '5GHz', 80)).toBe('nn1')
    expect(addNeighbourNetwork(p, '2.4GHz', 20)).toBe('nn2')
    expect(p.neighbourNetworks).toEqual([
      {
        id: 'nn1',
        band: '5GHz',
        channelWidthMHz: 80,
        strengthDbm: NEW_NEIGHBOUR_STRENGTH_DBM,
      },
      {
        id: 'nn2',
        band: '2.4GHz',
        channelWidthMHz: 20,
        strengthDbm: NEW_NEIGHBOUR_STRENGTH_DBM,
      },
    ])
    expect(parsePlan(p).ok).toBe(true)
  })

  it('reuses the lowest free id and drops the list when empty', () => {
    const p = plan()
    addNeighbourNetwork(p, '5GHz', 80)
    addNeighbourNetwork(p, '5GHz', 80)
    expect(deleteNeighbourNetwork(p, 'nn1')).toBe(true)
    expect(addNeighbourNetwork(p, '5GHz', 80)).toBe('nn1')
    deleteNeighbourNetwork(p, 'nn1')
    deleteNeighbourNetwork(p, 'nn2')
    expect(p.neighbourNetworks).toBeUndefined()
    expect(deleteNeighbourNetwork(p, 'nn2')).toBe(false)
  })

  it('clears the channel when the band or width changes', () => {
    const p = plan()
    const id = addNeighbourNetwork(p, '5GHz', 80)
    expect(setNeighbourChannel(p, id, 42)).toBe(true)
    expect(setNeighbourChannel(p, id, 42)).toBe(false)
    expect(setNeighbourWidth(p, id, 40)).toBe(true)
    expect(p.neighbourNetworks![0]!.channel).toBeUndefined()
    setNeighbourChannel(p, id, 38)
    expect(setNeighbourBand(p, id, '5GHz', 80)).toBe(false)
    expect(setNeighbourBand(p, id, '2.4GHz', 20)).toBe(true)
    expect(p.neighbourNetworks![0]).toEqual({
      id,
      band: '2.4GHz',
      channelWidthMHz: 20,
      strengthDbm: -70,
    })
  })

  it('sets the strength and a trimmed name, dropping a blank one', () => {
    const p = plan()
    const id = addNeighbourNetwork(p, '5GHz', 80)
    expect(setNeighbourStrength(p, id, -62)).toBe(true)
    expect(setNeighbourStrength(p, id, -62)).toBe(false)
    expect(renameNeighbourNetwork(p, id, '  Smith-5G ')).toBe(true)
    expect(p.neighbourNetworks![0]!.name).toBe('Smith-5G')
    expect(renameNeighbourNetwork(p, id, ' ')).toBe(true)
    expect(p.neighbourNetworks![0]!.name).toBeUndefined()
    expect(() => setNeighbourStrength(p, 'nope', -60)).toThrow(/nope/)
  })

  it('refuses a strength out of range and repeated ids', () => {
    const p = plan()
    addNeighbourNetwork(p, '5GHz', 80)
    p.neighbourNetworks![0]!.strengthDbm = -10
    expect(parsePlan(p).ok).toBe(false)
    p.neighbourNetworks![0]!.strengthDbm = -70
    p.neighbourNetworks!.push({ ...p.neighbourNetworks![0]! })
    expect(checkStructure(p)).toEqual([
      expect.objectContaining({ path: 'neighbourNetworks[1].id' }),
    ])
  })
})

describe('neighbours’ locations (D84)', () => {
  const at: NeighbourLocation = {
    floorId: 'f',
    x: -3,
    y: 4.5,
    heightM: 1,
    eirpDbm: 18.5,
    uncertaintyM: 2.4,
  }

  it('sets, keeps and clears a location', () => {
    const p = plan()
    const id = addNeighbourNetwork(p, '5GHz', 80)
    expect(setNeighbourLocation(p, id, at)).toBe(true)
    expect(p.neighbourNetworks![0]!.location).toEqual(at)
    expect(setNeighbourLocation(p, id, { ...at })).toBe(false)
    expect(setNeighbourLocation(p, id, { ...at, x: -2 })).toBe(true)
    expect(parsePlan(p).ok).toBe(true)
    expect(setNeighbourLocation(p, id, undefined)).toBe(true)
    expect(p.neighbourNetworks![0]!).not.toHaveProperty('location')
    expect(setNeighbourLocation(p, id, undefined)).toBe(false)
    expect(() =>
      setNeighbourLocation(p, id, { ...at, floorId: 'nope' }),
    ).toThrow(/nope/)
  })

  it('refuses a location on a floor the plan doesn’t have', () => {
    const p = plan()
    const id = addNeighbourNetwork(p, '5GHz', 80)
    setNeighbourLocation(p, id, at)
    p.neighbourNetworks![0]!.location!.floorId = 'gone'
    expect(checkStructure(p)).toEqual([
      expect.objectContaining({
        path: 'neighbourNetworks[0].location.floorId',
      }),
    ])
  })

  it('drops the location when its floor is deleted or the band changes', () => {
    const p = plan()
    const upstairs = addFloor(p, 'above')
    const a = addNeighbourNetwork(p, '5GHz', 80)
    const b = addNeighbourNetwork(p, '5GHz', 80)
    setNeighbourLocation(p, a, { ...at, floorId: upstairs })
    setNeighbourLocation(p, b, at)
    deleteFloor(p, upstairs)
    expect(p.neighbourNetworks![0]!).not.toHaveProperty('location')
    expect(p.neighbourNetworks![1]!.location).toEqual(at)
    setNeighbourBand(p, b, '6GHz', 80)
    expect(p.neighbourNetworks![1]!).not.toHaveProperty('location')
  })
})

import { describe, expect, it } from 'vitest'
import { deleteAccessPoint } from './accessPoints.ts'
import { addFloor, deleteFloor } from './floors.ts'
import type { Plan } from './schema.ts'
import {
  addSurveyReading,
  addSurveySpot,
  bssidOwner,
  deleteSurveyReading,
  deleteSurveySpot,
  findSurveySpot,
  moveSurveySpot,
  NEW_READING_DBM,
  parseBssids,
  setRadioBssids,
  setReadingDbm,
  setReadingSource,
  setSurveyNote,
  strongestReading,
  surveySpotName,
} from './survey.ts'
import { checkStructure, parsePlan } from './validate.ts'

/** Two floors: a router downstairs on 2.4 and 5 GHz, a mesh point upstairs on 5. */
function plan(): Plan {
  const floor = (id: string, elevationM: number) => ({
    id,
    name: id,
    elevationM,
    heightM: 2.5,
    nodes: [],
    walls: [],
    openings: [],
  })
  return {
    schemaVersion: 1,
    name: 'Test',
    floors: [floor('down', 0), floor('up', 2.8)],
    accessPoints: [
      {
        id: 'router',
        name: 'Router',
        floorId: 'down',
        x: 1,
        y: 1,
        heightM: 1,
        radios: [{ band: '2.4GHz' }, { band: '5GHz' }],
      },
      {
        id: 'mesh',
        name: 'Mesh',
        floorId: 'up',
        x: 5,
        y: 1,
        heightM: 1,
        radios: [{ band: '5GHz' }],
      },
    ],
  }
}

const spotOf = (p: Plan, id: string) => findSurveySpot(p, id)!.spot

describe('survey spots (D71)', () => {
  it('adds spots with ids unique across floors, and names them', () => {
    const p = plan()
    expect(addSurveySpot(p, 'down', { x: 2, y: 3 })).toBe('spot1')
    expect(addSurveySpot(p, 'up', { x: 4, y: 1 })).toBe('spot2')
    expect(p.floors[0]!.surveySpots).toEqual([
      { id: 'spot1', x: 2, y: 3, readings: [] },
    ])
    expect(findSurveySpot(p, 'spot2')?.floorId).toBe('up')
    expect(surveySpotName('spot2')).toBe('Spot 2')
    // A freed number is used again, as for access points.
    deleteSurveySpot(p, 'spot1')
    expect(addSurveySpot(p, 'up', { x: 0, y: 0 })).toBe('spot1')
  })

  it('moves a spot, and deleting the last one on a floor removes the list', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 2, y: 3 })
    expect(moveSurveySpot(p, 'spot1', 0.5, -1)).toBe(true)
    expect(spotOf(p, 'spot1')).toMatchObject({ x: 2.5, y: 2 })
    expect(moveSurveySpot(p, 'spot1', 0, 0)).toBe(false)
    expect(deleteSurveySpot(p, 'spot1')).toBe(true)
    expect(p.floors[0]!.surveySpots).toBeUndefined()
    expect(deleteSurveySpot(p, 'spot1')).toBe(false)
  })

  it('sets a trimmed note, and clears it when blank', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    expect(setSurveyNote(p, 'spot1', '  kitchen ')).toBe(true)
    expect(spotOf(p, 'spot1').note).toBe('kitchen')
    expect(setSurveyNote(p, 'spot1', 'kitchen')).toBe(false)
    expect(setSurveyNote(p, 'spot1', ' ')).toBe(true)
    expect(spotOf(p, 'spot1')).not.toHaveProperty('note')
  })
})

describe('survey readings (D71)', () => {
  it('adds readings for this floor’s access points first, then the others', () => {
    const p = plan()
    addSurveySpot(p, 'up', { x: 0, y: 0 })
    expect(addSurveyReading(p, 'spot1')).toBe(true)
    expect(addSurveyReading(p, 'spot1')).toBe(true)
    expect(addSurveyReading(p, 'spot1')).toBe(true)
    expect(spotOf(p, 'spot1').readings).toEqual([
      { apId: 'mesh', band: '5GHz', dbm: NEW_READING_DBM },
      { apId: 'router', band: '2.4GHz', dbm: NEW_READING_DBM },
      { apId: 'router', band: '5GHz', dbm: NEW_READING_DBM },
    ])
    // Every radio has one now.
    expect(addSurveyReading(p, 'spot1')).toBe(false)
    expect(spotOf(p, 'spot1').readings).toHaveLength(3)
  })

  it('adds nothing when the plan has no access points', () => {
    const p = { ...plan(), accessPoints: [] }
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    expect(addSurveyReading(p, 'spot1')).toBe(false)
  })

  it('changes a reading’s source, keeping one reading per access point and band', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    addSurveyReading(p, 'spot1') // router 2.4
    addSurveyReading(p, 'spot1') // router 5
    // Router 5 GHz is taken by the other reading.
    expect(
      setReadingSource(p, 'spot1', 0, { apId: 'router', band: '5GHz' }),
    ).toBe(false)
    // The mesh has no 2.4 GHz radio, so the reading takes its 5 GHz one.
    expect(setReadingSource(p, 'spot1', 0, { apId: 'mesh' })).toBe(true)
    expect(spotOf(p, 'spot1').readings[0]).toMatchObject({
      apId: 'mesh',
      band: '5GHz',
    })
    // Back to the router: 5 GHz is taken, so it takes the free 2.4 GHz.
    expect(setReadingSource(p, 'spot1', 0, { apId: 'router' })).toBe(true)
    expect(spotOf(p, 'spot1').readings[0]).toMatchObject({
      apId: 'router',
      band: '2.4GHz',
    })
    // And onto the mesh again from the 5 GHz reading: it keeps its band.
    expect(setReadingSource(p, 'spot1', 1, { apId: 'mesh' })).toBe(true)
    expect(spotOf(p, 'spot1').readings[1]).toMatchObject({
      apId: 'mesh',
      band: '5GHz',
    })
    expect(setReadingSource(p, 'spot1', 1, { apId: 'mesh' })).toBe(false)
  })

  it('refuses an access point with no free radio', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    addSurveyReading(p, 'spot1') // router 2.4
    addSurveyReading(p, 'spot1') // router 5
    addSurveyReading(p, 'spot1') // mesh 5
    expect(setReadingSource(p, 'spot1', 2, { apId: 'router' })).toBe(false)
    expect(spotOf(p, 'spot1').readings[2]).toMatchObject({ apId: 'mesh' })
  })

  it('sets a value, clamped to the schema’s range', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    addSurveyReading(p, 'spot1')
    expect(setReadingDbm(p, 'spot1', 0, -67)).toBe(true)
    expect(spotOf(p, 'spot1').readings[0]!.dbm).toBe(-67)
    expect(setReadingDbm(p, 'spot1', 0, -67)).toBe(false)
    setReadingDbm(p, 'spot1', 0, 12)
    expect(spotOf(p, 'spot1').readings[0]!.dbm).toBe(0)
    setReadingDbm(p, 'spot1', 0, -300)
    expect(spotOf(p, 'spot1').readings[0]!.dbm).toBe(-120)
  })

  it('deletes a reading', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    addSurveyReading(p, 'spot1')
    addSurveyReading(p, 'spot1')
    expect(deleteSurveyReading(p, 'spot1', 0)).toBe(true)
    expect(spotOf(p, 'spot1').readings).toEqual([
      { apId: 'router', band: '5GHz', dbm: NEW_READING_DBM },
    ])
    expect(deleteSurveyReading(p, 'spot1', 5)).toBe(false)
  })

  it('finds the strongest reading on a band', () => {
    const spot = {
      readings: [
        { apId: 'router', band: '5GHz', dbm: -71 },
        { apId: 'mesh', band: '5GHz', dbm: -58 },
        { apId: 'router', band: '2.4GHz', dbm: -50 },
      ] as const,
    }
    expect(strongestReading(spot, '5GHz')).toBe(-58)
    expect(strongestReading(spot, '2.4GHz')).toBe(-50)
    expect(strongestReading(spot, '6GHz')).toBeUndefined()
  })

  it('drops an access point’s readings when it’s deleted, keeping the spots', () => {
    const p = plan()
    addSurveySpot(p, 'up', { x: 0, y: 0 })
    addSurveyReading(p, 'spot1') // mesh 5
    addSurveyReading(p, 'spot1') // router 2.4
    deleteAccessPoint(p, 'router')
    expect(spotOf(p, 'spot1').readings).toEqual([
      { apId: 'mesh', band: '5GHz', dbm: NEW_READING_DBM },
    ])
    expect(checkStructure(p)).toEqual([])
  })

  it('drops readings from a deleted floor’s access points on other floors', () => {
    const p = plan()
    addSurveySpot(p, 'up', { x: 0, y: 0 })
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    addSurveyReading(p, 'spot1') // mesh 5
    addSurveyReading(p, 'spot1') // router 2.4
    deleteFloor(p, 'down')
    expect(spotOf(p, 'spot1').readings).toEqual([
      { apId: 'mesh', band: '5GHz', dbm: NEW_READING_DBM },
    ])
    expect(findSurveySpot(p, 'spot2')).toBeUndefined()
    expect(checkStructure(p)).toEqual([])
  })

  it('leaves spots alone when a floor is added', () => {
    const p = plan()
    addSurveySpot(p, 'up', { x: 0, y: 0 })
    addFloor(p, 'above')
    expect(findSurveySpot(p, 'spot1')?.floorId).toBe('up')
  })
})

describe('BSSIDs (D71)', () => {
  it('reads BSSIDs in any common form, without repeats', () => {
    expect(
      parseBssids(
        'A4:2B:B0:12:34:56, a4-2b-b0-12-34-57\na42b.b012.3458 a4:2b:b0:12:34:56',
      ),
    ).toEqual({
      bssids: ['a4:2b:b0:12:34:56', 'a4:2b:b0:12:34:57', 'a4:2b:b0:12:34:58'],
      invalid: [],
    })
    expect(parseBssids('  ')).toEqual({ bssids: [], invalid: [] })
    expect(parseBssids('a4:2b:b0:12:34, zz:2b:b0:12:34:56')).toEqual({
      bssids: [],
      invalid: ['a4:2b:b0:12:34', 'zz:2b:b0:12:34:56'],
    })
  })

  it('sets and clears a radio’s BSSIDs', () => {
    const p = plan()
    const bssids = ['a4:2b:b0:12:34:56', 'a6:2b:b0:12:34:56']
    expect(setRadioBssids(p, 'router', '5GHz', bssids)).toBe(true)
    expect(p.accessPoints[0]!.radios[1]!.bssids).toEqual(bssids)
    expect(setRadioBssids(p, 'router', '5GHz', bssids)).toBe(false)
    expect(setRadioBssids(p, 'router', '5GHz', [])).toBe(true)
    expect(p.accessPoints[0]!.radios[1]).not.toHaveProperty('bssids')
  })

  it('gives each BSSID to one radio', () => {
    const p = plan()
    setRadioBssids(p, 'router', '5GHz', ['a4:2b:b0:12:34:56'])
    expect(bssidOwner(p, 'a4:2b:b0:12:34:56')).toEqual({
      apId: 'router',
      band: '5GHz',
    })
    // Its own radio doesn't count.
    expect(
      bssidOwner(p, 'a4:2b:b0:12:34:56', { apId: 'router', band: '5GHz' }),
    ).toBeUndefined()
    expect(() =>
      setRadioBssids(p, 'mesh', '5GHz', ['a4:2b:b0:12:34:56']),
    ).toThrow(/another radio/)
  })
})

describe('survey validation (D71)', () => {
  it('accepts a plan with spots, readings and BSSIDs', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    addSurveyReading(p, 'spot1')
    setSurveyNote(p, 'spot1', 'hall')
    setRadioBssids(p, 'mesh', '5GHz', ['a4:2b:b0:12:34:56'])
    expect(parsePlan(p)).toEqual({ ok: true, plan: p })
  })

  it('rejects a BSSID that isn’t lower case with colons', () => {
    const p = plan()
    p.accessPoints[1]!.radios[0]!.bssids = ['A4-2B-B0-12-34-56']
    const result = parsePlan(p)
    expect(result.ok).toBe(false)
  })

  it('rejects a reading out of range', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    spotOf(p, 'spot1').readings.push({ apId: 'router', band: '5GHz', dbm: 5 })
    expect(parsePlan(p).ok).toBe(false)
  })

  it('reports broken references and repeats', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    p.floors[1]!.surveySpots = [{ id: 'spot1', x: 1, y: 1, readings: [] }]
    spotOf(p, 'spot1').readings.push(
      { apId: 'gone', band: '5GHz', dbm: -60 },
      { apId: 'router', band: '5GHz', dbm: -60 },
      { apId: 'router', band: '5GHz', dbm: -61 },
    )
    p.accessPoints[0]!.radios[1]!.bssids = ['a4:2b:b0:12:34:56']
    p.accessPoints[1]!.radios[0]!.bssids = ['a4:2b:b0:12:34:56']
    expect(checkStructure(p)).toEqual([
      {
        path: 'floors[0].surveySpots[0].readings[0].apId',
        message: 'No access point with id "gone".',
      },
      {
        path: 'floors[0].surveySpots[0].readings[2]',
        message: 'Second 5GHz reading from "router".',
      },
      {
        path: 'floors[1].surveySpots[0].id',
        message: 'Duplicate id "spot1".',
      },
      {
        path: 'accessPoints[1].radios[0].bssids[0]',
        message: 'BSSID a4:2b:b0:12:34:56 is on more than one radio.',
      },
    ])
  })

  it('keeps a neighbour’s BSSID off radios, other neighbours and the not-mine list (D77)', () => {
    const p = plan()
    p.accessPoints[0]!.radios[1]!.bssids = ['a4:2b:b0:12:34:56']
    p.ignoredBssids = ['10:20:30:40:50:61']
    const network = (id: string, bssid: string) => ({
      id,
      band: '5GHz' as const,
      channelWidthMHz: 80 as const,
      strengthDbm: -80,
      bssid,
    })
    p.neighbourNetworks = [
      network('nn1', '10:20:30:40:50:60'),
      network('nn2', '10:20:30:40:50:60'),
      network('nn3', 'a4:2b:b0:12:34:56'),
      network('nn4', '10:20:30:40:50:61'),
    ]
    expect(checkStructure(p)).toEqual([
      {
        path: 'neighbourNetworks[1].bssid',
        message:
          'BSSID 10:20:30:40:50:60 is on more than one neighbour network.',
      },
      {
        path: 'neighbourNetworks[2].bssid',
        message:
          'BSSID a4:2b:b0:12:34:56 is on a radio and also a neighbour’s.',
      },
      {
        path: 'neighbourNetworks[3].bssid',
        message:
          'BSSID 10:20:30:40:50:61 is a neighbour’s and also marked not mine.',
      },
    ])
    p.neighbourNetworks = [network('nn1', '10:20:30:40:50:60')]
    delete p.ignoredBssids
    expect(parsePlan(p).ok).toBe(true)
  })

  it('takes approximate readings, marked true or left out (D77)', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    spotOf(p, 'spot1').readings.push({
      apId: 'router',
      band: '5GHz',
      dbm: -57,
      approximate: true,
    })
    expect(parsePlan(p).ok).toBe(true)
    ;(spotOf(p, 'spot1').readings[0] as { approximate: unknown }).approximate =
      false
    expect(parsePlan(p).ok).toBe(false)
  })
})

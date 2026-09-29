import { describe, expect, it } from 'vitest'
import type { Plan } from './schema.ts'
import {
  addSurveySpot,
  findSurveySpot,
  forgetIgnoredBssids,
  setRadioBssids,
} from './survey.ts'
import {
  applyImport,
  bandOfFrequency,
  meanPowerDbm,
  parseReadings,
  prepareImport,
  type BssidChoice,
  type ReadingRow,
} from './surveyImport.ts'
import { checkStructure } from './validate.ts'

/** A router downstairs on 2.4 and 5 GHz, and an upper floor. */
function plan(): Plan {
  const floor = (id: string, name: string, elevationM: number) => ({
    id,
    name,
    elevationM,
    heightM: 2.5,
    nodes: [],
    walls: [],
    openings: [],
  })
  return {
    schemaVersion: 1,
    name: 'Test',
    floors: [floor('down', 'Ground floor', 0), floor('up', 'Upstairs', 2.8)],
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
    ],
  }
}

const A = 'a4:2b:b0:12:34:56'
const B = 'a4:2b:b0:12:34:57'
const N = 'f0:9f:c2:00:00:01'

const rowsOf = (text: string): ReadingRow[] => {
  const result = parseReadings(text)
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.rows
}

describe('meanPowerDbm (D72)', () => {
  it('averages power in mW, not dBm', () => {
    // −60 and −70 dBm are 1e-6 and 1e-7 mW; their mean, 5.5e-7 mW, is
    // 10·log10(5.5e-7) = −62.596 dBm, not the −65 of a dB mean.
    expect(meanPowerDbm([-60, -70])).toBe(-62.6)
    expect(meanPowerDbm([-55])).toBe(-55)
    expect(meanPowerDbm([-67, -67, -67])).toBe(-67)
    expect(() => meanPowerDbm([])).toThrow()
  })
})

describe('parseReadings (D72)', () => {
  it('reads CSV with any known column names, in any order', () => {
    const rows = rowsOf(
      [
        'Time,SSID,BSSID,RSSI (dBm),Channel,Spot',
        '12:00,Home,A4-2B-B0-12-34-56,−61,6,Spot 1',
        '12:01,"Home, 5G",a4:2b:b0:12:34:57,-58 dBm,36,spot1',
        '',
      ].join('\r\n'),
    )
    expect(rows).toEqual([
      {
        where: 'line 2',
        bssid: A,
        dbm: -61,
        ssid: 'Home',
        band: '2.4GHz',
        spot: 'Spot 1',
      },
      {
        where: 'line 3',
        bssid: B,
        dbm: -58,
        ssid: 'Home, 5G',
        band: '5GHz',
        spot: 'spot1',
      },
    ])
  })

  it('reads semicolon CSV with positions, floors and frequencies', () => {
    const rows = rowsOf(
      'bssid;dbm;frequency;x;y;floor\na42bb0123456;-70;5180;2,5;3;Upstairs\n',
    )
    expect(rows).toEqual([
      {
        where: 'line 2',
        bssid: A,
        dbm: -70,
        band: '5GHz',
        x: 2.5,
        y: 3,
        floor: 'Upstairs',
      },
    ])
  })

  it('reads JSON as a list or under "readings"', () => {
    const list = [{ BSSID: A, rssi: -50, band: '6 GHz', x: 1, y: 2 }]
    expect(rowsOf(JSON.stringify(list))).toEqual([
      { where: 'readings[0]', bssid: A, dbm: -50, band: '6GHz', x: 1, y: 2 },
    ])
    expect(rowsOf(JSON.stringify({ readings: list }))).toHaveLength(1)
  })

  it('says where each bad row is, and imports nothing', () => {
    const result = parseReadings(
      [
        'bssid,dbm,x,y',
        `${A},-60,1,1`,
        'nonsense,-60,1,1',
        `${A},,1,1`,
        `${A},12,1,1`,
        `${A},-60,1,`,
      ].join('\n'),
    )
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          path: 'line 3',
          message: '“nonsense” isn’t a BSSID like a4:2b:b0:12:34:56.',
        },
        { path: 'line 4', message: 'No signal in dBm.' },
        { path: 'line 5', message: 'Signal 12 dBm is outside -120 to 0 dBm.' },
        {
          path: 'line 6',
          message: 'A position needs both x and y, in metres.',
        },
      ],
    })
  })

  it('needs BSSID and dBm columns, and some readings', () => {
    expect(parseReadings('ssid,channel\nHome,6')).toEqual({
      ok: false,
      issues: [
        {
          path: 'line 1',
          message:
            'The first line needs a BSSID column and a dBm (or RSSI) column.',
        },
      ],
    })
    expect(parseReadings('bssid,dbm\n')).toMatchObject({ ok: false })
    expect(parseReadings('{"readings": 3}')).toMatchObject({ ok: false })
    expect(parseReadings('[1,')).toMatchObject({ ok: false })
  })

  it('refuses a row with both a spot and a position', () => {
    expect(
      parseReadings(`bssid,dbm,spot,x,y\n${A},-60,Spot 1,1,1`),
    ).toMatchObject({ ok: false })
  })

  it('knows each band’s frequencies', () => {
    expect(bandOfFrequency(2437)).toBe('2.4GHz')
    expect(bandOfFrequency(5.745)).toBe('5GHz')
    expect(bandOfFrequency(5955)).toBe('6GHz')
    expect(bandOfFrequency(900)).toBeUndefined()
  })
})

describe('prepareImport (D72)', () => {
  it('matches rows to named spots, new positions or the selected spot', () => {
    const p = plan()
    addSurveySpot(p, 'down', { x: 1, y: 1 })
    const rows = rowsOf(
      [
        'bssid,dbm,spot,x,y,floor',
        `${A},-60,Spot 1,,,`,
        `${A},-61,1,,,`,
        `${A},-62,,4,5,upstairs`,
        `${A},-63,,6,7,`,
        `${A},-64,,,,`,
      ].join('\n'),
    )
    const result = prepareImport(p, rows, {
      floorId: 'down',
      selectedSpotId: 'spot1',
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.prepared.rows.map((r) => r.target)).toEqual([
      { spotId: 'spot1' },
      { spotId: 'spot1' },
      { floorId: 'up', x: 4, y: 5 },
      { floorId: 'down', x: 6, y: 7 },
      { spotId: 'spot1' },
    ])
  })

  it('reports unknown spots and floors, and rows with nowhere to go', () => {
    const p = plan()
    const rows = rowsOf(
      [
        'bssid,dbm,spot,x,y,floor',
        `${A},-60,Spot 9,,,`,
        `${A},-60,,1,1,Attic`,
        `${A},-60,,,,`,
      ].join('\n'),
    )
    const result = prepareImport(p, rows, { floorId: 'down' })
    expect(result).toEqual({
      ok: false,
      issues: [
        { path: 'line 2', message: 'No spot “Spot 9”.' },
        { path: 'line 3', message: 'No floor “Attic”.' },
        {
          path: 'line 4',
          message:
            'No spot or position: select a spot first, or add a spot column, or x and y.',
        },
      ],
    })
  })

  it('lists BSSIDs to map, strongest first, leaving out known and ignored ones', () => {
    const p = plan()
    setRadioBssids(p, 'router', '2.4GHz', [A])
    p.ignoredBssids = [N]
    const rows = rowsOf(
      [
        'bssid,dbm,ssid,channel,x,y',
        `${A},-50,Home,6,1,1`,
        `${N},-80,Next door,6,1,1`,
        `${B},-70,Home,36,1,1`,
        `${B},-65,Home-guest,36,2,2`,
        'a4:2b:b0:99:99:99,-75,,,1,1',
      ].join('\n'),
    )
    const result = prepareImport(p, rows, { floorId: 'down' })
    if (!result.ok) throw new Error('expected ok')
    expect(result.prepared.unknown).toEqual([
      {
        bssid: B,
        ssids: ['Home', 'Home-guest'],
        band: '5GHz',
        count: 2,
        strongestDbm: -65,
      },
      { bssid: 'a4:2b:b0:99:99:99', ssids: [], count: 1, strongestDbm: -75 },
    ])
  })
})

describe('applyImport (D72)', () => {
  const choose = (entries: [string, BssidChoice][]) => new Map(entries)

  it('maps BSSIDs, adds spots and averages each radio’s readings per spot', () => {
    const p = plan()
    const rows = rowsOf(
      [
        'bssid,dbm,x,y',
        // Two scans of the 5 GHz radio, and its guest BSSID: one reading.
        `${A},-60,2,3`,
        `${A},-70,2,3`,
        `${B},-65,2,3`,
        // The same radio at another spot.
        `${A},-55,8,3`,
        // A neighbour, marked not mine.
        `${N},-80,2,3`,
      ].join('\n'),
    )
    const result = prepareImport(p, rows, { floorId: 'down' })
    if (!result.ok) throw new Error('expected ok')
    const summary = applyImport(
      p,
      result.prepared,
      choose([
        [A, { apId: 'router', band: '5GHz' }],
        [B, { apId: 'router', band: '5GHz' }],
        [N, 'not-mine'],
      ]),
    )
    expect(summary).toEqual({
      readingsAdded: 2,
      readingsReplaced: 0,
      spotsAdded: 2,
      rowsSkipped: 1,
      bssidsMapped: 2,
    })
    expect(p.accessPoints[0]!.radios[1]!.bssids).toEqual([A, B])
    expect(p.ignoredBssids).toEqual([N])
    // 1e-6, 1e-7 and 10^-6.5 mW: mean 4.721e-7 mW, −63.26 dBm.
    expect(p.floors[0]!.surveySpots).toEqual([
      {
        id: 'spot1',
        x: 2,
        y: 3,
        readings: [{ apId: 'router', band: '5GHz', dbm: -63.3 }],
      },
      {
        id: 'spot2',
        x: 8,
        y: 3,
        readings: [{ apId: 'router', band: '5GHz', dbm: -55 }],
      },
    ])
    expect(checkStructure(p)).toEqual([])
  })

  it('matches on its own the second time, and replaces older readings', () => {
    const p = plan()
    setRadioBssids(p, 'router', '2.4GHz', [A])
    p.ignoredBssids = [N]
    addSurveySpot(p, 'down', { x: 0, y: 0 })
    findSurveySpot(p, 'spot1')!.spot.readings.push({
      apId: 'router',
      band: '2.4GHz',
      dbm: -40,
    })
    const rows = rowsOf(`bssid,dbm\n${A},-52\n${N},-70`)
    const result = prepareImport(p, rows, {
      floorId: 'down',
      selectedSpotId: 'spot1',
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.prepared.unknown).toEqual([])
    const summary = applyImport(p, result.prepared, new Map())
    expect(summary).toMatchObject({
      readingsAdded: 0,
      readingsReplaced: 1,
      rowsSkipped: 1,
    })
    expect(findSurveySpot(p, 'spot1')!.spot.readings).toEqual([
      { apId: 'router', band: '2.4GHz', dbm: -52 },
    ])
  })

  it('adds no spot for a position whose rows are all skipped', () => {
    const p = plan()
    const rows = rowsOf(`bssid,dbm,x,y\n${N},-70,1,1`)
    const result = prepareImport(p, rows, { floorId: 'down' })
    if (!result.ok) throw new Error('expected ok')
    applyImport(p, result.prepared, choose([[N, 'not-mine']]))
    expect(p.floors[0]!.surveySpots).toBeUndefined()
  })
})

describe('BSSIDs marked not mine (D72)', () => {
  it('stop being ignored when typed onto a radio, and can be forgotten', () => {
    const p = plan()
    p.ignoredBssids = [A, N]
    setRadioBssids(p, 'router', '5GHz', [A])
    expect(p.ignoredBssids).toEqual([N])
    expect(forgetIgnoredBssids(p)).toBe(true)
    expect(p).not.toHaveProperty('ignoredBssids')
    expect(forgetIgnoredBssids(p)).toBe(false)
  })

  it('can’t also be on a radio, or listed twice', () => {
    const p = plan()
    p.ignoredBssids = [A, A]
    p.accessPoints[0]!.radios[0]!.bssids = [A]
    expect(checkStructure(p).map((i) => i.message)).toEqual([
      `BSSID ${A} is listed twice.`,
      `BSSID ${A} is on a radio and also marked not mine.`,
    ])
  })
})

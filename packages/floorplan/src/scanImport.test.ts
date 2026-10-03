import iwText from '../fixtures/scans/iw-handmade.txt?raw'
import netshDeText from '../fixtures/scans/netsh-handmade-de.txt?raw'
import netshText from '../fixtures/scans/netsh-handmade.txt?raw'
import nmcliText from '../fixtures/scans/nmcli-handmade.txt?raw'
import signalplanText from '../fixtures/scans/signalplan-scan-example.json?raw'
import systemProfilerText from '../fixtures/scans/system-profiler-handmade.json?raw'
import analyzerText from '../fixtures/scans/wifi-analyzer-handmade.csv?raw'
import { describe, expect, it } from 'vitest'
import {
  channelOfFrequency,
  groupScanDevices,
  netshPercentToDbm,
  nmcliPercentToDbm,
  parseScan,
  type ScanEntry,
  type ScanResult,
} from './scanImport.ts'

/**
 * The samples are written by hand until real captures come in (#141); see
 * fixtures/scans/README.md.
 */
const SAMPLES: Record<string, string> = {
  'iw-handmade.txt': iwText,
  'netsh-handmade-de.txt': netshDeText,
  'netsh-handmade.txt': netshText,
  'nmcli-handmade.txt': nmcliText,
  'signalplan-scan-example.json': signalplanText,
  'system-profiler-handmade.json': systemProfilerText,
  'wifi-analyzer-handmade.csv': analyzerText,
}
const sample = (name: string) => SAMPLES[name]!

function entries(result: ScanResult): ScanEntry[] {
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.entries
}

/** The three BSSIDs every sample has: two of the home's, one next door. */
const HOME_5 = 'a4:2b:b0:12:34:56'
const HOME_24 = 'a4:2b:b0:12:34:55'
const NEXT_DOOR = '10:20:30:40:50:60'

describe('percentages to dBm', () => {
  it('follows Windows: 0 % is −100 dBm, 100 % is −50 dBm, linear', () => {
    expect(netshPercentToDbm(0)).toBe(-100)
    expect(netshPercentToDbm(50)).toBe(-75)
    expect(netshPercentToDbm(86)).toBe(-57)
    expect(netshPercentToDbm(100)).toBe(-50)
    expect(netshPercentToDbm(120)).toBe(-50)
  })

  it('inverts NetworkManager’s truncated mapping to the middle of each step', () => {
    // NetworkManager: q = 100 − trunc(100 · (−40 − dBm) / 60), clamped.
    const quality = (dbm: number) =>
      Math.min(
        100,
        Math.max(
          0,
          100 -
            Math.trunc(
              (100 * Math.abs(Math.min(-40, Math.max(-100, dbm)) + 40)) / 60,
            ),
        ),
      )
    for (let q = 1; q <= 99; q++) {
      expect(quality(nmcliPercentToDbm(q))).toBe(q)
    }
    expect(nmcliPercentToDbm(0)).toBe(-100)
    expect(nmcliPercentToDbm(100)).toBe(-40)
    expect(nmcliPercentToDbm(86)).toBe(-48.7)
  })
})

describe('channelOfFrequency', () => {
  it('gives the channel on each band', () => {
    expect(channelOfFrequency(2412)).toBe(1)
    expect(channelOfFrequency(2484)).toBe(14)
    expect(channelOfFrequency(5180)).toBe(36)
    expect(channelOfFrequency(5745)).toBe(149)
    expect(channelOfFrequency(5935)).toBe(2)
    expect(channelOfFrequency(5955)).toBe(1)
    expect(channelOfFrequency(6115)).toBe(33)
    expect(channelOfFrequency(5181)).toBeUndefined()
  })
})

describe('parseScan', () => {
  it('reads netsh by its layout, signal as an approximate percentage', () => {
    const result = parseScan(sample('netsh-handmade.txt'))
    expect(result.ok && result.format).toBe('netsh')
    expect(entries(result)).toEqual([
      {
        where: 'line 9',
        bssid: HOME_5,
        ssid: 'HomeNet',
        band: '5GHz',
        channel: 36,
        dbm: -57,
        approximate: true,
      },
      {
        where: 'line 20',
        bssid: HOME_24,
        ssid: 'HomeNet',
        band: '2.4GHz',
        channel: 6,
        dbm: -50,
        approximate: true,
      },
      {
        where: 'line 32',
        bssid: NEXT_DOOR,
        ssid: 'Next door',
        // No band line (Windows 10): from the channel.
        band: '5GHz',
        channel: 149,
        dbm: -85,
        approximate: true,
      },
    ])
  })

  it('reads netsh in another language the same way', () => {
    const result = parseScan(sample('netsh-handmade-de.txt'))
    expect(result.ok && result.format).toBe('netsh')
    expect(entries(result)).toEqual([
      {
        where: 'line 9',
        bssid: HOME_5,
        ssid: 'HomeNet',
        band: '5GHz',
        channel: 36,
        dbm: -57,
        approximate: true,
      },
    ])
  })

  it('reads terse nmcli, unescaping colons', () => {
    const result = parseScan(sample('nmcli-handmade.txt'))
    expect(result.ok && result.format).toBe('nmcli')
    const [home5, home24, next] = entries(result)
    expect(home5).toEqual({
      where: 'line 1',
      bssid: HOME_5,
      ssid: 'HomeNet',
      band: '5GHz',
      channel: 36,
      dbm: -48.7,
      approximate: true,
    })
    expect(home24!.dbm).toBe(-40)
    expect(next!.ssid).toBe('Next: door')
    expect(next!.channel).toBe(149)
  })

  it('reads nmcli’s optional bandwidth', () => {
    const result = parseScan(
      'A4\\:2B\\:B0\\:12\\:34\\:56:HomeNet:36:5180 MHz:86:80 MHz\n',
    )
    expect(entries(result)[0]!.widthMHz).toBe(80)
  })

  it('reads iw in dBm, with the width from the VHT or HT operation', () => {
    const result = parseScan(sample('iw-handmade.txt'))
    expect(result.ok && result.format).toBe('iw')
    expect(entries(result)).toEqual([
      {
        where: 'line 1',
        bssid: HOME_5,
        ssid: 'HomeNet',
        band: '5GHz',
        channel: 36,
        widthMHz: 80,
        dbm: -56,
        approximate: false,
      },
      {
        where: 'line 17',
        bssid: HOME_24,
        ssid: 'HomeNet',
        band: '2.4GHz',
        channel: 6,
        widthMHz: 20,
        dbm: -41,
        approximate: false,
      },
      {
        where: 'line 26',
        bssid: NEXT_DOOR,
        ssid: 'Next door',
        band: '5GHz',
        channel: 149,
        widthMHz: 40,
        dbm: -84,
        approximate: false,
      },
    ])
    // 60 GHz isn't modelled: skipped, not an error.
    expect(result.ok && result.skipped).toEqual([
      {
        where: 'line 36',
        reason:
          'BSSID 02:aa:bb:cc:dd:ee is on no Wi-Fi band SignalPlan models.',
      },
    ])
  })

  it('reads WiFi Analyzer’s export', () => {
    const result = parseScan(sample('wifi-analyzer-handmade.csv'))
    expect(result.ok && result.format).toBe('wifi-analyzer')
    expect(
      entries(result).map((e) => [
        e.bssid,
        e.band,
        e.channel,
        e.widthMHz,
        e.dbm,
      ]),
    ).toEqual([
      [HOME_5, '5GHz', 36, 80, -56],
      [HOME_24, '2.4GHz', 6, 20, -41],
      [NEXT_DOOR, '5GHz', 149, 40, -84],
    ])
  })

  it('reads system_profiler, skipping networks macOS hid the BSSID of', () => {
    const result = parseScan(sample('system-profiler-handmade.json'))
    expect(result.ok && result.format).toBe('system-profiler')
    expect(
      entries(result).map((e) => [
        e.bssid,
        e.band,
        e.channel,
        e.widthMHz,
        e.dbm,
      ]),
    ).toEqual([
      [HOME_5, '5GHz', 36, 80, -56],
      [HOME_24, '2.4GHz', 6, 20, -41],
    ])
    expect(result.ok && result.skipped).toHaveLength(1)
    expect(result.ok && result.skipped[0]!.reason).toMatch(
      /“Next door” has no BSSID/,
    )
  })

  it('reads SignalPlan’s own scan format', () => {
    const result = parseScan(sample('signalplan-scan-example.json'))
    expect(result.ok && result.format).toBe('signalplan')
    expect(entries(result)[2]).toEqual({
      where: 'networks[2]',
      bssid: NEXT_DOOR,
      ssid: 'Next door',
      band: '5GHz',
      channel: 149,
      widthMHz: 40,
      dbm: -84,
      approximate: false,
    })
  })

  it('takes a channel and band in its own format, as the Mac script writes (D81)', () => {
    const result = parseScan(
      JSON.stringify({
        signalplanScan: 1,
        source: 'macos-corewlan',
        networks: [
          {
            bssid: HOME_5,
            ssid: 'HomeNet',
            channel: 36,
            band: '5',
            widthMHz: 80,
            dbm: -56,
          },
          { bssid: HOME_24, channel: 6, band: '2.4', widthMHz: 20, dbm: -41 },
          { bssid: NEXT_DOOR, channel: 5, band: '6', widthMHz: 160, dbm: -80 },
        ],
      }),
    )
    expect(entries(result).map((e) => [e.band, e.channel, e.widthMHz])).toEqual(
      [
        ['5GHz', 36, 80],
        ['2.4GHz', 6, 20],
        ['6GHz', 5, 160],
      ],
    )
  })

  it('refuses a later version of its own format', () => {
    const result = parseScan('{ "signalplanScan": 2, "networks": [] }')
    expect(result.ok).toBe(false)
  })

  it('names the line of a bad entry', () => {
    const result = parseScan(
      'A4\\:2B\\:B0\\:12\\:34\\:56:HomeNet:36:5180 MHz:86\nnot a line\n',
    )
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          path: 'line 2',
          message:
            'Expected BSSID:SSID:CHAN:FREQ:SIGNAL, as nmcli -t -f BSSID,SSID,CHAN,FREQ,SIGNAL gives.',
        },
      ],
    })
  })

  it('names a BSSID with no signal', () => {
    const text = sample('netsh-handmade-de.txt').replace(/Signal.*\n/, '')
    const result = parseScan(text)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues[0]).toEqual({
      path: 'line 9',
      message: `No signal for BSSID ${HOME_5}.`,
    })
  })

  it('says when text isn’t a scan it knows', () => {
    expect(parseScan('hello').ok).toBe(false)
    expect(parseScan('{ "readings": [] }').ok).toBe(false)
  })

  it('merges sightings of one BSSID as mean power', () => {
    const result = parseScan(
      [
        'A4\\:2B\\:B0\\:12\\:34\\:56:HomeNet:36:5180 MHz:50',
        'A4\\:2B\\:B0\\:12\\:34\\:56:HomeNet:36:5180 MHz:84',
      ].join('\n'),
    )
    // −70.3 and −49.9 dBm: their mean power, not the mean of the dBm.
    expect(entries(result)).toHaveLength(1)
    expect(entries(result)[0]!.dbm).toBe(-52.9)
  })
})

describe('groupScanDevices', () => {
  it('groups BSSIDs differing in the last octet or the local bit, strongest first', () => {
    const entry = (bssid: string, dbm: number, ssid?: string): ScanEntry => ({
      where: '',
      bssid,
      band: '5GHz',
      dbm,
      approximate: false,
      ...(ssid === undefined ? {} : { ssid }),
    })
    const devices = groupScanDevices([
      entry('a4:2b:b0:12:34:56', -60, 'HomeNet'),
      entry('a6:2b:b0:12:34:57', -58, 'HomeNet-Guest'),
      entry('a4:2b:b0:12:34:55', -45, 'HomeNet'),
      entry('a4:2b:b0:12:99:55', -50, 'HomeNet'),
      entry('10:20:30:40:50:60', -80),
    ])
    expect(devices.map((d) => d.entries.map((e) => e.bssid))).toEqual([
      ['a4:2b:b0:12:34:55', 'a6:2b:b0:12:34:57', 'a4:2b:b0:12:34:56'],
      ['a4:2b:b0:12:99:55'],
      ['10:20:30:40:50:60'],
    ])
    expect(devices[0]!.ssids).toEqual(['HomeNet', 'HomeNet-Guest'])
    expect(devices[2]!.ssids).toEqual([])
  })
})

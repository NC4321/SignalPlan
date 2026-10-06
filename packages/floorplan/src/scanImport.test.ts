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

describe('parseScan on output seen in the wild', () => {
  const T = '\t'
  const iwBss = (
    mac: string,
    freq: number,
    signal: string | undefined,
    rest: string[] = [],
  ) =>
    [
      `BSS ${mac}(on wlp2s0)`,
      `${T}last seen: 412.304s [boottime]`,
      `${T}TSF: 98765432 usec (0d, 00:01:38)`,
      `${T}freq: ${freq}.0`,
      `${T}beacon interval: 100 TUs`,
      `${T}capability: ESS Privacy SpectrumMgmt (0x1111)`,
      ...(signal === undefined ? [] : [`${T}signal: ${signal} dBm`]),
      `${T}last seen: 24 ms ago`,
      `${T}SSID: HomeNet`,
      ...rest,
    ].join('\n')

  it('reads iw’s 160 MHz as 802.11-2020 signals it: width 1 with a second segment', () => {
    const text = iwBss(HOME_5, 5180, '-52.00', [
      `${T}HT operation:`,
      `${T}${T} * primary channel: 36`,
      `${T}${T} * secondary channel offset: above`,
      `${T}${T} * STA channel width: any`,
      `${T}VHT operation:`,
      `${T}${T} * channel width: 1 (80 MHz)`,
      `${T}${T} * center freq segment 1: 42`,
      `${T}${T} * center freq segment 2: 50`,
      `${T}${T} * VHT basic MCS set: 0xfffc`,
    ])
    expect(entries(parseScan(text))[0]).toMatchObject({
      channel: 36,
      widthMHz: 160,
    })
  })

  it('reads a 6 GHz width from iw’s HE operation', () => {
    const he = (width: string) =>
      iwBss(HOME_5, 6135, '-60.00', [
        `${T}HE Operation:`,
        `${T}${T} * HE Operation Parameters: (0x023ff0)`,
        `${T}${T}${T} * 6 GHz Operation Information Present`,
        `${T}${T} * 6 GHz Operation Information`,
        `${T}${T}${T} * Primary Channel: 37`,
        `${T}${T}${T} * Channel Width: ${width}`,
        `${T}${T}${T} * Center Frequency Segment 0: 39`,
        `${T}${T}${T} * Minimum Rate: 6`,
      ])
    expect(entries(parseScan(he('80 MHz')))[0]).toMatchObject({
      band: '6GHz',
      channel: 37,
      widthMHz: 80,
    })
    expect(entries(parseScan(he('80+80 or 160 MHz')))[0]!.widthMHz).toBe(160)
  })

  it('skips an iw BSS without a signal line and keeps the rest', () => {
    const text = [
      iwBss(HOME_5, 5180, '-52.00'),
      iwBss(NEXT_DOOR, 2437, undefined),
    ].join('\n')
    const result = parseScan(text)
    expect(entries(result).map((e) => e.bssid)).toEqual([HOME_5])
    expect(result.ok && result.skipped).toEqual([
      {
        where: 'line 10',
        reason: `BSSID ${NEXT_DOOR} has no signal line in iw’s output.`,
      },
    ])
  })

  it('reads netsh with the percent sign first, as Turkish Windows writes it', () => {
    const text = [
      '',
      'Arabirim adı : Wi-Fi',
      'Şu anda 1 ağ görünür.',
      '',
      'SSID 1 : HomeNet',
      '    Ağ türü                 : Altyapı',
      '    Kimlik doğrulama        : WPA2-Kişisel',
      '    Şifreleme               : CCMP',
      '    BSSID 1                 : a4:2b:b0:12:34:56',
      '         Sinyal             : %86',
      '         Radyo türü         : 802.11ac',
      '         Kanal              : 36',
      '',
    ].join('\r\n')
    const result = parseScan(text)
    expect(result.ok && result.format).toBe('netsh')
    expect(entries(result)[0]).toMatchObject({
      bssid: HOME_5,
      ssid: 'HomeNet',
      band: '5GHz',
      channel: 36,
      dbm: -57,
      approximate: true,
    })
  })

  it('says it isn’t a scan for deeply nested JSON, rather than throwing', () => {
    const deep = '['.repeat(100_000) + ']'.repeat(100_000)
    expect(() => parseScan(deep)).not.toThrow()
    expect(parseScan(deep).ok).toBe(false)
    const deepObject =
      '{"a":'.repeat(50_000) + '{"SPAirPortDataType":[]}' + '}'.repeat(50_000)
    expect(() => parseScan(deepObject)).not.toThrow()
    expect(parseScan(deepObject).ok).toBe(false)
  })

  it('refuses nmcli fields in another order, naming the order it needs', () => {
    // -f BSSID,SSID,FREQ,CHAN,SIGNAL
    const swapped = parseScan(
      [
        'A4\\:2B\\:B0\\:12\\:34\\:56:HomeNet:5180 MHz:36:86',
        'A4\\:2B\\:B0\\:12\\:34\\:55:HomeNet:2437 MHz:6:97',
      ].join('\n'),
    )
    expect(swapped.ok).toBe(false)
    expect(!swapped.ok && swapped.issues).toHaveLength(2)
    expect(!swapped.ok && swapped.issues[0]).toEqual({
      path: 'line 1',
      message:
        'CHAN “5180 MHz” isn’t a channel number, so the fields may be in another order. Expected BSSID:SSID:CHAN:FREQ:SIGNAL, as nmcli -t -f BSSID,SSID,CHAN,FREQ,SIGNAL gives.',
    })
    // -f BSSID,CHAN,SSID,FREQ,SIGNAL would otherwise name the network “36”.
    const chanFirst = parseScan(
      'A4\\:2B\\:B0\\:12\\:34\\:56:36:HomeNet:5180 MHz:86',
    )
    expect(!chanFirst.ok && chanFirst.issues[0]!.message).toMatch(
      /^CHAN “HomeNet” isn’t a channel number.*BSSID:SSID:CHAN:FREQ:SIGNAL/,
    )
    // -f BSSID,SSID,CHAN,SIGNAL,FREQ
    const signalFirst = parseScan(
      'A4\\:2B\\:B0\\:12\\:34\\:56:HomeNet:36:86:5180 MHz',
    )
    expect(!signalFirst.ok && signalFirst.issues[0]!.message).toMatch(
      /^FREQ “86” isn’t a frequency like 5180 MHz/,
    )
    const tooStrong = parseScan(
      'A4\\:2B\\:B0\\:12\\:34\\:56:HomeNet:36:5180 MHz:186',
    )
    expect(!tooStrong.ok && tooStrong.issues[0]!.message).toMatch(
      /^SIGNAL “186” isn’t a percentage from 0 to 100/,
    )
    // A hidden network's empty SSID is still fine.
    expect(
      entries(parseScan('A4\\:2B\\:B0\\:12\\:34\\:56::36:5180 MHz:86'))[0],
    ).toMatchObject({ bssid: HOME_5, channel: 36 })
  })

  it('reads WiFi Analyzer re-saved as CSV, with the delimiter in quoted SSIDs', () => {
    const tail = (bssid: string, rest: string) => `${bssid},${rest}`
    const text = [
      'Time Stamp,SSID,BSSID,Strength,Primary Channel,Primary Frequency,Center Channel,Center Frequency,Width (Range),Distance,802.11mc,Security',
      `2026/10/03 12:00:00,"Home,-40",${tail(HOME_5, '-56dBm,36,5180MHz,42,5210MHz,80MHz (5170 - 5250),~3.1m,false,[WPA2-PSK-CCMP]')}`,
      `2026/10/03 12:00:00,"Home,2437",${tail(HOME_24, '-41dBm,6,2437MHz,6,2437MHz,20MHz (2427 - 2447),~1.0m,false,[WPA2-PSK-CCMP]')}`,
      `2026/10/03 12:00:00,"Flat 2, 5G",${tail(NEXT_DOOR, '-84dBm,149,5745MHz,151,5755MHz,40MHz (5735 - 5775),~40m,false,[WPA2-PSK-CCMP]')}`,
      `2026/10/03 12:00:00,"Say ""hi""",${tail('10:20:30:40:50:61', '-80dBm,149,5745MHz,151,5755MHz,40MHz (5735 - 5775),~40m,false,[WPA2-PSK-CCMP]')}`,
    ].join('\r\n')
    const result = parseScan(text)
    expect(result.ok && result.format).toBe('wifi-analyzer')
    expect(
      entries(result).map((e) => [
        e.where,
        e.ssid,
        e.bssid,
        e.band,
        e.channel,
        e.widthMHz,
        e.dbm,
      ]),
    ).toEqual([
      ['line 2', 'Home,-40', HOME_5, '5GHz', 36, 80, -56],
      ['line 3', 'Home,2437', HOME_24, '2.4GHz', 6, 20, -41],
      ['line 4', 'Flat 2, 5G', NEXT_DOOR, '5GHz', 149, 40, -84],
      ['line 5', 'Say "hi"', '10:20:30:40:50:61', '5GHz', 149, 40, -80],
    ])
  })
})

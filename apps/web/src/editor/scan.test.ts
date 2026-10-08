import { describe, expect, it } from 'vitest'
import {
  guessPlatform,
  MAC_SCRIPT_PASTE,
  SCAN_PLATFORMS,
  scanSummaryText,
  scanTuning,
} from './scan.ts'

describe('guessPlatform', () => {
  it('reads the platform from the user agent', () => {
    expect(
      guessPlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36',
      ),
    ).toBe('windows')
    expect(
      guessPlatform(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
      ),
    ).toBe('mac')
    expect(
      guessPlatform('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Firefox/131.0'),
    ).toBe('linux')
    expect(
      guessPlatform(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36',
      ),
    ).toBe('android')
    expect(
      guessPlatform(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      ),
    ).toBe('iphone')
    expect(guessPlatform('')).toBe('windows')
  })
})

describe('scanTuning', () => {
  it('uses the plan’s region for widths and channel numbers', () => {
    const tuning = scanTuning({ region: 'US' } as never)
    expect(tuning.usualWidth('5GHz')).toBe(80)
    expect(tuning.channelAt('5GHz', 149, 80)).toBe(155)
  })
})

describe('scanSummaryText', () => {
  it('says what the import did', () => {
    expect(
      scanSummaryText({
        bssidsMapped: 3,
        radiosTuned: 1,
        neighboursAdded: 2,
        neighboursUpdated: 1,
        bssidsIgnored: 1,
      }),
    ).toBe(
      'Scan imported: matched 3 BSSIDs to radios, set 1 radio’s channel, added 2 neighbours’ networks, updated 1, ignored 1 BSSID.',
    )
    expect(
      scanSummaryText({
        bssidsMapped: 0,
        radiosTuned: 0,
        neighboursAdded: 0,
        neighboursUpdated: 0,
        bssidsIgnored: 0,
      }),
    ).toBe('Scan imported: nothing new.')
  })

  it('says what it did at a spot first (D82)', () => {
    expect(
      scanSummaryText(
        {
          bssidsMapped: 0,
          radiosTuned: 0,
          neighboursAdded: 1,
          neighboursUpdated: 0,
          bssidsIgnored: 0,
        },
        {
          spotId: 'spot3',
          spotAdded: true,
          readingsAdded: 2,
          readingsAveraged: 1,
          neighboursHeard: 1,
        },
      ),
    ).toBe(
      'Scan imported: added Spot 3, 2 readings at Spot 3, 1 reading averaged with earlier scans, added 1 neighbour’s network.',
    )
  })

  it('names new access points first and says to drag them (D105)', () => {
    const summary = {
      bssidsMapped: 3,
      radiosTuned: 0,
      neighboursAdded: 0,
      neighboursUpdated: 0,
      bssidsIgnored: 0,
    }
    expect(scanSummaryText(summary, undefined, ['HomeNet'])).toBe(
      'Scan imported: added HomeNet, matched 3 BSSIDs to radios. Drag it to where it is.',
    )
    expect(
      scanSummaryText(summary, undefined, ['HomeNet', 'HomeNet 2', 'Attic']),
    ).toBe(
      'Scan imported: added HomeNet, HomeNet 2 and Attic, matched 3 BSSIDs to radios. Drag them to where they are.',
    )
  })
})

describe('scan scripts (D81)', () => {
  it('writes SignalPlan’s scan format and copies it', () => {
    const windows = SCAN_PLATFORMS.windows.script!.text
    expect(windows).toContain('\\"signalplanScan\\":1')
    expect(windows).toContain('Set-Clipboard')
    // Pasting it twice in one PowerShell session mustn't redefine the type.
    expect(windows).toContain("if (-not ('SignalPlanScan' -as [type]))")
    expect(MAC_SCRIPT_PASTE).toContain('"signalplanScan": 1')
    expect(MAC_SCRIPT_PASTE).toMatch(
      /\nSIGNALPLAN\nswift \/tmp\/signalplan-scan.swift \| pbcopy/,
    )
  })
})

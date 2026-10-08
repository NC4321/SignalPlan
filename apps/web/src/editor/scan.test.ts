import type { Plan, ScanDevice, ScanEntry } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  answeredDevices,
  answerFor,
  choicesOf,
  guessPlatform,
  hasBlankAnswers,
  MAC_SCRIPT_PASTE,
  NO_ANSWERS,
  SCAN_PLATFORMS,
  scanSummaryText,
  scanTuning,
  whoseOf,
  type Answers,
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

describe('answers in Which networks are yours? (D106)', () => {
  const entry = (bssid: string): ScanEntry => ({
    where: '',
    bssid,
    band: '5GHz',
    dbm: -50,
    approximate: false,
  })
  const ROUTER: ScanDevice = {
    entries: [entry('a4:00:00:00:00:01'), entry('a6:00:00:00:00:01')],
    ssids: ['Home', 'Home-Guest'],
  }
  const NEXT: ScanDevice = {
    entries: [entry('10:00:00:00:00:01')],
    ssids: ['Next door'],
  }
  const devices = [ROUTER, NEXT]
  const withAps = { accessPoints: [{ id: 'router' }] } as unknown as Plan
  const empty = { accessPoints: [] } as unknown as Plan

  it('shows which button an answer chose', () => {
    expect(whoseOf(undefined)).toBeUndefined()
    expect(whoseOf('')).toBeUndefined()
    expect(whoseOf('mine')).toBe('mine')
    expect(whoseOf('ap:router')).toBe('mine')
    expect(whoseOf('new')).toBe('mine')
    expect(whoseOf('neighbour')).toBe('neighbour')
    expect(whoseOf('ignore')).toBe('ignore')
  })

  it('answers Mine with a new access point only when the plan has none', () => {
    expect(answerFor('mine', withAps)).toBe('mine')
    expect(answerFor('mine', empty)).toBe('new')
    expect(answerFor('neighbour', withAps)).toBe('neighbour')
    expect(answerFor('ignore', empty)).toBe('ignore')
  })

  it('counts a device answered once every network has a choice', () => {
    const answers: Answers = {
      ...NO_ANSWERS,
      // Mine with no access point chosen yet isn't a choice.
      byDevice: { 'a4:00:00:00:00:01': 'mine', '10:00:00:00:00:01': 'ignore' },
    }
    expect(answeredDevices(devices, choicesOf(devices, answers))).toBe(1)
    const chosen = {
      ...answers,
      byDevice: { ...answers.byDevice, 'a4:00:00:00:00:01': 'ap:router' },
    }
    expect(answeredDevices(devices, choicesOf(devices, chosen))).toBe(2)
    // Split, the router counts only when both its networks are answered.
    const split: Answers = {
      ...chosen,
      split: ['a4:00:00:00:00:01'],
      byBssid: { 'a4:00:00:00:00:01': 'ap:router', 'a6:00:00:00:00:01': '' },
    }
    expect(answeredDevices(devices, choicesOf(devices, split))).toBe(1)
  })

  it('leaves Mine alone when marking the rest a neighbour’s', () => {
    expect(hasBlankAnswers(devices, NO_ANSWERS)).toBe(true)
    const mineOnly: Answers = {
      ...NO_ANSWERS,
      byDevice: { 'a4:00:00:00:00:01': 'mine', '10:00:00:00:00:01': 'ignore' },
    }
    expect(hasBlankAnswers(devices, mineOnly)).toBe(false)
    const splitBlank: Answers = {
      ...mineOnly,
      split: ['a4:00:00:00:00:01'],
      byBssid: { 'a4:00:00:00:00:01': 'ap:router', 'a6:00:00:00:00:01': '' },
    }
    expect(hasBlankAnswers(devices, splitBlank)).toBe(true)
  })
})

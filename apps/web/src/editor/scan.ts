import { channelAtWidth, radioTuning } from '@signalplan/engine'
import {
  radioKey,
  type Plan,
  type ScanChanges,
  type ScanSummary,
  type ScanTuning,
} from '@signalplan/floorplan'

/**
 * Scan your network (D77, D80): the command for each platform, the plan's
 * channel rules for applying a scan, and what an import did.
 */

export type ScanPlatform = 'windows' | 'mac' | 'linux' | 'android' | 'iphone'

export interface PlatformHelp {
  name: string
  /** The command to copy, when the platform has one. */
  command?: string
  /** A second command that gives more, with when to use it. */
  alternative?: { label: string; command: string }
  /** What to do, in order. */
  steps: string[]
  /** What the scan won't tell, or what to check. */
  note?: string
}

export const SCAN_PLATFORMS: Record<ScanPlatform, PlatformHelp> = {
  windows: {
    name: 'Windows',
    command: 'netsh wlan show networks mode=bssid',
    steps: [
      'On Windows 11, turn on Location in Settings › Privacy & security › Location, or the command lists no networks.',
      'Open Terminal or PowerShell (right-click the Start button), paste the command and press Enter.',
      'Copy everything it prints and paste it below.',
    ],
    note: 'Windows shows signal as a percentage, so readings are approximate (≈), and it doesn’t say channel widths.',
  },
  mac: {
    name: 'macOS',
    command: 'system_profiler SPAirPortDataType -json',
    steps: [
      'Open Terminal (Applications › Utilities), paste the command and press Enter. It takes a few seconds.',
      'Copy everything it prints and paste it below.',
    ],
    note: 'macOS hides each network’s BSSID unless the app running the command has Location permission, and networks without one are skipped. This hasn’t been checked on a real Mac yet.',
  },
  linux: {
    name: 'Linux',
    command:
      'nmcli -t -f BSSID,SSID,CHAN,FREQ,SIGNAL dev wifi list --rescan yes',
    alternative: {
      label:
        'For signal in dBm and channel widths, if you can use sudo (replace wlan0 with your Wi-Fi interface, from iw dev):',
      command: 'sudo iw dev wlan0 scan',
    },
    steps: [
      'Open a terminal, paste the command and press Enter.',
      'Copy everything it prints and paste it below.',
    ],
    note: 'nmcli shows signal as a percentage, so readings are approximate (≈), and it doesn’t say channel widths.',
  },
  android: {
    name: 'Android',
    steps: [
      'Install WiFi Analyzer (open source, from F-Droid or Google Play).',
      'Let it scan for a few seconds, then choose Export from its menu and save the file.',
      'Open the file below, or paste what’s in it.',
    ],
  },
  iphone: {
    name: 'iPhone or iPad',
    steps: [
      'iPhone and iPad apps can’t export a scan. Type readings in with the Survey tool instead: AirPort Utility’s Wi-Fi Scanner shows each network’s signal once it’s turned on in Settings › AirPort Utility.',
    ],
  },
}

/** The platform a browser is most likely on, from its user agent. */
export function guessPlatform(userAgent: string): ScanPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iphone'
  if (/Android/.test(userAgent)) return 'android'
  if (/Windows/.test(userAgent)) return 'windows'
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'mac'
  if (/Linux|X11|CrOS/.test(userAgent)) return 'linux'
  return 'windows'
}

/** The plan's channel rules, from the engine, for `planScan`. */
export function scanTuning(plan: Plan): ScanTuning {
  return {
    usualWidth: (band) => radioTuning({ band }, plan.region).widthMHz,
    channelAt: (band, primary, width) =>
      channelAtWidth(plan.region, band, primary, width),
  }
}

/** Whether applying would change a radio's width or channel. */
export function tunesRadios(
  changes: ScanChanges,
  overwrite: ReadonlySet<string>,
): boolean {
  return changes.radios.some(
    (r) =>
      r.widthMHz !== undefined &&
      (!r.alreadySet || overwrite.has(radioKey(r.apId, r.band))),
  )
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

/** What applying a scan did, for the status bar. */
export function scanSummaryText(summary: ScanSummary): string {
  const {
    bssidsMapped,
    radiosTuned,
    neighboursAdded,
    neighboursUpdated,
    bssidsIgnored,
  } = summary
  const parts = [
    bssidsMapped > 0 && `matched ${plural(bssidsMapped, 'BSSID')} to radios`,
    radiosTuned > 0 &&
      `set ${plural(radiosTuned, 'radio’s', 'radios’')} channel`,
    neighboursAdded > 0 &&
      `added ${plural(neighboursAdded, 'neighbour’s network', 'neighbours’ networks')}`,
    neighboursUpdated > 0 && `updated ${neighboursUpdated}`,
    bssidsIgnored > 0 && `ignored ${plural(bssidsIgnored, 'BSSID')}`,
  ].filter((p): p is string => typeof p === 'string')
  if (parts.length === 0) return 'Scan imported: nothing new.'
  return `Scan imported: ${parts.join(', ')}.`
}

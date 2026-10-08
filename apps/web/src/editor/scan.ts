import { channelAtWidth, radioTuning } from '@signalplan/engine'
import windowsScript from './scanScripts/signalplan-scan.ps1?raw'
import macScript from './scanScripts/signalplan-scan.swift?raw'
import {
  radioKey,
  surveySpotName,
  type Plan,
  type ScanChanges,
  type ScanChoice,
  type ScanDevice,
  type ScanSummary,
  type ScanTuning,
  type SpotScanSummary,
} from '@signalplan/floorplan'

/**
 * Scan your network (D77, D80): the command for each platform, the plan's
 * channel rules for applying a scan, and what an import did.
 */

export type ScanPlatform = 'windows' | 'mac' | 'linux' | 'android' | 'iphone'

/**
 * The Mac script as one paste for Terminal: it's saved to a temporary file,
 * run with `swift`, and its output copied (D81).
 */
export const MAC_SCRIPT_PASTE = `cat > /tmp/signalplan-scan.swift <<'SIGNALPLAN'
${macScript.trimEnd()}
SIGNALPLAN
swift /tmp/signalplan-scan.swift | pbcopy && echo "Copied the scan. Paste it into SignalPlan."
`

export interface PlatformHelp {
  name: string
  /**
   * SignalPlan's own scan script (D81), which gives signal in dBm and
   * channel widths, to copy and paste whole.
   */
  script?: { text: string; note: string }
  /** The command to copy, when the platform has one. */
  command?: string
  /** What to call the command when there's also a script. */
  commandLabel?: string
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
    script: {
      text: windowsScript,
      note: 'The script asks Windows’ Wi-Fi service directly, for signal in dBm and channel widths, and sends nothing anywhere. It’s new and hasn’t been run on a real PC yet: if it fails, use the built-in command below.',
    },
    command: 'netsh wlan show networks mode=bssid',
    commandLabel:
      'Or Windows’ built-in command (signal as a percentage, so approximate, and no widths): paste it the same way, then copy everything it prints.',
    steps: [
      'Turn on Location in Settings › Privacy & security › Location, with Let desktop apps access your location, or Windows lists no networks.',
      'Open PowerShell or Terminal (right-click the Start button), paste the script and press Enter. After about 5 seconds it copies the scan.',
      'Paste it below.',
    ],
  },
  mac: {
    name: 'macOS',
    script: {
      text: MAC_SCRIPT_PASTE,
      note: 'The script asks macOS’s Wi-Fi framework directly, for signal in dBm and channel widths, and sends nothing anywhere. It needs the command-line developer tools (macOS offers to install them the first time) and Location allowed for Terminal, or macOS hides BSSIDs. It’s new and hasn’t been run on a real Mac yet: if it fails, use the built-in command below.',
    },
    command: 'system_profiler SPAirPortDataType -json',
    commandLabel:
      'Or macOS’s built-in command (networks whose BSSID macOS hides are skipped): paste it the same way, then copy everything it prints.',
    steps: [
      'Open Terminal (Applications › Utilities), paste the script and press Enter. After a few seconds it copies the scan.',
      'Paste it below.',
    ],
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

/** What applying a scan did, for the status bar, with what it did at a spot (D82). */
export function scanSummaryText(
  summary: ScanSummary,
  atSpot?: SpotScanSummary,
  added: readonly string[] = [],
): string {
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
  if (atSpot) {
    const name = surveySpotName(atSpot.spotId)
    const { readingsAdded, readingsAveraged } = atSpot
    parts.unshift(
      ...[
        atSpot.spotAdded && `added ${name}`,
        readingsAdded > 0 && `${plural(readingsAdded, 'reading')} at ${name}`,
        readingsAveraged > 0 &&
          `${plural(readingsAveraged, 'reading')} averaged with earlier scans`,
      ].filter((p): p is string => typeof p === 'string'),
    )
  }
  // New access points (D105) come first, with where to drag them.
  if (added.length > 0) parts.unshift(`added ${listOf(added)}`)
  if (parts.length === 0) return 'Scan imported: nothing new.'
  const text = `Scan imported: ${parts.join(', ')}.`
  if (added.length === 0) return text
  return added.length === 1
    ? `${text} Drag it to where it is.`
    : `${text} Drag them to where they are.`
}

/** "A", "A and B", "A, B and C". */
function listOf(names: readonly string[]): string {
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/*
 * Answers in "Which networks are yours?" (D80, D105, D106), as the dialog
 * keeps them: a string per device, or per BSSID once a device is split.
 */
export const NEIGHBOUR = 'neighbour'
export const IGNORE = 'ignore'
/** An access point by id: `ap:<id>`. */
export const AP = 'ap:'
export const NEW_AP = 'new'
/** Mine, with which access point still to choose (D106). */
export const MINE = 'mine'

/** The answers given so far, by device and, for split devices, by BSSID. */
export interface Answers {
  byDevice: Record<string, string>
  byBssid: Record<string, string>
  split: string[]
  /** Radios already set that the person agreed to retune. */
  overwrite: string[]
}

export const NO_ANSWERS: Answers = {
  byDevice: {},
  byBssid: {},
  split: [],
  overwrite: [],
}

export const deviceKey = (device: ScanDevice) => device.entries[0]!.bssid

/**
 * An answer as a choice. A new access point is one per device (D105), even
 * when its BSSIDs are answered one at a time. Mine without an access point
 * isn't a choice yet.
 */
export function choiceOf(
  value: string | undefined,
  device: ScanDevice,
): ScanChoice | undefined {
  if (value === NEIGHBOUR) return 'neighbour'
  if (value === IGNORE) return 'ignore'
  if (value === NEW_AP) return { newAccessPoint: deviceKey(device) }
  if (value?.startsWith(AP)) return { apId: value.slice(AP.length) }
  return undefined
}

/** Each unknown BSSID's answer, from its device's or its own when split. */
export function choicesOf(
  devices: readonly ScanDevice[],
  answers: Answers,
): Map<string, ScanChoice> {
  const choices = new Map<string, ScanChoice>()
  for (const device of devices) {
    const split = answers.split.includes(deviceKey(device))
    for (const { bssid } of device.entries) {
      const choice = choiceOf(
        split ? answers.byBssid[bssid] : answers.byDevice[deviceKey(device)],
        device,
      )
      if (choice) choices.set(bssid, choice)
    }
  }
  return choices
}

/** Whose a device or network is, before choosing which access point (D106). */
export type Whose = 'mine' | 'neighbour' | 'ignore'

export const WHOSE_OPTIONS: { value: Whose; label: string }[] = [
  { value: 'mine', label: 'Mine' },
  { value: 'neighbour', label: 'A neighbour’s' },
  { value: 'ignore', label: 'Ignore' },
]

/** Which of the three buttons an answer shows chosen, if any. */
export function whoseOf(value: string | undefined): Whose | undefined {
  if (value === NEIGHBOUR) return 'neighbour'
  if (value === IGNORE) return 'ignore'
  if (value === MINE || value === NEW_AP || value?.startsWith(AP)) {
    return 'mine'
  }
  return undefined
}

/**
 * The answer a button gives. Mine is a new access point in a plan without
 * any; otherwise which one is still to choose.
 */
export function answerFor(whose: Whose, plan: Plan): string {
  if (whose === 'neighbour') return NEIGHBOUR
  if (whose === 'ignore') return IGNORE
  return plan.accessPoints.length === 0 ? NEW_AP : MINE
}

/** How many devices have an answer for every one of their BSSIDs. */
export function answeredDevices(
  devices: readonly ScanDevice[],
  choices: ReadonlyMap<string, ScanChoice>,
): number {
  return devices.filter((device) =>
    device.entries.every((e) => choices.has(e.bssid)),
  ).length
}

/**
 * Whether any device, or a split device's BSSID, has no answer at all, for
 * "Mark the rest a neighbour’s". Mine with its access point still to choose
 * is an answer, so it's left as it is.
 */
export function hasBlankAnswers(
  devices: readonly ScanDevice[],
  answers: Answers,
): boolean {
  return devices.some((device) =>
    answers.split.includes(deviceKey(device))
      ? device.entries.some((e) => !answers.byBssid[e.bssid])
      : !answers.byDevice[deviceKey(device)],
  )
}

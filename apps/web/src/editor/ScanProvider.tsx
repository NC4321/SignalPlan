import {
  applyScan,
  groupScanDevices,
  parseScan,
  planScan,
  radioKey,
  SCAN_FORMAT_NAMES,
  unknownScanEntries,
  type Plan,
  type PlanIssue,
  type ScanChanges,
  type ScanChoice,
  type ScanDevice,
  type ScanEntry,
  type ScanFormat,
  type ScanSummary,
  type SkippedEntry,
} from '@signalplan/floorplan'
import { useId, useRef, useState, type ReactNode } from 'react'
import { BAND_LABELS } from './coverageText.ts'
import { useEditor, useEditorStore } from './context.ts'
import { Dialog, PlanIssues } from './Dialog.tsx'
import {
  guessPlatform,
  SCAN_PLATFORMS,
  scanSummaryText,
  scanTuning,
  tunesRadios,
  type ScanPlatform,
} from './scan.ts'
import { ScanContext } from './scanContext.ts'

const NEIGHBOUR = 'neighbour'
const IGNORE = 'ignore'
const AP = 'ap:'

/** A scan that has been read, waiting for answers. */
interface ReadScan {
  format: ScanFormat
  entries: ScanEntry[]
  skipped: SkippedEntry[]
}

/** The answers given so far, by device and, for split devices, by BSSID. */
interface Answers {
  byDevice: Record<string, string>
  byBssid: Record<string, string>
  split: string[]
  /** Radios already set that the person agreed to retune. */
  overwrite: string[]
}

const NO_ANSWERS: Answers = {
  byDevice: {},
  byBssid: {},
  split: [],
  overwrite: [],
}

const deviceKey = (device: ScanDevice) => device.entries[0]!.bssid

function choiceOf(value: string | undefined): ScanChoice | undefined {
  if (value === NEIGHBOUR) return 'neighbour'
  if (value === IGNORE) return 'ignore'
  if (value?.startsWith(AP)) return { apId: value.slice(AP.length) }
  return undefined
}

/** Each unknown BSSID's answer, from its device's or its own when split. */
function choicesOf(
  devices: readonly ScanDevice[],
  answers: Answers,
): Map<string, ScanChoice> {
  const choices = new Map<string, ScanChoice>()
  for (const device of devices) {
    const split = answers.split.includes(deviceKey(device))
    for (const { bssid } of device.entries) {
      const choice = choiceOf(
        split ? answers.byBssid[bssid] : answers.byDevice[deviceKey(device)],
      )
      if (choice) choices.set(bssid, choice)
    }
  }
  return choices
}

const formatDbm = (entry: ScanEntry) =>
  `${entry.approximate ? '≈' : ''}${entry.dbm} dBm`.replace('-', '−')

/**
 * Scan your network (D77, D80): copy a scan command for the platform, paste
 * or open what it prints, then say which devices are yours and which are the
 * neighbours', and apply it all as one undo step.
 */
export function ScanProvider({ children }: { children: ReactNode }) {
  const store = useEditorStore()
  const [open, setOpen] = useState(false)
  const [scan, setScan] = useState<ReadScan>()
  const [answers, setAnswers] = useState<Answers>(NO_ANSWERS)
  const [problem, setProblem] = useState<PlanIssue[]>()
  const [text, setText] = useState('')
  const [platform, setPlatform] = useState<ScanPlatform>(() =>
    guessPlatform(navigator.userAgent),
  )

  const close = () => {
    setOpen(false)
    setScan(undefined)
    setProblem(undefined)
  }

  const read = (output: string) => {
    const result = parseScan(output)
    if (!result.ok) {
      setProblem(result.issues)
      return
    }
    setProblem(undefined)
    setAnswers(NO_ANSWERS)
    setScan({
      format: result.format,
      entries: result.entries,
      skipped: result.skipped,
    })
  }

  const apply = () => {
    if (!scan) return
    // The plan may have changed while the dialog was open, say by an undo,
    // so what to change is worked out again from the plan as it is now.
    const plan = store.getState().plan
    const devices = groupScanDevices(unknownScanEntries(plan, scan.entries))
    const changes = planScan(
      plan,
      scan.entries,
      choicesOf(devices, answers),
      scanTuning(plan),
    )
    const overwrite = new Set(answers.overwrite)
    let summary: ScanSummary | undefined
    // BSSIDs and neighbours don't change coverage, so a search or suggestion
    // stays (D71), unless a radio's channel changes, as when set by hand.
    store.getState().edit(
      'Import scan',
      (draft) => {
        summary = applyScan(draft, changes, overwrite)
      },
      { keepOptimizer: !tunesRadios(changes, overwrite) },
    )
    close()
    if (summary) store.getState().setNotice(scanSummaryText(summary))
  }

  return (
    <ScanContext value={{ openScan: () => setOpen(true) }}>
      {children}
      <Dialog
        open={open}
        title={scan ? 'Which networks are yours?' : 'Scan your network'}
        onClose={close}
        actions={
          scan ? (
            <AnswerActions
              scan={scan}
              answers={answers}
              onBack={() => setScan(undefined)}
              onCancel={close}
              onApply={apply}
            />
          ) : (
            <ReadActions
              text={text}
              onCancel={close}
              onRead={() => read(text)}
              onFile={(contents) => {
                setText(contents)
                read(contents)
              }}
            />
          )
        }
      >
        {scan ? (
          <AnswerStep scan={scan} answers={answers} setAnswers={setAnswers} />
        ) : (
          <ReadStep
            platform={platform}
            setPlatform={setPlatform}
            text={text}
            setText={setText}
            problem={problem}
          />
        )}
      </Dialog>
    </ScanContext>
  )
}

function ReadActions({
  text,
  onCancel,
  onRead,
  onFile,
}: {
  text: string
  onCancel: () => void
  onRead: () => void
  onFile: (contents: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" onClick={() => input.current?.click()}>
        Open a file…
      </button>
      <input
        ref={input}
        type="file"
        accept=".txt,.json,.csv,.log,text/plain,text/csv,application/json"
        hidden
        aria-label="Open a scan file"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onFile(await file.text())
        }}
      />
      <button
        type="button"
        className="primary"
        disabled={text.trim() === ''}
        onClick={onRead}
      >
        Read scan
      </button>
    </>
  )
}

/** The platform's command and steps, and a box for what it printed. */
function ReadStep({
  platform,
  setPlatform,
  text,
  setText,
  problem,
}: {
  platform: ScanPlatform
  setPlatform: (platform: ScanPlatform) => void
  text: string
  setText: (text: string) => void
  problem: PlanIssue[] | undefined
}) {
  const platformId = useId()
  const outputId = useId()
  const help = SCAN_PLATFORMS[platform]
  return (
    <>
      <p>
        See every Wi-Fi network your computer or phone can hear: yours, to set
        their channels, and the neighbours’, which share them. Nothing leaves
        this page.
      </p>
      <div className="field">
        <label htmlFor={platformId}>Your device</label>
        <select
          id={platformId}
          value={platform}
          onChange={(event) => setPlatform(event.target.value as ScanPlatform)}
        >
          {(Object.keys(SCAN_PLATFORMS) as ScanPlatform[]).map((id) => (
            <option key={id} value={id}>
              {SCAN_PLATFORMS[id].name}
            </option>
          ))}
        </select>
      </div>
      <ol className="scan-steps">
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {help.script && (
        <>
          <ScriptBlock script={help.script.text} name={help.name} />
          <p className="hint">{help.script.note}</p>
        </>
      )}
      {help.command && help.commandLabel && (
        <p className="hint">{help.commandLabel}</p>
      )}
      {help.command && <CommandLine command={help.command} />}
      {help.alternative && (
        <>
          <p className="hint">{help.alternative.label}</p>
          <CommandLine command={help.alternative.command} />
        </>
      )}
      {help.note && <p className="hint">{help.note}</p>}
      {platform !== 'iphone' && (
        <div className="field">
          <label htmlFor={outputId}>What it printed</label>
          <textarea
            id={outputId}
            className="scan-output"
            rows={5}
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
      )}
      {problem && (
        <div role="alert">
          <p>This scan can’t be read:</p>
          <PlanIssues issues={problem} />
        </div>
      )}
    </>
  )
}

/** A script to copy whole, which can be read before running it. */
function ScriptBlock({ script, name }: { script: string; name: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="scan-script">
      <div className="scan-command">
        <span>SignalPlan’s scan script for {name}</span>
        <button
          type="button"
          className="primary"
          onClick={() => {
            void navigator.clipboard?.writeText(script).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }}
        >
          Copy script
        </button>
        <span className="hint" aria-live="polite">
          {copied ? 'Copied' : ''}
        </span>
      </div>
      <details>
        <summary>Show the script</summary>
        {/* Scrollable, so it takes focus to scroll from the keyboard. */}
        <pre tabIndex={0} aria-label={`Scan script for ${name}`}>
          <code>{script}</code>
        </pre>
      </details>
    </div>
  )
}

function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="scan-command">
      <code>{command}</code>
      <button
        type="button"
        aria-label={`Copy ${command}`}
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }}
      >
        Copy
      </button>
      <span className="hint" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  )
}

/** The scan's devices not known yet, and every BSSID's answer so far. */
function useAnswerState(scan: ReadScan, answers: Answers) {
  const plan = useEditor((s) => s.plan)
  const devices = groupScanDevices(unknownScanEntries(plan, scan.entries))
  const choices = choicesOf(devices, answers)
  const unanswered = devices.some((device) =>
    device.entries.some((e) => !choices.has(e.bssid)),
  )
  return { plan, devices, choices, unanswered }
}

function AnswerActions({
  scan,
  answers,
  onBack,
  onCancel,
  onApply,
}: {
  scan: ReadScan
  answers: Answers
  onBack: () => void
  onCancel: () => void
  onApply: () => void
}) {
  const { unanswered } = useAnswerState(scan, answers)
  return (
    <>
      <button type="button" onClick={onBack}>
        Back
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className="primary"
        disabled={unanswered}
        title={unanswered ? 'Answer for each network first' : undefined}
        onClick={onApply}
      >
        Apply
      </button>
    </>
  )
}

/** Which devices in the scan are yours and which a neighbour's, then what applying will do. */
function AnswerStep({
  scan,
  answers,
  setAnswers,
}: {
  scan: ReadScan
  answers: Answers
  setAnswers: (update: (a: Answers) => Answers) => void
}) {
  const { plan, devices, choices, unanswered } = useAnswerState(scan, answers)
  const { entries } = scan
  const changes = planScan(plan, entries, choices, scanTuning(plan))
  const known = entries.length - devices.flatMap((d) => d.entries).length
  return (
    <>
      <p>
        Read {entries.length === 1 ? '1 BSSID' : `${entries.length} BSSIDs`}{' '}
        from {SCAN_FORMAT_NAMES[scan.format]}
        {known > 0 && `, ${known} of them already known`}.
        {devices.length > 0 &&
          ' For each device, pick the access point it is, or say it’s a neighbour’s (counted as interference) or to ignore it. Your answers are saved, so later scans match on their own.'}
      </p>
      {devices.length > 0 && (
        <>
          <ul className="bssid-mapping">
            {devices.map((device) => (
              <DeviceRow
                key={deviceKey(device)}
                device={device}
                plan={plan}
                answers={answers}
                setAnswers={setAnswers}
              />
            ))}
          </ul>
          <button
            type="button"
            disabled={!unanswered}
            onClick={() =>
              setAnswers((a) => {
                const byDevice = { ...a.byDevice }
                const byBssid = { ...a.byBssid }
                for (const device of devices) {
                  byDevice[deviceKey(device)] ||= NEIGHBOUR
                  for (const { bssid } of device.entries) {
                    byBssid[bssid] ||= NEIGHBOUR
                  }
                }
                return { ...a, byDevice, byBssid }
              })
            }
          >
            Mark the rest a neighbour’s
          </button>
        </>
      )}
      <Review
        scan={scan}
        plan={plan}
        changes={changes}
        answers={answers}
        setAnswers={setAnswers}
      />
    </>
  )
}

function DeviceRow({
  device,
  plan,
  answers,
  setAnswers,
}: {
  device: ScanDevice
  plan: Plan
  answers: Answers
  setAnswers: (update: (a: Answers) => Answers) => void
}) {
  const id = useId()
  const key = deviceKey(device)
  const split = answers.split.includes(key)
  const strongest = device.entries[0]!
  const bands = [...new Set(device.entries.map((e) => e.band))]
  const name =
    device.ssids.filter((s) => s !== '').join(', ') || 'Hidden network'
  const details = [
    bands.map((b) => BAND_LABELS[b]).join(' and '),
    device.entries.length === 1
      ? strongest.bssid
      : `${device.entries.length} BSSIDs`,
    `strongest ${formatDbm(strongest)}`,
  ]
  return (
    <li className="field">
      <label htmlFor={id}>
        {name}
        <span className="hint"> {details.join(' · ')}</span>
      </label>
      {!split && (
        <AnswerSelect
          id={id}
          plan={plan}
          value={answers.byDevice[key] ?? ''}
          onChange={(value) =>
            setAnswers((a) => ({
              ...a,
              byDevice: { ...a.byDevice, [key]: value },
            }))
          }
        />
      )}
      {device.entries.length > 1 && (
        <button
          type="button"
          className="link-button"
          aria-expanded={split}
          onClick={() =>
            setAnswers((a) => ({
              ...a,
              split: split
                ? a.split.filter((k) => k !== key)
                : [...a.split, key],
              // Splitting starts each BSSID from the device's answer.
              byBssid: split
                ? a.byBssid
                : {
                    ...a.byBssid,
                    ...Object.fromEntries(
                      device.entries.map((e) => [
                        e.bssid,
                        a.byBssid[e.bssid] || a.byDevice[key] || '',
                      ]),
                    ),
                  },
            }))
          }
        >
          {split ? 'Answer as one device' : 'Answer each BSSID'}
        </button>
      )}
      {split && (
        <ul className="scan-bssids">
          {device.entries.map((entry) => (
            <BssidAnswer
              key={entry.bssid}
              entry={entry}
              plan={plan}
              value={answers.byBssid[entry.bssid] ?? ''}
              onChange={(value) =>
                setAnswers((a) => ({
                  ...a,
                  byBssid: { ...a.byBssid, [entry.bssid]: value },
                }))
              }
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function BssidAnswer({
  entry,
  plan,
  value,
  onChange,
}: {
  entry: ScanEntry
  plan: Plan
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <li>
      <label htmlFor={id}>
        <code>{entry.bssid}</code>
        <span className="hint">
          {' '}
          {[
            entry.ssid ?? 'hidden',
            BAND_LABELS[entry.band],
            formatDbm(entry),
          ].join(' · ')}
        </span>
      </label>
      <AnswerSelect id={id} plan={plan} value={value} onChange={onChange} />
    </li>
  )
}

function AnswerSelect({
  id,
  plan,
  value,
  onChange,
}: {
  id: string
  plan: Plan
  value: string
  onChange: (value: string) => void
}) {
  const floorName = (floorId: string) =>
    plan.floors.length > 1
      ? ` (${plan.floors.find((f) => f.id === floorId)?.name ?? ''})`
      : ''
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Choose…
      </option>
      {plan.accessPoints.map((ap) => (
        <option key={ap.id} value={`${AP}${ap.id}`}>
          Mine: {ap.name}
          {floorName(ap.floorId)}
        </option>
      ))}
      <option value={NEIGHBOUR}>A neighbour’s</option>
      <option value={IGNORE}>Ignore</option>
    </select>
  )
}

/** What applying will do that's worth a word before it does. */
function Review({
  scan,
  plan,
  changes,
  answers,
  setAnswers,
}: {
  scan: ReadScan
  plan: Plan
  changes: ScanChanges
  answers: Answers
  setAnswers: (update: (a: Answers) => Answers) => void
}) {
  const apName = (apId: string) =>
    plan.accessPoints.find((a) => a.id === apId)?.name ?? apId
  const retune = changes.radios.filter((r) => r.alreadySet)
  const assumed = changes.neighbours.filter((n) => n.widthAssumed).length
  const noWidth = scan.entries.every((e) => e.widthMHz === undefined)
  const approximate = scan.entries.some((e) => e.approximate)
  const tuning = (width: number | undefined, channel: number | undefined) =>
    width === undefined
      ? 'Auto'
      : `${width} MHz, ${channel === undefined ? 'channel on Auto' : `channel ${channel}`}`
  return (
    <>
      {retune.length > 0 && (
        <fieldset className="choices">
          <legend>Change channels you’ve set?</legend>
          {retune.map((r) => {
            const key = radioKey(r.apId, r.band)
            const radio = plan.accessPoints
              .find((a) => a.id === r.apId)
              ?.radios.find((x) => x.band === r.band)
            return (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={answers.overwrite.includes(key)}
                  onChange={(event) => {
                    const on = event.target.checked
                    setAnswers((a) => ({
                      ...a,
                      overwrite: on
                        ? [...a.overwrite, key]
                        : a.overwrite.filter((k) => k !== key),
                    }))
                  }}
                />
                {apName(r.apId)}, {BAND_LABELS[r.band]}: from{' '}
                {tuning(radio?.channelWidthMHz, radio?.channel)} to{' '}
                {tuning(r.widthMHz, r.channel)}
              </label>
            )
          })}
        </fieldset>
      )}
      {noWidth && changes.radios.length > 0 && (
        <p className="hint">
          This scan doesn’t say channel widths, so your radios’ channels stay as
          they are.
        </p>
      )}
      {assumed > 0 && (
        <p className="hint">
          The scan doesn’t say{' '}
          {assumed === 1 ? 'one network’s' : `${assumed} networks’`} width, so{' '}
          {assumed === 1 ? 'it gets' : 'they get'} the band’s usual width;
          change it under Neighbours’ networks if you know it.
        </p>
      )}
      {approximate && (
        <p className="hint">
          Signals are converted from percentages, so neighbours’ strengths are
          approximate.
        </p>
      )}
      {changes.noRadio.length > 0 && (
        <ul className="hint">
          {changes.noRadio.map((n) => (
            <li key={n.bssid}>
              {apName(n.apId)} has no {BAND_LABELS[n.band]} radio, so{' '}
              <code>{n.bssid}</code> is left out.
            </li>
          ))}
        </ul>
      )}
      {scan.skipped.length > 0 && (
        <details className="hint">
          <summary>
            {scan.skipped.length === 1
              ? '1 network skipped'
              : `${scan.skipped.length} networks skipped`}
          </summary>
          <ul>
            {scan.skipped.map((s) => (
              <li key={s.where}>{s.reason}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

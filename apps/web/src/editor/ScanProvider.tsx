import {
  addScanAccessPoints,
  applyScan,
  applyScanAtSpot,
  findSurveySpot,
  floorMiddle,
  groupScanDevices,
  newScanAccessPoints,
  parseScan,
  planScan,
  radioKey,
  scanFloorId,
  SCAN_FORMAT_NAMES,
  surveySpotName,
  unknownScanEntries,
  type Plan,
  type PlanIssue,
  type ScanChanges,
  type ScanDevice,
  type ScanEntry,
  type ScanFormat,
  type ScanNewAccessPoint,
  type ScanPlace,
  type ScanSummary,
  type SkippedEntry,
  type SpotScanSummary,
} from '@signalplan/floorplan'
import { useId, useRef, useState, type ReactNode } from 'react'
import { BAND_LABELS } from './coverageText.ts'
import { useEditor, useEditorStore } from './context.ts'
import { Dialog, PlanIssues } from './Dialog.tsx'
import { MAX_SCAN_FILE_BYTES, readTextFile } from './readFile.ts'
import { Segmented } from './Segmented.tsx'
import {
  AP,
  answerFor,
  answeredDevices,
  choicesOf,
  deviceKey,
  guessPlatform,
  hasBlankAnswers,
  MINE,
  NEIGHBOUR,
  NEW_AP,
  NO_ANSWERS,
  SCAN_PLATFORMS,
  whoseOf,
  WHOSE_OPTIONS,
  type Answers,
  scanSummaryText,
  scanTuning,
  tunesRadios,
  type ScanPlatform,
} from './scan.ts'
import { ScanContext } from './scanContext.ts'

/** A scan that has been read, waiting for answers. */
interface ReadScan {
  format: ScanFormat
  entries: ScanEntry[]
  skipped: SkippedEntry[]
}

/**
 * Where the scan was taken (D82): the spot selected when the dialog opened,
 * a click on the plan that adds one, or not at a spot.
 */
type PlaceChoice = 'selected' | 'click' | 'none'

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
  const [selectedSpot, setSelectedSpot] = useState<string>()
  const [place, setPlace] = useState<PlaceChoice>('none')

  const openScan = () => {
    const state = store.getState()
    state.setPlaceScan(undefined)
    // A spot selected now is where the scan was most likely taken.
    const [item, ...rest] = state.selection
    const spot =
      item?.kind === 'surveySpot' && rest.length === 0 ? item.id : undefined
    setSelectedSpot(spot)
    setPlace(spot ? 'selected' : 'none')
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    setScan(undefined)
    setProblem(undefined)
  }

  const read = (output: string) => {
    let result: ReturnType<typeof parseScan>
    try {
      result = parseScan(output)
    } catch (error) {
      // A reader that throws must still say so, not leave the dialog idle.
      const detail = error instanceof Error ? ` (${error.message})` : ''
      setProblem([
        {
          path: '',
          message: `SignalPlan hit an error reading it${detail}.`,
        },
      ])
      return
    }
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

  /**
   * Applies the scan, as one undo step, at a spot if it has one. The plan
   * may have changed since it was read, say by an undo, so what to change
   * is worked out again from the plan as it is now.
   */
  const commit = (
    read: ReadScan,
    given: Answers,
    place: ScanPlace | undefined,
  ) => {
    const state = store.getState()
    const plan = state.plan
    const devices = groupScanDevices(unknownScanEntries(plan, read.entries))
    const choices = choicesOf(devices, given)
    const tuning = scanTuning(plan)
    const overwrite = new Set(given.overwrite)
    const at =
      place && 'spotId' in place && !findSurveySpot(plan, place.spotId)
        ? undefined
        : place
    // New access points go on the floor the scan was taken on (D105).
    const floorId = scanFloorId(plan, place, state.floorId)
    const adding = newScanAccessPoints(plan, read.entries, choices).length > 0
    let summary: ScanSummary | undefined
    let atSpot: SpotScanSummary | undefined
    let added: string[] = []
    // BSSIDs, neighbours and readings don't change coverage, so a search or
    // suggestion stays (D71), unless a radio's channel changes, as when set
    // by hand, or an access point is added.
    state.edit(
      'Import scan',
      (draft) => {
        const resolved = addScanAccessPoints(
          draft,
          read.entries,
          choices,
          floorId,
          floorMiddle(draft, floorId),
        )
        added = resolved.ids
        const changes = planScan(draft, read.entries, resolved.choices, tuning)
        summary = applyScan(draft, changes, overwrite)
        if (at) atSpot = applyScanAtSpot(draft, read.entries, changes, at)
      },
      {
        keepOptimizer:
          !adding &&
          !tunesRadios(
            planScan(plan, read.entries, choices, tuning),
            overwrite,
          ),
      },
    )
    const after = store.getState()
    // A new access point is selected, ready to drag to where it is.
    if (added.length > 0) {
      after.select(added.map((id) => ({ kind: 'accessPoint' as const, id })))
    } else if (atSpot) {
      after.select([{ kind: 'surveySpot', id: atSpot.spotId }])
    }
    const names = added.map(
      (id) => after.plan.accessPoints.find((a) => a.id === id)?.name ?? id,
    )
    if (summary) after.setNotice(scanSummaryText(summary, atSpot, names))
  }

  const apply = () => {
    if (!scan) return
    const read = scan
    const given = answers
    close()
    if (place === 'click') {
      // Waits for a click on the plan, on the floor on show (D82).
      store.getState().setPlaceScan((at) => {
        const state = store.getState()
        state.setPlaceScan(undefined)
        commit(read, given, { floorId: state.floorId, x: at.x, y: at.y })
      })
    } else {
      commit(
        read,
        given,
        place === 'selected' && selectedSpot
          ? { spotId: selectedSpot }
          : undefined,
      )
    }
  }

  return (
    <ScanContext value={{ openScan }}>
      {children}
      <Dialog
        open={open}
        wide
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
              applyLabel={place === 'click' ? 'Apply, then click…' : 'Apply'}
            />
          ) : (
            <ReadActions
              text={text}
              onCancel={close}
              onRead={() => read(text)}
              onFile={async (file) => {
                const result = await readTextFile(file, MAX_SCAN_FILE_BYTES)
                if (!result.ok) {
                  setProblem(result.issues)
                  return
                }
                setText(result.text)
                read(result.text)
              }}
            />
          )
        }
      >
        {scan ? (
          <>
            <AnswerStep scan={scan} answers={answers} setAnswers={setAnswers} />
            <PlaceField
              place={place}
              setPlace={setPlace}
              selectedSpot={selectedSpot}
            />
          </>
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
  onFile: (file: File) => void | Promise<void>
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
          if (file) void onFile(file)
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
  const emptyId = useId()
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
            aria-describedby={text.trim() === '' ? emptyId : undefined}
            onChange={(event) => setText(event.target.value)}
          />
          {text.trim() === '' && (
            <p id={emptyId} className="hint">
              Read scan turns on once there is something to read. Paste what the
              command printed, or open the file it saved.
            </p>
          )}
        </div>
      )}
      {problem && (
        <div role="alert">
          <p>Nothing was changed. This scan can’t be read:</p>
          <PlanIssues issues={problem} />
          <p className="hint">
            Copy everything the command printed, from its first line to its
            last, or run it again and open the file it saves.
          </p>
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
  applyLabel,
}: {
  scan: ReadScan
  answers: Answers
  onBack: () => void
  onCancel: () => void
  onApply: () => void
  applyLabel: string
}) {
  const { devices, choices, unanswered } = useAnswerState(scan, answers)
  const answered = answeredDevices(devices, choices)
  return (
    <>
      {/* Says why Apply is off while devices are left (D106). */}
      {devices.length > 0 && (
        <p className="dialog-status" aria-live="polite">
          {answered} of {devices.length}{' '}
          {devices.length === 1 ? 'device' : 'devices'} answered
        </p>
      )}
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
        {applyLabel}
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
  const { plan, devices, choices } = useAnswerState(scan, answers)
  const { entries } = scan
  const changes = planScan(plan, entries, choices, scanTuning(plan))
  const adding = newScanAccessPoints(plan, entries, choices)
  const known = entries.length - devices.flatMap((d) => d.entries).length
  const blank = hasBlankAnswers(devices, answers)
  return (
    <>
      <p>
        Read {entries.length === 1 ? '1 BSSID' : `${entries.length} BSSIDs`}{' '}
        from {SCAN_FORMAT_NAMES[scan.format]}
        {known > 0 && `, ${known} of them already known`}.
        {devices.length > 0 &&
          ' Say which devices are yours and which access point each one is. A neighbour’s counts as interference. Your answers are saved, so later scans match on their own.'}
      </p>
      {devices.length > 0 && (
        <>
          <ul className="scan-devices">
            {devices.map((device) => (
              <DeviceCard
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
            disabled={!blank}
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
      {adding.length > 0 && <NewAccessPoints adding={adding} />}
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

const deviceName = (device: ScanDevice) =>
  device.ssids.filter((s) => s !== '').join(', ') || 'Hidden network'

/**
 * One device the scan heard, as a card (D106): its names, bands and signal,
 * and whose it is. Split, its networks are answered one by one inside it.
 */
function DeviceCard({
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
  const listId = useId()
  const key = deviceKey(device)
  const split = answers.split.includes(key)
  const strongest = device.entries[0]!
  const bands = [...new Set(device.entries.map((e) => e.band))]
  const name = deviceName(device)
  const count = device.entries.length
  return (
    <li className="scan-device">
      <div className="scan-device-head">
        <h3>{name}</h3>
        <p className="scan-details">
          {bands.map((b) => (
            <span key={b} className="band-tag">
              {BAND_LABELS[b]}
            </span>
          ))}
          <span>
            {count === 1 ? <code>{strongest.bssid}</code> : `${count} networks`}
          </span>
          <span>strongest {formatDbm(strongest)}</span>
        </p>
      </div>
      {!split && (
        <Answer
          about={name}
          plan={plan}
          value={answers.byDevice[key]}
          onChange={(value) =>
            setAnswers((a) => ({
              ...a,
              byDevice: { ...a.byDevice, [key]: value },
            }))
          }
        />
      )}
      {split && (
        <ul id={listId} className="scan-networks">
          {device.entries.map((entry) => (
            <NetworkAnswer
              key={entry.bssid}
              entry={entry}
              plan={plan}
              value={answers.byBssid[entry.bssid]}
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
      {count > 1 && (
        <button
          type="button"
          className="link-button scan-split"
          aria-expanded={split}
          aria-controls={split ? listId : undefined}
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
          {split
            ? 'Answer as one device'
            : `Answer each network separately (${count})`}
        </button>
      )}
    </li>
  )
}

/** One network (BSSID) of a split device, with its own answer. */
function NetworkAnswer({
  entry,
  plan,
  value,
  onChange,
}: {
  entry: ScanEntry
  plan: Plan
  value: string | undefined
  onChange: (value: string) => void
}) {
  const ssid = entry.ssid || 'Hidden network'
  return (
    <li className="scan-network">
      <div className="scan-device-head">
        <p className="scan-network-name">{ssid}</p>
        <p className="scan-details">
          <span className="band-tag">{BAND_LABELS[entry.band]}</span>
          <code>{entry.bssid}</code>
          <span>{formatDbm(entry)}</span>
        </p>
      </div>
      <Answer
        about={`${ssid}, ${BAND_LABELS[entry.band]}, ${entry.bssid}`}
        plan={plan}
        value={value}
        onChange={onChange}
      />
    </li>
  )
}

/**
 * Mine, A neighbour's or Ignore as joined buttons, then for Mine which
 * access point (D106). A plan without access points answers Mine with a new
 * one; otherwise the access point is still to choose, and the answer isn't
 * complete until it is.
 */
function Answer({
  about,
  plan,
  value,
  onChange,
}: {
  about: string
  plan: Plan
  value: string | undefined
  onChange: (value: string) => void
}) {
  const name = useId()
  const selectId = useId()
  const whose = whoseOf(value)
  const floorName = (floorId: string) =>
    plan.floors.length > 1
      ? ` (${plan.floors.find((f) => f.id === floorId)?.name ?? ''})`
      : ''
  return (
    <div className="scan-answer">
      <Segmented
        label={`Whose is ${about}?`}
        name={name}
        value={whose}
        options={WHOSE_OPTIONS}
        onChange={(chosen) => onChange(answerFor(chosen, plan))}
      />
      {whose === 'mine' && (
        <div className="field">
          <label htmlFor={selectId}>
            Which access point?
            <span className="visually-hidden"> ({about})</span>
          </label>
          <select
            id={selectId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value={MINE} disabled>
              Choose…
            </option>
            {plan.accessPoints.map((ap) => (
              <option key={ap.id} value={`${AP}${ap.id}`}>
                {ap.name}
                {floorName(ap.floorId)}
              </option>
            ))}
            <option value={NEW_AP}>A new access point</option>
          </select>
        </div>
      )}
    </div>
  )
}

/** The access points applying adds, and where they go (D105). */
function NewAccessPoints({ adding }: { adding: ScanNewAccessPoint[] }) {
  const one = adding.length === 1
  return (
    <div className="hint">
      <p>
        {one ? 'Adds an access point' : `Adds ${adding.length} access points`}{' '}
        in the middle of the floor, with a radio on each band the scan heard:
      </p>
      <ul>
        {adding.map((ap) => (
          <li key={ap.key}>
            {ap.name} ({ap.bands.map((b) => BAND_LABELS[b]).join(' and ')})
          </li>
        ))}
      </ul>
      <p>
        Drag {one ? 'it' : 'each'} to where {one ? 'it is' : 'they are'} in your
        home afterwards.
      </p>
    </div>
  )
}

/**
 * Where the scan was taken (D82): at a survey spot, your radios' signals
 * become its readings and the neighbours' strengths the strongest heard.
 */
function PlaceField({
  place,
  setPlace,
  selectedSpot,
}: {
  place: PlaceChoice
  setPlace: (place: PlaceChoice) => void
  selectedSpot: string | undefined
}) {
  const options: { value: PlaceChoice; label: string }[] = [
    ...(selectedSpot
      ? [
          {
            value: 'selected' as const,
            label: `At ${surveySpotName(selectedSpot)}`,
          },
        ]
      : []),
    {
      value: 'click',
      label: selectedSpot
        ? 'At a new spot: click the plan after Apply'
        : 'At a survey spot: click the plan after Apply',
    },
    { value: 'none', label: 'Not at a spot' },
  ]
  return (
    <fieldset className="choices">
      <legend>Where was this scan taken?</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name="scan-place"
            checked={place === option.value}
            onChange={() => setPlace(option.value)}
          />
          {option.label}
        </label>
      ))}
      <p className="hint">
        {place === 'none'
          ? 'Your radios’ BSSIDs and the neighbours’ networks are still saved, but no readings are.'
          : 'Your access points’ signals become the spot’s readings, for the error report and Calibrate; scans at one spot are averaged. Each neighbour’s strength becomes the strongest it was heard at any spot.'}
      </p>
    </fieldset>
  )
}

/** Shown while Scan your network waits for a click where the scan was taken (D82). */
export function ScanPlacementBar() {
  const store = useEditorStore()
  return (
    <div className="calibration-bar" role="region" aria-label="Place the scan">
      <p>
        <strong>Where was the scan taken?</strong> Click the plan there, on the
        floor on show, to add a survey spot with its readings.
      </p>
      <button
        type="button"
        onClick={() => {
          const state = store.getState()
          state.setPlaceScan(undefined)
          state.setNotice('Scan not imported.')
        }}
      >
        Cancel
      </button>
    </div>
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

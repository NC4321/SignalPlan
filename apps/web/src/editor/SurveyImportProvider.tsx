import {
  applyImport,
  parseReadings,
  prepareImport,
  type Band,
  type BssidChoice,
  type ImportSummary,
  type PlanIssue,
  type PreparedImport,
  type ReadingRow,
} from '@signalplan/floorplan'
import { useId, useRef, useState, type ReactNode } from 'react'
import { BAND_LABELS } from './coverageText.ts'
import { useEditor, useEditorStore } from './context.ts'
import { Dialog, PlanIssues } from './Dialog.tsx'
import { importSummaryText } from './surveyImport.ts'
import { SurveyImportContext } from './surveyImportContext.ts'

const NOT_MINE = 'not-mine'

/**
 * Importing survey readings from a CSV or JSON file (D72): read and check
 * the file, match its rows to spots, ask which radio each unknown BSSID is,
 * then add everything as one undo step and say what it did.
 */
export function SurveyImportProvider({ children }: { children: ReactNode }) {
  const store = useEditorStore()
  const input = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<{
    file: string
    issues: PlanIssue[]
  }>()
  const [pending, setPending] = useState<Pending>()
  const [picked, setPicked] = useState<Record<string, string>>({})

  /** Matches the rows against the plan as it is now. */
  const prepare = (file: string, rows: ReadingRow[], context: Context) => {
    const result = prepareImport(store.getState().plan, rows, context)
    if (!result.ok) setProblem({ file, issues: result.issues })
    return result.ok ? result.prepared : undefined
  }

  const finish = (
    { file, rows, context }: Pending,
    choices: ReadonlyMap<string, BssidChoice>,
  ) => {
    // The plan may have changed while the dialog was open, say by an undo,
    // so the rows are matched again before anything is added.
    const prepared = prepare(file, rows, context)
    if (!prepared) return
    let summary: ImportSummary | undefined
    // Readings don't change coverage, so a suggestion stays.
    store.getState().edit(
      'Import readings',
      (plan) => {
        summary = applyImport(plan, prepared, choices)
      },
      { keepOptimizer: true },
    )
    if (summary) store.getState().setNotice(importSummaryText(summary))
  }

  const importFile = async (file: File) => {
    const parsed = parseReadings(await file.text())
    if (!parsed.ok) {
      setProblem({ file: file.name, issues: parsed.issues })
      return
    }
    const state = store.getState()
    const only = state.selection.length === 1 ? state.selection[0] : undefined
    const context = {
      floorId: state.floorId,
      selectedSpotId: only?.kind === 'surveySpot' ? only.id : undefined,
    }
    const prepared = prepare(file.name, parsed.rows, context)
    if (!prepared) return
    const next = { file: file.name, rows: parsed.rows, context, prepared }
    if (prepared.unknown.length === 0) finish(next, new Map())
    else {
      setPicked({})
      setPending(next)
    }
  }

  return (
    <SurveyImportContext
      value={{ chooseReadingsFile: () => input.current?.click() }}
    >
      {children}
      <input
        ref={input}
        type="file"
        accept=".csv,.json,.txt,text/csv,application/json"
        hidden
        aria-label="Import readings"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void importFile(file)
        }}
      />
      <Dialog
        open={problem !== undefined}
        title="These readings can’t be imported"
        onClose={() => setProblem(undefined)}
        actions={
          <button
            type="button"
            className="primary"
            onClick={() => setProblem(undefined)}
          >
            OK
          </button>
        }
      >
        <p>
          Nothing was imported from “{problem?.file}”. Fix these and try again:
        </p>
        <PlanIssues issues={problem?.issues ?? []} />
        <p className="hint">
          The file needs a BSSID and a dBm (or RSSI) column, and a spot or x and
          y for each row, or a spot selected first.
        </p>
      </Dialog>
      <MappingDialog
        pending={pending}
        picked={picked}
        setPicked={setPicked}
        onCancel={() => setPending(undefined)}
        onImport={(choices) => {
          const current = pending
          setPending(undefined)
          if (current) finish(current, choices)
        }}
      />
    </SurveyImportContext>
  )
}

type Context = { floorId: string; selectedSpotId: string | undefined }

/** A file waiting for its BSSIDs to be mapped. */
interface Pending {
  file: string
  rows: ReadingRow[]
  context: Context
  prepared: PreparedImport
}

/**
 * Which radio each BSSID the plan doesn't know yet belongs to, or "not
 * mine" for a neighbour's. Every one needs an answer before importing. It
 * stays mounted, so closing it returns focus to where the import started.
 */
function MappingDialog({
  pending,
  picked,
  setPicked,
  onCancel,
  onImport,
}: {
  pending: Pending | undefined
  picked: Record<string, string>
  setPicked: (
    update: (p: Record<string, string>) => Record<string, string>,
  ) => void
  onCancel: () => void
  onImport: (choices: Map<string, BssidChoice>) => void
}) {
  const plan = useEditor((s) => s.plan)
  const unknown = pending?.prepared.unknown ?? []
  const done = unknown.every((u) => picked[u.bssid])
  const floorName = (floorId: string) =>
    plan.floors.length > 1
      ? ` (${plan.floors.find((f) => f.id === floorId)?.name ?? ''})`
      : ''
  const radios = plan.accessPoints.flatMap((ap) =>
    ap.radios.map((r) => ({
      value: `${ap.id}\n${r.band}`,
      band: r.band,
      label: `${ap.name}${floorName(ap.floorId)}, ${BAND_LABELS[r.band]}`,
    })),
  )
  const choices = () =>
    new Map(
      unknown.map(({ bssid }): [string, BssidChoice] => {
        const value = picked[bssid]!
        if (value === NOT_MINE) return [bssid, 'not-mine']
        const [apId = '', band] = value.split('\n')
        return [bssid, { apId, band: band as Band }]
      }),
    )
  return (
    <Dialog
      open={pending !== undefined}
      title="Which radio is each BSSID?"
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!done}
            title={done ? undefined : 'Choose for each BSSID first'}
            onClick={() => onImport(choices())}
          >
            Import
          </button>
        </>
      }
    >
      <p>
        “{pending?.file}” has readings from{' '}
        {unknown.length === 1 ? 'a BSSID' : `${unknown.length} BSSIDs`} no
        access point has yet. Pick the radio each belongs to (a Wi-Fi scanner
        shows the network name and band), or Not mine for a neighbour’s. Your
        choices are saved, so later imports match on their own.
      </p>
      <ul className="bssid-mapping">
        {unknown.map((u) => (
          <BssidRow
            key={u.bssid}
            unknown={u}
            radios={radios}
            value={picked[u.bssid] ?? ''}
            onChange={(value) => setPicked((p) => ({ ...p, [u.bssid]: value }))}
          />
        ))}
      </ul>
      <button
        type="button"
        disabled={done}
        onClick={() =>
          setPicked((p) =>
            Object.fromEntries(
              unknown.map(({ bssid }) => [bssid, p[bssid] || NOT_MINE]),
            ),
          )
        }
      >
        Mark the rest not mine
      </button>
    </Dialog>
  )
}

function BssidRow({
  unknown,
  radios,
  value,
  onChange,
}: {
  unknown: PreparedImport['unknown'][number]
  radios: { value: string; band: Band; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const noteId = useId()
  const chosen = radios.find((r) => r.value === value)
  // The file's band is only a hint, but a different one is worth a look.
  const mismatch =
    chosen && unknown.band !== undefined && chosen.band !== unknown.band
  const { bssid, ssids, band, count, strongestDbm } = unknown
  const details = [
    ssids.length > 0 ? ssids.join(', ') : 'no network name',
    band && BAND_LABELS[band],
    `${count} reading${count === 1 ? '' : 's'}, strongest ${strongestDbm} dBm`.replace(
      '-',
      '−',
    ),
  ].filter(Boolean)
  return (
    <li className="field">
      <label htmlFor={id}>
        <code>{bssid}</code>
        <span className="hint"> {details.join(' · ')}</span>
      </label>
      <select
        id={id}
        value={value}
        aria-describedby={mismatch ? noteId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          Choose…
        </option>
        <option value={NOT_MINE}>Not mine (a neighbour’s)</option>
        {radios.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      {mismatch && (
        <p id={noteId} className="field-note field-warning">
          The file says {BAND_LABELS[unknown.band!]}, but this radio is{' '}
          {BAND_LABELS[chosen.band]}.
        </p>
      )}
    </li>
  )
}

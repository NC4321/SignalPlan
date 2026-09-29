import {
  applyImport,
  parseReadings,
  prepareImport,
  type Band,
  type BssidChoice,
  type ImportSummary,
  type PlanIssue,
  type PreparedImport,
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
  const [mapping, setMapping] = useState<{
    file: string
    prepared: PreparedImport
  }>()

  const finish = (
    prepared: PreparedImport,
    choices: ReadonlyMap<string, BssidChoice>,
  ) => {
    let summary: ImportSummary | undefined
    const state = store.getState()
    // Readings don't change coverage, so a suggestion stays.
    state.edit(
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
    const prepared = prepareImport(state.plan, parsed.rows, {
      floorId: state.floorId,
      selectedSpotId: only?.kind === 'surveySpot' ? only.id : undefined,
    })
    if (!prepared.ok) {
      setProblem({ file: file.name, issues: prepared.issues })
      return
    }
    if (prepared.prepared.unknown.length === 0) {
      finish(prepared.prepared, new Map())
    } else {
      setMapping({ file: file.name, prepared: prepared.prepared })
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
      {mapping && (
        <MappingDialog
          key={mapping.file + mapping.prepared.unknown.length}
          file={mapping.file}
          prepared={mapping.prepared}
          onCancel={() => setMapping(undefined)}
          onImport={(choices) => {
            setMapping(undefined)
            finish(mapping.prepared, choices)
          }}
        />
      )}
    </SurveyImportContext>
  )
}

/**
 * Which radio each BSSID the plan doesn't know yet belongs to, or "not
 * mine" for a neighbour's. Every one needs an answer before importing.
 */
function MappingDialog({
  file,
  prepared,
  onCancel,
  onImport,
}: {
  file: string
  prepared: PreparedImport
  onCancel: () => void
  onImport: (choices: Map<string, BssidChoice>) => void
}) {
  const plan = useEditor((s) => s.plan)
  const [picked, setPicked] = useState<Record<string, string>>({})
  const hintId = useId()
  const { unknown } = prepared
  const done = unknown.every((u) => picked[u.bssid])
  const floorName = (floorId: string) =>
    plan.floors.length > 1
      ? ` (${plan.floors.find((f) => f.id === floorId)?.name ?? ''})`
      : ''
  const radios = plan.accessPoints.flatMap((ap) =>
    ap.radios.map((r) => ({
      value: `${ap.id}\n${r.band}`,
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
      open
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
      <p id={hintId}>
        “{file}” has readings from{' '}
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
            describedBy={hintId}
            onChange={(value) => setPicked((p) => ({ ...p, [u.bssid]: value }))}
          />
        ))}
      </ul>
      {!done && (
        <button
          type="button"
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
      )}
    </Dialog>
  )
}

function BssidRow({
  unknown,
  radios,
  value,
  describedBy,
  onChange,
}: {
  unknown: PreparedImport['unknown'][number]
  radios: { value: string; label: string }[]
  value: string
  describedBy: string
  onChange: (value: string) => void
}) {
  const id = useId()
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
        aria-describedby={describedBy}
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
    </li>
  )
}

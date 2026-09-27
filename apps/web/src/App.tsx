import {
  BANDS,
  parsePlan,
  type Band,
  type Plan,
  type Point,
} from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import { useCallback, useState } from 'react'
import { PlanCanvas } from './PlanCanvas.tsx'
import { cssColour, QUALITY_BANDS, qualityOf } from './quality.ts'
import { useCoverage } from './useCoverage.ts'

const MODEL_URL = 'https://github.com/NC4321/SignalPlan/blob/main/docs/MODEL.md'

function loadSample(): Plan {
  const result = parsePlan(sampleHome)
  if (!result.ok) {
    throw new Error(`Sample plan is invalid: ${result.issues[0]?.message}`)
  }
  return result.plan
}

const BAND_LABELS: Record<Band, string> = {
  '2.4GHz': '2.4 GHz',
  '5GHz': '5 GHz',
  '6GHz': '6 GHz',
}

function App() {
  const [plan, setPlan] = useState(loadSample)
  const [band, setBand] = useState<Band>('5GHz')
  const [hover, setHover] = useState<number>()
  const floor = plan.floors[0]!
  const { coverage, error } = useCoverage(plan, floor.id, band)

  const moveAccessPoint = useCallback((id: string, to: Point) => {
    setPlan((current) => ({
      ...current,
      accessPoints: current.accessPoints.map((ap) =>
        ap.id === id ? { ...ap, x: to.x, y: to.y } : ap,
      ),
    }))
  }, [])

  const broadcasting = plan.accessPoints.some((ap) =>
    ap.radios.some((radio) => radio.band === band),
  )
  const hoverBand = hover === undefined ? undefined : qualityOf(hover)

  return (
    <main>
      <header>
        <h1>SignalPlan</h1>
        <p className="lede">
          Predicted Wi-Fi coverage for a sample flat. Drag the router to see how
          coverage changes.
        </p>
      </header>

      <fieldset className="bands">
        <legend>Band</legend>
        {BANDS.map((b) => (
          <label key={b}>
            <input
              type="radio"
              name="band"
              value={b}
              checked={band === b}
              onChange={() => setBand(b)}
            />
            {BAND_LABELS[b]}
          </label>
        ))}
      </fieldset>

      <div className="plan">
        <PlanCanvas
          floor={floor}
          accessPoints={plan.accessPoints}
          coverage={broadcasting ? coverage : undefined}
          onMoveAccessPoint={moveAccessPoint}
          onHover={setHover}
        />
        {!broadcasting && (
          <p className="notice">
            No access point in this plan broadcasts on {BAND_LABELS[band]}.
          </p>
        )}
        {error && <p className="notice">Couldn’t compute coverage: {error}</p>}
      </div>

      <p className="readout" aria-live="polite">
        {hover === undefined
          ? 'Point at the plan to read the signal.'
          : `${hover.toFixed(0)} dBm · ${hoverBand?.label ?? 'No signal'}`}
      </p>

      <ul className="legend" aria-label="Signal quality">
        {QUALITY_BANDS.map((q, i) => (
          <li key={q.label}>
            <span className="swatch" style={{ background: cssColour(q) }} />
            <span className="legend-label">{q.label}</span>
            <span className="legend-range">
              {i === 0
                ? `≥ ${q.minDbm} dBm`
                : `${q.minDbm} to ${QUALITY_BANDS[i - 1]!.minDbm} dBm`}
            </span>
            <span className="legend-meaning">{q.meaning}</span>
          </li>
        ))}
        <li>
          <span className="swatch swatch-none" />
          <span className="legend-label">No signal</span>
          <span className="legend-range">
            {`< ${QUALITY_BANDS.at(-1)!.minDbm} dBm`}
          </span>
          <span className="legend-meaning" />
        </li>
      </ul>

      <footer>
        <p>
          Predictions come from a simplified model: straight-line paths through
          walls with losses computed from ITU-R P.2040. Read{' '}
          <a href={MODEL_URL}>how the model works</a> and its known limits.
        </p>
      </footer>
    </main>
  )
}

export default App

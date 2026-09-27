import { freeSpacePathLoss } from '@signalplan/engine'

const BANDS = [
  { label: '2.4 GHz', frequencyHz: 2.437e9 },
  { label: '5 GHz', frequencyHz: 5.18e9 },
  { label: '6 GHz', frequencyHz: 6.0e9 },
] as const

function App() {
  return (
    <main>
      <h1>SignalPlan</h1>
      <p>
        Draw your home to scale, place Wi-Fi access points, and see predicted
        coverage floor by floor. Under construction.
      </p>
      <table>
        <caption>Free-space path loss at 1 m</caption>
        <thead>
          <tr>
            <th scope="col">Band</th>
            <th scope="col">Loss</th>
          </tr>
        </thead>
        <tbody>
          {BANDS.map(({ label, frequencyHz }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{freeSpacePathLoss(1, frequencyHz).toFixed(1)} dB</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}

export default App

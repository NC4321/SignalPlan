import { stackedFloors } from '@signalplan/floorplan'
import { useMemo } from 'react'
import { useEditor, useEditorStore } from './context.ts'

/**
 * The floors as a stack in the canvas corner, top floor at the top (D52).
 * Pick one to show it; the buttons above and below add a floor there. Under
 * them, a checkbox shows the floor below faintly (D53).
 */
export function FloorStack() {
  const store = useEditorStore()
  const floors = useEditor((s) => s.plan.floors)
  const floorId = useEditor((s) => s.floorId)
  const topDown = useMemo(() => stackedFloors(floors).reverse(), [floors])
  const showGhost = useEditor((s) => s.showGhost)
  const hasFloorBelow = topDown.at(-1)?.id !== floorId

  return (
    <nav className="floor-stack" aria-label="Floors">
      <button
        type="button"
        className="floor-add"
        title="Add a floor above the top one"
        onClick={() => store.getState().addFloor('above')}
      >
        + Floor above
      </button>
      <ul>
        {topDown.map((floor) => (
          <li key={floor.id}>
            <button
              type="button"
              aria-current={floor.id === floorId ? 'true' : undefined}
              title={
                floor.id === floorId
                  ? `${floor.name}, on show`
                  : `Show ${floor.name} (PageUp, PageDown)`
              }
              onClick={() => store.getState().setFloor(floor.id)}
            >
              {floor.name || 'Unnamed floor'}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="floor-add"
        title="Add a floor below the bottom one, such as a basement"
        onClick={() => store.getState().addFloor('below')}
      >
        + Floor below
      </button>
      {hasFloorBelow && (
        <label className="floor-ghost">
          <input
            type="checkbox"
            checked={showGhost}
            onChange={(event) =>
              store.getState().setShowGhost(event.target.checked)
            }
          />
          Show floor below
        </label>
      )}
    </nav>
  )
}

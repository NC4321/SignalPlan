import type { Point } from '@signalplan/floorplan'
import { useEffect, useRef, useState } from 'react'
import { toScreen, type Camera } from './camera.ts'
import { bearingDeg, pointAtBearing } from './snap.ts'
import { parseLength, type Units } from './units.ts'
import { inOpenDialog, isTyping } from './util.ts'

/** Unit screen vector pointing from `toward` back past `anchor`. */
function directionAway(camera: Camera, anchor: Point, toward: Point): Point {
  const a = toScreen(camera, anchor)
  const b = toScreen(camera, toward)
  const length = Math.hypot(a.x - b.x, a.y - b.y)
  if (length === 0) return { x: 1, y: 1 }
  return { x: (a.x - b.x) / length, y: (a.y - b.y) / length }
}

/** Characters that start typing a length while a wall follows the cursor. */
const STARTS_LENGTH = /^[0-9.'"]$/

interface Props {
  /** The corner the wall being drawn starts from. */
  anchor: Point
  /** Where the preview points, which sets the direction if no angle is typed. */
  toward: Point | undefined
  camera: Camera
  units: Units
  onSubmit: (point: Point) => void
}

/**
 * While drawing, typing a number opens a small box by the wall's start for an
 * exact length; Tab moves to an optional angle; Enter places the wall.
 */
export function LengthInput({
  anchor,
  toward,
  camera,
  units,
  onSubmit,
}: Props) {
  const [open, setOpen] = useState(false)
  const [length, setLength] = useState('')
  const [angle, setAngle] = useState('')
  const [error, setError] = useState<string>()
  const lengthField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (open || isTyping(event) || event.ctrlKey || event.metaKey) return
      if (event.defaultPrevented || inOpenDialog(event)) return
      if (!STARTS_LENGTH.test(event.key)) return
      event.preventDefault()
      setLength(event.key)
      setAngle('')
      setError(undefined)
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) lengthField.current?.focus()
  }, [open])

  if (!open) return null

  const close = () => {
    setOpen(false)
    document.querySelector<HTMLElement>('.editor-canvas')?.focus()
  }

  const submit = () => {
    const metres = parseLength(length, units)
    if (metres === undefined || metres <= 0) {
      setError(units === 'metric' ? 'Try 3.5 or 350 cm' : `Try 12'6" or 12.5`)
      return
    }
    let bearing: number
    if (angle.trim() !== '') {
      const degrees = Number(angle.replace('°', ''))
      if (!Number.isFinite(degrees)) {
        setError('Angle in degrees, e.g. 90')
        return
      }
      bearing = degrees
    } else if (
      toward &&
      Math.hypot(toward.x - anchor.x, toward.y - anchor.y) > 0
    ) {
      bearing = bearingDeg(anchor, toward)
    } else {
      setError('Point the wall in a direction, or type an angle')
      return
    }
    onSubmit(pointAtBearing(anchor, metres, bearing))
    close()
  }

  // Open on the side of the corner away from the wall being drawn, so the box
  // never covers the wall or the pointer.
  const at = toScreen(camera, anchor)
  const away = toward ? directionAway(camera, anchor, toward) : { x: 1, y: 1 }
  return (
    <form
      className="length-input"
      style={{
        left: at.x + away.x * 24,
        top: at.y + away.y * 24,
        translate: `${away.x < 0 ? '-100%' : '0'} ${away.y < 0 ? '-100%' : '0'}`,
      }}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
    >
      <label>
        Length
        <input
          ref={lengthField}
          value={length}
          onChange={(event) => setLength(event.target.value)}
          aria-invalid={error !== undefined}
          aria-describedby={error ? 'length-error' : undefined}
          inputMode="decimal"
          autoComplete="off"
          size={8}
        />
      </label>
      <label>
        Angle
        <input
          value={angle}
          onChange={(event) => setAngle(event.target.value)}
          placeholder={
            toward ? `${Math.round(bearingDeg(anchor, toward))}°` : '°'
          }
          inputMode="decimal"
          autoComplete="off"
          size={5}
        />
      </label>
      <button type="submit">Place</button>
      {error && (
        <p id="length-error" className="length-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

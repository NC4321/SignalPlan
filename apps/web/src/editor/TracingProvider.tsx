import { useRef, useState, type ReactNode } from 'react'
import { useEditorStore } from './context.ts'
import { Dialog } from './Dialog.tsx'
import { rememberImage } from './images.ts'
import { useServices } from './services.ts'
import { TracingContext } from './tracingContext.ts'
import {
  ACCEPTED_IMAGE_TYPES,
  blobToDataUrl,
  checkImageFile,
  initialPlacement,
  replaceBackground,
} from './tracing.ts'

/**
 * Adding a tracing image (D22): check it, store it, place it to fill the
 * view, then start calibration so its scale can be set. A floor that already
 * has an image gets it replaced, keeping its place and scale when the new
 * picture has the same proportions.
 */
export function TracingProvider({ children }: { children: ReactNode }) {
  const store = useEditorStore()
  const { library } = useServices()
  const input = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const addImage = async (file: File) => {
    const check = checkImageFile(file)
    if (!check.ok) {
      setError(check.reason)
      return
    }
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      setError(
        'This image couldn’t be read. Try exporting it again as PNG or JPEG.',
      )
      return
    }
    const state = store.getState()
    const canvas = document.querySelector('.editor-canvas')
    if (!state.camera || !canvas) {
      setError(
        'The image can only be placed from the 2D view. Switch to 2D, then choose it again.',
      )
      bitmap.close()
      return
    }
    const rect = canvas.getBoundingClientRect()
    const size = { widthPx: bitmap.width, heightPx: bitmap.height }
    const placement = initialPlacement(state.camera, rect, size)

    let source: { imageId: string } | { dataUrl: string }
    try {
      source = library
        ? { imageId: await library.addImage(file) }
        : { dataUrl: await blobToDataUrl(file) }
    } catch {
      setError(
        'This browser wouldn’t keep the image. Free some space or allow site storage, or try a smaller image.',
      )
      bitmap.close()
      return
    }
    rememberImage('imageId' in source ? source.imageId : source.dataUrl, bitmap)

    const floorId = state.floorId
    const current = state.plan.floors.find((f) => f.id === floorId)?.background
    let calibrateNext = true
    if (current) {
      const replaced = replaceBackground(current, source, size, placement)
      calibrateNext = replaced.needsCalibration
      state.edit('Replace tracing image', (plan) => {
        const floor = plan.floors.find((f) => f.id === floorId)
        if (floor) floor.background = replaced.background
      })
    } else {
      state.edit('Add tracing image', (plan) => {
        const floor = plan.floors.find((f) => f.id === floorId)
        if (!floor) return
        floor.background = {
          ...source,
          ...placement,
          ...size,
          opacity: 0.5,
          visible: true,
          locked: false,
        }
      })
    }
    state.select([])
    if (calibrateNext) state.setTool('calibrate')
    setNotice(
      check.large
        ? 'This image is over 10 MB, so plan files saved with it will be large.'
        : undefined,
    )
  }

  return (
    <TracingContext
      value={{ chooseImage: () => input.current?.click(), notice }}
    >
      {children}
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        hidden
        aria-label="Choose a floor plan image to trace"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void addImage(file)
        }}
      />
      <Dialog
        open={error !== undefined}
        title="This image can’t be used"
        onClose={() => setError(undefined)}
        actions={
          <button
            type="button"
            className="primary"
            onClick={() => setError(undefined)}
          >
            OK
          </button>
        }
      >
        <p>{error}</p>
      </Dialog>
    </TracingContext>
  )
}

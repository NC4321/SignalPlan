import { loadPlan, type Plan, type PlanIssue } from '@signalplan/floorplan'
import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from './context.ts'
import { Dialog, PlanIssues } from './Dialog.tsx'
import { ExportDialog } from './ExportDialog.tsx'
import { newPlanId } from './library.ts'
import {
  blankPlan,
  downloadPlan,
  FILE_EXTENSION,
  samplePlan,
} from './persistence.ts'
import { PlansDialog } from './PlansDialog.tsx'
import { useServices } from './services.ts'
import { embedImages, storeEmbeddedImages } from './tracing.ts'
import { useSurveyImport } from './surveyImportContext.ts'
import { useTracing } from './tracingContext.ts'
import { isTyping, MOD_KEY } from './util.ts'

/**
 * New, Open, Save, My plans and the sample home (D21). Every edited plan is
 * kept in the list, so switching plans never loses work and needs no
 * confirmation: the open plan is saved first.
 */
export function FileMenu() {
  const store = useEditorStore()
  const { library, autosaver } = useServices()
  const { chooseImage } = useTracing()
  const { chooseReadingsFile } = useSurveyImport()
  /** Saves the open plan to a file, with its tracing images embedded. */
  const saveToFile = async () => {
    const state = store.getState()
    downloadPlan(await embedImages(state.plan, library))
  }
  const menu = useRef<HTMLDetailsElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [plansOpen, setPlansOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [problem, setProblem] = useState<{
    file: string
    issues: PlanIssue[]
  }>()

  const summary = useRef<HTMLElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  /** Closes the menu, returning focus to "File" if it was inside it. */
  const closeMenu = () => {
    const element = menu.current
    if (!element?.open) return
    const hadFocus = element.contains(document.activeElement)
    element.removeAttribute('open')
    if (hadFocus) summary.current?.focus()
  }
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLButtonElement>(
      '.menu-items button:not(:disabled)',
    ) ?? []),
  ]

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) {
        menu.current?.removeAttribute('open')
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  /** Opens a new or sample plan; it joins the list on its first edit. */
  const startFresh = async (plan: Plan) => {
    closeMenu()
    await autosaver.flush()
    store.getState().loadPlan(plan, { pristine: true })
  }

  const openFile = async (file: File) => {
    const result = loadPlan(await file.text())
    if (!result.ok) {
      setProblem({ file: file.name, issues: result.issues })
      return
    }
    await autosaver.flush()
    // Opened files are your work: they join the list straight away. Their
    // embedded images move into the browser's image store.
    const plan = await storeEmbeddedImages(result.plan, library)
    const id = newPlanId()
    await library?.save(id, plan)
    store.getState().loadPlan(plan, { id })
  }

  // Ctrl/⌘+S saves to a file, Ctrl/⌘+O opens one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (isTyping(event) && key !== 's') return
      if (key === 's') {
        event.preventDefault()
        void saveToFile()
      } else if (key === 'o') {
        event.preventDefault()
        fileInput.current?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <>
      <details
        className="menu"
        ref={menu}
        onToggle={(event) => {
          const open = event.currentTarget.open
          setMenuOpen(open)
          // Opened from the keyboard, focus moves to the first item.
          if (open && summary.current?.matches(':focus-visible')) {
            items()[0]?.focus()
          }
        }}
        onKeyDown={(event) => {
          const list = items()
          const at = list.indexOf(document.activeElement as HTMLButtonElement)
          if (event.key === 'Escape' && menu.current?.open) {
            // Handled here so the editor's Esc (back to Select) doesn't fire.
            event.preventDefault()
            event.stopPropagation()
            closeMenu()
            summary.current?.focus()
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!menu.current?.open) {
              menu.current?.setAttribute('open', '')
              ;(event.key === 'ArrowDown' ? list[0] : list.at(-1))?.focus()
              return
            }
            const step = event.key === 'ArrowDown' ? 1 : -1
            const next = at === -1 ? (step === 1 ? 0 : -1) : at + step
            list.at(next % list.length)?.focus()
          } else if (event.key === 'Home' || event.key === 'End') {
            if (at === -1) return
            event.preventDefault()
            ;(event.key === 'Home' ? list[0] : list.at(-1))?.focus()
          }
        }}
        onBlur={(event) => {
          // Tabbing out of the menu closes it.
          const to = event.relatedTarget
          if (to instanceof Node && !event.currentTarget.contains(to)) {
            event.currentTarget.removeAttribute('open')
          }
        }}
      >
        <summary ref={summary}>File</summary>
        <div className="menu-items">
          <button type="button" onClick={() => void startFresh(blankPlan())}>
            New plan
          </button>
          <button
            type="button"
            disabled={!library}
            title={library ? undefined : 'This browser blocks storage'}
            onClick={() => {
              closeMenu()
              setPlansOpen(true)
            }}
          >
            My plans…
          </button>
          <button
            type="button"
            onClick={() => {
              closeMenu()
              fileInput.current?.click()
            }}
          >
            Open file… <kbd>{MOD_KEY}O</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              closeMenu()
              void saveToFile()
            }}
          >
            Save to file <kbd>{MOD_KEY}S</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              closeMenu()
              setExportOpen(true)
            }}
          >
            Export image…
          </button>
          <button
            type="button"
            onClick={() => {
              closeMenu()
              chooseImage()
            }}
          >
            Trace a floor plan image…
          </button>
          <button
            type="button"
            onClick={() => {
              closeMenu()
              chooseReadingsFile()
            }}
          >
            Import readings…
          </button>
          <button type="button" onClick={() => void startFresh(samplePlan())}>
            Open the sample home
          </button>
        </div>
      </details>

      <input
        ref={fileInput}
        type="file"
        accept={`${FILE_EXTENSION},.json,application/json`}
        hidden
        aria-label="Open a plan file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void openFile(file)
        }}
      />

      {library && (
        <PlansDialog
          open={plansOpen}
          library={library}
          onClose={() => setPlansOpen(false)}
        />
      )}

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />

      <Dialog
        open={problem !== undefined}
        title="This file can’t be opened"
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
        <p>“{problem?.file}” isn’t a SignalPlan plan, or it has problems:</p>
        <PlanIssues issues={problem?.issues ?? []} />
      </Dialog>
    </>
  )
}

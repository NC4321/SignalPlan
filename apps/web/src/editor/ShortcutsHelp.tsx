import { Fragment, useEffect, useState } from 'react'
import { Dialog } from './Dialog.tsx'
import { shortcutGroups, type Shortcut } from './shortcuts.ts'
import { isTyping, MOD_NAME } from './util.ts'

/**
 * The keyboard shortcuts overlay (D89): the top bar's "?" button, or the ?
 * key anywhere text isn't being typed, lists every shortcut by group.
 */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey) return
      if (event.altKey || isTyping(event)) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <button
        type="button"
        className="help-button"
        aria-label="Keyboard shortcuts"
        aria-keyshortcuts="?"
        title="Keyboard shortcuts (?)"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      <Dialog
        open={open}
        title="Keyboard shortcuts"
        wide
        onClose={() => setOpen(false)}
        actions={
          <button
            type="button"
            className="primary"
            onClick={() => setOpen(false)}
          >
            Done
          </button>
        }
      >
        {/* Scrollable on small screens, so it takes focus first: the list
            opens at the top, and arrow keys scroll it. */}
        <div
          className="shortcut-groups"
          tabIndex={0}
          role="region"
          aria-label="Shortcuts"
        >
          {shortcutGroups(MOD_NAME).map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl className="shortcuts">
                {group.shortcuts.map((shortcut) => (
                  <Fragment key={shortcut.does}>
                    <dt>
                      <Keys keys={shortcut.keys} />
                      {shortcut.or && (
                        <>
                          {' or '}
                          <Keys keys={shortcut.or} />
                        </>
                      )}
                    </dt>
                    <dd>{shortcut.does}</dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </Dialog>
    </>
  )
}

function Keys({ keys }: { keys: Shortcut['keys'] }) {
  return keys.map((key, i) => (
    <Fragment key={key}>
      {i > 0 && '+'}
      <kbd>{key}</kbd>
    </Fragment>
  ))
}

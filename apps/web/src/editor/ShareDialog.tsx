import { useEffect, useState } from 'react'
import type { Plan } from '@signalplan/floorplan'
import { useEditor } from './context.ts'
import { Dialog } from './Dialog.tsx'
import { LONG_LINK, shareLink, type ShareLink } from './shareLink.ts'

/**
 * File › Share link…: a link with the plan in it, to copy (D88). The plan
 * travels in the link itself, so nothing is uploaded anywhere.
 */
export function ShareDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const plan = useEditor((s) => s.plan)
  // The link with the plan it was made from: one made from an older plan
  // isn't shown while the new one is being made.
  const [made, setMade] = useState<{ plan: Plan; link: ShareLink }>()
  const [copied, setCopied] = useState<string>()
  useEffect(() => {
    if (!open) return
    let current = true
    void shareLink(plan, window.location.href).then((link) => {
      if (current) setMade({ plan, link })
    })
    return () => {
      current = false
    }
  }, [open, plan])
  const link = made?.plan === plan ? made.link : undefined
  const copy = () => {
    if (!link) return
    void navigator.clipboard?.writeText(link.url).then(
      () => setCopied(link.url),
      () => setCopied(undefined),
    )
  }
  const images = link?.imagesLeftOut ?? []
  return (
    <Dialog
      open={open}
      title="Share link"
      onClose={onClose}
      actions={
        <>
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="primary"
            disabled={!link}
            onClick={copy}
          >
            Copy link
          </button>
        </>
      }
    >
      <p>
        Anyone with this link can open a copy of the plan. The plan is in the
        link itself: nothing is uploaded.
      </p>
      <div className="share-link">
        <input
          type="text"
          readOnly
          aria-label="Link to this plan"
          value={link?.url ?? 'Making the link…'}
          onFocus={(event) => event.currentTarget.select()}
        />
        <span className="hint" aria-live="polite">
          {link && copied === link.url ? 'Copied' : ''}
        </span>
      </div>
      {images.length > 0 && (
        <p className="hint">
          The tracing {images.length === 1 ? 'image' : 'images'} (
          {images.join(', ')}) {images.length === 1 ? 'isn’t' : 'aren’t'} in the
          link. Save to file to share {images.length === 1 ? 'it' : 'them'} too.
        </p>
      )}
      {link && link.url.length > LONG_LINK && (
        <p className="hint">
          This link is {link.url.length.toLocaleString()} characters long, so
          some apps may cut it short. Save to file is safer for a plan this
          size.
        </p>
      )}
    </Dialog>
  )
}

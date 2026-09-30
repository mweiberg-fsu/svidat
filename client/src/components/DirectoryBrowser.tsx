import { useEffect, useRef, useState } from 'react'
import { browseDirectory, errorMessage } from '../api/client'
import type { DirectoryListing } from '../api/types'

interface DirectoryBrowserProps {
  // Folder to open first; falls back to the server's default if it fails.
  initialPath?: string
  // v250/v300 destinations must be writable: unwritable folders can still
  // be browsed through, but not selected.
  requireWritable?: boolean
  onSelect: (path: string) => void
  onClose: () => void
}

// Modal folder picker over the *server's* filesystem (GET /admin/browse).
export function DirectoryBrowser({ initialPath, requireWritable, onSelect, onClose }: DirectoryBrowserProps) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  const open = async (path?: string) => {
    setLoading(true)
    try {
      setListing(await browseDirectory(path))
      setError(null)
    } catch (err) {
      // Keep showing the current folder; just report why we couldn't move.
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    dialogRef.current?.focus()
    let cancelled = false
    const start = async () => {
      try {
        const first = await browseDirectory(initialPath || undefined)
        if (!cancelled) setListing(first)
      } catch {
        // A typo'd or deleted initial path: start from the default instead.
        if (cancelled) return
        try {
          const fallback = await browseDirectory(undefined)
          if (!cancelled) setListing(fallback)
        } catch (err) {
          if (!cancelled) setError(errorMessage(err))
        }
      }
    }
    void start()
    return () => {
      cancelled = true
    }
    // Only on mount: initialPath is the starting point, not a controlled value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const blocked = listing ? !listing.readable || (requireWritable && !listing.writable) : true

  return (
    <div className="dir-browser-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="dir-browser"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dir-browser-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="dir-browser-header">
          <span id="dir-browser-title">Choose a folder on the server</span>
          <button type="button" className="dir-browser-close" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>

        {listing && (
          <div className="dir-browser-shortcuts">
            {listing.shortcuts.map((s) => (
              <button
                key={s.label}
                type="button"
                className="admin-btn"
                title={s.path}
                disabled={loading}
                onClick={() => void open(s.path)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="dir-browser-location">
          <button
            type="button"
            className="admin-btn"
            aria-label="Up one folder"
            disabled={loading || !listing?.parent}
            onClick={() => listing?.parent && void open(listing.parent)}
          >
            ↑
          </button>
          <code className="dir-browser-path">{listing?.path ?? '…'}</code>
        </div>

        <ul className="dir-browser-list" aria-busy={loading}>
          {listing?.dirs.map((d) => {
            const dim = !d.readable || (requireWritable && !d.writable)
            return (
              <li key={d.path}>
                <button
                  type="button"
                  className={`dir-browser-entry${dim ? ' is-dim' : ''}`}
                  title={!d.readable ? 'Not readable' : requireWritable && !d.writable ? 'Not writable' : undefined}
                  disabled={loading}
                  onClick={() => void open(d.path)}
                >
                  <span aria-hidden="true">📁</span>
                  {d.name}
                </button>
              </li>
            )
          })}
          {listing && listing.dirs.length === 0 && <li className="dir-browser-empty">No subfolders</li>}
          {listing?.truncated && <li className="dir-browser-empty">Showing the first 1000 folders</li>}
        </ul>

        {error && <p className="admin-status admin-status-error">{error}</p>}
        {listing && !listing.readable && <p className="admin-hint">This folder is not readable.</p>}
        {listing && listing.readable && requireWritable && !listing.writable && (
          <p className="admin-hint">This folder is not writable.</p>
        )}

        <div className="dir-browser-actions">
          <button type="button" className="admin-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={loading || blocked}
            onClick={() => listing && onSelect(listing.path)}
          >
            Select this folder
          </button>
        </div>
      </div>
    </div>
  )
}

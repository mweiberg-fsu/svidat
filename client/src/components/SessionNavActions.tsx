import { useEffect, useRef, useState } from 'react'
import { getAuditHistory, revertAuditEntry } from '../api/client'
import type { AuditEntry } from '../api/types'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { ConfirmModal } from './ConfirmModal'
import { exportPlotsPng } from '../plotImage'

type Confirming = { kind: 'exit' } | { kind: 'revert'; entries: AuditEntry[] } | null

function errorText(err: unknown): string {
  return `Error: ${err instanceof Error ? err.message : String(err)}`
}

// Stroke icons (24x24, currentColor) so they follow the tab's text color.
function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  )
}

function ExitIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

// Navbar tab buttons for the file currently being viewed. Save Image opens a
// menu for picking which plotted variables to export as one PNG. Close
// Session opens a menu of session-level actions and needs an open edit session.
export function SessionNavActions() {
  const { file, variables } = usePlotSelection()
  const {
    sessionOpen,
    sessionOpenedAt,
    canEdit,
    closeSession,
    flagSelection,
    setFlagSelection,
    notifyFlagged,
  } = useEditSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [imageMenuOpen, setImageMenuOpen] = useState(false)
  const [imageVars, setImageVars] = useState<string[]>([])
  const imageMenuRef = useRef<HTMLDivElement | null>(null)

  // Close the menu on Escape or a click anywhere outside it.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [menuOpen])

  // Same dismissal rules as the Close Session menu.
  useEffect(() => {
    if (!imageMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImageMenuOpen(false)
    }
    const onMouseDown = (e: MouseEvent) => {
      if (imageMenuRef.current && !imageMenuRef.current.contains(e.target as Node)) {
        setImageMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [imageMenuOpen])

  // A picked-plots list belongs to the file it was opened for.
  useEffect(() => {
    setImageMenuOpen(false)
  }, [file])

  // A status message belongs to the file/session it was about.
  useEffect(() => {
    setStatus(null)
  }, [file, sessionOpen])

  // Both tabs are always shown; they're greyed out until there's something
  // to act on (a file for Save Image, an open edit session for Close Session).
  const canClose = Boolean(file) && canEdit && sessionOpen

  // Drop an open menu once Close Session stops being available, so it can't
  // reappear later. Keyed on canClose only -- also closing it when a session
  // *opens* would race a click that opened the menu right after.
  useEffect(() => {
    if (!canClose) setMenuOpen(false)
  }, [canClose])

  // Only this session's own flag edits (sessionOpenedAt scopes the history
  // to the lock holder), reverted newest-first so each revert restores the
  // flags exactly as they were before that edit.
  const startRevertAll = async () => {
    setMenuOpen(false)
    setStatus(null)
    try {
      const history: AuditEntry[] = await getAuditHistory(file, sessionOpenedAt ?? undefined)
      const entries = history
        .filter((e) => e.action === 'flag_edit' && !e.reverted)
        .sort((a, b) => b.id - a.id)
      if (entries.length === 0) {
        setStatus('No applied flags to revert')
        return
      }
      setConfirming({ kind: 'revert', entries })
    } catch (err) {
      setStatus(errorText(err))
    }
  }

  const revertAll = async (entries: AuditEntry[]) => {
    setConfirming(null)
    setBusy(true)
    let reverted = 0
    try {
      for (const e of entries) {
        await revertAuditEntry(e.id)
        reverted++
      }
      setStatus(`Reverted ${reverted} flag edit${reverted === 1 ? '' : 's'}`)
    } catch (err) {
      setStatus(
        `${errorText(err)} (reverted ${reverted} of ${entries.length} before stopping)`
      )
    } finally {
      setBusy(false)
      if (reverted > 0) notifyFlagged()
    }
  }

  // Every plot starts checked each time the menu opens.
  const toggleImageMenu = () => {
    if (!imageMenuOpen) setImageVars(variables)
    setImageMenuOpen((o) => !o)
  }

  const toggleImageVar = (name: string) =>
    setImageVars((prev) => (prev.includes(name) ? prev.filter((v) => v !== name) : [...prev, name]))

  const saveImage = async () => {
    setImageMenuOpen(false)
    setStatus(null)
    try {
      // `variables` order, not click order: plots stack as they appear on screen.
      await exportPlotsPng(
        variables.filter((v) => imageVars.includes(v)),
        `${file}_plots.png`
      )
    } catch (err) {
      setStatus(errorText(err))
    }
  }

  return (
    <div className="navbar-session-actions">
      <div className="navbar-tab-menu" ref={imageMenuRef}>
        <button
          type="button"
          className={`navbar-tab${imageMenuOpen ? ' open' : ''}`}
          aria-expanded={imageMenuOpen}
          disabled={!file}
          onClick={toggleImageMenu}
        >
          <ImageIcon />
          <span className="navbar-tab-label">Save Image</span>
        </button>
        {imageMenuOpen && file && (
          <div
            className="navbar-dropdown navbar-tab-dropdown navbar-image-dropdown"
            role="group"
            aria-label="Save image"
          >
            {variables.length === 0 ? (
              <p className="navbar-image-empty">No plots to save</p>
            ) : (
              <div className="navbar-image-options">
                {variables.map((name) => (
                  <label key={name} className="navbar-image-option">
                    <input
                      type="checkbox"
                      name={name}
                      checked={imageVars.includes(name)}
                      onChange={() => toggleImageVar(name)}
                    />
                    {name}
                  </label>
                ))}
              </div>
            )}
            <button
              type="button"
              className="navbar-dropdown-item navbar-image-save"
              disabled={imageVars.length === 0}
              onClick={saveImage}
            >
              Save PNG
            </button>
          </div>
        )}
      </div>
      <div className="navbar-tab-menu" ref={menuRef}>
        <button
          type="button"
          className={`navbar-tab${menuOpen ? ' open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={!canClose || busy}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <ExitIcon />
          <span className="navbar-tab-label">Close Session</span>
        </button>
        {menuOpen && canClose && (
          <div className="navbar-dropdown navbar-tab-dropdown" role="menu">
            <button
              type="button"
              role="menuitem"
              className="navbar-dropdown-item"
              onClick={() => {
                setMenuOpen(false)
                setConfirming({ kind: 'exit' })
              }}
            >
              Exit file
            </button>
            <button
              type="button"
              role="menuitem"
              className="navbar-dropdown-item"
              onClick={startRevertAll}
            >
              Revert all applied flags
            </button>
            <button
              type="button"
              role="menuitem"
              className="navbar-dropdown-item"
              disabled={!flagSelection}
              onClick={() => {
                setMenuOpen(false)
                setFlagSelection(null)
              }}
            >
              Remove highlighted area
            </button>
          </div>
        )}
      </div>
      {status && (
        <span role="status" className="navbar-session-status">
          {status}
        </span>
      )}
      {confirming?.kind === 'exit' && canClose && (
        <ConfirmModal
          title="Exit file?"
          confirmLabel="Exit file"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            closeSession()
          }}
        >
          <p>
            Close your edit session for <strong>{file}</strong>? The file will be unlocked so
            other editors can open it. Your unsaved edits are kept and you can resume them
            later, but they are not saved as a draft.
          </p>
        </ConfirmModal>
      )}
      {confirming?.kind === 'revert' && canClose && (
        <ConfirmModal
          title="Revert all applied flags?"
          confirmLabel="Revert flags"
          onCancel={() => setConfirming(null)}
          onConfirm={() => revertAll(confirming.entries)}
        >
          <p>
            Revert all {confirming.entries.length} flag edit
            {confirming.entries.length === 1 ? '' : 's'} applied to <strong>{file}</strong> in
            this session? Value edits are not affected.
          </p>
        </ConfirmModal>
      )}
    </div>
  )
}

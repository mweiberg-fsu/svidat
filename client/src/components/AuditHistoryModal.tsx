import { useEffect, useState } from 'react'
import { getAuditHistory, revertAuditEntry } from '../api/client'
import type { AuditEntry } from '../api/types'
import { useEditSession } from '../context/EditSessionContext'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useFloatingPanel } from '../hooks/useFloatingPanel'

const DEFAULT_WIDTH = 600
const DEFAULT_HEIGHT = 420
const MIN_WIDTH = 360
const MIN_HEIGHT = 240

export function AuditHistoryModal({ onClose }: { onClose: () => void }) {
  const { file } = usePlotSelection()
  const { notifyFlagged, sessionOpenedAt } = useEditSession()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [revertingId, setRevertingId] = useState<number | null>(null)
  const panel = useFloatingPanel({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  })

  const refresh = () => {
    setStatus(null)
    if (!file) {
      setEntries([])
      return
    }
    getAuditHistory(file, sessionOpenedAt ?? undefined)
      .then(setEntries)
      .catch((err) => {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  useEffect(refresh, [file, sessionOpenedAt])

  const handleRevert = async (id: number) => {
    setRevertingId(id)
    try {
      await revertAuditEntry(id)
      refresh()
      notifyFlagged()
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRevertingId(null)
    }
  }

  return (
    <div
      className="audit-history-modal"
      style={panel.style}
      onMouseDownCapture={panel.onPanelMouseDown}
    >
      <div className="audit-history-modal-header" onMouseDown={panel.onHeaderMouseDown}>
        <span>Audit History</span>
        <button
          type="button"
          className="audit-history-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          &times;
        </button>
      </div>
      <div className="audit-history-modal-body">
        {!file ? (
          <p>Select a file to view its audit history.</p>
        ) : (
          <>
            <ul>
              {entries.map((e) => (
                <li key={e.id}>
                  <span className="audit-history-entry-details">
                    {e.timestamp} — {e.username ?? `user #${e.user_id}`} — {e.action}{' '}
                    {e.var_name ?? ''} {e.old_value ?? ''} → {e.new_value ?? ''}
                  </span>
                  {e.action !== 'point_edit' && e.action !== 'bulk_edit' && e.action !== 'flag_edit'
                    ? null
                    : e.reverted ? (
                        <span className="audit-history-reverted-label">Reverted</span>
                      ) : (
                        <button
                          className="audit-history-revert-btn"
                          onClick={() => handleRevert(e.id)}
                          disabled={revertingId === e.id}
                        >
                          Revert
                        </button>
                      )}
                </li>
              ))}
            </ul>
            {entries.length === 0 && !status && <p>No edits yet.</p>}
          </>
        )}
        {status && <p role="status">{status}</p>}
      </div>
      <div className="audit-history-modal-resize-handle" onMouseDown={panel.onResizeMouseDown} />
    </div>
  )
}

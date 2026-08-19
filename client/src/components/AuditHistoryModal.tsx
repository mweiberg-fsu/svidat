import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyAuditHistory, revertAuditEntry } from '../api/client'
import type { AuditEntry } from '../api/types'
import { useEditSession } from '../context/EditSessionContext'

const DEFAULT_WIDTH = 600
const DEFAULT_HEIGHT = 420
const MIN_WIDTH = 360
const MIN_HEIGHT = 240

export function AuditHistoryModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { notifyFlagged } = useEditSession()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [revertingId, setRevertingId] = useState<number | null>(null)
  const [position, setPosition] = useState(() => ({
    top: Math.max(0, (window.innerHeight - DEFAULT_HEIGHT) / 2),
    left: Math.max(0, (window.innerWidth - DEFAULT_WIDTH) / 2),
  }))
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const draggingRef = useRef(false)
  const resizingRef = useRef(false)

  const refresh = () => {
    setStatus(null)
    getMyAuditHistory()
      .then(setEntries)
      .catch((err) => {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  useEffect(refresh, [])

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

  const handleHeaderMouseDown = (e: ReactMouseEvent) => {
    draggingRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startTop = position.top
    const startLeft = position.left
    const handleMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      const deltaX = ev.clientX - startX
      const deltaY = ev.clientY - startY
      const maxLeft = window.innerWidth - 40
      const maxTop = window.innerHeight - 40
      setPosition({
        top: Math.min(maxTop, Math.max(0, startTop + deltaY)),
        left: Math.min(maxLeft, Math.max(0, startLeft + deltaX)),
      })
    }
    const handleMouseUp = () => {
      draggingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const handleResizeMouseDown = (e: ReactMouseEvent) => {
    e.stopPropagation()
    resizingRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startWidth = size.width
    const startHeight = size.height
    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const deltaX = ev.clientX - startX
      const deltaY = ev.clientY - startY
      setSize({
        width: Math.max(MIN_WIDTH, startWidth + deltaX),
        height: Math.max(MIN_HEIGHT, startHeight + deltaY),
      })
    }
    const handleMouseUp = () => {
      resizingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div
      className="audit-history-modal"
      style={{ top: position.top, left: position.left, width: size.width, height: size.height }}
    >
      <div className="audit-history-modal-header" onMouseDown={handleHeaderMouseDown}>
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
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              <span className="audit-history-entry-details">
                {e.timestamp} —{' '}
                <a
                  href={`/files?file=${encodeURIComponent(e.filename ?? '')}`}
                  onClick={(ev) => {
                    ev.preventDefault()
                    navigate(`/files?file=${encodeURIComponent(e.filename ?? '')}`)
                  }}
                >
                  {e.filename}
                </a>{' '}
                — {e.action} {e.var_name ?? ''} {e.old_value ?? ''} → {e.new_value ?? ''}
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
        {status && <p role="status">{status}</p>}
      </div>
      <div className="audit-history-modal-resize-handle" onMouseDown={handleResizeMouseDown} />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { getAuditHistory, revertAuditEntry } from '../api/client'
import type { AuditEntry } from '../api/types'
import { useEditSession } from '../context/EditSessionContext'

export function AuditPanel({
  filename,
  refreshSignal,
}: {
  filename: string
  refreshSignal: number
}) {
  const { notifyFlagged, sessionOpenedAt } = useEditSession()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [revertingId, setRevertingId] = useState<number | null>(null)

  const refresh = () => {
    setStatus(null)
    getAuditHistory(filename, sessionOpenedAt ?? undefined)
      .then(setEntries)
      .catch((err) => {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  useEffect(refresh, [filename, refreshSignal, sessionOpenedAt])

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
    <div>
      <h2>Audit history (this session)</h2>
      <ul>
        {entries.map((e) => (
          <li key={e.id}>
            {e.timestamp} — {e.username ?? `user #${e.user_id}`} — {e.action} {e.var_name ?? ''}{' '}
            {e.old_value ?? ''} → {e.new_value ?? ''}
            {e.action !== 'point_edit' && e.action !== 'bulk_edit' && e.action !== 'flag_edit'
              ? null
              : e.reverted ? (
                  <span> Reverted</span>
                ) : (
                  <button onClick={() => handleRevert(e.id)} disabled={revertingId === e.id}>
                    Revert
                  </button>
                )}
          </li>
        ))}
      </ul>
      {status && <p role="status">{status}</p>}
    </div>
  )
}

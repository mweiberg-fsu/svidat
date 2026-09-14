import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyAuditHistory, listDrafts, revertAuditEntry, uploadAvatar } from '../api/client'
import type { AuditEntry } from '../api/types'
import { useAvatar } from '../hooks/useAvatar'
import { useAuth } from '../context/AuthContext'

const REVERTIBLE_ACTIONS = new Set(['point_edit', 'bulk_edit', 'flag_edit'])

export function ProfilePage() {
  const { id, username, roles, avatarVersion, bumpAvatarVersion } = useAuth()
  const avatarUrl = useAvatar(id, avatarVersion)
  const [status, setStatus] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [drafts, setDrafts] = useState<string[]>([])
  const [draftsError, setDraftsError] = useState<string | null>(null)
  const navigate = useNavigate()

  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditError, setAuditError] = useState<string | null>(null)
  const [revertingId, setRevertingId] = useState<number | null>(null)
  const [fileFilter, setFileFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const refreshAudit = () => {
    setAuditError(null)
    getMyAuditHistory()
      .then(setAuditEntries)
      .catch((err) => setAuditError(err instanceof Error ? err.message : String(err)))
  }

  useEffect(() => {
    if (roles.includes('qca')) {
      listDrafts()
        .then(setDrafts)
        .catch((err) => setDraftsError(err instanceof Error ? err.message : String(err)))
      refreshAudit()
    }
  }, [roles])

  const editedFiles = useMemo(
    () => [...new Set(auditEntries.map((e) => e.filename).filter((f): f is string => !!f))].sort(),
    [auditEntries]
  )

  const filteredAudit = useMemo(() => {
    return auditEntries.filter((e) => {
      if (fileFilter && e.filename !== fileFilter) return false
      if (dateFrom && e.timestamp < dateFrom) return false
      if (dateTo && e.timestamp > `${dateTo}T23:59:59`) return false
      return true
    })
  }, [auditEntries, fileFilter, dateFrom, dateTo])

  const handleRevert = async (id: number) => {
    setRevertingId(id)
    try {
      await revertAuditEntry(id)
      refreshAudit()
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : String(err))
    } finally {
      setRevertingId(null)
    }
  }

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setStatus(null)
    try {
      await uploadAvatar(file)
      bumpAvatarVersion()
      setStatus('Photo updated')
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="profile-page">
      <h1>Profile</h1>
      <div className="profile-card">
        {avatarUrl ? (
          <img className="profile-avatar" src={avatarUrl} alt="avatar" width={80} height={80} />
        ) : (
          <span className="profile-avatar profile-avatar-placeholder" aria-hidden="true" />
        )}
        <p className="profile-row">
          <b>Username:</b> {username}
        </p>
        <p className="profile-row">
          <b>Roles:</b> {roles.length ? roles.join(', ') : 'view only'}
        </p>
        <label className="profile-upload-label">
          Upload photo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFileChange}
            disabled={uploading}
          />
        </label>
        {status && <p role="status" className="profile-status">{status}</p>}
      </div>
      {roles.includes('qca') && (
        <section className="profile-drafts">
          <h2>My drafts</h2>
          {draftsError && <p role="status">Error: {draftsError}</p>}
          <ul>
            {drafts.map((f) => (
              <li key={f}>
                <a
                  href={`/files?file=${encodeURIComponent(f)}&source=draft`}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate(`/files?file=${encodeURIComponent(f)}&source=draft`)
                  }}
                >
                  {f}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {roles.includes('qca') && (
        <section className="profile-card-wide">
          <h2>Files edited</h2>
          {auditError && <p role="status">Error: {auditError}</p>}
          {editedFiles.length === 0 && !auditError && <p className="profile-hint">No edits yet.</p>}
          <ul className="profile-files-list">
            {editedFiles.map((f) => (
              <li key={f}>
                <a
                  href={`/files?file=${encodeURIComponent(f)}`}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate(`/files?file=${encodeURIComponent(f)}`)
                  }}
                >
                  {f}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {roles.includes('qca') && (
        <section className="profile-card-wide">
          <h2>Full audit history</h2>
          <div className="profile-audit-filters">
            <label className="admin-field">
              File
              <select value={fileFilter} onChange={(e) => setFileFilter(e.target.value)}>
                <option value="">All files</option>
                {editedFiles.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              From
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="admin-field">
              To
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
          </div>
          <ul className="profile-audit-list">
            {filteredAudit.map((e) => (
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
                {!REVERTIBLE_ACTIONS.has(e.action) ? null : e.reverted ? (
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
          {filteredAudit.length === 0 && !auditError && (
            <p className="profile-hint">No matching entries.</p>
          )}
        </section>
      )}
    </div>
  )
}

import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDrafts, uploadAvatar } from '../api/client'
import { useAvatar } from '../hooks/useAvatar'
import { useAuth } from '../context/AuthContext'

export function ProfilePage() {
  const { id, username, roles, avatarVersion, bumpAvatarVersion } = useAuth()
  const avatarUrl = useAvatar(id, avatarVersion)
  const [status, setStatus] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [drafts, setDrafts] = useState<string[]>([])
  const [draftsError, setDraftsError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (roles.includes('qca')) {
      listDrafts()
        .then(setDrafts)
        .catch((err) => setDraftsError(err instanceof Error ? err.message : String(err)))
    }
  }, [roles])

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
    </div>
  )
}

import { useEffect, useState, type ChangeEvent } from 'react'
import {
  createUser,
  deleteThemeLogo,
  deleteUser,
  fetchLogoBlobUrl,
  getOAuthSettings,
  getTheme,
  listUsers,
  updateOAuthSettings,
  updateThemeSettings,
  updateUserRoles,
  uploadThemeLogo,
} from '../api/client'
import type { ThemeSettings } from '../api/types'
import { applyTheme } from '../theme'
import { AdminConfigSection } from '../components/AdminConfigSection'

interface UserRow {
  id: number
  username: string
  roles: string[]
}

const ROLE_OPTIONS = ['admin', 'qca'] as const

const THEME_COLOR_FIELDS = [
  { key: 'primary_color', label: 'Primary color' },
  { key: 'secondary_color', label: 'Secondary color' },
  { key: 'tertiary_color', label: 'Tertiary color' },
] as const

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [newRoles, setNewRoles] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editRoles, setEditRoles] = useState<string[]>([])
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [allowedDomains, setAllowedDomains] = useState<string[]>([])
  const [domainInput, setDomainInput] = useState('')
  const [oauthStatus, setOauthStatus] = useState<string | null>(null)
  const [oauthSubmitting, setOauthSubmitting] = useState(false)

  const [themeForm, setThemeForm] = useState({
    primary_color: '',
    secondary_color: '',
    tertiary_color: '',
    save_draft_label: '',
    publish_label: '',
    site_name: '',
  })
  const [themeStatus, setThemeStatus] = useState<string | null>(null)
  const [themeSubmitting, setThemeSubmitting] = useState(false)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null)

  const refresh = () => {
    listUsers()
      .then(setUsers)
      .catch((err) => {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  useEffect(refresh, [])

  useEffect(() => {
    getOAuthSettings()
      .then((s) => setAllowedDomains(s.allowed_domains))
      .catch((err) => {
        setOauthStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      })
  }, [])

  const loadLogoPreview = (hasLogo: boolean) => {
    const next = hasLogo ? fetchLogoBlobUrl() : Promise.resolve(null)
    next.then((url) =>
      setLogoPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    )
  }

  const syncTheme = (theme: ThemeSettings) => {
    setThemeForm({
      primary_color: theme.primary_color,
      secondary_color: theme.secondary_color,
      tertiary_color: theme.tertiary_color,
      save_draft_label: theme.save_draft_label,
      publish_label: theme.publish_label,
      site_name: theme.site_name,
    })
    loadLogoPreview(theme.has_logo)
  }

  useEffect(() => {
    getTheme()
      .then(syncTheme)
      .catch((err) => {
        setThemeStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      })
  }, [])

  const toggleNewRole = (role: string) => {
    setNewRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  const handleCreate = async () => {
    setSubmitting(true)
    try {
      await createUser(username, password, newRoles)
      setUsername('')
      setPassword('')
      setNewRoles([])
      setStatus('User created')
      refresh()
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    setSubmitting(true)
    try {
      await deleteUser(id)
      setStatus('User deleted')
      refresh()
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = (user: UserRow) => {
    setEditingId(user.id)
    setEditRoles(user.roles)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditRoles([])
  }

  const toggleEditRole = (role: string) => {
    setEditRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  const saveEdit = async (userId: number) => {
    setEditSubmitting(true)
    try {
      const updated = await updateUserRoles(userId, editRoles)
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, roles: updated.roles } : u)))
      setEditingId(null)
      setEditRoles([])
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setEditSubmitting(false)
    }
  }

  const saveDomains = async (next: string[]) => {
    setOauthStatus(null)
    setOauthSubmitting(true)
    try {
      const saved = await updateOAuthSettings(next)
      setAllowedDomains(saved.allowed_domains)
      setOauthStatus('Domain list updated')
    } catch (err) {
      setOauthStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setOauthSubmitting(false)
    }
  }

  const handleAddDomain = () => {
    const domain = domainInput.trim().toLowerCase()
    if (!domain) return
    setDomainInput('')
    saveDomains([...new Set([...allowedDomains, domain])])
  }

  const handleRemoveDomain = (domain: string) => {
    saveDomains(allowedDomains.filter((d) => d !== domain))
  }

  const handleSaveTheme = async () => {
    setThemeStatus(null)
    setThemeSubmitting(true)
    try {
      const saved = await updateThemeSettings(themeForm)
      syncTheme(saved)
      applyTheme(saved)
      setThemeStatus('Theme updated')
    } catch (err) {
      setThemeStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setThemeSubmitting(false)
    }
  }

  const runLogoChange = async (action: () => Promise<ThemeSettings>, success: string) => {
    setThemeStatus(null)
    setThemeSubmitting(true)
    try {
      const saved = await action()
      loadLogoPreview(saved.has_logo)
      applyTheme(saved)
      setThemeStatus(success)
    } catch (err) {
      setThemeStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setThemeSubmitting(false)
    }
  }

  const handleLogoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    runLogoChange(() => uploadThemeLogo(file), 'Logo updated')
  }

  return (
    <div className="admin-page">
      <h1>Users</h1>

      <section className="admin-card">
        <h2>All users</h2>
        <ul className="admin-user-list">
          {users.map((u) => (
            <li key={u.id} className="admin-user-row">
              {editingId === u.id ? (
                <>
                  <span className="admin-user-name">{u.username}</span>
                  <div className="admin-role-checks">
                    {ROLE_OPTIONS.map((r) => (
                      <label key={r} className="admin-role-check">
                        <input
                          type="checkbox"
                          checked={editRoles.includes(r)}
                          onChange={() => toggleEditRole(r)}
                          disabled={editSubmitting}
                        />
                        {r}
                      </label>
                    ))}
                  </div>
                  <div className="admin-user-actions">
                    <button
                      className="admin-btn admin-btn-primary"
                      onClick={() => saveEdit(u.id)}
                      disabled={editSubmitting}
                    >
                      Save
                    </button>
                    <button className="admin-btn" onClick={cancelEdit} disabled={editSubmitting}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="admin-user-name">{u.username}</span>
                  <div className="admin-role-badges">
                    {u.roles.length ? (
                      u.roles.map((r) => (
                        <span key={r} className="admin-role-badge">
                          {r}
                        </span>
                      ))
                    ) : (
                      <span className="admin-role-badge admin-role-badge-muted">view only</span>
                    )}
                  </div>
                  <div className="admin-user-actions">
                    <button className="admin-btn" onClick={() => startEdit(u)} disabled={submitting}>
                      Edit
                    </button>
                    <button
                      className="admin-btn admin-btn-danger"
                      onClick={() => handleDelete(u.id)}
                      disabled={submitting}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-card">
        <h2>Add user</h2>
        <div className="admin-form-row">
          <label className="admin-field">
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="admin-field">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        <div className="admin-role-checks">
          {ROLE_OPTIONS.map((r) => (
            <label key={r} className="admin-role-check">
              <input
                type="checkbox"
                checked={newRoles.includes(r)}
                onChange={() => toggleNewRole(r)}
              />
              {r}
            </label>
          ))}
        </div>
        <button className="admin-btn admin-btn-primary" onClick={handleCreate} disabled={submitting}>
          Create user
        </button>

        {status && (
          <p className={`admin-status ${status.startsWith('Error') ? 'admin-status-error' : ''}`}>
            {status}
          </p>
        )}
      </section>

      <section className="admin-card">
        <h2>OAuth allowed email domains</h2>
        <p className="admin-hint">
          Empty list = any Google/Microsoft account may sign in and auto-create an account.
        </p>
        <ul className="admin-domain-list">
          {allowedDomains.map((d) => (
            <li key={d} className="admin-domain-chip">
              {d}
              <button
                className="admin-domain-remove"
                onClick={() => handleRemoveDomain(d)}
                disabled={oauthSubmitting}
                aria-label={`Remove ${d}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="admin-form-row">
          <label className="admin-field">
            New domain
            <input
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="fsu.edu"
              disabled={oauthSubmitting}
            />
          </label>
          <button
            className="admin-btn admin-btn-primary admin-btn-inline"
            onClick={handleAddDomain}
            disabled={oauthSubmitting}
          >
            Add domain
          </button>
        </div>

        {oauthStatus && (
          <p className={`admin-status ${oauthStatus.startsWith('Error') ? 'admin-status-error' : ''}`}>
            {oauthStatus}
          </p>
        )}
      </section>

      <section className="admin-card">
        <h2>Theme</h2>
        <div className="admin-form-row">
          <label className="admin-field">
            Site name
            <input
              type="text"
              value={themeForm.site_name}
              maxLength={64}
              onChange={(e) => setThemeForm((prev) => ({ ...prev, site_name: e.target.value }))}
              disabled={themeSubmitting}
            />
          </label>
        </div>
        <div className="admin-form-row">
          <label className="admin-field">
            Save draft button text
            <input
              type="text"
              value={themeForm.save_draft_label}
              maxLength={32}
              onChange={(e) =>
                setThemeForm((prev) => ({ ...prev, save_draft_label: e.target.value }))
              }
              disabled={themeSubmitting}
            />
          </label>
          <label className="admin-field">
            Publish button text
            <input
              type="text"
              value={themeForm.publish_label}
              maxLength={32}
              onChange={(e) =>
                setThemeForm((prev) => ({ ...prev, publish_label: e.target.value }))
              }
              disabled={themeSubmitting}
            />
          </label>
        </div>
        <div className="admin-logo-row">
          {logoPreviewUrl ? (
            <img className="admin-logo-preview" src={logoPreviewUrl} alt="Current logo" />
          ) : (
            <span className="admin-hint">No logo set</span>
          )}
          <label className="admin-btn admin-btn-inline">
            {logoPreviewUrl ? 'Replace logo' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleLogoFile}
              disabled={themeSubmitting}
              hidden
            />
          </label>
          {logoPreviewUrl && (
            <button
              className="admin-btn admin-btn-inline admin-btn-danger"
              onClick={() => runLogoChange(deleteThemeLogo, 'Logo removed')}
              disabled={themeSubmitting}
            >
              Remove logo
            </button>
          )}
        </div>
        <div className="admin-form-row">
          {THEME_COLOR_FIELDS.map(({ key, label }) => (
            <label key={key} className="admin-field">
              {label}
              <span className="admin-color-row">
                <span
                  className="admin-color-swatch"
                  style={{ backgroundColor: themeForm[key] }}
                  data-testid={`swatch-${key}`}
                  aria-hidden="true"
                />
                <input
                  type="color"
                  value={themeForm[key]}
                  onChange={(e) =>
                    setThemeForm((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  disabled={themeSubmitting}
                />
              </span>
            </label>
          ))}
        </div>
        <button
          className="admin-btn admin-btn-primary"
          onClick={handleSaveTheme}
          disabled={themeSubmitting}
        >
          Save theme
        </button>

        {themeStatus && (
          <p className={`admin-status ${themeStatus.startsWith('Error') ? 'admin-status-error' : ''}`}>
            {themeStatus}
          </p>
        )}
      </section>

      <AdminConfigSection />
    </div>
  )
}

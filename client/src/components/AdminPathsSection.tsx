import { useEffect, useState } from 'react'
import { errorMessage, getPathSettings, updatePathSettings } from '../api/client'
import type { PathLists, PathSettings } from '../api/types'

const BLOCKS = [
  { key: 'raw_dirs', label: 'Read files from', defaultKey: 'raw' },
  { key: 'draft_dirs', label: 'Save v250 drafts to', defaultKey: 'draft' },
  { key: 'published_dirs', label: 'Publish v300 files to', defaultKey: 'published' },
] as const

type ListKey = (typeof BLOCKS)[number]['key']

function PathListEditor({
  label,
  paths,
  defaultPath,
  onSave,
  disabled,
  status,
}: {
  label: string
  paths: string[]
  defaultPath: string
  onSave: (next: string[]) => Promise<boolean>
  disabled: boolean
  status: string | null
}) {
  const [draft, setDraft] = useState('')

  const add = async () => {
    const value = draft.trim()
    if (!value || disabled) return
    if (await onSave([...paths, value])) setDraft('')
  }

  return (
    <div>
      <h3 className="admin-subheading">{label}</h3>
      {paths.length === 0 && (
        <p className="admin-hint">
          Using default: <code>{defaultPath}</code>
        </p>
      )}
      {paths.length > 0 && (
        <ul className="admin-path-list">
          {paths.map((p) => (
            <li key={p} className="admin-path-row">
              <code>{p}</code>
              <button
                type="button"
                className="admin-btn admin-btn-danger"
                aria-label={`Remove ${p}`}
                disabled={disabled}
                onClick={() => onSave(paths.filter((x) => x !== p))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="admin-form-row">
        <div className="admin-field admin-path-input">
          <input
            type="text"
            aria-label={`New ${label} path`}
            placeholder="/absolute/path"
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void add()
              }
            }}
          />
        </div>
        <button
          type="button"
          className="admin-btn admin-btn-inline"
          aria-label={`Add ${label} path`}
          disabled={disabled || !draft.trim()}
          onClick={() => void add()}
        >
          +
        </button>
      </div>
      {status && (
        <p className={`admin-status ${status.startsWith('Error') ? 'admin-status-error' : ''}`}>{status}</p>
      )}
    </div>
  )
}

export function AdminPathsSection() {
  const [settings, setSettings] = useState<PathSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [statuses, setStatuses] = useState<Partial<Record<ListKey | 'load', string>>>({})

  useEffect(() => {
    getPathSettings()
      .then(setSettings)
      .catch((err) => setStatuses({ load: `Error: ${errorMessage(err)}` }))
  }, [])

  const save = async (key: ListKey, next: string[]): Promise<boolean> => {
    if (!settings) return false
    const lists: PathLists = {
      raw_dirs: settings.raw_dirs,
      draft_dirs: settings.draft_dirs,
      published_dirs: settings.published_dirs,
      [key]: next,
    }
    setSaving(true)
    setStatuses({})
    try {
      setSettings(await updatePathSettings(lists))
      return true
    } catch (err) {
      setStatuses({ [key]: `Error saving paths: ${errorMessage(err)}` })
      return false
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return statuses.load ? <p className="admin-status admin-status-error">{statuses.load}</p> : null
  }

  return (
    <div>
      {BLOCKS.map((b) => (
        <PathListEditor
          key={b.key}
          label={b.label}
          paths={settings[b.key]}
          defaultPath={settings.defaults[b.defaultKey]}
          disabled={saving}
          status={statuses[b.key] ?? null}
          onSave={(next) => save(b.key, next)}
        />
      ))}
    </div>
  )
}

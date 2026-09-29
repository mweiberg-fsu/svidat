import { useState } from 'react'
import type { CustomTrigger } from '../api/types'
import { MAX_CUSTOM_TRIGGER_NAME_LENGTH, recordedLabel, triggerKind, validateCustomTrigger } from '../appConfig'
import { TriggerRecorder } from './TriggerRecorder'

interface CustomTriggersListProps {
  triggers: CustomTrigger[]
  // Persists the whole next list; rejects with the server error.
  onSave: (next: CustomTrigger[]) => Promise<void>
  disabled?: boolean
}

// Named, recorded keybinds. Adding/deleting saves immediately (separate from
// the keybindings form's Save), and the saved entries show up as options in
// the gesture dropdowns.
export function CustomTriggersList({ triggers, onSave, disabled }: CustomTriggersListProps) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const error = trigger ? validateCustomTrigger({ name, trigger }, triggers) : null
  const busy = disabled || saving

  const closeAdd = () => {
    setAdding(false)
    setName('')
    setTrigger(null)
  }

  const save = async (next: CustomTrigger[], okMessage: string) => {
    setStatus(null)
    setSaving(true)
    try {
      await onSave(next)
      setStatus(okMessage)
      return true
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  const add = async () => {
    if (!trigger || error) return
    if (await save([...triggers, { name: name.trim(), trigger }], 'Keybind added')) closeAdd()
  }

  return (
    <div className="custom-triggers">
      {triggers.length > 0 && (
        <ul className="custom-triggers-list">
          {triggers.map((t, idx) => (
            <li key={t.trigger} className="custom-trigger-row">
              <span className="custom-trigger-name">{t.name}</span>
              <span className="custom-trigger-label">{recordedLabel(t.trigger)}</span>
              <span className="custom-trigger-kind">{triggerKind(t.trigger) ?? '?'}</span>
              <button
                type="button"
                className="custom-trigger-delete"
                aria-label={`Delete ${t.name}`}
                onClick={() => save(triggers.filter((_, i) => i !== idx), 'Keybind removed')}
                disabled={busy}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="custom-trigger-add">
          <label className="admin-field">
            Name
            <input
              type="text"
              value={name}
              maxLength={MAX_CUSTOM_TRIGGER_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
          <TriggerRecorder value={trigger} onChange={setTrigger} disabled={busy} />
          {error && <p className="admin-status admin-status-error">{error}</p>}
          <div className="custom-trigger-add-actions">
            <button type="button" onClick={add} disabled={busy || !trigger || !name.trim() || Boolean(error)}>
              Add
            </button>
            <button type="button" onClick={closeAdd} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="custom-trigger-plus"
          aria-label="Add keybind"
          onClick={() => {
            setStatus(null)
            setAdding(true)
          }}
          disabled={busy}
        >
          +
        </button>
      )}

      {status && (
        <p role="status" className="admin-status">
          {status}
        </p>
      )}
    </div>
  )
}

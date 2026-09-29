import type { KeyBindings } from '../api/types'
import { CLICK_TRIGGERS, DRAG_TRIGGERS, GESTURES, findConflict, triggerLabel } from '../appConfig'

interface KeybindingsFieldsProps {
  value: KeyBindings
  onChange: (next: KeyBindings) => void
  disabled?: boolean
}

export function KeybindingsFields({ value, onChange, disabled }: KeybindingsFieldsProps) {
  const conflict = findConflict(value)

  const setBinding = (key: keyof KeyBindings, next: string) => onChange({ ...value, [key]: next })

  return (
    <>
      <div className="admin-form-row">
        {GESTURES.map((g) => {
          const builtIns: readonly string[] = g.kind === 'drag' ? DRAG_TRIGGERS : CLICK_TRIGGERS
          const current = value[g.key]
          return (
            <label key={g.key} className="admin-field">
              {g.label}
              <select value={current} onChange={(e) => setBinding(g.key, e.target.value)} disabled={disabled}>
                {builtIns.map((t) => (
                  <option key={t} value={t}>
                    {triggerLabel(t, g.kind)}
                  </option>
                ))}
                {/* A value set outside this dropdown (e.g. via the API, or a
                    canonical mods/button/action string) still needs to show
                    as the select's current option. */}
                {!builtIns.includes(current) && <option value={current}>{triggerLabel(current, g.kind)}</option>}
              </select>
            </label>
          )
        })}
      </div>
      {conflict && <p className="admin-status admin-status-error">{conflict}</p>}
    </>
  )
}

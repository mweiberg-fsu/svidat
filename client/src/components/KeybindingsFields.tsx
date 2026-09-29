import type { CustomTrigger, KeyBindings } from '../api/types'
import {
  CLICK_TRIGGERS,
  DRAG_TRIGGERS,
  GESTURES,
  canonicalTrigger,
  findConflict,
  triggerKind,
  triggerLabel,
} from '../appConfig'

export interface TriggerGroup {
  label: string
  triggers: CustomTrigger[]
}

interface KeybindingsFieldsProps {
  value: KeyBindings
  onChange: (next: KeyBindings) => void
  disabled?: boolean
  // Named custom trigger lists offered after the built-ins, in order
  // (e.g. Shared, then Mine). Earlier groups win on duplicate triggers.
  customGroups?: TriggerGroup[]
}

interface Option {
  value: string
  text: string
}

function optionGroups(kind: 'drag' | 'click', customGroups: TriggerGroup[]) {
  const builtIns: readonly string[] = kind === 'drag' ? DRAG_TRIGGERS : CLICK_TRIGGERS
  const seen = new Set<string>()
  const take = (value: string) => {
    const canon = canonicalTrigger(value, kind)
    if (!canon || seen.has(canon)) return false
    seen.add(canon)
    return true
  }
  const groups: { label: string; options: Option[] }[] = [
    {
      label: 'Built-in',
      options: builtIns.filter(take).map((t) => ({ value: t, text: triggerLabel(t, kind) })),
    },
  ]
  for (const g of customGroups) {
    const options = g.triggers
      .filter((t) => triggerKind(t.trigger) === kind && take(t.trigger))
      .map((t) => ({ value: t.trigger, text: `${t.name} — ${triggerLabel(t.trigger, kind)}` }))
    if (options.length) groups.push({ label: g.label, options })
  }
  return groups
}

export function KeybindingsFields({ value, onChange, disabled, customGroups = [] }: KeybindingsFieldsProps) {
  const conflict = findConflict(value)

  const setBinding = (key: keyof KeyBindings, next: string) => onChange({ ...value, [key]: next })

  return (
    <>
      <div className="admin-form-row">
        {GESTURES.map((g) => {
          const groups = optionGroups(g.kind, customGroups)
          const current = value[g.key]
          const currentCanon = canonicalTrigger(current, g.kind)
          // Match on canonical form so a legacy token and its canonical twin
          // select the same option.
          const match = groups
            .flatMap((grp) => grp.options)
            .find((o) => currentCanon !== null && canonicalTrigger(o.value, g.kind) === currentCanon)
          return (
            <label key={g.key} className="admin-field">
              {g.label}
              <select
                value={match ? match.value : current}
                onChange={(e) => setBinding(g.key, e.target.value)}
                disabled={disabled}
              >
                {groups.map((grp) => (
                  <optgroup key={grp.label} label={grp.label}>
                    {grp.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.text}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {/* A value no option offers (set via the API, or a custom
                    trigger since deleted) still shows as the current option. */}
                {!match && <option value={current}>{triggerLabel(current, g.kind)}</option>}
              </select>
            </label>
          )
        })}
      </div>
      {conflict && <p className="admin-status admin-status-error">{conflict}</p>}
    </>
  )
}

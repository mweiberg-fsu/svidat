import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import type { Modifier } from '../api/types'
import { recordedLabel } from '../appConfig'

const BUTTONS = ['left', 'middle', 'right'] as const
// Matches the plots' drag-vs-click threshold closely enough for recording.
const DRAG_THRESHOLD_PX = 4

function modsOf(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): string {
  const mods: Modifier[] = []
  if (e.shiftKey) mods.push('shift')
  if (e.ctrlKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.metaKey) mods.push('meta')
  return mods.join('+') || 'none'
}

interface TriggerRecorderProps {
  value: string | null
  onChange: (trigger: string | null) => void
  disabled?: boolean
}

// Capture box: hold modifiers, then click / drag / double-click any mouse
// button inside it. Emits a canonical "<mods>/<button>/<action>" string.
// Modifiers are read at press time, like the plots do.
export function TriggerRecorder({ value, onChange, disabled }: TriggerRecorderProps) {
  const pendingUp = useRef<((e: MouseEvent) => void) | null>(null)

  const stopListening = useCallback(() => {
    if (pendingUp.current) window.removeEventListener('mouseup', pendingUp.current)
    window.removeEventListener('blur', stopListening)
    pendingUp.current = null
  }, [])
  useEffect(() => stopListening, [stopListening])
  useEffect(() => {
    if (disabled) stopListening()
  }, [disabled, stopListening])

  const onMouseDown = (e: ReactMouseEvent) => {
    const button = BUTTONS[e.button]
    if (disabled || !button) return
    e.preventDefault()
    stopListening()
    const mods = modsOf(e)
    const { clientX: x0, clientY: y0, button: down } = e
    const onUp = (up: MouseEvent) => {
      if (up.button !== down) return
      stopListening()
      const moved = Math.hypot(up.clientX - x0, up.clientY - y0) > DRAG_THRESHOLD_PX
      const action = moved ? 'drag' : up.detail >= 2 ? 'dblclick' : 'click'
      onChange(`${mods}/${button}/${action}`)
    }
    pendingUp.current = onUp
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', stopListening)
  }

  return (
    <div className="trigger-recorder">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Record keybind"
        aria-disabled={disabled}
        className={`trigger-recorder-box${value ? ' has-value' : ''}`}
        onMouseDown={onMouseDown}
        onContextMenu={(e) => e.preventDefault()}
        onAuxClick={(e) => e.preventDefault()}
      >
        {value ? recordedLabel(value) : 'Hold keys, then click / drag / double-click here'}
      </div>
      {value && (
        <button type="button" onClick={() => onChange(null)} disabled={disabled}>
          Re-record
        </button>
      )}
    </div>
  )
}

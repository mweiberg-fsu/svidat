import { setColorMode, useColorMode } from '../colorMode'

export function ColorModeSwitch({ className }: { className?: string }) {
  const mode = useColorMode()
  const isDark = mode === 'dark'
  return (
    <label className={className ? `color-mode-switch ${className}` : 'color-mode-switch'}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={isDark}
        checked={isDark}
        onChange={(e) => setColorMode(e.target.checked ? 'dark' : 'light')}
      />
      <span className="color-mode-switch-track" aria-hidden="true">
        <span className="color-mode-switch-thumb" />
      </span>
      <span className="color-mode-switch-label">Dark mode</span>
    </label>
  )
}

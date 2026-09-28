import { GESTURES, triggerLabel, useAppConfig } from '../appConfig'
import type { KeyBindings } from '../api/types'
import { useFloatingPanel } from '../hooks/useFloatingPanel'

// Condensed version of the Documentation "Controls" tab: a quick-reference
// table built from the live keybindings (so admin rebinds show up here).
// Each row: the key combos (alternatives, one per line) and the action.
function bindingRows(bindings: KeyBindings): [string[], string][] {
  const label = (key: keyof KeyBindings) => {
    const gesture = GESTURES.find((g) => g.key === key)!
    return triggerLabel(bindings[key], gesture.kind)
  }
  return [
    [['Click row'], 'Set active variable'],
    [['Drag row'], 'Select range (qca)'],
    [[label('x_zoom')], 'Zoom X axis'],
    [[label('y_zoom')], 'Zoom Y axis'],
    [[label('undo'), 'Right-click'], 'Undo zoom'],
    [[label('redo'), 'Shift+right-click'], 'Redo zoom'],
    [['Drag right edge'], 'Resize sidebar'],
  ]
}

export function KeybindsModal({ onClose }: { onClose: () => void }) {
  const { keybindings } = useAppConfig()
  const panel = useFloatingPanel({ width: 280, height: 440, minWidth: 200, minHeight: 200 })

  return (
    <div className="keybinds-modal" style={panel.style} onMouseDownCapture={panel.onPanelMouseDown}>
      <div className="keybinds-modal-header" onMouseDown={panel.onHeaderMouseDown}>
        <span>Keybinds</span>
        <button type="button" className="keybinds-modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
      </div>
      <div className="keybinds-modal-body">
        <table className="keybinds-table">
          <tbody>
            {bindingRows(keybindings).map(([keys, action]) => (
              <tr key={action}>
                <th scope="row">
                  {keys.map((k) => (
                    <div key={k} className="keybinds-key">
                      {k}
                    </div>
                  ))}
                </th>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="keybinds-modal-resize-handle" onMouseDown={panel.onResizeMouseDown} />
    </div>
  )
}

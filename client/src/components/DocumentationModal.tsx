import { useState } from 'react'
import { fillPlaceholders, useAppConfig } from '../appConfig'
import { Markdown } from './Markdown'

// Tabs and their Markdown text come from the admin panel's Configuration
// section (see appConfig.ts); {{x_zoom}}-style placeholders are filled in
// with the current keybindings.
export function DocumentationModal({ onClose }: { onClose: () => void }) {
  const { documentation, keybindings } = useAppConfig()
  const [activeIdx, setActiveIdx] = useState(0)
  // An admin can delete tabs while this is open — fall back to the first.
  const active = documentation[activeIdx] ?? documentation[0]

  return (
    <div className="documentation-modal">
      <div className="documentation-modal-header">
        <span>Documentation</span>
        <button
          type="button"
          className="documentation-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          &times;
        </button>
      </div>
      <div className="documentation-modal-tabs" role="tablist">
        {documentation.map((tab, idx) => (
          <button
            key={`${idx}-${tab.title}`}
            type="button"
            role="tab"
            aria-selected={tab === active}
            className={tab === active ? 'documentation-modal-tab active' : 'documentation-modal-tab'}
            onClick={() => setActiveIdx(idx)}
          >
            {tab.title}
          </button>
        ))}
      </div>
      <div className="documentation-modal-body">
        {active && <Markdown source={fillPlaceholders(active.body, keybindings)} />}
      </div>
    </div>
  )
}

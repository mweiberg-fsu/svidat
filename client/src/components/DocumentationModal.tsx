import { useState } from 'react'

type DocsTab = 'overview' | 'workflow' | 'controls'

const TABS: { id: DocsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'controls', label: 'Controls' },
]

export function DocumentationModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<DocsTab>('overview')

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
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'documentation-modal-tab active' : 'documentation-modal-tab'}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="documentation-modal-body">
        {activeTab === 'overview' && (
          <div>
            <p>
              svidat is a netCDF quality-control tool. It lets you browse, plot, and
              hand-edit variable data in netCDF files, with every change tracked in an
              audit log.
            </p>
            <h3>Roles</h3>
            <ul>
              <li><strong>admin</strong> — full access, manages users.</li>
              <li><strong>qca</strong> — can edit, save, and publish files.</li>
              <li><strong>user</strong> — view only.</li>
            </ul>
          </div>
        )}
        {activeTab === 'workflow' && (
          <div>
            <h3>File lifecycle</h3>
            <ol>
              <li>A file is uploaded as <strong>raw</strong> — the original, read-only source.</li>
              <li>A qca/admin user opens an edit session, creating their own working copy.</li>
              <li>Point edits, bulk edits, and flag edits write to that working copy.</li>
              <li><strong>Save</strong> copies the working copy into a draft version.</li>
              <li><strong>Publish</strong> copies the working copy into the published version.</li>
              <li>Every edit is recorded in the audit history and can be reverted.</li>
            </ol>
          </div>
        )}
        {activeTab === 'controls' && (
          <div>
            <h3>Plot gestures</h3>
            <ul>
              <li>Click a row — set that row as the active variable.</li>
              <li>Drag on a row (admin/qca only) — select a point range and open the flag toolbar.</li>
              <li>Shift+drag — zoom the X axis.</li>
              <li>Ctrl+drag — zoom the Y axis.</li>
              <li>Right-click — undo the last zoom.</li>
              <li>Shift+right-click or double-click — redo zoom.</li>
              <li>Cmd+click — undo.</li>
              <li>Escape — cancel an open flag-selection popover.</li>
            </ul>
            <h3>Sidebar</h3>
            <ul>
              <li>Drag the sidebar's right edge to resize it.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

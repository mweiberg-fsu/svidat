import { useEffect, useState } from 'react'
import { getConfig, updateConfig } from '../api/client'
import type { AppConfig, ClickTrigger, DocTab, KeyBindings } from '../api/types'
import {
  DEFAULT_DOCUMENTATION,
  DEFAULT_KEYBINDINGS,
  GESTURES,
  applyConfig,
  fillPlaceholders,
  triggerLabel,
} from '../appConfig'
import { Markdown } from './Markdown'

const DRAG_TRIGGERS: ClickTrigger[] = ['shift', 'ctrl', 'alt', 'meta']
const CLICK_TRIGGERS: ClickTrigger[] = [...DRAG_TRIGGERS, 'dblclick']
// Keep in sync with server/app/schemas.py.
const MAX_DOC_TABS = 10
const MAX_DOC_TAB_TITLE_LENGTH = 40

function findConflict(bindings: KeyBindings): string | null {
  const seen = new Map<string, string>()
  for (const g of GESTURES) {
    const other = seen.get(bindings[g.key])
    if (other) return `"${other}" and "${g.label}" can't share the same binding.`
    seen.set(bindings[g.key], g.label)
  }
  return null
}

export function AdminConfigSection() {
  const [form, setForm] = useState<AppConfig>({
    keybindings: DEFAULT_KEYBINDINGS,
    documentation: DEFAULT_DOCUMENTATION,
  })
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [preview, setPreview] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getConfig()
      .then(setForm)
      .catch((err) => setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`))
  }, [])

  const docs = form.documentation
  const current = docs[selectedIdx] ?? docs[0]
  const conflict = findConflict(form.keybindings)
  const blankTitle = docs.some((t) => !t.title.trim())

  const setBinding = (key: keyof KeyBindings, value: ClickTrigger) =>
    setForm((prev) => ({ ...prev, keybindings: { ...prev.keybindings, [key]: value } }))

  const setDocs = (next: DocTab[]) => setForm((prev) => ({ ...prev, documentation: next }))

  const updateCurrent = (patch: Partial<DocTab>) =>
    setDocs(docs.map((t, i) => (i === selectedIdx ? { ...t, ...patch } : t)))

  const addTab = () => {
    setDocs([...docs, { title: 'New tab', body: '' }])
    setSelectedIdx(docs.length)
    setPreview(false)
  }

  const deleteTab = () => {
    setDocs(docs.filter((_, i) => i !== selectedIdx))
    setSelectedIdx(Math.max(0, selectedIdx - 1))
  }

  const moveTab = (delta: -1 | 1) => {
    const target = selectedIdx + delta
    if (target < 0 || target >= docs.length) return
    const next = [...docs]
    ;[next[selectedIdx], next[target]] = [next[target], next[selectedIdx]]
    setDocs(next)
    setSelectedIdx(target)
  }

  const resetDocs = () => {
    setDocs(DEFAULT_DOCUMENTATION)
    setSelectedIdx(0)
    setStatus('Documentation reset to defaults — save to apply')
  }

  const handleSave = async () => {
    setStatus(null)
    setSubmitting(true)
    try {
      const saved = await updateConfig(form)
      setForm(saved)
      applyConfig(saved)
      setStatus('Configuration updated')
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="admin-card">
      <h2>Configuration</h2>

      <h3 className="admin-subheading">Plot keybindings</h3>
      <p className="admin-hint">
        Applies to every user. Right-click (undo) and Shift+right-click (redo) always work too.
      </p>
      <div className="admin-form-row">
        {GESTURES.map((g) => (
          <label key={g.key} className="admin-field">
            {g.label}
            <select
              value={form.keybindings[g.key]}
              onChange={(e) => setBinding(g.key, e.target.value as ClickTrigger)}
              disabled={submitting}
            >
              {(g.kind === 'drag' ? DRAG_TRIGGERS : CLICK_TRIGGERS).map((t) => (
                <option key={t} value={t}>
                  {triggerLabel(t, g.kind)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {conflict && <p className="admin-status admin-status-error">{conflict}</p>}

      <h3 className="admin-subheading">Documentation</h3>
      <p className="admin-hint">
        Markdown: <code># Heading</code>, <code>- bullet</code>, <code>1. numbered</code>,{' '}
        <code>**bold**</code>, <code>*italic*</code>, <code>[link](https://…)</code>. Use{' '}
        <code>{'{{x_zoom}}'}</code>, <code>{'{{y_zoom}}'}</code>, <code>{'{{undo}}'}</code>,{' '}
        <code>{'{{redo}}'}</code> to insert the current keybindings.
      </p>
      <div className="admin-doc-tabs" role="tablist" aria-label="Documentation tabs">
        {docs.map((tab, idx) => (
          <button
            key={idx}
            type="button"
            role="tab"
            aria-selected={tab === current}
            className={`admin-doc-tab${tab === current ? ' active' : ''}`}
            onClick={() => setSelectedIdx(idx)}
          >
            {tab.title.trim() || '(untitled)'}
          </button>
        ))}
        <button
          type="button"
          className="admin-doc-tab admin-doc-tab-add"
          onClick={addTab}
          disabled={submitting || docs.length >= MAX_DOC_TABS}
        >
          + Add tab
        </button>
      </div>

      {current && (
        <div className="admin-doc-editor">
          <div className="admin-form-row">
            <label className="admin-field">
              Tab title
              <input
                type="text"
                value={current.title}
                maxLength={MAX_DOC_TAB_TITLE_LENGTH}
                onChange={(e) => updateCurrent({ title: e.target.value })}
                disabled={submitting}
              />
            </label>
            <button
              type="button"
              className="admin-btn admin-btn-inline"
              onClick={() => moveTab(-1)}
              disabled={submitting || selectedIdx === 0}
            >
              Move left
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-inline"
              onClick={() => moveTab(1)}
              disabled={submitting || selectedIdx >= docs.length - 1}
            >
              Move right
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-inline admin-btn-danger"
              onClick={deleteTab}
              disabled={submitting || docs.length <= 1}
            >
              Delete tab
            </button>
          </div>
          <div className="admin-doc-mode">
            <button
              type="button"
              className={`admin-doc-mode-btn${!preview ? ' active' : ''}`}
              onClick={() => setPreview(false)}
            >
              Write
            </button>
            <button
              type="button"
              className={`admin-doc-mode-btn${preview ? ' active' : ''}`}
              onClick={() => setPreview(true)}
            >
              Preview
            </button>
          </div>
          {preview ? (
            <div className="admin-doc-preview" data-testid="doc-preview">
              <Markdown source={fillPlaceholders(current.body, form.keybindings)} />
            </div>
          ) : (
            <textarea
              className="admin-doc-textarea"
              aria-label="Tab content"
              value={current.body}
              onChange={(e) => updateCurrent({ body: e.target.value })}
              rows={12}
              disabled={submitting}
            />
          )}
        </div>
      )}

      <div className="admin-config-actions">
        <button
          className="admin-btn admin-btn-primary"
          onClick={handleSave}
          disabled={submitting || !!conflict || blankTitle}
        >
          Save configuration
        </button>
        <button className="admin-btn" onClick={resetDocs} disabled={submitting}>
          Reset documentation to defaults
        </button>
      </div>
      {blankTitle && <p className="admin-status admin-status-error">Every tab needs a title.</p>}
      {status && (
        <p className={`admin-status ${status.startsWith('Error') ? 'admin-status-error' : ''}`}>
          {status}
        </p>
      )}
    </section>
  )
}

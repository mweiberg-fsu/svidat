import { useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { publishFile, saveDraft } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { useBranding } from '../theme'

// Plain decimal for an input: trims float noise (e.g. 0.30000000000000004)
// without cutting real precision off values like 270.6788.
function formatBound(v: number): string {
  return String(Number(v.toPrecision(10)))
}

// Bar under the main navbar, beside the sidebar: the edit-session actions
// (Bulk edit, Save draft, Publish) plus the plot view controls (Show flags,
// Show climo, Show points, and Y min/max for the selected plot). Always
// shown; the edit actions are greyed out until there's an open edit session
// on a file, the view toggles until a file is selected, and the Y inputs
// until a plot is selected.
export function SecondaryNavbar() {
  const { file } = usePlotSelection()
  const { saveDraftLabel, publishLabel } = useBranding()
  const {
    sessionOpen,
    canEdit,
    endSessionLocally,
    editable,
    bulkEdit,
    toggleBulkEdit,
    selectedVariables,
    flagsVisible,
    toggleFlagsVisible,
    climatologyVisible,
    toggleClimatologyVisible,
    pointsVisible,
    togglePointsVisible,
    activeYRange,
    requestYRange,
  } = useEditSession()
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [yMinText, setYMinText] = useState('')
  const [yMaxText, setYMaxText] = useState('')
  const [yInvalid, setYInvalid] = useState(false)

  // The inputs mirror the selected plot's displayed Y range, following
  // selection changes, zooms and undo. Keyed on the values rather than the
  // object, so an unrelated re-publish doesn't wipe what's being typed.
  const shownVar = activeYRange?.varName
  const shownMin = activeYRange?.min
  const shownMax = activeYRange?.max
  const resetYInputs = () => {
    setYMinText(shownMin === undefined ? '' : formatBound(shownMin))
    setYMaxText(shownMax === undefined ? '' : formatBound(shownMax))
    setYInvalid(false)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(resetYInputs, [shownVar, shownMin, shownMax])

  // Applies the typed range to the selected plot — any values, inside or
  // outside the data, so each bound zooms in or out on its own without
  // moving the other. An invalid pair (blank, or min >= max) is kept as typed
  // and flagged rather than reverted.
  const applyYRange = () => {
    if (!activeYRange) return
    const min = parseFloat(yMinText)
    const max = parseFloat(yMaxText)
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      setYInvalid(true)
      return
    }
    setYInvalid(false)
    if (min === activeYRange.min && max === activeYRange.max) return
    requestYRange({ varName: activeYRange.varName, min, max })
  }

  const onYKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') applyYRange()
    else if (e.key === 'Escape') resetYInputs()
  }

  // Moving between Y min and Y max is still mid-edit; only leaving the pair
  // applies it.
  const onYBlur = (e: FocusEvent<HTMLInputElement>) => {
    const next = e.relatedTarget
    if (next instanceof HTMLElement && next.classList.contains('secondary-navbar-yinput')) return
    applyYRange()
  }

  const canSubmit = Boolean(file) && canEdit && sessionOpen && !submitting

  // A save/publish message belongs to the file it was about.
  useEffect(() => {
    setStatus(null)
  }, [file])

  const handleSave = async () => {
    setSubmitting(true)
    try {
      await saveDraft(file)
      endSessionLocally()
      setStatus('Saved as v250 draft')
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handlePublish = async () => {
    setSubmitting(true)
    try {
      await publishFile(file)
      setStatus('Published as v300')
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="secondary-navbar">
      <div className="secondary-navbar-left">
        <button
          type="button"
          className={`files-toolbar-btn${bulkEdit ? ' active' : ''}`}
          onClick={toggleBulkEdit}
          disabled={!(Boolean(file) && editable)}
        >
          Bulk edit{bulkEdit && selectedVariables.length > 0 ? ` (${selectedVariables.length} vars)` : ''}
        </button>
        <button
          type="button"
          className={`files-toolbar-btn${flagsVisible ? ' active' : ''}`}
          aria-pressed={flagsVisible}
          onClick={toggleFlagsVisible}
          disabled={!file}
        >
          Show flags
        </button>
        <button
          type="button"
          className={`files-toolbar-btn${climatologyVisible ? ' active' : ''}`}
          aria-pressed={climatologyVisible}
          onClick={toggleClimatologyVisible}
          disabled={!file}
        >
          Show climo
        </button>
        <button
          type="button"
          className={`files-toolbar-btn${pointsVisible ? ' active' : ''}`}
          aria-pressed={pointsVisible}
          onClick={togglePointsVisible}
          disabled={!file}
        >
          Show points
        </button>
        <input
          type="number"
          step="any"
          className="secondary-navbar-yinput"
          aria-label="Y min"
          placeholder="Y min"
          value={yMinText}
          aria-invalid={yInvalid}
          onChange={(e) => {
            setYMinText(e.target.value)
            setYInvalid(false)
          }}
          onKeyDown={onYKeyDown}
          onBlur={onYBlur}
          disabled={!activeYRange}
        />
        <input
          type="number"
          step="any"
          className="secondary-navbar-yinput"
          aria-label="Y max"
          placeholder="Y max"
          value={yMaxText}
          aria-invalid={yInvalid}
          onChange={(e) => {
            setYMaxText(e.target.value)
            setYInvalid(false)
          }}
          onKeyDown={onYKeyDown}
          onBlur={onYBlur}
          disabled={!activeYRange}
        />
      </div>
      <div className="secondary-navbar-right">
        {status && (
          <span role="status" className="secondary-navbar-status">
            {status}
          </span>
        )}
        <button type="button" onClick={handleSave} disabled={!canSubmit}>
          {saveDraftLabel}
        </button>
        <button type="button" onClick={handlePublish} disabled={!canSubmit}>
          {publishLabel}
        </button>
      </div>
    </div>
  )
}

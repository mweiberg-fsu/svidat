import { useEffect, useRef, useState } from 'react'
import { applyFlag, jobStatus } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { FLAG_CODES } from '../constants/flagCodes'

const FLAG_POLL_INTERVAL_MS = 300
const FLAG_POLL_TIMEOUT_MS = 30000

type FlagJobResult =
  | { varName: string; ok: true }
  | { varName: string; ok: false; error: string }

// Applies one flag code to one variable and polls its background job to
// completion. Shared by both single-variable and bulk (fan-out) apply —
// each call is fully independent, so a caller running several of these in
// parallel gets one result per variable with no shared failure state.
async function runFlagJob(
  file: string,
  varName: string,
  startIdx: number,
  endIdx: number,
  code: string
): Promise<FlagJobResult> {
  try {
    const result = await applyFlag(file, varName, startIdx, endIdx, code)
    const start = Date.now()
    while (Date.now() - start < FLAG_POLL_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, FLAG_POLL_INTERVAL_MS))
      const jobResult = await jobStatus(result.job_id)
      if (jobResult.status === 'done') {
        return { varName, ok: true }
      }
      if (jobResult.status === 'failed') {
        return { varName, ok: false, error: jobResult.error ?? 'Flag apply failed' }
      }
    }
    return { varName, ok: false, error: 'Flag apply still running — try again later' }
  } catch (err) {
    return { varName, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function FlagsPanel() {
  const { file } = usePlotSelection()
  const {
    editable,
    flagSelection,
    setFlagSelection,
    notifyFlagged,
    flagsVisible,
    toggleFlagsVisible,
    climatologyVisible,
    toggleClimatologyVisible,
    bulkEdit,
    selectedVariables,
  } = useEditSession()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // A changed (or cleared) selection invalidates any previous apply error —
  // same lifetime FlagToolbar's error had (it unmounted on cancel/apply).
  useEffect(() => {
    setError(null)
  }, [flagSelection])

  const handleApply = async (code: string) => {
    if (!flagSelection) return
    setSubmitting(true)
    setError(null)
    // Bulk mode fans the same drag range out to every explicitly selected
    // panel; falls back to just the dragged-on variable if none are
    // selected.
    const targets =
      bulkEdit && selectedVariables.length > 0 ? selectedVariables : [flagSelection.varName]
    try {
      const results = await Promise.all(
        targets.map((varName) =>
          runFlagJob(file, varName, flagSelection.startIdx, flagSelection.endIdx, code)
        )
      )
      if (!isMountedRef.current) return
      const failed = results.filter(
        (r): r is Extract<FlagJobResult, { ok: false }> => !r.ok
      )
      const succeededCount = results.length - failed.length
      if (succeededCount > 0) {
        notifyFlagged()
      }
      if (failed.length > 0) {
        setError(
          results.length === 1
            ? failed[0].error
            : `Flagged ${succeededCount} of ${results.length} — failed:\n` +
                failed.map((f) => `${f.varName}: ${f.error}`).join('\n')
        )
      }
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  const disabled = !editable || !flagSelection || submitting
  const pointCount = flagSelection ? flagSelection.endIdx - flagSelection.startIdx + 1 : 0

  return (
    <div className="sidebar-flags-panel">
      <div className="sidebar-flags-panel-modes">
        <label>
          <input type="checkbox" checked={flagsVisible} onChange={toggleFlagsVisible} />
          Show flags
        </label>
        <label>
          <input
            type="checkbox"
            checked={climatologyVisible}
            onChange={toggleClimatologyVisible}
          />
          Show climatology
        </label>
      </div>
      <p className="sidebar-flags-panel-status">
        {flagSelection
          ? `${flagSelection.rangeLabel} — ${pointCount} points selected`
          : editable
            ? 'Select points on the plot to flag them'
            : 'Drag on the plot to start editing'}
      </p>
      <div className="sidebar-flags-panel-grid">
        {FLAG_CODES.map(({ code, description }) => (
          <button
            key={code}
            onClick={() => handleApply(code)}
            disabled={disabled}
            title={`${code} — ${description}`}
          >
            {code}-{description}
          </button>
        ))}
      </div>
      <div className="sidebar-flags-panel-actions">
        <button
          className="sidebar-flags-panel-clear"
          onClick={() => setFlagSelection(null)}
          disabled={disabled}
        >
          Clear selection
        </button>
      </div>
      {error && (
        <p role="status" style={{ whiteSpace: 'pre-line' }}>
          Error: {error}
        </p>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { applyFlag, jobStatus } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { FLAG_CODES } from '../constants/flagCodes'

const FLAG_POLL_INTERVAL_MS = 300
const FLAG_POLL_TIMEOUT_MS = 30000

export function FlagsPanel() {
  const { file } = usePlotSelection()
  const { editable, flagSelection, setFlagSelection, notifyFlagged } = useEditSession()
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
    try {
      const result = await applyFlag(
        file,
        flagSelection.varName,
        flagSelection.startIdx,
        flagSelection.endIdx,
        code
      )
      const start = Date.now()
      while (Date.now() - start < FLAG_POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, FLAG_POLL_INTERVAL_MS))
        if (!isMountedRef.current) return
        const jobResult = await jobStatus(result.job_id)
        if (!isMountedRef.current) return
        if (jobResult.status === 'done') {
          setFlagSelection(null)
          notifyFlagged()
          return
        }
        if (jobResult.status === 'failed') {
          setError(jobResult.error ?? 'Flag apply failed')
          return
        }
      }
      setError('Flag apply still running — try again later')
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : String(err))
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
      <button
        className="sidebar-flags-panel-clear"
        onClick={() => setFlagSelection(null)}
        disabled={disabled}
      >
        Clear selection
      </button>
      {error && <p role="status">Error: {error}</p>}
    </div>
  )
}

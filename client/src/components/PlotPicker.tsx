import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { getFileMetadata } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useCatalog } from '../hooks/useCatalog'
import type { FileMetadata } from '../api/types'
import { MULTI_SELECT_KEY } from '../platform'

// SAMOS files give date/time/time_of_day `qcindex = 1`: they share a flag
// column that's never hand-edited, so they don't belong in the picker. Real
// files spell it `qcindex`; `qc_index` is accepted too in case other sources
// use it. The attribute may come back as a scalar or a 1-element array.
function isUnflaggable(qcIndex: unknown): boolean {
  const value = Array.isArray(qcIndex) ? qcIndex[0] : qcIndex
  return Number(value) === 1
}

export function PlotPicker() {
  const { catalog, error: catalogError } = useCatalog()
  const { ship, year, file, variables, setShip, setYear, setFile, setVariables } =
    usePlotSelection()
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)

  const ships = catalog ? Object.keys(catalog).sort() : []
  const years = ship && catalog ? Object.keys(catalog[ship] ?? {}).sort() : []
  const files = ship && year && catalog ? catalog[ship]?.[year] ?? [] : []
  // Keep the server's key order — it mirrors the variable order in the
  // netCDF file itself, which is the order SAMOS users expect.
  const variableNames = metadata
    ? Object.keys(metadata.variables).filter((v) => {
        const { dims, attrs } = metadata.variables[v]
        return (
          dims.length === 1 &&
          dims[0] === 'time' &&
          v !== 'flag' &&
          !isUnflaggable(attrs.qcindex ?? attrs.qc_index)
        )
      })
    : []

  // On the first run, `file` may already come from the URL (a shared link
  // or refresh) with `variables` alongside it — don't wipe those out. Only
  // clear the selection when the user actually switches to a different file.
  const isFirstFileEffect = useRef(true)

  useEffect(() => {
    const skipReset = isFirstFileEffect.current
    isFirstFileEffect.current = false

    if (!file) {
      setMetadata(null)
      if (!skipReset) setVariables([])
      return
    }
    let cancelled = false
    setMetadataError(null)
    if (!skipReset) setVariables([])
    getFileMetadata(file)
      .then((result) => {
        if (cancelled) return
        setMetadata(result)
      })
      .catch((err) => {
        if (cancelled) return
        setMetadataError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const handleVariablesChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setVariables(Array.from(e.target.selectedOptions).map((o) => o.value))
  }

  return (
    <fieldset className="plot-picker">
      {catalogError && <p role="status">Error: {catalogError}</p>}
      {catalog && (
        <>
          <label>
            Ship
            <select value={ship} onChange={(e) => setShip(e.target.value)}>
              <option value="">Select ship</option>
              {ships.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              disabled={!ship}
            >
              <option value="">Select year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label>
            File
            <select
              value={file}
              onChange={(e) => setFile(e.target.value)}
              disabled={!year}
            >
              <option value="">Select file</option>
              {files.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {metadataError && <p role="status">Error: {metadataError}</p>}
      {metadata && (
        <label>
          <span className="plot-picker-label-row">
            <span id="plot-picker-variables-label">Variables</span>
            <span
              className="help-icon"
              tabIndex={0}
              role="img"
              aria-label="How to select multiple variables"
              aria-describedby="plot-picker-variables-hint"
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.75c-.5.2-.8.6-.8 1.1v.45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <circle cx="8" cy="11.6" r="0.9" fill="currentColor" />
              </svg>
            </span>
            <span id="plot-picker-variables-hint" role="tooltip" className="help-tooltip">
              {MULTI_SELECT_KEY}+click to select multiple individual variables. Click-and-drag
              (or Shift+click) to select a consecutive range.
            </span>
          </span>
          <select
            aria-labelledby="plot-picker-variables-label"
            multiple
            value={variables}
            onChange={handleVariablesChange}
            size={Math.min(8, Math.max(3, variableNames.length))}
          >
            {variableNames.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  )
}

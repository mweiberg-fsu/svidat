import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { getFileMetadata } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useCatalog } from '../hooks/useCatalog'
import type { FileMetadata } from '../api/types'

export function PlotPicker() {
  const { catalog, error: catalogError } = useCatalog()
  const { ship, year, file, variables, setShip, setYear, setFile, setVariables } =
    usePlotSelection()
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)

  const ships = catalog ? Object.keys(catalog).sort() : []
  const years = ship && catalog ? Object.keys(catalog[ship] ?? {}).sort() : []
  const files = ship && year && catalog ? catalog[ship]?.[year] ?? [] : []
  const variableNames = metadata
    ? Object.keys(metadata.variables)
        .filter((v) => {
          const dims = metadata.variables[v].dims
          return dims.length === 1 && dims[0] === 'time' && v !== 'flag'
        })
        .sort()
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
          Variables
          <select
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

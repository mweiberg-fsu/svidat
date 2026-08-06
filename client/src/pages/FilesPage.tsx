import { useEffect, useState } from 'react'
import { getFileMetadata } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { SvgPlot } from '../components/SvgPlot'
import { EditForm } from '../components/EditForm'
import { AuditPanel } from '../components/AuditPanel'
import type { FileMetadata } from '../api/types'

export function FilesPage() {
  const { file } = usePlotSelection()
  const { sessionOpen, canEdit, sessionError, closeSession, flagAppliedAt } = useEditSession()
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [auditRefreshKey, setAuditRefreshKey] = useState(0)

  useEffect(() => {
    if (!file) {
      setMetadata(null)
      return
    }
    let cancelled = false
    getFileMetadata(file).then((result) => {
      if (!cancelled) setMetadata(result)
    })
    return () => {
      cancelled = true
    }
  }, [file])

  // flagAppliedAt starts at 0 and only increments via notifyFlagged, so
  // skipping 0 avoids firing this effect spuriously on mount. This relies on
  // FilesPage always mounting alongside a fresh EditSessionProvider (see
  // ProtectedRoute) — if the provider were ever hoisted higher to persist
  // session state across navigation, flagAppliedAt could already be nonzero
  // on mount and this guard would need to change.
  useEffect(() => {
    if (flagAppliedAt === 0) return
    setAuditRefreshKey((k) => k + 1)
  }, [flagAppliedAt])

  return (
    <div>
      {file && canEdit && (
        <div>
          {!sessionOpen && <p>Drag on a plot to start editing.</p>}
          {sessionOpen && <button onClick={closeSession}>Close session</button>}
          {sessionError && <p role="alert">{sessionError}</p>}
        </div>
      )}
      <SvgPlot />
      {sessionOpen && metadata && (
        <>
          <EditForm
            filename={file}
            variables={Object.keys(metadata.variables)}
            onChanged={() => setAuditRefreshKey((k) => k + 1)}
          />
          <AuditPanel filename={file} refreshSignal={auditRefreshKey} />
        </>
      )}
    </div>
  )
}

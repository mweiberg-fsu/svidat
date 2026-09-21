import { useState } from 'react'
import { publishFile, saveDraft } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { SvgPlot } from '../components/SvgPlot'

export function FilesPage() {
  const { file } = usePlotSelection()
  const {
    sessionOpen,
    canEdit,
    sessionError,
    closeSession,
    endSessionLocally,
    editable,
    bulkEdit,
    toggleBulkEdit,
    selectedVariables,
  } = useEditSession()
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

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
    <div>
      {file && canEdit && (
        <div>
          {sessionOpen && (
            <div className="files-toolbar">
              <div className="files-toolbar-left">
                <button onClick={closeSession}>Close session</button>
                <button
                  className={`files-toolbar-btn${bulkEdit ? ' active' : ''}`}
                  onClick={toggleBulkEdit}
                  disabled={!editable}
                >
                  Bulk edit{bulkEdit && selectedVariables.length > 0 ? ` (${selectedVariables.length} vars)` : ''}
                </button>
              </div>
              <div className="files-toolbar-right">
                <button onClick={handleSave} disabled={submitting}>
                  Save draft (v250)
                </button>
                <button onClick={handlePublish} disabled={submitting}>
                  Publish (v300)
                </button>
              </div>
            </div>
          )}
          {sessionError && <p role="alert">{sessionError}</p>}
          {status && <p role="status">{status}</p>}
        </div>
      )}
      <SvgPlot />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { bulkEdit, jobStatus, pointEdit, publishFile, saveDraft } from '../api/client'

const BULK_EDIT_POLL_INTERVAL_MS = 300
const BULK_EDIT_POLL_TIMEOUT_MS = 30000

export function EditForm({
  filename,
  variables,
  onChanged,
}: {
  filename: string
  variables: string[]
  onChanged: () => void
}) {
  const [varName, setVarName] = useState(variables[0] ?? '')
  const [indices, setIndices] = useState('')
  const [value, setValue] = useState('')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeStop, setRangeStop] = useState('')
  const [op, setOp] = useState('add')
  const [status, setStatus] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isMountedRef = useRef(true)
  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const handlePointEdit = async () => {
    setSubmitting(true)
    try {
      const parsedIndices = indices.split(',').map((i) => parseInt(i.trim(), 10))
      const parsedValue = parseFloat(value)
      if (parsedIndices.some(Number.isNaN) || Number.isNaN(parsedValue)) {
        setStatus('Error: indices and value must be valid numbers')
        return
      }
      await pointEdit(filename, varName, parsedIndices, parsedValue)
      setStatus('Point edit applied')
      onChanged()
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleBulkEdit = async () => {
    setSubmitting(true)
    try {
      const parsedStart = parseInt(rangeStart, 10)
      const parsedStop = parseInt(rangeStop, 10)
      const parsedValue = parseFloat(value)
      if (Number.isNaN(parsedStart) || Number.isNaN(parsedStop) || Number.isNaN(parsedValue)) {
        setStatus('Error: range and value must be valid numbers')
        return
      }
      const slices = [[parsedStart, parsedStop]]
      const result = await bulkEdit(filename, varName, slices, op, parsedValue)
      setStatus(`Bulk edit job submitted: ${result.job_id}`)

      const startTime = Date.now()
      while (Date.now() - startTime < BULK_EDIT_POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, BULK_EDIT_POLL_INTERVAL_MS))
        if (!isMountedRef.current) {
          return
        }
        const jobResult = await jobStatus(result.job_id)
        if (!isMountedRef.current) {
          return
        }
        if (jobResult.status === 'done') {
          setStatus('Bulk edit applied')
          onChanged()
          return
        }
        if (jobResult.status === 'failed') {
          setStatus(`Bulk edit failed: ${jobResult.error}`)
          return
        }
      }
      if (isMountedRef.current) {
        setStatus('Bulk edit still running — check back later')
      }
    } catch (err) {
      if (isMountedRef.current) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  const handleSave = async () => {
    setSubmitting(true)
    try {
      await saveDraft(filename)
      setStatus('Saved as v250 draft')
      onChanged()
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handlePublish = async () => {
    setSubmitting(true)
    try {
      await publishFile(filename)
      setStatus('Published as v300')
      onChanged()
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2>Edit</h2>
      <label>
        Variable
        <select value={varName} onChange={(e) => setVarName(e.target.value)}>
          {variables.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Point edit</legend>
        <label>
          Indices (comma separated)
          <input value={indices} onChange={(e) => setIndices(e.target.value)} />
        </label>
        <label>
          Value
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button onClick={handlePointEdit} disabled={submitting}>
          Apply point edit
        </button>
      </fieldset>

      <fieldset>
        <legend>Bulk edit</legend>
        <label>
          Range start
          <input value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
        </label>
        <label>
          Range stop
          <input value={rangeStop} onChange={(e) => setRangeStop(e.target.value)} />
        </label>
        <label>
          Operation
          <select value={op} onChange={(e) => setOp(e.target.value)}>
            <option value="add">add</option>
            <option value="multiply">multiply</option>
            <option value="set">set</option>
          </select>
        </label>
        <button onClick={handleBulkEdit} disabled={submitting}>
          Apply bulk edit
        </button>
      </fieldset>

      <div>
        <button onClick={handleSave} disabled={submitting}>
          Save draft (v250)
        </button>
        <button onClick={handlePublish} disabled={submitting}>
          Publish (v300)
        </button>
      </div>

      {status && <p role="status">{status}</p>}
    </div>
  )
}

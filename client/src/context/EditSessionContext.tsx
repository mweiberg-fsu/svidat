import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { closeSession, openSession } from '../api/client'
import { useAuth } from './AuthContext'
import { usePlotSelection } from './PlotSelectionContext'

export interface FlagSelection {
  varName: string
  startIdx: number
  endIdx: number
  rangeLabel: string
}

interface EditSessionState {
  sessionOpen: boolean
  sessionOpenedAt: string | null
  canEdit: boolean
  editable: boolean
  sessionError: string | null
  openSession: (filename?: string) => Promise<void>
  closeSession: () => Promise<void>
  endSessionLocally: () => void
  flagSelection: FlagSelection | null
  setFlagSelection: (selection: FlagSelection | null) => void
  flagAppliedAt: number
  notifyFlagged: () => void
  flagsVisible: boolean
  toggleFlagsVisible: () => void
  bulkEdit: boolean
  toggleBulkEdit: () => void
  selectedVariables: string[]
  toggleVariableSelected: (varName: string) => void
}

const EditSessionContext = createContext<EditSessionState | undefined>(undefined)

export function EditSessionProvider({ children }: { children: ReactNode }) {
  const { roles } = useAuth()
  const { file, variables, setFile } = usePlotSelection()
  const [searchParams] = useSearchParams()
  const [sessionOpen, setSessionOpen] = useState(false)
  const [sessionOpenedAt, setSessionOpenedAt] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [flagSelection, setFlagSelection] = useState<FlagSelection | null>(null)
  const [flagAppliedAt, setFlagAppliedAt] = useState(0)
  const [flagsVisible, setFlagsVisible] = useState(true)
  const [bulkEdit, setBulkEdit] = useState(false)
  const [selectedVariables, setSelectedVariables] = useState<string[]>([])

  const canEdit = roles.includes('qca')
  const editable = sessionOpen && canEdit

  const openingRef = useRef(false)

  // A new file invalidates the current edit session — same as FilesPage's
  // original per-file session reset. Also clear any stale in-flight open
  // flag so a legitimate open request for the new file isn't silently
  // swallowed by the guard in handleOpenSession. Then, for an editable-role
  // user, immediately open a session for the new file — so the session
  // toolbar (Close/Bulk edit/Save/Publish) appears as soon as a file is
  // selected, rather than waiting for the first flag-drag gesture. This
  // claims the file's DB edit lock on open, not on first edit, so simply
  // viewing a file as a qca user now blocks other qca users from opening
  // it too. Calls performOpen (not handleOpenSession) because this effect
  // has already reset sessionOpen above — but that reset is an async state
  // update, not yet reflected in this render's `sessionOpen` closure, so
  // handleOpenSession's own `if (sessionOpen ...) return` guard would still
  // see the *previous* file's stale true value here and wrongly no-op.
  // performOpen is deliberately omitted from the deps below — it's redefined
  // every render, and including it would rerun this effect (and re-attempt
  // an open) on every unrelated render, not just on an actual file/role
  // change, since performOpen only guards on openingRef, not sessionOpen.
  useEffect(() => {
    setSessionOpen(false)
    setSessionOpenedAt(null)
    setSessionError(null)
    setBulkEdit(false)
    openingRef.current = false
    if (file && canEdit) {
      performOpen(file)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, canEdit])

  // A new file or variable set makes any pending flag selection meaningless
  // — same as SvgPlot's original [file, variables] reset. A selected panel
  // that's no longer plotted (or a different file entirely) is meaningless
  // the same way.
  useEffect(() => {
    setFlagSelection(null)
    setSelectedVariables([])
  }, [file, variables])

  // Warn before the user loses an open edit session (unsaved temp-file
  // edits + the DB lock) by closing the tab, refreshing, or navigating away
  // at the browser level. Browsers ignore any custom message and show their
  // own generic prompt — returnValue is just the standard trigger.
  useEffect(() => {
    if (!sessionOpen) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [sessionOpen])

  // Core open logic, guarded only by openingRef (a ref, always synchronously
  // current — unlike sessionOpen state, which may lag a render behind).
  // handleOpenSession wraps this with an additional sessionOpen check for
  // its other callers (e.g. Sidebar resuming a session), where skipping a
  // redundant open when already known-open is the desired behavior.
  const performOpen = async (target: string) => {
    if (!target || openingRef.current) return
    openingRef.current = true
    setSessionError(null)
    try {
      const source = searchParams.get('source') ?? 'raw'
      const result = await openSession(target, source)
      setSessionOpenedAt(result.session_started_at ?? null)
      setSessionOpen(true)
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'failed to open session')
      setFlagSelection(null)
    } finally {
      openingRef.current = false
    }
  }

  const handleOpenSession = async (targetFilename?: string) => {
    const target = targetFilename ?? file
    if (!target) return
    if (sessionOpen || openingRef.current) return
    await performOpen(target)
  }

  const handleCloseSession = async () => {
    if (!file) return
    setSessionError(null)
    try {
      await closeSession(file)
      setSessionOpen(false)
      setSessionOpenedAt(null)
      setFlagSelection(null)
      setFile('')
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'failed to close session')
    }
  }

  // For actions that end the session server-side without calling
  // closeSession (e.g. save, which now releases the lock and deletes the
  // temp file itself) — resets local state to match without a redundant
  // closeSession API call.
  const endSessionLocally = () => {
    setSessionOpen(false)
    setSessionOpenedAt(null)
    setFlagSelection(null)
  }

  const notifyFlagged = () => setFlagAppliedAt((v) => v + 1)
  const toggleFlagsVisible = () => setFlagsVisible((v) => !v)
  const toggleBulkEdit = () => setBulkEdit((v) => !v)
  const toggleVariableSelected = (varName: string) => {
    setSelectedVariables((prev) =>
      prev.includes(varName) ? prev.filter((v) => v !== varName) : [...prev, varName]
    )
  }

  return (
    <EditSessionContext.Provider
      value={{
        sessionOpen,
        sessionOpenedAt,
        canEdit,
        editable,
        sessionError,
        openSession: handleOpenSession,
        closeSession: handleCloseSession,
        endSessionLocally,
        flagSelection,
        setFlagSelection,
        flagAppliedAt,
        notifyFlagged,
        flagsVisible,
        toggleFlagsVisible,
        bulkEdit,
        toggleBulkEdit,
        selectedVariables,
        toggleVariableSelected,
      }}
    >
      {children}
    </EditSessionContext.Provider>
  )
}

export function useEditSession(): EditSessionState {
  const ctx = useContext(EditSessionContext)
  if (!ctx) {
    throw new Error('useEditSession must be used within EditSessionProvider')
  }
  return ctx
}

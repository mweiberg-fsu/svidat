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
  flagSelection: FlagSelection | null
  setFlagSelection: (selection: FlagSelection | null) => void
  flagAppliedAt: number
  notifyFlagged: () => void
  flagsVisible: boolean
  toggleFlagsVisible: () => void
  bulkEdit: boolean
  toggleBulkEdit: () => void
}

const EditSessionContext = createContext<EditSessionState | undefined>(undefined)

export function EditSessionProvider({ children }: { children: ReactNode }) {
  const { roles } = useAuth()
  const { file, variables } = usePlotSelection()
  const [searchParams] = useSearchParams()
  const [sessionOpen, setSessionOpen] = useState(false)
  const [sessionOpenedAt, setSessionOpenedAt] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [flagSelection, setFlagSelection] = useState<FlagSelection | null>(null)
  const [flagAppliedAt, setFlagAppliedAt] = useState(0)
  const [flagsVisible, setFlagsVisible] = useState(true)
  const [bulkEdit, setBulkEdit] = useState(false)

  const canEdit = roles.includes('qca')
  const editable = sessionOpen && canEdit

  const openingRef = useRef(false)

  // A new file invalidates the current edit session — same as FilesPage's
  // original per-file session reset. Also clear any stale in-flight open
  // flag so a legitimate open request for the new file isn't silently
  // swallowed by the guard in handleOpenSession.
  useEffect(() => {
    setSessionOpen(false)
    setSessionOpenedAt(null)
    setSessionError(null)
    setBulkEdit(false)
    openingRef.current = false
  }, [file])

  // A new file or variable set makes any pending flag selection meaningless
  // — same as SvgPlot's original [file, variables] reset.
  useEffect(() => {
    setFlagSelection(null)
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

  const handleOpenSession = async (targetFilename?: string) => {
    const target = targetFilename ?? file
    if (!target) return
    if (sessionOpen || openingRef.current) return
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

  const handleCloseSession = async () => {
    if (!file) return
    setSessionError(null)
    try {
      await closeSession(file)
      setSessionOpen(false)
      setSessionOpenedAt(null)
      setFlagSelection(null)
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'failed to close session')
    }
  }

  const notifyFlagged = () => setFlagAppliedAt((v) => v + 1)
  const toggleFlagsVisible = () => setFlagsVisible((v) => !v)
  const toggleBulkEdit = () => setBulkEdit((v) => !v)

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
        flagSelection,
        setFlagSelection,
        flagAppliedAt,
        notifyFlagged,
        flagsVisible,
        toggleFlagsVisible,
        bulkEdit,
        toggleBulkEdit,
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

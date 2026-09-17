import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useEditSession } from '../context/EditSessionContext'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useAvatar } from '../hooks/useAvatar'
import { PlotPicker } from './PlotPicker'
import { FlagsPanel } from './FlagsPanel'
import { AuditHistoryModal } from './AuditHistoryModal'
import { DocumentationModal } from './DocumentationModal'
import { ResumeSessionModal } from './ResumeSessionModal'
import { discardSession, getMySessions, RESUME_CHECKED_KEY } from '../api/client'
import type { TempSessionEntry } from '../api/types'

const MIN_WIDTH = 200
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 250

type SidebarTab = 'files' | 'flags'

export function Sidebar() {
  const { username, roles, id, avatarVersion } = useAuth()
  const { flagSelection, sessionOpen, openSession } = useEditSession()
  const { setFile } = usePlotSelection()
  const avatarUrl = useAvatar(id, avatarVersion)
  const navigate = useNavigate()
  const location = useLocation()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [activeTab, setActiveTab] = useState<SidebarTab>('files')
  const [showAuditHistory, setShowAuditHistory] = useState(false)
  const [showDocs, setShowDocs] = useState(false)
  const [resumableSessions, setResumableSessions] = useState<TempSessionEntry[]>([])
  const draggingRef = useRef(false)

  // Mirrors the old popover's "appears once you resolve a drag" behavior —
  // now surfaces as switching to the tab that shows the code picker.
  useEffect(() => {
    if (flagSelection) setActiveTab('flags')
  }, [flagSelection])

  // Sidebar remounts on every route navigation (providers aren't shared
  // across routes), so a plain ref/state guard wouldn't survive that. The
  // sessionStorage flag persists across remounts within the same tab, so
  // this fetch only fires once per login, not once per navigation.
  useEffect(() => {
    if (sessionStorage.getItem(RESUME_CHECKED_KEY)) return
    sessionStorage.setItem(RESUME_CHECKED_KEY, '1')
    getMySessions()
      .then(setResumableSessions)
      .catch(() => {})
  }, [])

  const handleContinueSession = async (filename: string) => {
    setFile(filename)
    await openSession(filename)
    setResumableSessions((prev) => prev.filter((s) => s.filename !== filename))
    if (location.pathname !== '/files') navigate('/files')
  }

  const handleDiscardSession = async (filename: string) => {
    await discardSession(filename)
    setResumableSessions((prev) => prev.filter((s) => s.filename !== filename))
  }

  const handleNavClick = (path: string) => {
    if (sessionOpen && location.pathname !== path) {
      if (!window.confirm('You have an open edit session. Leave without closing it?')) {
        return
      }
    }
    if (resumableSessions.length > 0 && location.pathname !== path) {
      if (!window.confirm('You have unresolved edits to continue or discard. Leave anyway?')) {
        return
      }
    }
    navigate(path)
  }

  const handleMouseDown = () => {
    draggingRef.current = true
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX))
      setWidth(next)
    }
    const handleMouseUp = () => {
      draggingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-welcome">
        {avatarUrl ? (
          <img className="sidebar-welcome-avatar" src={avatarUrl} alt="avatar" width={36} height={36} />
        ) : (
          <span className="sidebar-welcome-avatar sidebar-welcome-avatar-placeholder" aria-hidden="true" />
        )}
        <div className="sidebar-welcome-text">
          Welcome
          <b>{username}</b>
        </div>
      </div>
      <div className="sidebar-links">
        <a
          href="/files"
          className={location.pathname === '/files' ? 'active' : undefined}
          onClick={(e) => {
            e.preventDefault()
            handleNavClick('/files')
          }}
        >
          Plots
        </a>
        {roles.includes('admin') && (
          <a
            href="/admin/users"
            className={location.pathname === '/admin/users' ? 'active' : undefined}
            onClick={(e) => {
              e.preventDefault()
              handleNavClick('/admin/users')
            }}
          >
            Admin
          </a>
        )}
        <a
          href="/profile"
          className={location.pathname === '/profile' ? 'active' : undefined}
          onClick={(e) => {
            e.preventDefault()
            handleNavClick('/profile')
          }}
        >
          Profile
        </a>
        <button
          type="button"
          className="sidebar-audit-history-link"
          onClick={() => {
            setShowAuditHistory(true)
            setShowDocs(false)
          }}
        >
          Audit History
        </button>
        <button
          type="button"
          className="sidebar-docs-link"
          onClick={() => {
            setShowDocs(true)
            setShowAuditHistory(false)
          }}
        >
          Documentation
        </button>
      </div>
      {location.pathname === '/files' && (
        <>
          <div className="sidebar-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'files'}
              className={activeTab === 'files' ? 'sidebar-tab active' : 'sidebar-tab'}
              onClick={() => setActiveTab('files')}
            >
              File Selection
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'flags'}
              className={activeTab === 'flags' ? 'sidebar-tab active' : 'sidebar-tab'}
              onClick={() => setActiveTab('flags')}
            >
              Flags
            </button>
          </div>
          <div className="sidebar-tab-panel">
            {activeTab === 'files' ? <PlotPicker /> : <FlagsPanel />}
          </div>
        </>
      )}
      <div className="sidebar-resize-handle" onMouseDown={handleMouseDown} />
      {showAuditHistory && (
        <AuditHistoryModal onClose={() => setShowAuditHistory(false)} />
      )}
      {showDocs && <DocumentationModal onClose={() => setShowDocs(false)} />}
      {resumableSessions.length > 0 && (
        <ResumeSessionModal
          entries={resumableSessions}
          onContinue={handleContinueSession}
          onDiscard={handleDiscardSession}
        />
      )}
    </aside>
  )
}

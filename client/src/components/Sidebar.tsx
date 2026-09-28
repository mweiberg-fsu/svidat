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
import { KeybindsModal } from './KeybindsModal'
import { ShipTrackModal } from './ShipTrackModal'
import { ResumeSessionModal } from './ResumeSessionModal'
import { ColorModeSwitch } from './ColorModeSwitch'
import { discardSession } from '../api/client'
import { PLOT_PATH } from '../routes'

const MIN_WIDTH = 200
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 250

type SidebarTab = 'files' | 'flags'

export function Sidebar() {
  const { username, id, avatarVersion, resumableSessions, removeResumableSession } = useAuth()
  const { flagSelection, sessionOpen, openSession } = useEditSession()
  const { setFile } = usePlotSelection()
  const avatarUrl = useAvatar(id, avatarVersion)
  const navigate = useNavigate()
  const location = useLocation()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [activeTab, setActiveTab] = useState<SidebarTab>('files')
  const [showAuditHistory, setShowAuditHistory] = useState(false)
  const [showDocs, setShowDocs] = useState(false)
  const [showKeybinds, setShowKeybinds] = useState(false)
  const [showShipTrack, setShowShipTrack] = useState(false)
  const draggingRef = useRef(false)

  // Mirrors the old popover's "appears once you resolve a drag" behavior —
  // now surfaces as switching to the tab that shows the code picker.
  useEffect(() => {
    if (flagSelection) setActiveTab('flags')
  }, [flagSelection])

  // A session ending (Close session button, or Save/Publish which also
  // end it) leaves the Flags tab showing stale/irrelevant controls once
  // there's no active session to flag against — revert to File Selection.
  useEffect(() => {
    if (!sessionOpen) setActiveTab('files')
  }, [sessionOpen])

  // Expose the current width so the navbar can start its tabs exactly where
  // the sidebar ends (tracks live resizing too).
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--sidebar-width', `${width}px`)
    return () => {
      root.style.removeProperty('--sidebar-width')
    }
  }, [width])

  const handleContinueSession = async (filename: string) => {
    setFile(filename)
    await openSession(filename)
    removeResumableSession(filename)
    if (location.pathname !== PLOT_PATH) navigate(PLOT_PATH)
  }

  const handleDiscardSession = async (filename: string) => {
    await discardSession(filename)
    removeResumableSession(filename)
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
        <div className="sidebar-welcome-row">
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
        <ColorModeSwitch className="sidebar-color-mode" />
      </div>
      <div className="sidebar-links">
        <h3 className="sidebar-section-heading">Widgets</h3>
        <button
          type="button"
          className="sidebar-audit-history-link"
          onClick={() => {
            setShowAuditHistory(true)
          }}
        >
          Audit History
        </button>
        <button
          type="button"
          className="sidebar-docs-link"
          onClick={() => {
            setShowDocs(true)
          }}
        >
          Documentation
        </button>
        <button
          type="button"
          className="sidebar-keybinds-link"
          onClick={() => {
            setShowKeybinds(true)
          }}
        >
          Keybinds
        </button>
        <button
          type="button"
          className="sidebar-ship-track-link"
          onClick={() => {
            setShowShipTrack(true)
          }}
        >
          Ship Track
        </button>
      </div>
      {location.pathname === PLOT_PATH && (
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
      {showKeybinds && <KeybindsModal onClose={() => setShowKeybinds(false)} />}
      {showShipTrack && <ShipTrackModal onClose={() => setShowShipTrack(false)} />}
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

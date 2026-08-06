import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useEditSession } from '../context/EditSessionContext'
import { useAvatar } from '../hooks/useAvatar'
import { PlotPicker } from './PlotPicker'
import { FlagsPanel } from './FlagsPanel'
import { AuditHistoryModal } from './AuditHistoryModal'

const MIN_WIDTH = 200
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 250

type SidebarTab = 'files' | 'flags'

export function Sidebar() {
  const { username, role, id, avatarVersion } = useAuth()
  const { flagSelection } = useEditSession()
  const avatarUrl = useAvatar(id, avatarVersion)
  const navigate = useNavigate()
  const location = useLocation()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [activeTab, setActiveTab] = useState<SidebarTab>('files')
  const [showAuditHistory, setShowAuditHistory] = useState(false)
  const draggingRef = useRef(false)

  // Mirrors the old popover's "appears once you resolve a drag" behavior —
  // now surfaces as switching to the tab that shows the code picker.
  useEffect(() => {
    if (flagSelection) setActiveTab('flags')
  }, [flagSelection])

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
          onClick={(e) => {
            e.preventDefault()
            navigate('/files')
          }}
        >
          Plots
        </a>
        {role === 'admin' && (
          <a
            href="/admin/users"
            onClick={(e) => {
              e.preventDefault()
              navigate('/admin/users')
            }}
          >
            Admin
          </a>
        )}
        <a
          href="/profile"
          onClick={(e) => {
            e.preventDefault()
            navigate('/profile')
          }}
        >
          Profile
        </a>
        <button
          type="button"
          className="sidebar-audit-history-link"
          onClick={() => setShowAuditHistory(true)}
        >
          Audit History
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
    </aside>
  )
}

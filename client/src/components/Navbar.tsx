import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAvatar } from '../hooks/useAvatar'
import { useLogo } from '../hooks/useLogo'
import { useAuth } from '../context/AuthContext'
import { DEFAULT_SITE_NAME, useBranding } from '../theme'
import { SessionNavActions } from './SessionNavActions'
import { useGuardedNavigate } from '../hooks/useGuardedNavigate'
import { PLOT_PATH } from '../routes'

// Stroke icons (24x24, currentColor), matching SessionNavActions' tab icons.
function PlotIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-6" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )
}

function AdminIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

export function Navbar() {
  const { username, roles, id, avatarVersion, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const avatarUrl = useAvatar(id, avatarVersion)
  const { siteName, hasLogo, logoVersion } = useBranding()
  const logoUrl = useLogo(hasLogo, logoVersion)
  const navigate = useNavigate()
  const location = useLocation()
  const guardedNavigate = useGuardedNavigate()

  const goTo = (path: string) => {
    setOpen(false)
    guardedNavigate(path)
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <button className="navbar-logo" onClick={() => goTo(PLOT_PATH)}>
          {logoUrl && <img className="navbar-logo-img" src={logoUrl} alt="" height={28} />}
          {siteName === DEFAULT_SITE_NAME ? (
            <span>
              SVI<span className="navbar-logo-accent">DAT</span>
            </span>
          ) : (
            <span>{siteName}</span>
          )}
        </button>
        <div className="navbar-tabs">
          <button
            type="button"
            className={`navbar-tab${location.pathname === PLOT_PATH ? ' active' : ''}`}
            onClick={() => goTo(PLOT_PATH)}
          >
            <PlotIcon />
            <span className="navbar-tab-label">Plot</span>
          </button>
          <button
            type="button"
            className={`navbar-tab${location.pathname === '/profile' ? ' active' : ''}`}
            onClick={() => goTo('/profile')}
          >
            <ProfileIcon />
            <span className="navbar-tab-label">Profile</span>
          </button>
          {roles.includes('admin') && (
            <button
              type="button"
              className={`navbar-tab${location.pathname === '/admin/users' ? ' active' : ''}`}
              onClick={() => goTo('/admin/users')}
            >
              <AdminIcon />
              <span className="navbar-tab-label">Admin</span>
            </button>
          )}
          <SessionNavActions />
        </div>
      </div>
      <div className="navbar-account">
        <button className="navbar-trigger" onClick={() => setOpen((o) => !o)}>
          <span>{username}</span>
          {avatarUrl ? (
            <img className="navbar-avatar" src={avatarUrl} alt="avatar" width={28} height={28} />
          ) : (
            <span className="navbar-avatar navbar-avatar-placeholder" aria-hidden="true" />
          )}
        </button>
        {open && (
          <div className="navbar-dropdown" role="menu">
            <div className="navbar-dropdown-who">
              {avatarUrl ? (
                <img
                  className="navbar-avatar navbar-avatar-lg"
                  src={avatarUrl}
                  alt="avatar"
                  width={32}
                  height={32}
                />
              ) : (
                <span
                  className="navbar-avatar navbar-avatar-lg navbar-avatar-placeholder"
                  aria-hidden="true"
                />
              )}
              <div>
                <div className="navbar-dropdown-name">{username}</div>
                <div className="navbar-dropdown-role">{roles.length ? roles.join(', ') : 'view only'}</div>
              </div>
            </div>
            <button className="navbar-dropdown-item" onClick={() => goTo('/profile')}>
              Profile
            </button>
            {roles.includes('admin') && (
              <button className="navbar-dropdown-item" onClick={() => goTo('/admin/users')}>
                Admin
              </button>
            )}
            <button className="navbar-dropdown-item navbar-logout" onClick={handleLogout}>
              Log out
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}

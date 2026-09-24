import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAvatar } from '../hooks/useAvatar'
import { useLogo } from '../hooks/useLogo'
import { useAuth } from '../context/AuthContext'
import { DEFAULT_SITE_NAME, useBranding } from '../theme'

export function Navbar() {
  const { username, roles, id, avatarVersion, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const avatarUrl = useAvatar(id, avatarVersion)
  const { siteName, hasLogo, logoVersion } = useBranding()
  const logoUrl = useLogo(hasLogo, logoVersion)
  const navigate = useNavigate()

  const goTo = (path: string) => {
    setOpen(false)
    navigate(path)
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav className="navbar">
      <button className="navbar-logo" onClick={() => goTo('/files')}>
        {logoUrl && <img className="navbar-logo-img" src={logoUrl} alt="" height={28} />}
        {siteName === DEFAULT_SITE_NAME ? (
          <span>
            SVI<span className="navbar-logo-accent">DAT</span>
          </span>
        ) : (
          <span>{siteName}</span>
        )}
      </button>
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

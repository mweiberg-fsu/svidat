import { useEffect } from 'react'
import { useBranding } from '../theme'
import { useLogo } from './useLogo'

// Shipped icon from index.html, used whenever no admin logo is set.
export const DEFAULT_FAVICON = '/favicon.svg'

// Keeps the browser tab icon in sync with the admin-set logo (the same image
// the navbar and login page show), falling back to the default icon.
export function useFavicon() {
  const { hasLogo, logoVersion } = useBranding()
  const logoUrl = useLogo(hasLogo, logoVersion)

  useEffect(() => {
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    if (logoUrl) {
      // The logo may be PNG/JPEG/SVG; let the browser sniff it.
      link.removeAttribute('type')
      link.href = logoUrl
    } else {
      link.type = 'image/svg+xml'
      link.href = DEFAULT_FAVICON
    }
  }, [logoUrl])
}

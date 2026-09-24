import { useEffect, useRef, useState } from 'react'
import { fetchLogoBlobUrl } from '../api/client'

export function useLogo(hasLogo: boolean, logoVersion: number): string | null {
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const replace = (url: string | null) => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = url
      setLogoUrl(url)
    }
    if (!hasLogo) {
      replace(null)
      return
    }
    fetchLogoBlobUrl().then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url)
        return
      }
      replace(url)
    })
    return () => {
      cancelled = true
    }
  }, [hasLogo, logoVersion])

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  return logoUrl
}

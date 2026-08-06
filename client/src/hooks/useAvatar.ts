import { useEffect, useRef, useState } from 'react'
import { fetchAvatarBlobUrl } from '../api/client'

export function useAvatar(id: number | null, avatarVersion: number): string | null {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (id == null) return
    let cancelled = false
    fetchAvatarBlobUrl(id).then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url)
        return
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = url
      setAvatarUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [id, avatarVersion])

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  return avatarUrl
}

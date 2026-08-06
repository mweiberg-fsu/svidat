import { useEffect, useState } from 'react'
import { getCatalog } from '../api/client'
import type { Catalog } from '../api/types'

export function useCatalog(): { catalog: Catalog | null; error: string | null } {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCatalog()
      .then(setCatalog)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return { catalog, error }
}

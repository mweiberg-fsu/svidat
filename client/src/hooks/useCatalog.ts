import { useEffect, useState } from 'react'
import { getCatalog, getShipNames } from '../api/client'
import type { Catalog, ShipNames } from '../api/types'

export function useCatalog(): {
  catalog: Catalog | null
  shipNames: ShipNames
  error: string | null
} {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [shipNames, setShipNames] = useState<ShipNames>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCatalog()
      .then(setCatalog)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    // Names are cosmetic: if they fail to load, ships show as bare call signs.
    getShipNames()
      .then(setShipNames)
      .catch(() => {})
  }, [])

  return { catalog, shipNames, error }
}

import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

interface PlotSelectionState {
  ship: string
  year: string
  file: string
  variables: string[]
  setShip: (value: string) => void
  setYear: (value: string) => void
  setFile: (value: string) => void
  setVariables: (value: string[]) => void
}

const PlotSelectionContext = createContext<PlotSelectionState | undefined>(undefined)

export function PlotSelectionProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams()

  const ship = params.get('ship') ?? ''
  const year = params.get('year') ?? ''
  const file = params.get('file') ?? ''
  const variables = params.get('vars')?.split(',').filter(Boolean) ?? []

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === '') next.delete(k)
            else next.set(k, v)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const setShip = (value: string) => update({ ship: value, year: null, file: null, vars: null })
  const setYear = (value: string) => update({ year: value, file: null })
  const setFile = (value: string) => update({ file: value, vars: null })
  const setVariables = (value: string[]) => update({ vars: value.join(',') || null })

  return (
    <PlotSelectionContext.Provider
      value={{ ship, year, file, variables, setShip, setYear, setFile, setVariables }}
    >
      {children}
    </PlotSelectionContext.Provider>
  )
}

export function usePlotSelection(): PlotSelectionState {
  const ctx = useContext(PlotSelectionContext)
  if (!ctx) {
    throw new Error('usePlotSelection must be used within PlotSelectionProvider')
  }
  return ctx
}

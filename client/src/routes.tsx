import { Navigate, useLocation } from 'react-router-dom'

// The plot/editing page. Formerly /files — see LegacyPlotRedirect.
export const PLOT_PATH = '/plot'

// Keeps old /files?... bookmarks and shared links working.
export function LegacyPlotRedirect() {
  const { search } = useLocation()
  return <Navigate to={`${PLOT_PATH}${search}`} replace />
}

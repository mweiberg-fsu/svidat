import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { SvgPlot } from '../components/SvgPlot'

// Bulk edit / Save draft / Publish live in the SecondaryNavbar (app layout).
export function FilesPage() {
  const { file } = usePlotSelection()
  const { canEdit, sessionError } = useEditSession()

  return (
    <div>
      {file && canEdit && sessionError && <p role="alert">{sessionError}</p>}
      <SvgPlot />
    </div>
  )
}

import { CurrentUserPlotGuide } from '../components/PlotGuide'

// Navbar "Guide": the same getting-started guide the plot area shows when
// nothing is plotted, available any time.
export function GuidePage() {
  return (
    <div className="guide-page">
      <CurrentUserPlotGuide lead="Here's how to find your way around." />
    </div>
  )
}

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { LegacyPlotRedirect, PLOT_PATH } from '../routes'

function Where() {
  const { pathname, search } = useLocation()
  return <span data-testid="where">{pathname + search}</span>
}

describe('routes', () => {
  it('the plot page lives at /plot', () => {
    expect(PLOT_PATH).toBe('/plot')
  })

  it('redirects old /files links to /plot, keeping the query string', () => {
    render(
      <MemoryRouter initialEntries={['/files?file=FILE_A&source=draft']}>
        <Routes>
          <Route path="/files" element={<LegacyPlotRedirect />} />
          <Route path={PLOT_PATH} element={<Where />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('where')).toHaveTextContent('/plot?file=FILE_A&source=draft')
  })
})

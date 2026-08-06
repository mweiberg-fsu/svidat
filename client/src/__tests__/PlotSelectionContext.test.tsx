import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'

function Consumer() {
  const { file, setFile, variables, setVariables } = usePlotSelection()
  return (
    <div>
      <span>file:{file}</span>
      <span>variables:{variables.join(',')}</span>
      <button onClick={() => setFile('KAQP_20250101v20001')}>set file</button>
      <button onClick={() => setVariables(['CNDC', 'SSPS'])}>set variables</button>
    </div>
  )
}

describe('PlotSelectionContext', () => {
  it('shares state between consumers under the same provider', () => {
    render(
      <MemoryRouter>
        <PlotSelectionProvider>
          <Consumer />
        </PlotSelectionProvider>
      </MemoryRouter>
    )
    expect(screen.getByText('file:')).toBeInTheDocument()
    fireEvent.click(screen.getByText('set file'))
    expect(screen.getByText('file:KAQP_20250101v20001')).toBeInTheDocument()
    fireEvent.click(screen.getByText('set variables'))
    expect(screen.getByText('variables:CNDC,SSPS')).toBeInTheDocument()
  })
})

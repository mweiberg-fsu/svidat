import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PlotGuide } from '../components/PlotGuide'
import { DEFAULT_DOCUMENTATION, DEFAULT_KEYBINDINGS, applyConfig, modifierName } from '../appConfig'

afterEach(() => {
  applyConfig({ keybindings: DEFAULT_KEYBINDINGS, documentation: DEFAULT_DOCUMENTATION })
})

describe('PlotGuide', () => {
  it('keeps the original prompt and shows the navigation steps', () => {
    render(<PlotGuide roles={[]} />)
    expect(screen.getByText('Select variables in the sidebar to view plots.')).toBeInTheDocument()
    for (const title of ['Pick a file', 'Choose variables', 'Explore the plot', 'Handy tools', 'Make it yours']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
  })

  it('shows the live keybindings, including personal rebinds', () => {
    applyConfig({
      keybindings: DEFAULT_KEYBINDINGS,
      user_keybindings: { ...DEFAULT_KEYBINDINGS, x_zoom: 'alt' },
      documentation: DEFAULT_DOCUMENTATION,
    })
    render(<PlotGuide roles={[]} />)
    const explore = screen.getByRole('heading', { name: 'Explore the plot' }).closest('li') as HTMLElement
    expect(within(explore).getByText(`${modifierName('alt')}+drag`)).toBeInTheDocument()
  })

  it('shows the flagging step only to qca users', () => {
    const { rerender } = render(<PlotGuide roles={[]} />)
    expect(screen.queryByRole('heading', { name: 'Flag & publish' })).not.toBeInTheDocument()
    expect(screen.getByText(/view-only/i)).toBeInTheDocument()

    rerender(<PlotGuide roles={['qca']} />)
    expect(screen.getByRole('heading', { name: 'Flag & publish' })).toBeInTheDocument()
    expect(screen.getByText('Save draft (v250)')).toBeInTheDocument()
    expect(screen.getByText('Publish (v300)')).toBeInTheDocument()
  })
})

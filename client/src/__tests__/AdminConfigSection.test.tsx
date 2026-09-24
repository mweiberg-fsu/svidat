import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AdminConfigSection } from '../components/AdminConfigSection'
import * as client from '../api/client'
import type { AppConfig } from '../api/types'
import { DEFAULT_DOCUMENTATION, DEFAULT_KEYBINDINGS, applyConfig } from '../appConfig'

const SERVER_CONFIG: AppConfig = {
  keybindings: DEFAULT_KEYBINDINGS,
  documentation: [
    { title: 'Intro', body: '## Hello\n\nUse {{x_zoom}} to zoom.' },
    { title: 'More', body: 'second tab' },
  ],
}

describe('AdminConfigSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(client, 'getConfig').mockResolvedValue(SERVER_CONFIG)
  })

  afterEach(() => {
    applyConfig({ keybindings: DEFAULT_KEYBINDINGS, documentation: DEFAULT_DOCUMENTATION })
  })

  it('loads keybindings and documentation tabs from the server', async () => {
    render(<AdminConfigSection />)
    expect(await screen.findByRole('tab', { name: 'Intro' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'More' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tab content')).toHaveValue('## Hello\n\nUse {{x_zoom}} to zoom.')
    expect(screen.getByLabelText('Zoom X axis')).toHaveValue('shift')
    expect(screen.getByLabelText('Redo zoom')).toHaveValue('dblclick')
  })

  it('blocks saving when two gestures share a binding', async () => {
    render(<AdminConfigSection />)
    await screen.findByRole('tab', { name: 'Intro' })

    fireEvent.change(screen.getByLabelText('Zoom Y axis'), { target: { value: 'shift' } })

    expect(screen.getByText(/can't share the same binding/)).toBeInTheDocument()
    expect(screen.getByText('Save configuration')).toBeDisabled()
  })

  it('previews Markdown with the form\'s current bindings filled in', async () => {
    render(<AdminConfigSection />)
    await screen.findByRole('tab', { name: 'Intro' })

    fireEvent.change(screen.getByLabelText('Zoom X axis'), { target: { value: 'alt' } })
    fireEvent.click(screen.getByText('Preview'))

    const preview = screen.getByTestId('doc-preview')
    expect(preview.querySelector('h3')!.textContent).toBe('Hello')
    expect(preview.textContent).toMatch(/Use (Alt|Option)\+drag to zoom\./)
  })

  it('adds, renames, reorders, and deletes tabs, then saves the result', async () => {
    const update = vi
      .spyOn(client, 'updateConfig')
      .mockImplementation(async (config) => config)
    render(<AdminConfigSection />)
    await screen.findByRole('tab', { name: 'Intro' })

    fireEvent.click(screen.getByText('+ Add tab'))
    fireEvent.change(screen.getByLabelText('Tab title'), { target: { value: 'FAQ' } })
    fireEvent.change(screen.getByLabelText('Tab content'), { target: { value: '- q?' } })
    fireEvent.click(screen.getByText('Move left'))

    fireEvent.click(screen.getByRole('tab', { name: 'Intro' }))
    fireEvent.click(screen.getByText('Delete tab'))

    fireEvent.change(screen.getByLabelText('Undo zoom'), { target: { value: 'alt' } })
    fireEvent.click(screen.getByText('Save configuration'))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        keybindings: { ...DEFAULT_KEYBINDINGS, undo: 'alt' },
        documentation: [
          { title: 'FAQ', body: '- q?' },
          { title: 'More', body: 'second tab' },
        ],
      })
    )
    expect(await screen.findByText('Configuration updated')).toBeInTheDocument()
  })

  it('disables saving while a tab title is blank', async () => {
    render(<AdminConfigSection />)
    await screen.findByRole('tab', { name: 'Intro' })

    fireEvent.change(screen.getByLabelText('Tab title'), { target: { value: '  ' } })

    expect(screen.getByText('Every tab needs a title.')).toBeInTheDocument()
    expect(screen.getByText('Save configuration')).toBeDisabled()
  })

  it('resets the documentation form to the defaults', async () => {
    render(<AdminConfigSection />)
    await screen.findByRole('tab', { name: 'Intro' })

    fireEvent.click(screen.getByText('Reset documentation to defaults'))

    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Intro' })).not.toBeInTheDocument()
  })

  it('shows a server error on save', async () => {
    vi.spyOn(client, 'updateConfig').mockRejectedValue(new Error('422: bad'))
    render(<AdminConfigSection />)
    await screen.findByRole('tab', { name: 'Intro' })

    fireEvent.click(screen.getByText('Save configuration'))

    expect(await screen.findByText('Error: 422: bad')).toBeInTheDocument()
  })
})

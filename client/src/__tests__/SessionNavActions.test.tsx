import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SessionNavActions } from '../components/SessionNavActions'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'
import * as plotImage from '../plotImage'
import type { AuditEntry } from '../api/types'

const SESSION_START = '2026-09-24T10:00:00'

function Probe() {
  const sel = usePlotSelection()
  const { openSession, flagSelection, setFlagSelection, flagAppliedAt } = useEditSession()
  return (
    <div>
      <button onClick={() => sel.setFile('FILE_A')}>set file</button>
      <button onClick={() => sel.setFile('FILE_B')}>switch file</button>
      <button onClick={() => sel.setVariables(['T', 'SAL', 'LAT'])}>set vars</button>
      <button onClick={() => openSession()}>open session</button>
      <button
        onClick={() =>
          setFlagSelection({ varName: 'T', startIdx: 1, endIdx: 3, rangeLabel: '01:00–03:00' })
        }
      >
        highlight
      </button>
      <span data-testid="selection">{flagSelection ? flagSelection.varName : 'none'}</span>
      <span data-testid="flag-applied-at">{flagAppliedAt}</span>
    </div>
  )
}

async function renderWithOpenSession() {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(['qca']))
  localStorage.setItem('svidat_username', 'testuser')
  vi.spyOn(apiClient, 'openSession').mockResolvedValue({
    status: 'opened',
    session_started_at: SESSION_START,
  })
  render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <Probe />
            <SessionNavActions />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
  fireEvent.click(screen.getByText('set file'))
  fireEvent.click(screen.getByText('open session'))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
  )
}

async function openSaveMenu() {
  await renderWithOpenSession()
  fireEvent.click(screen.getByText('set vars'))
  fireEvent.click(screen.getByRole('button', { name: 'Save Image' }))
  return screen.getByRole('group', { name: 'Save image' })
}

function entry(id: number, action: string, reverted = false): AuditEntry {
  return {
    id,
    user_id: 1,
    username: 'testuser',
    action,
    var_name: 'T',
    old_value: null,
    new_value: null,
    reverted,
    timestamp: SESSION_START,
  }
}

describe('SessionNavActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('Close Session opens a menu with the three session actions; Escape closes it', async () => {
    await renderWithOpenSession()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Close Session'))
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Exit file',
      'Revert all applied flags',
      'Remove highlighted area',
    ])

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking outside closes the menu', async () => {
    await renderWithOpenSession()
    fireEvent.click(screen.getByText('Close Session'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Remove highlighted area is disabled with no selection and clears one when present', async () => {
    await renderWithOpenSession()
    fireEvent.click(screen.getByText('Close Session'))
    expect(screen.getByRole('menuitem', { name: 'Remove highlighted area' })).toBeDisabled()

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByText('highlight'))
    expect(screen.getByTestId('selection')).toHaveTextContent('T')

    fireEvent.click(screen.getByText('Close Session'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove highlighted area' }))
    expect(screen.getByTestId('selection')).toHaveTextContent('none')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Revert all applied flags reverts only unreverted flag edits, newest first, after confirming', async () => {
    await renderWithOpenSession()
    const historySpy = vi
      .spyOn(apiClient, 'getAuditHistory')
      .mockResolvedValue([
        entry(1, 'flag_edit'),
        entry(2, 'point_edit'),
        entry(3, 'flag_edit'),
        entry(4, 'flag_edit', true),
      ])
    const revertSpy = vi.spyOn(apiClient, 'revertAuditEntry').mockResolvedValue({ status: 'reverted' })

    fireEvent.click(screen.getByText('Close Session'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revert all applied flags' }))

    const dialog = await screen.findByRole('dialog')
    expect(historySpy).toHaveBeenCalledWith('FILE_A', SESSION_START)
    expect(dialog).toHaveTextContent('2 flag edits')
    expect(revertSpy).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Revert flags' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Reverted 2 flag edits'))
    expect(revertSpy.mock.calls.map((c) => c[0])).toEqual([3, 1])
    expect(screen.getByTestId('flag-applied-at')).not.toHaveTextContent('0')
  })

  it('Revert all applied flags reports when there is nothing to revert', async () => {
    await renderWithOpenSession()
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([entry(2, 'point_edit')])
    const revertSpy = vi.spyOn(apiClient, 'revertAuditEntry')

    fireEvent.click(screen.getByText('Close Session'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revert all applied flags' }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('No applied flags to revert')
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(revertSpy).not.toHaveBeenCalled()
  })

  it('Revert all applied flags stops and reports on the first failure', async () => {
    await renderWithOpenSession()
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([
      entry(1, 'flag_edit'),
      entry(3, 'flag_edit'),
    ])
    const revertSpy = vi
      .spyOn(apiClient, 'revertAuditEntry')
      .mockRejectedValueOnce(new Error('already reverted'))

    fireEvent.click(screen.getByText('Close Session'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revert all applied flags' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revert flags' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('already reverted'))
    expect(revertSpy).toHaveBeenCalledTimes(1)
  })

  it('shows Save Image as a tab button', async () => {
    await renderWithOpenSession()
    expect(screen.getByRole('button', { name: 'Save Image' })).toHaveClass('navbar-tab')
    expect(screen.getByRole('button', { name: 'Close Session' })).toHaveClass('navbar-tab')
  })

  it('Save Image opens a menu listing the plotted variables in order, all checked', async () => {
    const menu = await openSaveMenu()
    const boxes = within(menu).getAllByRole('checkbox')
    expect(boxes.map((b) => b.getAttribute('name'))).toEqual(['T', 'SAL', 'LAT'])
    boxes.forEach((b) => expect(b).toBeChecked())
  })

  it('lays the plot checkboxes out in a two-column grid, with Save PNG below it', async () => {
    const menu = await openSaveMenu()
    const grid = menu.querySelector('.navbar-image-options')!
    expect(within(grid as HTMLElement).getAllByRole('checkbox')).toHaveLength(3)
    // The button isn't part of the grid.
    expect(grid.contains(within(menu).getByRole('button', { name: 'Save PNG' }))).toBe(false)
  })

  it('Save PNG exports only the checked plots, in on-screen order', async () => {
    const exportSpy = vi.spyOn(plotImage, 'exportPlotsPng').mockResolvedValue()
    const menu = await openSaveMenu()
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'SAL' }))
    fireEvent.click(within(menu).getByRole('button', { name: 'Save PNG' }))

    expect(exportSpy).toHaveBeenCalledWith(['T', 'LAT'], 'FILE_A_plots.png')
    expect(screen.queryByRole('group', { name: 'Save image' })).not.toBeInTheDocument()
  })

  it('Save PNG is disabled when every plot is unchecked', async () => {
    const menu = await openSaveMenu()
    within(menu).getAllByRole('checkbox').forEach((b) => fireEvent.click(b))
    expect(within(menu).getByRole('button', { name: 'Save PNG' })).toBeDisabled()
  })

  it('re-checks every plot each time the menu opens', async () => {
    const menu = await openSaveMenu()
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'T' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Image' })) // close
    fireEvent.click(screen.getByRole('button', { name: 'Save Image' })) // reopen
    const reopened = screen.getByRole('group', { name: 'Save image' })
    expect(within(reopened).getByRole('checkbox', { name: 'T' })).toBeChecked()
  })

  it('shows the export error in the status area', async () => {
    vi.spyOn(plotImage, 'exportPlotsPng').mockRejectedValue(new Error('No plots to save'))
    const menu = await openSaveMenu()
    fireEvent.click(within(menu).getByRole('button', { name: 'Save PNG' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Error: No plots to save')
  })

  it('shows "No plots to save" when a file is open but nothing is plotted', async () => {
    await renderWithOpenSession()
    fireEvent.click(screen.getByRole('button', { name: 'Save Image' }))
    const menu = screen.getByRole('group', { name: 'Save image' })
    expect(within(menu).getByText('No plots to save')).toBeInTheDocument()
    expect(within(menu).getByRole('button', { name: 'Save PNG' })).toBeDisabled()
  })

  it('Escape closes the Save Image menu', async () => {
    await openSaveMenu()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Save image' })).not.toBeInTheDocument()
  })

  it('clicking outside closes the Save Image menu', async () => {
    await openSaveMenu()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('group', { name: 'Save image' })).not.toBeInTheDocument()
  })

  it('closes the Save Image menu when the file changes', async () => {
    await openSaveMenu()
    fireEvent.click(screen.getByText('switch file'))
    expect(screen.queryByRole('group', { name: 'Save image' })).not.toBeInTheDocument()
  })
})

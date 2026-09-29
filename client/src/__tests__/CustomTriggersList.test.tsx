import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CustomTriggersList } from '../components/CustomTriggersList'

const LIST = [{ name: 'Pan', trigger: 'none/middle/drag' }]

function record(mods: Record<string, boolean>, button: number, dx = 0) {
  const box = screen.getByRole('button', { name: /record keybind/i })
  fireEvent.mouseDown(box, { button, clientX: 0, clientY: 0, ...mods })
  fireEvent.mouseUp(window, { button, clientX: dx, clientY: 0, detail: 1 })
}

describe('CustomTriggersList', () => {
  it('lists triggers with name, label and kind', () => {
    render(<CustomTriggersList triggers={LIST} onSave={vi.fn()} />)
    expect(screen.getByText('Pan')).toBeInTheDocument()
    expect(screen.getByText('Middle-drag')).toBeInTheDocument()
    expect(screen.getByText('drag')).toBeInTheDocument()
  })

  it('adds a recorded trigger via +', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<CustomTriggersList triggers={LIST} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add keybind' }))
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Quick undo' } })
    record({ altKey: true }, 2)
    expect(add).toBeEnabled()
    fireEvent.click(add)
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([...LIST, { name: 'Quick undo', trigger: 'alt/right/click' }])
    )
    expect(await screen.findByText('Keybind added')).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('shows a validation message and keeps Add disabled', () => {
    render(<CustomTriggersList triggers={LIST} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add keybind' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Other' } })
    record({}, 1, 20) // none/middle/drag, same as Pan
    expect(screen.getByText('Same keybind as "Pan".')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('deletes a trigger', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<CustomTriggersList triggers={LIST} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Pan' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([]))
  })

  it('shows save errors', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('422: bad'))
    render(<CustomTriggersList triggers={LIST} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Pan' }))
    expect(await screen.findByText('Error: 422: bad')).toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ColorModeSwitch } from '../components/ColorModeSwitch'
import { setColorMode } from '../colorMode'

describe('ColorModeSwitch', () => {
  it('toggles data-theme, persists choice, and keeps multiple switches in sync', () => {
    setColorMode('light')
    render(
      <>
        <ColorModeSwitch />
        <ColorModeSwitch />
      </>,
    )
    const [first, second] = screen.getAllByRole('switch', { name: 'Dark mode' })
    expect(first).not.toBeChecked()

    fireEvent.click(first)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('svidat-color-mode')).toBe('dark')
    expect(second).toBeChecked()

    fireEvent.click(second)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(first).not.toBeChecked()
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AuthProvider, useAuth } from '../context/AuthContext'
import * as apiClient from '../api/client'

function Consumer() {
  const { login } = useAuth()
  return (
    <button onClick={() => login('tok', ['qca'], 'testuser', 1)}>login</button>
  )
}

describe('AuthContext theme', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('applies the fetched theme colors as CSS custom properties on login', async () => {
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([])
    vi.spyOn(apiClient, 'getTheme').mockResolvedValue({
      primary_color: '#111111',
      secondary_color: '#222222',
      tertiary_color: '#333333',
      site_name: 'SVIDAT',
      save_draft_label: 'Save draft (v250)',
      publish_label: 'Publish (v300)',
      has_logo: false,
    })

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    )
    fireEvent.click(screen.getByText('login'))

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#111111')
    )
    expect(document.documentElement.style.getPropertyValue('--secondary')).toBe('#222222')
    expect(document.documentElement.style.getPropertyValue('--tertiary')).toBe('#333333')
  })

  it('fetches the public theme even when there is no token', async () => {
    const themeSpy = vi.spyOn(apiClient, 'getTheme').mockResolvedValue({
      primary_color: '#444444',
      secondary_color: '#555555',
      tertiary_color: '#666666',
      site_name: 'SVIDAT',
      save_draft_label: 'Save draft (v250)',
      publish_label: 'Publish (v300)',
      has_logo: false,
    })
    const sessionsSpy = vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([])
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    )
    expect(themeSpy).toHaveBeenCalledTimes(1)
    expect(sessionsSpy).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#444444')
    )
  })
})

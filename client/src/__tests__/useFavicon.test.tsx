import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import * as apiClient from '../api/client'
import { applyTheme } from '../theme'
import { DEFAULT_FAVICON, useFavicon } from '../hooks/useFavicon'
import type { ThemeSettings } from '../api/types'

function Host() {
  useFavicon()
  return null
}

const theme = (has_logo: boolean): ThemeSettings => ({
  primary_color: '#e11d48',
  secondary_color: '#1f2937',
  tertiary_color: '#374151',
  site_name: 'SVIDAT',
  save_draft_label: '',
  publish_label: '',
  has_logo,
})

const icon = () => document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')

describe('useFavicon', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.head.innerHTML = `<link rel="icon" type="image/svg+xml" href="${DEFAULT_FAVICON}" />`
  })

  afterEach(() => {
    act(() => applyTheme(theme(false)))
  })

  it('uses the admin-set logo as the tab icon', async () => {
    vi.spyOn(apiClient, 'fetchLogoBlobUrl').mockResolvedValue('blob:logo-1')
    render(<Host />)
    act(() => applyTheme(theme(true)))
    await waitFor(() => expect(icon()?.getAttribute('href')).toBe('blob:logo-1'))
    // The logo can be any image type, so the SVG type hint is dropped.
    expect(icon()?.hasAttribute('type')).toBe(false)
  })

  it('switches to a newly uploaded logo', async () => {
    const fetchSpy = vi
      .spyOn(apiClient, 'fetchLogoBlobUrl')
      .mockResolvedValueOnce('blob:logo-1')
      .mockResolvedValueOnce('blob:logo-2')
    render(<Host />)
    act(() => applyTheme(theme(true)))
    await waitFor(() => expect(icon()?.getAttribute('href')).toBe('blob:logo-1'))
    act(() => applyTheme(theme(true)))
    await waitFor(() => expect(icon()?.getAttribute('href')).toBe('blob:logo-2'))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('falls back to the default icon when there is no logo', async () => {
    vi.spyOn(apiClient, 'fetchLogoBlobUrl').mockResolvedValue('blob:logo-1')
    render(<Host />)
    act(() => applyTheme(theme(true)))
    await waitFor(() => expect(icon()?.getAttribute('href')).toBe('blob:logo-1'))

    act(() => applyTheme(theme(false)))
    await waitFor(() => expect(icon()?.getAttribute('href')).toBe(DEFAULT_FAVICON))
    expect(icon()?.getAttribute('type')).toBe('image/svg+xml')
  })
})

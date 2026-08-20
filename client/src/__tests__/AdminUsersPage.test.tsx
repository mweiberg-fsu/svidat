import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AdminUsersPage } from '../pages/AdminUsersPage'
import * as client from '../api/client'

describe('AdminUsersPage OAuth domain allowlist', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(client, 'listUsers').mockResolvedValue([])
    vi.spyOn(client, 'getOAuthSettings').mockResolvedValue({ allowed_domains: ['fsu.edu'] })
  })

  it('loads and displays existing allowed domains', async () => {
    render(<AdminUsersPage />)
    expect(await screen.findByText('fsu.edu')).toBeInTheDocument()
  })

  it('adds a domain and re-renders the list the server returns', async () => {
    vi.spyOn(client, 'updateOAuthSettings').mockResolvedValue({
      allowed_domains: ['fsu.edu', 'noaa.gov'],
    })
    render(<AdminUsersPage />)
    await screen.findByText('fsu.edu')

    fireEvent.change(screen.getByPlaceholderText('fsu.edu'), { target: { value: 'noaa.gov' } })
    fireEvent.click(screen.getByText('Add domain'))

    await waitFor(() =>
      expect(client.updateOAuthSettings).toHaveBeenCalledWith(['fsu.edu', 'noaa.gov'])
    )
    expect(await screen.findByText('noaa.gov')).toBeInTheDocument()
  })

  it('removes a domain', async () => {
    vi.spyOn(client, 'updateOAuthSettings').mockResolvedValue({ allowed_domains: [] })
    render(<AdminUsersPage />)
    await screen.findByText('fsu.edu')

    fireEvent.click(screen.getByText('Remove'))

    await waitFor(() => expect(client.updateOAuthSettings).toHaveBeenCalledWith([]))
  })
})

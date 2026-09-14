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

    fireEvent.click(screen.getByRole('button', { name: 'Remove fsu.edu' }))

    await waitFor(() => expect(client.updateOAuthSettings).toHaveBeenCalledWith([]))
  })

  it('disables add/remove controls while a domain update is in flight', async () => {
    let resolveUpdate: (value: { allowed_domains: string[] }) => void
    const pending = new Promise<{ allowed_domains: string[] }>((resolve) => {
      resolveUpdate = resolve
    })
    vi.spyOn(client, 'updateOAuthSettings').mockReturnValue(pending)

    render(<AdminUsersPage />)
    await screen.findByText('fsu.edu')

    fireEvent.change(screen.getByPlaceholderText('fsu.edu'), { target: { value: 'noaa.gov' } })
    fireEvent.click(screen.getByText('Add domain'))

    await waitFor(() => expect(screen.getByText('Add domain')).toBeDisabled())
    expect(screen.getByPlaceholderText('fsu.edu')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove fsu.edu' })).toBeDisabled()

    // a second click while in flight must not fire a second request
    fireEvent.click(screen.getByText('Add domain'))
    expect(client.updateOAuthSettings).toHaveBeenCalledTimes(1)

    resolveUpdate!({ allowed_domains: ['fsu.edu', 'noaa.gov'] })

    await waitFor(() => expect(screen.getByText('Add domain')).not.toBeDisabled())
  })
})

describe('AdminUsersPage role management', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(client, 'getOAuthSettings').mockResolvedValue({ allowed_domains: [] })
  })

  it('creates a user with checked roles', async () => {
    vi.spyOn(client, 'listUsers').mockResolvedValue([])
    vi.spyOn(client, 'createUser').mockResolvedValue({ id: 1, username: 'newqca', roles: ['qca'] })

    render(<AdminUsersPage />)

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newqca' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByLabelText('qca'))
    fireEvent.click(screen.getByText('Create user'))

    await waitFor(() => expect(client.createUser).toHaveBeenCalledWith('newqca', 'pw', ['qca']))
  })

  it('shows existing users with their current roles', async () => {
    vi.spyOn(client, 'listUsers').mockResolvedValue([
      { id: 7, username: 'existinguser', roles: ['admin'] },
    ])

    render(<AdminUsersPage />)

    const row = await screen.findByText(/existinguser/)
    expect(row).toBeInTheDocument()
    expect(row.closest('li')).toHaveTextContent('admin')
  })

  it('clicking Edit reveals role checkboxes pre-filled from current roles', async () => {
    vi.spyOn(client, 'listUsers').mockResolvedValue([
      { id: 7, username: 'existinguser', roles: ['admin'] },
    ])

    render(<AdminUsersPage />)
    await screen.findByText(/existinguser/)

    fireEvent.click(screen.getByText('Edit'))

    const adminCheckbox = screen.getAllByLabelText('admin').find(
      (el) => (el as HTMLInputElement).type === 'checkbox'
    ) as HTMLInputElement
    const qcaCheckbox = screen.getAllByLabelText('qca').find(
      (el) => (el as HTMLInputElement).type === 'checkbox'
    ) as HTMLInputElement
    expect(adminCheckbox.checked).toBe(true)
    expect(qcaCheckbox.checked).toBe(false)
    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('Save calls updateUserRoles and exits edit mode with the returned roles', async () => {
    vi.spyOn(client, 'listUsers').mockResolvedValue([
      { id: 7, username: 'existinguser', roles: ['admin'] },
    ])
    vi.spyOn(client, 'updateUserRoles').mockResolvedValue({
      id: 7,
      username: 'existinguser',
      roles: ['admin', 'qca'],
    })

    render(<AdminUsersPage />)
    await screen.findByText(/existinguser/)
    fireEvent.click(screen.getByText('Edit'))

    const qcaCheckbox = screen.getAllByLabelText('qca').find(
      (el) => (el as HTMLInputElement).type === 'checkbox'
    ) as HTMLInputElement
    fireEvent.click(qcaCheckbox)
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(client.updateUserRoles).toHaveBeenCalledWith(7, ['admin', 'qca']))
    expect(screen.queryByText('Save')).not.toBeInTheDocument()
    const row = (await screen.findByText(/existinguser/)).closest('li')
    expect(row).toHaveTextContent('admin')
    expect(row).toHaveTextContent('qca')
  })

  it('Cancel discards checkbox changes and exits edit mode without saving', async () => {
    vi.spyOn(client, 'listUsers').mockResolvedValue([
      { id: 7, username: 'existinguser', roles: ['admin'] },
    ])
    const updateSpy = vi.spyOn(client, 'updateUserRoles')

    render(<AdminUsersPage />)
    await screen.findByText(/existinguser/)
    fireEvent.click(screen.getByText('Edit'))

    const qcaCheckbox = screen.getAllByLabelText('qca').find(
      (el) => (el as HTMLInputElement).type === 'checkbox'
    ) as HTMLInputElement
    fireEvent.click(qcaCheckbox)
    fireEvent.click(screen.getByText('Cancel'))

    expect(updateSpy).not.toHaveBeenCalled()
    expect(screen.queryByText('Save')).not.toBeInTheDocument()
    expect(screen.getByText(/existinguser/).closest('li')).toHaveTextContent('admin')
  })

  it('disables Save/Cancel/checkboxes while a role update is in flight', async () => {
    vi.spyOn(client, 'listUsers').mockResolvedValue([
      { id: 7, username: 'existinguser', roles: ['admin'] },
    ])
    let resolveUpdate: (value: { id: number; username: string; roles: string[] }) => void
    vi.spyOn(client, 'updateUserRoles').mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve
      })
    )

    render(<AdminUsersPage />)
    await screen.findByText(/existinguser/)
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Save'))

    expect(screen.getByText('Save')).toBeDisabled()
    expect(screen.getByText('Cancel')).toBeDisabled()

    resolveUpdate!({ id: 7, username: 'existinguser', roles: ['admin'] })
    await waitFor(() => expect(screen.queryByText('Save')).not.toBeInTheDocument())
  })
})

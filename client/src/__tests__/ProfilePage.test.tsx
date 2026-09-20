import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProfilePage } from '../pages/ProfilePage'
import { AuthProvider } from '../context/AuthContext'
import * as apiClient from '../api/client'

describe('ProfilePage', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('svidat_id', '1')
    localStorage.setItem('svidat_username', 'testuser')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    vi.restoreAllMocks()
  })

  it('uploads a photo and shows a success status', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    const uploadSpy = vi
      .spyOn(apiClient, 'uploadAvatar')
      .mockResolvedValue({ avatar_path: 'avatars/1.png' })

    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    const input = screen.getByLabelText('Upload photo')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith(file))
    await waitFor(() => expect(screen.getByText('Photo updated')).toBeInTheDocument())
  })

  it('shows an error status when upload fails', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'uploadAvatar').mockRejectedValue(new Error('400: upload failed'))

    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload photo'), { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByText('Error: 400: upload failed')).toBeInTheDocument()
    )
  })

  it('shows My drafts section for qca role', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'listDrafts').mockResolvedValue(['shipx_2026-07-30'])
    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('My drafts')).toBeInTheDocument())
    const link = screen.getByText('shipx_2026-07-30')
    expect(link.closest('a')).toHaveAttribute(
      'href',
      '/files?file=shipx_2026-07-30&source=draft'
    )
  })

  it('hides My drafts section for admin-only role (no qca)', async () => {
    localStorage.setItem('svidat_role', JSON.stringify(['admin']))
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('Profile')).toBeInTheDocument())
    expect(screen.queryByText('My drafts')).not.toBeInTheDocument()
  })

  it('hides My drafts section for view-only role (no roles)', async () => {
    localStorage.setItem('svidat_role', JSON.stringify([]))
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('Profile')).toBeInTheDocument())
    expect(screen.queryByText('My drafts')).not.toBeInTheDocument()
  })

  it('shows Files Edited tab by default, listing unique edited filenames', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'listDrafts').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([
      { id: 1, user_id: 1, username: 'testuser', action: 'point_edit', var_name: 'temp', old_value: 1, new_value: 2, reverted: false, timestamp: '2026-09-01T00:00:00', filename: 'shipx_2026-09-01' },
      { id: 2, user_id: 1, username: 'testuser', action: 'save', var_name: null, old_value: null, new_value: null, reverted: false, timestamp: '2026-09-02T00:00:00', filename: 'shipx_2026-09-01' },
    ])

    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )

    await waitFor(() => expect(screen.getByText('Files Edited')).toBeInTheDocument())
    const section = screen.getByRole('button', { name: 'Files Edited' }).closest('section')!
    expect(section.textContent).toContain('shipx_2026-09-01')
  })

  it('switches to Temporary Files tab and lists open sessions', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'listDrafts').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([
      { filename: 'shipx_2026-09-05', created_at: '2026-09-05T00:00:00', last_edited_at: null },
    ])

    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Temporary Files' }))
    expect(await screen.findByText('shipx_2026-09-05')).toBeInTheDocument()
  })

  it('switches to Saved to v250 tab and lists only save-action filenames', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'listDrafts').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([
      { id: 1, user_id: 1, username: 'testuser', action: 'save', var_name: null, old_value: null, new_value: null, reverted: false, timestamp: '2026-09-02T00:00:00', filename: 'shipx_2026-09-02' },
      { id: 2, user_id: 1, username: 'testuser', action: 'publish', var_name: null, old_value: null, new_value: null, reverted: false, timestamp: '2026-09-03T00:00:00', filename: 'shipx_2026-09-03' },
    ])

    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Saved to v250' }))
    const section = screen.getByRole('button', { name: 'Saved to v250' }).closest('section')!
    await waitFor(() => expect(within(section).getByText('shipx_2026-09-02')).toBeInTheDocument())
    expect(within(section).queryByText('shipx_2026-09-03')).not.toBeInTheDocument()
  })

  it('switches to Saved to v300 tab and lists only publish-action filenames', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'listDrafts').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([
      { id: 1, user_id: 1, username: 'testuser', action: 'save', var_name: null, old_value: null, new_value: null, reverted: false, timestamp: '2026-09-02T00:00:00', filename: 'shipx_2026-09-02' },
      { id: 2, user_id: 1, username: 'testuser', action: 'publish', var_name: null, old_value: null, new_value: null, reverted: false, timestamp: '2026-09-03T00:00:00', filename: 'shipx_2026-09-03' },
    ])

    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Saved to v300' }))
    const section = screen.getByRole('button', { name: 'Saved to v300' }).closest('section')!
    await waitFor(() => expect(within(section).getByText('shipx_2026-09-03')).toBeInTheDocument())
    expect(within(section).queryByText('shipx_2026-09-02')).not.toBeInTheDocument()
  })

  it('shows an empty-state hint when the active tab has no files', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'listDrafts').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])

    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )

    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Temporary Files' }))
    expect(await screen.findByText('No open sessions.')).toBeInTheDocument()
  })
})

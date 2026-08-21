import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
})

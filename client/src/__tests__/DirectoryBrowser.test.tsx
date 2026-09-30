import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as client from '../api/client'
import { DirectoryBrowser } from '../components/DirectoryBrowser'
import type { DirectoryListing } from '../api/types'

const SHORTCUTS = [
  { label: 'Data folder', path: '/srv/data' },
  { label: 'Home', path: '/home/me' },
  { label: 'Root', path: '/' },
]

function listing(path: string, dirs: string[], extra: Partial<DirectoryListing> = {}): DirectoryListing {
  return {
    path,
    parent: path === '/' ? null : path.split('/').slice(0, -1).join('/') || '/',
    readable: true,
    writable: true,
    dirs: dirs.map((name) => ({
      name,
      path: `${path === '/' ? '' : path}/${name}`,
      readable: true,
      writable: name !== 'locked',
    })),
    truncated: false,
    shortcuts: SHORTCUTS,
    ...extra,
  }
}

describe('DirectoryBrowser', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('starts at the given path and navigates into a folder and back up', async () => {
    const browse = vi.spyOn(client, 'browseDirectory').mockImplementation(async (p?: string) => {
      if (p === '/srv/data/raw') return listing('/srv/data/raw', [])
      return listing('/srv/data', ['raw', 'locked'])
    })
    render(<DirectoryBrowser initialPath="/srv/data" onSelect={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'raw' }))
    await waitFor(() => expect(browse).toHaveBeenLastCalledWith('/srv/data/raw'))
    expect(await screen.findByText('/srv/data/raw')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Up one folder' }))
    await waitFor(() => expect(browse).toHaveBeenLastCalledWith('/srv/data'))
  })

  it('selects the current folder', async () => {
    vi.spyOn(client, 'browseDirectory').mockResolvedValue(listing('/srv/data', ['raw']))
    const onSelect = vi.fn()
    render(<DirectoryBrowser onSelect={onSelect} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select this folder' }))
    expect(onSelect).toHaveBeenCalledWith('/srv/data')
  })

  it('jumps to a shortcut', async () => {
    const browse = vi.spyOn(client, 'browseDirectory').mockResolvedValue(listing('/srv/data', []))
    render(<DirectoryBrowser onSelect={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Home' }))
    await waitFor(() => expect(browse).toHaveBeenLastCalledWith('/home/me'))
  })

  it('marks unwritable folders and blocks selecting one when writing is required', async () => {
    vi.spyOn(client, 'browseDirectory').mockResolvedValue(
      listing('/srv/data', ['locked'], { writable: false })
    )
    render(<DirectoryBrowser requireWritable onSelect={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'locked' })).toHaveAttribute('title', 'Not writable')
    expect(screen.getByRole('button', { name: 'Select this folder' })).toBeDisabled()
    expect(screen.getByText('This folder is not writable.')).toBeInTheDocument()
  })

  it('falls back to the default folder when the initial path fails', async () => {
    const browse = vi
      .spyOn(client, 'browseDirectory')
      .mockRejectedValueOnce(new Error('400: {"detail":"/typo does not exist"}'))
      .mockResolvedValue(listing('/srv/data', []))
    render(<DirectoryBrowser initialPath="/typo" onSelect={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('/srv/data')).toBeInTheDocument()
    expect(browse).toHaveBeenNthCalledWith(1, '/typo')
    expect(browse).toHaveBeenNthCalledWith(2, undefined)
  })

  it('shows an error when a folder cannot be opened, keeping the current one', async () => {
    vi.spyOn(client, 'browseDirectory')
      .mockResolvedValueOnce(listing('/srv/data', ['secret']))
      .mockRejectedValueOnce(new Error('400: {"detail":"cannot read /srv/data/secret: Permission denied"}'))
    render(<DirectoryBrowser onSelect={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'secret' }))
    expect(await screen.findByText('cannot read /srv/data/secret: Permission denied')).toBeInTheDocument()
    expect(screen.getByText('/srv/data')).toBeInTheDocument()
  })

  it('closes on Cancel and on Escape', async () => {
    vi.spyOn(client, 'browseDirectory').mockResolvedValue(listing('/srv/data', []))
    const onClose = vi.fn()
    render(<DirectoryBrowser onSelect={vi.fn()} onClose={onClose} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AdminPathsSection } from '../components/AdminPathsSection'
import * as client from '../api/client'
import type { PathSettings } from '../api/types'

const base = {
  raw_dirs: [] as string[],
  draft_dirs: [] as string[],
  published_dirs: [] as string[],
  defaults: { raw: '/srv/raw', draft: '/srv/drafts', published: '/srv/published' },
}

describe('AdminPathsSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(client, 'getPathSettings').mockResolvedValue(base)
  })

  it('renders three blocks with default hints for empty lists', async () => {
    render(<AdminPathsSection />)
    expect(await screen.findByRole('heading', { name: 'Read files from' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Save v250 drafts to' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Publish v300 files to' })).toBeInTheDocument()
    expect(screen.getByText('/srv/raw')).toBeInTheDocument()
    expect(screen.getByText('/srv/drafts')).toBeInTheDocument()
    expect(screen.getByText('/srv/published')).toBeInTheDocument()
  })

  it('shows a load error', async () => {
    vi.spyOn(client, 'getPathSettings').mockRejectedValue(new Error('500: boom'))
    render(<AdminPathsSection />)
    expect(await screen.findByText('Error: 500: boom')).toBeInTheDocument()
  })

  it('adds a path via the + button and clears the input', async () => {
    vi.spyOn(client, 'updatePathSettings').mockResolvedValue({ ...base, raw_dirs: ['/data/a'] })
    render(<AdminPathsSection />)
    const input = await screen.findByLabelText('New Read files from path')
    fireEvent.change(input, { target: { value: '/data/a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Read files from path' }))
    await waitFor(() =>
      expect(client.updatePathSettings).toHaveBeenCalledWith({
        raw_dirs: ['/data/a'],
        draft_dirs: [],
        published_dirs: [],
      })
    )
    expect(await screen.findByText('/data/a')).toBeInTheDocument()
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('adds a path with Enter', async () => {
    vi.spyOn(client, 'updatePathSettings').mockResolvedValue({ ...base, draft_dirs: ['/d'] })
    render(<AdminPathsSection />)
    const input = await screen.findByLabelText('New Save v250 drafts to path')
    fireEvent.change(input, { target: { value: '/d' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(client.updatePathSettings).toHaveBeenCalledWith({
        raw_dirs: [],
        draft_dirs: ['/d'],
        published_dirs: [],
      })
    )
  })

  it('disables add when input is blank', async () => {
    render(<AdminPathsSection />)
    await screen.findByLabelText('New Read files from path')
    expect(screen.getByRole('button', { name: 'Add Read files from path' })).toBeDisabled()
  })

  it('removes a path', async () => {
    vi.spyOn(client, 'getPathSettings').mockResolvedValue({ ...base, raw_dirs: ['/data/a', '/data/b'] })
    vi.spyOn(client, 'updatePathSettings').mockResolvedValue({ ...base, raw_dirs: ['/data/b'] })
    render(<AdminPathsSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove /data/a' }))
    await waitFor(() =>
      expect(client.updatePathSettings).toHaveBeenCalledWith({
        raw_dirs: ['/data/b'],
        draft_dirs: [],
        published_dirs: [],
      })
    )
    await waitFor(() => expect(screen.queryByText('/data/a')).not.toBeInTheDocument())
  })

  it('shows a server error in the block, keeping the list and input', async () => {
    vi.spyOn(client, 'updatePathSettings').mockRejectedValue(new Error('422: /x does not exist'))
    render(<AdminPathsSection />)
    const input = await screen.findByLabelText('New Read files from path')
    fireEvent.change(input, { target: { value: '/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Read files from path' }))
    expect(await screen.findByText('Error: 422: /x does not exist')).toBeInTheDocument()
    expect(input).toHaveValue('/x')
    expect(screen.getByText('/srv/raw')).toBeInTheDocument()
  })

  it('disables all controls while saving', async () => {
    let resolve!: (v: PathSettings) => void
    vi.spyOn(client, 'updatePathSettings').mockReturnValue(new Promise((r) => (resolve = r)))
    render(<AdminPathsSection />)
    const input = await screen.findByLabelText('New Read files from path')
    fireEvent.change(input, { target: { value: '/a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Read files from path' }))
    await waitFor(() => expect(input).toBeDisabled())
    expect(screen.getByLabelText('New Publish v300 files to path')).toBeDisabled()
    resolve({ ...base, raw_dirs: ['/a'] })
    await waitFor(() => expect(input).not.toBeDisabled())
  })
})

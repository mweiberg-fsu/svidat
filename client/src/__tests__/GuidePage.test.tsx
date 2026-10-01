import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { GuidePage } from '../pages/GuidePage'

describe('GuidePage', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('svidat_id', '1')
    localStorage.setItem('svidat_username', 'guideuser')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
  })

  it('shows the full guide for the signed-in user, with a page-specific lead', () => {
    render(
      <AuthProvider>
        <MemoryRouter>
          <GuidePage />
        </MemoryRouter>
      </AuthProvider>
    )
    expect(screen.getByRole('heading', { name: /Welcome to/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Flag & publish' })).toBeInTheDocument()
    expect(screen.queryByText('Select variables in the sidebar to view plots.')).not.toBeInTheDocument()
  })
})

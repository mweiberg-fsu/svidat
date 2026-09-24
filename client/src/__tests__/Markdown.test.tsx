import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from '../components/Markdown'

describe('Markdown', () => {
  it('renders headings, lists, paragraphs, and inline formatting', () => {
    const { container } = render(
      <Markdown
        source={[
          '# Title',
          '## Section',
          '',
          'First line',
          'same paragraph with **bold**, *italic* and `code`.',
          '',
          '- one',
          '* two',
          '',
          '1. first',
          '2. second',
        ].join('\n')}
      />
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Title' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Section' })).toBeInTheDocument()
    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.querySelector('p')!.textContent).toBe(
      'First line same paragraph with bold, italic and code.'
    )
    expect(container.querySelector('strong')!.textContent).toBe('bold')
    expect(container.querySelector('em')!.textContent).toBe('italic')
    expect(container.querySelector('code')!.textContent).toBe('code')
    expect(Array.from(container.querySelectorAll('ul li')).map((li) => li.textContent)).toEqual([
      'one',
      'two',
    ])
    expect(Array.from(container.querySelectorAll('ol li')).map((li) => li.textContent)).toEqual([
      'first',
      'second',
    ])
  })

  it('renders http(s) links but drops unsafe link targets to plain text', () => {
    render(<Markdown source="[good](https://example.com) and [bad](javascript:alert(1))" />)
    expect(screen.getByRole('link', { name: 'good' })).toHaveAttribute('href', 'https://example.com')
    expect(screen.queryByRole('link', { name: 'bad' })).not.toBeInTheDocument()
  })

  it('never renders raw HTML from the source', () => {
    const { container } = render(<Markdown source={'<img src=x onerror="alert(1)"> <b>hi</b>'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>hi</b>')
  })
})

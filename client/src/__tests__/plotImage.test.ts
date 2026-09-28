import { describe, expect, it, beforeEach } from 'vitest'
import { cloneForExport, exportPlotsPng } from '../plotImage'

function mountRow(varName: string, width = 300, height = 200) {
  const row = document.createElement('div')
  row.className = 'svg-plot-row'
  row.setAttribute('data-variable', varName)
  row.innerHTML = `
    <svg width="${width}" height="${height}">
      <path d="M0 0 L10 10" />
      <rect data-export="skip" x="1" y="1" width="5" height="5" />
      <g><circle data-export="skip" cx="1" cy="1" r="1" /></g>
    </svg>`
  document.body.appendChild(row)
  return row.querySelector('svg')!
}

describe('plotImage', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('cloneForExport strips data-export="skip" elements and leaves the original intact', () => {
    const svg = mountRow('T')
    const clone = cloneForExport(svg)

    expect(clone.querySelectorAll('[data-export="skip"]')).toHaveLength(0)
    expect(clone.querySelector('path')).not.toBeNull()
    expect(clone.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
    expect(clone.getAttribute('width')).toBe('300')
    expect(clone.getAttribute('height')).toBe('200')
    // Original DOM untouched.
    expect(svg.querySelectorAll('[data-export="skip"]')).toHaveLength(2)
  })

  it('exportPlotsPng rejects when none of the requested plots are on the page', async () => {
    mountRow('T')
    await expect(exportPlotsPng(['NOPE'], 'x.png')).rejects.toThrow('No plots to save')
  })
})

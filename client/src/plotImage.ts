// Exports the plot rows currently rendered by SvgPlot as one PNG, stacked
// top-to-bottom in the order given. Captures each row's <svg> as seen on
// screen (zoom, flags, climatology), minus anything SvgPlot tags
// data-export="skip" (zoom/drag boxes, the flag-selection highlight). The
// plot SVGs use only inline presentation attributes, so a serialized clone
// renders the same without the page's stylesheet.

const SVG_NS = 'http://www.w3.org/2000/svg'
// Pixel density of the exported image, so it stays sharp when zoomed/printed.
const EXPORT_SCALE = 2

function plotSize(svg: SVGSVGElement): { width: number; height: number } {
  return {
    width: Number(svg.getAttribute('width')) || svg.clientWidth,
    height: Number(svg.getAttribute('height')) || svg.clientHeight,
  }
}

export function cloneForExport(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelectorAll('[data-export="skip"]').forEach((el) => el.remove())
  const { width, height } = plotSize(svg)
  clone.setAttribute('xmlns', SVG_NS)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  return clone
}

function loadImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const markup = new XMLSerializer().serializeToString(svg)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to render plot image'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Defer revocation: the browser may still be reading the blob URL when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function exportPlotsPng(varNames: string[], filename: string): Promise<void> {
  const svgs = varNames
    .map((name) =>
      document.querySelector<SVGSVGElement>(
        `.svg-plot-row[data-variable="${CSS.escape(name)}"] svg`
      )
    )
    .filter((svg): svg is SVGSVGElement => svg !== null)
  if (svgs.length === 0) throw new Error('No plots to save')

  const sizes = svgs.map(plotSize)
  const images = await Promise.all(svgs.map((svg) => loadImage(cloneForExport(svg))))

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(...sizes.map((s) => s.width)) * EXPORT_SCALE
  canvas.height = sizes.reduce((sum, s) => sum + s.height, 0) * EXPORT_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE)

  let y = 0
  images.forEach((img, i) => {
    ctx.drawImage(img, 0, y, sizes[i].width, sizes[i].height)
    y += sizes[i].height
  })

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Failed to encode PNG')
  download(blob, filename)
}

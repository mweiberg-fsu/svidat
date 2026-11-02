import L from 'leaflet'

// SMAP L3 sea surface salinity (JPL CAP, 8-day running mean) from NASA GIBS,
// the imagery service behind Worldview. GIBS serves Web Mercator PNG tiles
// with CORS enabled, so unlike the SST overlay (sstLayer.ts) the tiles go on
// the map as-is, and the pointer readout reads pixels back and maps their
// colour to a value through the layer's published colormap. Nothing is
// downloaded or stored by svidat.
export const SSS_LAYER = 'SMAP_L3_Sea_Surface_Salinity_CAP_8Day_RunningMean'
const GIBS = 'https://gibs.earthdata.nasa.gov'
const TILE_MATRIX_SET = 'GoogleMapsCompatible_Level6'
// Deepest zoom GIBS has tiles for (Level6); Leaflet upscales beyond it.
export const SSS_MAX_NATIVE_ZOOM = 6
const TILE = 256
export const SSS_LEGEND_URL = `${GIBS}/legends/SMAP_Sea_Surface_Salinity_H.svg`
const COLORMAP_URL = `${GIBS}/colormaps/v1.3/SMAP_Sea_Surface_Salinity.xml`
export const SSS_ATTRIBUTION = 'SSS: NASA SMAP (JPL CAP) via NASA GIBS'
// The record has gaps (and trails real time by days), so a file's own date
// may have no map; fall back to the latest one within this many days before.
const LOOKBACK_DAYS = 30
// Tiles kept decoded for the pointer readout.
const TILE_CACHE_SIZE = 64

export function sssTileUrl(date: string, z: number | string, x: number | string, y: number | string): string {
  return `${GIBS}/wmts/epsg3857/best/${SSS_LAYER}/default/${date}/${TILE_MATRIX_SET}/${z}/${y}/${x}.png`
}

function domainsUrl(start: string, end: string): string {
  return `${GIBS}/wmts/epsg3857/best/1.0.0/${SSS_LAYER}/default/${TILE_MATRIX_SET}/all/${start}--${end}.xml`
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const ISO_DATE = /^\d{4}-\d\d-\d\d/

// Latest date <= `date` in a GIBS DescribeDomains time list, e.g.
// "2026-03-01/2026-03-03/P1D,2026-03-05/2026-03-27/P1D" (daily ranges; a
// bare date is a single day). Null when nothing is that early.
export function latestDateInDomain(domain: string, date: string): string | null {
  let best: string | null = null
  for (const part of domain.split(',')) {
    const dates = part
      .trim()
      .split('/')
      .filter((p) => ISO_DATE.test(p))
      .map((p) => p.slice(0, 10))
    if (dates.length === 0) continue
    const start = dates[0]
    const end = dates[dates.length - 1]
    if (start > date) continue
    const candidate = end < date ? end : date
    if (best === null || candidate > best) best = candidate
  }
  return best
}

const dateCache = new Map<string, Promise<string | null>>()

// The 8-day mean to show for a file dated `date`: that day's if GIBS has
// it, else the latest within LOOKBACK_DAYS before; null when there's none.
export function resolveSssDate(date: string): Promise<string | null> {
  const cached = dateCache.get(date)
  if (cached) return cached
  const promise = fetch(domainsUrl(addDays(date, -LOOKBACK_DAYS), date))
    .then((r) => {
      if (!r.ok) throw new Error(`salinity dates unavailable (${r.status})`)
      return r.text()
    })
    .then((xml) => {
      const domain = xml.match(/<Domain>([^<]*)<\/Domain>/)?.[1] ?? ''
      return latestDateInDomain(domain, date)
    })
  promise.catch(() => dateCache.delete(date))
  dateCache.set(date, promise)
  return promise
}

// One colour bin of the colormap, in PSU; `max` is Infinity for the top
// (">= 40") bin and the bottom bin starts at 0 ("< 30").
export interface SssBin {
  min: number
  max: number
}

function rgbKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b
}

function parseBound(s: string): number {
  const t = s.trim()
  if (/^\+?INF$/i.test(t)) return Infinity
  if (/^-INF$/i.test(t)) return -Infinity
  return Number(t)
}

// RGB -> value bin from a GIBS v1.3 colormap XML. Transparent / no-data
// entries are left out: a pixel matching nothing is "no data".
export function parseSssColormap(xml: string): Map<number, SssBin> {
  const out = new Map<number, SssBin>()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  for (const entry of Array.from(doc.getElementsByTagName('ColorMapEntry'))) {
    if (entry.getAttribute('transparent') === 'true' || entry.getAttribute('nodata') === 'true') continue
    const rgb = entry.getAttribute('rgb')?.split(',').map(Number)
    const range = entry.getAttribute('value')?.match(/^[[(]\s*([^,]+),([^\])]+)[\])]$/)
    if (!rgb || rgb.length !== 3 || !range) continue
    out.set(rgbKey(rgb[0], rgb[1], rgb[2]), { min: parseBound(range[1]), max: parseBound(range[2]) })
  }
  return out
}

// Bin for one RGBA pixel: transparent is no data (land, ice, swath gap);
// otherwise the exact colour, or failing that (resampling at a tile's
// coastline edge) the nearest colormap colour if it's close.
export function lookupSssBin(
  colormap: Map<number, SssBin>,
  r: number,
  g: number,
  b: number,
  a: number
): SssBin | null {
  if (a < 128) return null
  const exact = colormap.get(rgbKey(r, g, b))
  if (exact) return exact
  let best: SssBin | null = null
  let bestDist = 3 * 6 * 6
  for (const [key, bin] of colormap) {
    const dr = ((key >> 16) & 255) - r
    const dg = ((key >> 8) & 255) - g
    const db = (key & 255) - b
    const dist = dr * dr + dg * dg + db * db
    if (dist <= bestDist) {
      best = bin
      bestDist = dist
    }
  }
  return best
}

export function formatSssBin(bin: SssBin): string {
  if (bin.max === Infinity) return `≥ ${bin.min.toFixed(2)}`
  if (bin.min <= 0) return `< ${bin.max.toFixed(2)}`
  return ((bin.min + bin.max) / 2).toFixed(2)
}

// Web Mercator tile (x, y) at zoom z holding (lat, lon), and the pixel
// within it.
export function tilePixel(
  lat: number,
  lon: number,
  z: number
): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat))
  const sin = Math.sin((clampedLat * Math.PI) / 180)
  const gx = ((lon + 180) / 360) * n * TILE
  const gy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n * TILE
  const x = Math.max(0, Math.min(n - 1, Math.floor(gx / TILE)))
  const y = Math.max(0, Math.min(n - 1, Math.floor(gy / TILE)))
  const px = Math.max(0, Math.min(TILE - 1, Math.floor(gx - x * TILE)))
  const py = Math.max(0, Math.min(TILE - 1, Math.floor(gy - y * TILE)))
  return { x, y, px, py }
}

let colormapPromise: Promise<Map<number, SssBin>> | null = null

function loadColormap(): Promise<Map<number, SssBin>> {
  if (!colormapPromise) {
    colormapPromise = fetch(COLORMAP_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`salinity colormap unavailable (${r.status})`)
        return r.text()
      })
      .then(parseSssColormap)
    colormapPromise.catch(() => {
      colormapPromise = null
    })
  }
  return colormapPromise
}

// Decoded RGBA tiles by "date|z|x|y" (null = GIBS has no tile there).
const tileCache = new Map<string, Promise<Uint8ClampedArray | null>>()

function loadTile(date: string, z: number, x: number, y: number): Promise<Uint8ClampedArray | null> {
  const key = `${date}|${z}|${x}|${y}`
  const cached = tileCache.get(key)
  if (cached) return cached
  const promise = fetch(sssTileUrl(date, z, x, y))
    .then(async (r) => {
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`salinity tile unavailable (${r.status})`)
      const bitmap = await createImageBitmap(await r.blob())
      const canvas = document.createElement('canvas')
      canvas.width = TILE
      canvas.height = TILE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d canvas')
      ctx.drawImage(bitmap, 0, 0, TILE, TILE)
      return ctx.getImageData(0, 0, TILE, TILE).data
    })
  promise.catch(() => tileCache.delete(key))
  tileCache.set(key, promise)
  if (tileCache.size > TILE_CACHE_SIZE) tileCache.delete(tileCache.keys().next().value!)
  return promise
}

// Salinity bin at (lat, lon) on the map for `date` (a date resolveSssDate
// returned), read from the deepest-zoom tile; null = no data there.
export async function sssAt(date: string, lat: number, lon: number): Promise<SssBin | null> {
  const { x, y, px, py } = tilePixel(lat, lon, SSS_MAX_NATIVE_ZOOM)
  const [colormap, tile] = await Promise.all([loadColormap(), loadTile(date, SSS_MAX_NATIVE_ZOOM, x, y)])
  if (!tile) return null
  const i = (py * TILE + px) * 4
  return lookupSssBin(colormap, tile[i], tile[i + 1], tile[i + 2], tile[i + 3])
}

export function createSssLayer(date: string): L.TileLayer {
  return L.tileLayer(sssTileUrl(date, '{z}', '{x}', '{y}'), {
    opacity: 0.7,
    zIndex: 2,
    attribution: SSS_ATTRIBUTION,
    maxNativeZoom: SSS_MAX_NATIVE_ZOOM,
    maxZoom: 18,
  })
}

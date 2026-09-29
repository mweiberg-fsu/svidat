import L from 'leaflet'

// NOAA OISST v2.1 (final, daily, 0.25 deg) served by CoastWatch ERDDAP's WMS.
// Nothing is downloaded or stored by svidat: the browser requests rendered
// images for what the map is showing. ERDDAP's WMS only speaks EPSG:4326, so
// the grid layer below reprojects each tile into the map's Web Mercator.
const DATASET = 'ncdcOisst21Agg_LonPM180'
const ERDDAP = 'https://coastwatch.pfeg.noaa.gov/erddap'
const WMS_URL = `${ERDDAP}/wms/${DATASET}/request`
const TILE = 256
export const SST_ATTRIBUTION = 'SST: NOAA OISST v2.1 via CoastWatch ERDDAP'

// OISST's daily fields are stamped at noon UTC.
export function sstTime(isoDateOrTime: string): string {
  return `${isoDateOrTime.slice(0, 10)}T12:00:00Z`
}

// Latitude at a global Web Mercator pixel y for zoom z.
function mercatorLat(z: number, globalY: number): number {
  const n = Math.PI - (2 * Math.PI * globalY) / (TILE * 2 ** z)
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI
}

// [south, north] latitude of tile row y at zoom z.
export function tileLatBounds(z: number, y: number): [number, number] {
  return [mercatorLat(z, (y + 1) * TILE), mercatorLat(z, y * TILE)]
}

// Latitude at the centre of pixel `row` (0..255) within tile row y.
export function mercatorRowLat(z: number, y: number, row: number): number {
  return mercatorLat(z, y * TILE + row + 0.5)
}

export function sstGetMapUrl(
  date: string,
  latS: number,
  lonW: number,
  latN: number,
  lonE: number,
  width: number,
  height: number
): string {
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: `${DATASET}:sst`,
    styles: '',
    crs: 'EPSG:4326',
    // WMS 1.3.0 + EPSG:4326 uses latitude-first axis order.
    bbox: [latS, lonW, latN, lonE].join(','),
    width: String(width),
    height: String(height),
    format: 'image/png',
    transparent: 'true',
    time: sstTime(date),
  })
  return `${WMS_URL}?${params.toString()}`
}

export function sstLegendUrl(date: string): string {
  const query = `sst[(${sstTime(date)})][(0.0)][(-89.875):(89.875)][(-179.875):(179.875)]`
  return `${ERDDAP}/griddap/${DATASET}.png?${encodeURIComponent(query)}&.legend=Only`
}

// A GridLayer drawing the day's SST. Each 256px Mercator tile fetches the
// EPSG:4326 image covering the same lat/lon box, then copies it one output
// row at a time from the source row at that row's latitude (the lat->y
// mapping is linear in the source but not in Mercator).
export function createSstLayer(date: string): L.GridLayer {
  const SstLayer = L.GridLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const canvas = document.createElement('canvas')
      canvas.width = TILE
      canvas.height = TILE
      const n = 2 ** coords.z
      const lonW = (coords.x / n) * 360 - 180
      const lonE = ((coords.x + 1) / n) * 360 - 180
      const [latS, latN] = tileLatBounds(coords.z, coords.y)
      const img = new Image()
      img.onload = () => {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          for (let row = 0; row < TILE; row++) {
            const lat = mercatorRowLat(coords.z, coords.y, row)
            const srcRow = Math.min(TILE - 1, Math.max(0, Math.floor(((latN - lat) / (latN - latS)) * TILE)))
            ctx.drawImage(img, 0, srcRow, TILE, 1, 0, row, TILE, 1)
          }
        }
        done(undefined, canvas)
      }
      img.onerror = () => done(new Error('SST tile failed to load'), canvas)
      img.src = sstGetMapUrl(date, latS, lonW, latN, lonE, TILE, TILE)
      return canvas
    },
  })
  const SstLayerCtor = SstLayer as unknown as new (options: L.GridLayerOptions) => L.GridLayer
  return new SstLayerCtor({ opacity: 0.7, zIndex: 2, attribution: SST_ATTRIBUTION, maxNativeZoom: 10, maxZoom: 18 })
}

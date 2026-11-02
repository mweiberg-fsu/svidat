import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addDays,
  formatSssBin,
  latestDateInDomain,
  lookupSssBin,
  parseSssColormap,
  resolveSssDate,
  sssTileUrl,
  tilePixel,
} from '../sssLayer'

const COLORMAP = `<?xml version="1.0" encoding="UTF-8"?>
<ColorMaps>
  <ColorMap title="No Data">
    <Entries>
      <ColorMapEntry rgb="0,0,0" transparent="true" nodata="true" ref="0"/>
    </Entries>
  </ColorMap>
  <ColorMap title="Sea Surface Salinity" units="PSU">
    <Entries>
      <ColorMapEntry rgb="93,5,145" transparent="false" sourceValue="[0.0,30.00)" value="[0.0,30.00)" ref="1"/>
      <ColorMapEntry rgb="106,0,179" transparent="false" sourceValue="[30.00,30.04)" value="[30.00,30.04)" ref="2"/>
      <ColorMapEntry rgb="204,204,204" transparent="false" sourceValue="[40.00,+INF)" value="[40.00,+INF)" ref="255"/>
    </Entries>
  </ColorMap>
</ColorMaps>`

describe('sssLayer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds GIBS tile URLs for the SMAP 8-day layer', () => {
    expect(sssTileUrl('2026-07-30', 6, 17, 26)).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/SMAP_L3_Sea_Surface_Salinity_CAP_8Day_RunningMean/default/2026-07-30/GoogleMapsCompatible_Level6/6/26/17.png'
    )
  })

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-01-15', -30)).toBe('2025-12-16')
  })

  describe('latestDateInDomain', () => {
    const domain = '2026-03-01/2026-03-03/P1D,2026-03-05/2026-03-27/P1D,2026-03-29/2026-10-10/P1D'

    it('returns the date itself when it is inside a range', () => {
      expect(latestDateInDomain(domain, '2026-07-30')).toBe('2026-07-30')
    })

    it('falls back to the end of the previous range inside a gap', () => {
      expect(latestDateInDomain(domain, '2026-03-28')).toBe('2026-03-27')
      expect(latestDateInDomain(domain, '2026-03-04')).toBe('2026-03-03')
    })

    it('uses the last available day when the date is past the record', () => {
      expect(latestDateInDomain(domain, '2026-10-19')).toBe('2026-10-10')
    })

    it('is null when nothing is that early, or the domain is empty', () => {
      expect(latestDateInDomain(domain, '2026-02-01')).toBeNull()
      expect(latestDateInDomain('', '2026-02-01')).toBeNull()
    })

    it('accepts bare dates and full timestamps', () => {
      expect(latestDateInDomain('2026-01-01,2026-01-05T00:00:00Z', '2026-01-04')).toBe('2026-01-01')
    })
  })

  it('resolves the map date from GIBS DescribeDomains', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<Domains><DimensionDomain><Domain>2026-03-05/2026-03-27/P1D</Domain></DimensionDomain></Domains>")
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveSssDate('2026-03-28')).resolves.toBe('2026-03-27')
    expect(fetchMock.mock.calls[0][0]).toContain('/all/2026-02-26--2026-03-28.xml')
    // Cached per date.
    await resolveSssDate('2026-03-28')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed date lookup', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('<Domain>2025-06-01/2025-06-30/P1D</Domain>'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveSssDate('2025-06-10')).rejects.toThrow()
    await expect(resolveSssDate('2025-06-10')).resolves.toBe('2025-06-10')
  })

  describe('colormap', () => {
    const colormap = parseSssColormap(COLORMAP)

    it('parses value bins and skips the no-data entry', () => {
      expect(colormap.size).toBe(3)
      expect(lookupSssBin(colormap, 106, 0, 179, 255)).toEqual({ min: 30, max: 30.04 })
      expect(lookupSssBin(colormap, 204, 204, 204, 255)).toEqual({ min: 40, max: Infinity })
    })

    it('treats transparent pixels as no data', () => {
      expect(lookupSssBin(colormap, 106, 0, 179, 0)).toBeNull()
    })

    it('matches a near colour, but not an unrelated one', () => {
      expect(lookupSssBin(colormap, 107, 1, 178, 255)).toEqual({ min: 30, max: 30.04 })
      expect(lookupSssBin(colormap, 0, 255, 0, 255)).toBeNull()
    })

    it('formats bins as their midpoint, or open-ended at the extremes', () => {
      expect(formatSssBin({ min: 35, max: 35.04 })).toBe('35.02')
      expect(formatSssBin({ min: 0, max: 30 })).toBe('< 30.00')
      expect(formatSssBin({ min: 40, max: Infinity })).toBe('≥ 40.00')
    })
  })

  describe('tilePixel', () => {
    it('finds the tile and pixel at the map centre', () => {
      expect(tilePixel(0, 0, 1)).toEqual({ x: 1, y: 1, px: 0, py: 0 })
    })

    it('stays inside the tile grid at the extremes', () => {
      expect(tilePixel(89.9, 180, 6)).toEqual({ x: 63, y: 0, px: 255, py: 0 })
      expect(tilePixel(-89.9, -180, 6)).toEqual({ x: 0, y: 63, px: 0, py: 255 })
    })

    it('places a Gulf of Mexico point in the right z6 tile', () => {
      const { x, y } = tilePixel(27.6, -84.3, 6)
      expect(x).toBe(17)
      expect(y).toBe(26)
    })
  })
})

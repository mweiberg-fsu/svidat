import { describe, expect, it } from 'vitest'
import { mercatorRowLat, sstGetMapUrl, sstLegendUrl, sstTime, tileLatBounds } from '../sstLayer'

describe('sstLayer', () => {
  it('tileLatBounds gives the Web Mercator latitude span of a tile row', () => {
    const [south, north] = tileLatBounds(0, 0)
    expect(north).toBeCloseTo(85.0511, 3)
    expect(south).toBeCloseTo(-85.0511, 3)
    const [s1, n1] = tileLatBounds(1, 0) // northern half
    expect(s1).toBeCloseTo(0, 6)
    expect(n1).toBeCloseTo(85.0511, 3)
  })

  it('mercatorRowLat decreases down the tile and stays inside its bounds', () => {
    const [south, north] = tileLatBounds(5, 12)
    const lats = Array.from({ length: 256 }, (_, r) => mercatorRowLat(5, 12, r))
    expect(lats[0]).toBeLessThanOrEqual(north)
    expect(lats[255]).toBeGreaterThanOrEqual(south)
    for (let i = 1; i < lats.length; i++) expect(lats[i]).toBeLessThan(lats[i - 1])
  })

  it('sstTime stamps a day at 12:00Z', () => {
    expect(sstTime('2019-03-01T14:19:00')).toBe('2019-03-01T12:00:00Z')
  })

  it('sstGetMapUrl builds a WMS 1.3.0 EPSG:4326 GetMap with lat-first bbox and time', () => {
    const url = new URL(sstGetMapUrl('2019-03-01', 30, -85, 35, -75, 256, 128))
    expect(url.origin + url.pathname).toBe(
      'https://coastwatch.pfeg.noaa.gov/erddap/wms/ncdcOisst21Agg_LonPM180/request'
    )
    const p = url.searchParams
    expect(p.get('service')).toBe('WMS')
    expect(p.get('version')).toBe('1.3.0')
    expect(p.get('request')).toBe('GetMap')
    expect(p.get('layers')).toBe('ncdcOisst21Agg_LonPM180:sst')
    expect(p.get('crs')).toBe('EPSG:4326')
    expect(p.get('bbox')).toBe('30,-85,35,-75')
    expect(p.get('width')).toBe('256')
    expect(p.get('height')).toBe('128')
    expect(p.get('format')).toBe('image/png')
    expect(p.get('transparent')).toBe('true')
    expect(p.get('time')).toBe('2019-03-01T12:00:00Z')
  })

  it('sstLegendUrl asks ERDDAP for a legend-only image for that day', () => {
    const url = sstLegendUrl('2019-03-01')
    expect(url).toContain('/erddap/griddap/ncdcOisst21Agg_LonPM180.png?')
    expect(decodeURIComponent(url)).toContain('sst[(2019-03-01T12:00:00Z)][(0.0)]')
    expect(url).toContain('.legend=Only')
  })
})

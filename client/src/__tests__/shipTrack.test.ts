import { describe, expect, it } from 'vitest'
import { buildTrack, nearestFix, normalizeLon, windowSegments } from '../shipTrack'

const t = (i: number) => `2022-04-24T${String(i).padStart(2, '0')}:00:00`

describe('shipTrack', () => {
  it('normalizeLon maps 0..360 and out-of-range values into -180..180', () => {
    expect(normalizeLon(270.68)).toBeCloseTo(-89.32)
    expect(normalizeLon(10)).toBe(10)
    expect(normalizeLon(180)).toBe(-180)
    expect(normalizeLon(-190)).toBe(170)
  })

  it('buildTrack splits segments at missing lat or lon and keeps sample indices', () => {
    const segs = buildTrack(
      [t(0), t(1), t(2), t(3), t(4)],
      [10, 11, null, 13, 14],
      [20, 21, 22, null, 24]
    )
    expect(segs.map((s) => s.map((f) => f.idx))).toEqual([[0, 1], [4]])
    expect(segs[0][1]).toEqual({ idx: 1, time: t(1), lat: 11, lon: 21 })
  })

  it('buildTrack unwraps longitude across the dateline so the line stays continuous', () => {
    const segs = buildTrack([t(0), t(1), t(2)], [0, 0, 0], [179, 181, 183]) // 181 -> -179 raw
    expect(segs[0].map((f) => f.lon)).toEqual([179, 181, 183])
    const west = buildTrack([t(0), t(1)], [0, 0], [-179, 179])
    expect(west[0].map((f) => f.lon)).toEqual([-179, -181])
  })

  it('buildTrack returns no segments when there are no valid fixes', () => {
    expect(buildTrack([t(0)], [null], [null])).toEqual([])
  })

  it('windowSegments keeps only fixes whose index is inside [start, end]', () => {
    const segs = buildTrack([t(0), t(1), t(2), t(3)], [1, 2, 3, 4], [1, 2, 3, 4])
    expect(windowSegments(segs, [1, 2]).map((s) => s.map((f) => f.idx))).toEqual([[1, 2]])
    expect(windowSegments(segs, [9, 10])).toEqual([])
  })

  it('nearestFix returns the closest fix within maxPx in projected space, else null', () => {
    const segs = buildTrack([t(0), t(1)], [0, 0], [0, 10])
    const project = (f: { lat: number; lon: number }) => ({ x: f.lon * 10, y: f.lat * 10 })
    expect(nearestFix(segs, project, { x: 98, y: 3 }, 10)?.idx).toBe(1)
    expect(nearestFix(segs, project, { x: 50, y: 50 }, 10)).toBeNull()
  })
})

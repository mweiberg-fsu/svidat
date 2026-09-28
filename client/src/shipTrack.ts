// Pure helpers for the Ship Track map: turn a file's lat/lon series into
// drawable segments, and find the fix nearest the pointer.

export interface TrackFix {
  idx: number // sample index into the file's time axis
  time: string
  lat: number
  lon: number
}

// SAMOS longitudes are 0..360 degrees east; maps want -180..180.
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

// Splits the track at samples with a missing lat or lon. Longitudes are
// normalized, then unwrapped relative to the previous valid fix, so a
// dateline crossing continues past +/-180 instead of jumping across the
// whole map (Leaflet draws longitudes outside -180..180 fine).
export function buildTrack(
  time: string[],
  lat: (number | null)[],
  lon: (number | null)[]
): TrackFix[][] {
  const segments: TrackFix[][] = []
  let current: TrackFix[] = []
  let prevLon: number | null = null
  for (let i = 0; i < time.length; i++) {
    const la = lat[i]
    const lo = lon[i]
    if (la === null || la === undefined || lo === null || lo === undefined) {
      if (current.length) segments.push(current)
      current = []
      continue
    }
    let unwrapped = normalizeLon(lo)
    if (prevLon !== null) {
      while (unwrapped - prevLon > 180) unwrapped -= 360
      while (unwrapped - prevLon < -180) unwrapped += 360
    }
    prevLon = unwrapped
    current.push({ idx: i, time: time[i], lat: la, lon: unwrapped })
  }
  if (current.length) segments.push(current)
  return segments
}

// The parts of the track inside the plots' X window [start, end] (sample
// indices, inclusive).
export function windowSegments(segments: TrackFix[][], [start, end]: [number, number]): TrackFix[][] {
  return segments
    .map((seg) => seg.filter((f) => f.idx >= start && f.idx <= end))
    .filter((seg) => seg.length > 0)
}

// Closest fix to `point` in screen space (via `project`), or null if none is
// within `maxPx`.
export function nearestFix(
  segments: TrackFix[][],
  project: (fix: TrackFix) => { x: number; y: number },
  point: { x: number; y: number },
  maxPx: number
): TrackFix | null {
  let best: TrackFix | null = null
  let bestDist = maxPx
  for (const seg of segments) {
    for (const fix of seg) {
      const p = project(fix)
      const d = Math.hypot(p.x - point.x, p.y - point.y)
      if (d <= bestDist) {
        best = fix
        bestDist = d
      }
    }
  }
  return best
}

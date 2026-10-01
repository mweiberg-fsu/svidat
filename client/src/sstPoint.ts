// Pointer-readout helpers for the ship-track "Values" toggle (kept apart
// from sstLayer.ts, which pulls in Leaflet).

// Centre of the 0.25 deg OISST cell containing `value`, clamped to the
// grid's outermost centres. Mirrors server/app/sst.py snap(), so the
// client-side cache key matches the cell the server looks up.
export function snapToSstCell(value: number, limit: number): number {
  const centre = Math.floor(value / 0.25) * 0.25 + 0.125
  return Math.max(-limit, Math.min(limit, centre))
}

// Leaflet reports longitudes outside -180..180 on world copies.
export function wrapLon(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon // avoid float noise when already in range
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`
}

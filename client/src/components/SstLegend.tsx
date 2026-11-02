// SST colour bar drawn to match the salinity legend GIBS serves (a
// matplotlib SVG: bold title, outlined bar, ticks, unit label) — same
// viewBox and layout, so the two read as one set. The colours must match
// what ERDDAP's WMS draws for OISST: its `sst` variable has no
// colorBarPalette, so ERDDAP uses its default "Rainbow" palette (8 equal
// linear segments) over colorBarMinimum..colorBarMaximum.
const SST_MIN = 0
const SST_MAX = 32
// ERDDAP WEB-INF/cptfiles/Rainbow.cpt, segment boundary colours.
const RAINBOW = [
  '#800080',
  '#ff00ff',
  '#0000ff',
  '#00ffff',
  '#00ff00',
  '#ffff00',
  '#ff9900',
  '#ff0000',
  '#800000',
]
const TICKS = [0, 4, 8, 12, 16, 20, 24, 28, 32]

// GIBS legend geometry (SMAP_Sea_Surface_Salinity_H.svg).
const WIDTH = 302.4
const HEIGHT = 68.4
const BAR_LEFT = 22.68
const BAR_RIGHT = 279.72
const BAR_TOP = 23.94
const BAR_BOTTOM = 37.62
const TICK_LEN = 3.5
const STROKE = 0.8

export function SstLegend() {
  const xOf = (v: number) => BAR_LEFT + ((v - SST_MIN) / (SST_MAX - SST_MIN)) * (BAR_RIGHT - BAR_LEFT)
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="SST legend"
      fontFamily="'DejaVu Sans', Verdana, sans-serif"
      fill="#000"
    >
      <defs>
        <linearGradient id="sst-legend-rainbow">
          {RAINBOW.map((color, i) => (
            <stop key={i} offset={i / (RAINBOW.length - 1)} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <text x={WIDTH / 2} y={10.26} fontSize={10} fontWeight="bold" textAnchor="middle">
        Sea Surface Temperature
      </text>
      <rect
        x={BAR_LEFT}
        y={BAR_TOP}
        width={BAR_RIGHT - BAR_LEFT}
        height={BAR_BOTTOM - BAR_TOP}
        fill="url(#sst-legend-rainbow)"
        stroke="#000"
        strokeWidth={STROKE}
      />
      {TICKS.map((v) => (
        <g key={v}>
          <line
            x1={xOf(v)}
            x2={xOf(v)}
            y1={BAR_BOTTOM}
            y2={BAR_BOTTOM + TICK_LEN}
            stroke="#000"
            strokeWidth={STROKE}
          />
          <text x={xOf(v)} y={50.7} fontSize={8} textAnchor="middle">
            {v}
          </text>
        </g>
      ))}
      <text x={WIDTH / 2} y={64.98} fontSize={10} textAnchor="middle">
        °C
      </text>
    </svg>
  )
}

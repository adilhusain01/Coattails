/**
 * Schematic of a trailing stop: the price climbs to a peak, the stop follows 15% below the
 * highest price seen, and the position is sold where the price crosses it. Illustrative, not data.
 */
const PRICE = [
  [0, 70], [40, 64], [80, 58], [120, 50], [160, 44], [200, 36], [240, 30],
  [280, 34], [320, 46], [360, 58], [400, 72], [440, 86],
] as const

// Stop = 15% of the chart's price scale below the running peak (y grows downward).
const STOP = (() => {
  let peak = Infinity
  return PRICE.map(([x, y]) => {
    peak = Math.min(peak, y)
    return [x, peak + 30] as const
  })
})()

const path = (pts: readonly (readonly [number, number])[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")

export function ExitDiagram() {
  return (
    <figure className="flex flex-col gap-3">
      <svg
        viewBox="-8 10 470 110"
        className="h-auto w-full overflow-visible"
        role="img"
        aria-labelledby="exit-diagram-title exit-diagram-desc"
      >
        <title id="exit-diagram-title">How a trailing stop sells a position</title>
        <desc id="exit-diagram-desc">
          The price rises to a peak. The stop line follows 15 percent below the highest price. When the price falls
          through the stop, Coattails sells.
        </desc>
        <line x1="0" x2="460" y1="110" y2="110" className="stroke-border" strokeWidth="1" />
        <path d={path(STOP)} fill="none" className="stroke-viz-stop" strokeWidth="2" strokeDasharray="5 4" />
        <path d={path(PRICE)} fill="none" className="stroke-viz-price" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="240" cy="30" r="4" className="fill-viz-price stroke-card" strokeWidth="2" />
        <text x="240" y="20" textAnchor="middle" className="fill-muted-foreground text-[10px]">
          Peak
        </text>
        <circle cx="366" cy="60" r="5" className="fill-card stroke-foreground" strokeWidth="2" />
        <text x="374" y="52" className="fill-foreground text-[10px] font-semibold">
          Sold
        </text>
        <circle cx="0" cy="70" r="3.5" className="fill-viz-price stroke-card" strokeWidth="2" />
        <text x="0" y="60" textAnchor="middle" className="fill-muted-foreground text-[10px]">
          Bought
        </text>
      </svg>
      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-5 bg-viz-price" aria-hidden />
          Price
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-0 w-5 border-t-2 border-dashed border-viz-stop" aria-hidden />
          Stop, 15% under the highest price
        </span>
      </figcaption>
    </figure>
  )
}

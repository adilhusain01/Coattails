"use client"

import { CartesianGrid, Line, LineChart, ReferenceDot, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { shortDay, usd } from "@/lib/format"
import type { DemoMarker, DemoPoint } from "@/server/demo"

const config = {
  price: { label: "Close", color: "var(--viz-price)" },
  stop: { label: "Trailing stop", color: "var(--viz-stop)" },
  after: { label: "After the sale", color: "var(--muted-foreground)" },
} satisfies ChartConfig

/**
 * The replayed closes. Before the exit: price (solid) and stop (dashed). After the exit the price
 * continues in a muted line so the viewer sees what the exit avoided or gave up.
 */
export function ReplayChart({ series, markers, ticker }: { series: DemoPoint[]; markers: DemoMarker[]; ticker?: string }) {
  const firstAfter = series.findIndex((p) => p.after)
  const data = series.map((p, i) => ({
    date: p.date,
    price: p.after ? null : p.price,
    stop: p.after ? null : p.stop,
    // The exit close appears in both lines so they join.
    after: p.after || (firstAfter > 0 && i === firstAfter - 1) ? p.price : null,
  }))
  const hasStop = series.some((p) => p.stop != null)
  const hasAfter = firstAfter > 0

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-64 w-full"
      role="img"
      aria-label={`${ticker ?? "Stock"} daily closes during the demo, with buy and sell points`}
    >
      <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          padding={{ left: 20, right: 12 }}
          tickFormatter={(d: string) => shortDay(`${d}T00:00:00Z`)}
        />
        <YAxis
          width={56}
          tickLine={false}
          axisLine={false}
          domain={["auto", "auto"]}
          tickFormatter={(v: number) => usd(v, 0)}
        />
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              labelFormatter={(d) => shortDay(`${d}T00:00:00Z`)}
              formatter={(value, name) => (
                <div className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">{config[name as keyof typeof config]?.label}</span>
                  <span className="font-mono tabular-nums">{usd(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        <Line dataKey="price" type="monotone" stroke="var(--color-price)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
        {hasStop && (
          <Line dataKey="stop" type="stepAfter" stroke="var(--color-stop)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        )}
        {hasAfter && (
          <Line dataKey="after" type="monotone" stroke="var(--color-after)" strokeWidth={2} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
        )}
        {markers.map((m, i) => (
          <ReferenceDot
            key={`${m.kind}-${i}`}
            x={m.date}
            y={m.price}
            r={6}
            fill={m.kind === "buy" ? "var(--viz-price)" : "var(--card)"}
            stroke={m.kind === "buy" ? "var(--card)" : "var(--foreground)"}
            strokeWidth={2}
            label={{ value: m.kind === "buy" ? "Buy" : "Sell", position: "top", offset: 10, fontSize: 11, fill: "var(--foreground)" }}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  )
}

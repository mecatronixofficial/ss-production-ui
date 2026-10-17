"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendSeries = { key: string; label: string; color: string };

const parseDay = (value: string) => new Date(`${value}T00:00:00`);

const weekdayDate = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric" });
const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

const tooltipKg = (value: number | string | undefined) =>
  `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;

// 950 -> "950", 10350 -> "10.4k"; the old `value / 1000` showed "0.1k" for small days.
const axisKg = (value: number) =>
  Math.abs(value) >= 1000
    ? `${Number((value / 1000).toFixed(1))}k`
    : String(Math.round(value));

/** KG per day for each series, as soft area lines. */
export function ProductionChart({ data, series }: { data: ReadonlyArray<{ date: string }>; series: ReadonlyArray<TrendSeries> }) {
  const shortDate = (value: string) =>
    (data.length > 7 ? dayMonth : weekdayDate).format(parseDay(value));

  return (
    <div className="h-[290px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`trend-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.26} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="#e8eeeb" strokeDasharray="4 5" vertical={false} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tickFormatter={shortDate}
            tick={{ fill: "#7a8882", fontSize: 11 }}
            minTickGap={16}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            tick={{ fill: "#7a8882", fontSize: 11 }}
            tickFormatter={axisKg}
          />
          <Tooltip
            formatter={(value, name) => [tooltipKg(value as number), name]}
            labelFormatter={(label) =>
              new Intl.DateTimeFormat("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "short",
              }).format(parseDay(String(label)))
            }
            contentStyle={{
              border: "1px solid #dfe8e4",
              borderRadius: 14,
              boxShadow: "0 16px 36px -20px rgba(20,59,50,.55)",
              fontSize: 12,
            }}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              fill={`url(#trend-${s.key})`}
              strokeWidth={2.25}
              dot={data.length <= 7 ? { r: 3, strokeWidth: 2, fill: "#fff" } : false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

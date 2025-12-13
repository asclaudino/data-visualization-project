// app/countries/[countryId]/CountrySeasonalityHeatmap.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
import type { DisasterType } from "@/lib/utils/disasterTypes";

type Metric = "events" | "deaths" | "affected" | "damage";
type Resolution = "year" | "decade";

type Props = {
  countryId: string;
  selectedTypes: DisasterType[];
  yearRange: [number, number];
};

type Cell = {
  rowKey: number; // year or decade start
  month: number; // 1..12
  value: number;
  events: number; // always store count for tooltip
};

type TooltipState = {
  x: number;
  y: number;
  header: string;
  lines: string[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", 
    "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCompact(n: number) {
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

export default function CountrySeasonalityHeatmap({
  countryId,
  selectedTypes,
  yearRange,
}: Props) {
  const [metric, setMetric] = useState<Metric>("events");
  const [resolution, setResolution] = useState<Resolution>("decade");
  const [data, setData] = useState<DisasterRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // animation trigger
  const [animTick, setAnimTick] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getDisasterData()
      .then((rows) => {
        if (cancelled) return;
        setData(rows);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setError("Could not load EM-DAT data.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { rows, cells, maxValue } = useMemo(() => {
    const empty = { rows: [] as number[], cells: [] as Cell[], maxValue: 0 };

    if (!data || !selectedTypes.length) return empty;

    const [startYear, endYear] = yearRange;

    // Filter per country + global filters
    const perCountry = data.filter((d) => d.iso === countryId || d.country === countryId);

    const filtered = perCountry.filter(
      (d) =>
        d.year >= startYear &&
        d.year <= endYear &&
        selectedTypes.includes(d.disasterType as DisasterType)
    );

    if (!filtered.length) return empty;

    const rowKeyFn = (y: number) => (resolution === "decade" ? Math.floor(y / 10) * 10 : y);

    // Build row keys (keep empty rows to show gaps)
    const rowSet = new Set<number>();
    for (let y = startYear; y <= endYear; y++) rowSet.add(rowKeyFn(y));

    const rows = Array.from(rowSet).sort((a, b) => d3.ascending(a, b));

    // Aggregate (rowKey, month) -> {value, events}
    const agg = new Map<string, { value: number; events: number }>();

    for (const d of filtered) {
      // We expect "Start Month" exists in the raw file. If your emdatData.ts doesn't expose it yet,
      // this still works if the parsed object has `startMonth` or `startMonth`-like property.
      const sm =
        (d as any).startMonth ??
        (d as any).start_month ??
        (d as any)["Start Month"] ??
        (d as any).startMonthRaw;

      const month = Number(sm);
      if (!month || month < 1 || month > 12) continue;

      const rk = rowKeyFn(d.year);
      const key = `${rk}-${month}`;

      const deaths = d.totalDeaths ?? 0;
      const affected = d.totalAffected ?? 0;
      const damage = d.economicDamageAdj ?? 0; // '000 US$

      const add =
        metric === "events"
          ? 1
          : metric === "deaths"
            ? deaths
            : metric === "affected"
              ? affected
              : damage;

      const prev = agg.get(key);
      if (prev) {
        prev.value += add;
        prev.events += 1;
      } else {
        agg.set(key, { value: add, events: 1 });
      }
    }

    // Full grid: keep empty buckets
    const cells: Cell[] = [];
    let maxValue = 0;

    for (const rk of rows) {
      for (let m = 1; m <= 12; m++) {
        const key = `${rk}-${m}`;
        const got = agg.get(key);
        const value = got ? got.value : 0;
        const events = got ? got.events : 0;
        maxValue = Math.max(maxValue, value);
        cells.push({ rowKey: rk, month: m, value, events });
      }
    }

    return { rows, cells, maxValue };
  }, [data, selectedTypes, yearRange, countryId, metric, resolution]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const svgEl = svgRef.current;
    const svg = d3.select(svgEl);

    // Measure
    const { width } = svgEl.getBoundingClientRect();
    svg.selectAll("*").remove();

    if (!width || !rows.length || !cells.length) return;

    const margin = { top: 26, right: 16, bottom: 34, left: 58 };

    const innerWidth = Math.max(1, width - margin.left - margin.right);

    // Keep readable cell height:
    const targetCellH = resolution === "decade" ? 22 : 14;
    const innerHeight = Math.max(200, rows.length * targetCellH);
    const height = innerHeight + margin.top + margin.bottom;

    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand<number>()
      .domain(d3.range(1, 13))
      .range([0, innerWidth])
      .paddingInner(0.08)
      .paddingOuter(0.02);

    const y = d3
      .scaleBand<number>()
      .domain(rows)
      .range([0, innerHeight])
      .paddingInner(0.08)
      .paddingOuter(0.02);

    // Color scale (subtle, consistent with your UI)
    const color = d3
      .scaleSequential(d3.interpolateBlues)
      .domain([0, Math.max(1, maxValue)]);

    // Axes (light grid, no domains)
    const xAxis = d3
      .axisBottom<number>(x)
      .tickValues(d3.range(1, 13))
      .tickFormat((d) => MONTHS[d - 1])
      .tickSize(0);

    const yAxis = d3
      .axisLeft<number>(y)
      .tickValues(rows)
      .tickFormat((d) => (resolution === "decade" ? `${d}s` : String(d)))
      .tickSize(0);

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(xAxis)
      .call((gg) => gg.selectAll("text").attr("font-size", 10).attr("fill", "#64748b"))
      .call((gg) => gg.select(".domain").remove());

    g.append("g")
      .call(yAxis)
      .call((gg) => gg.selectAll("text").attr("font-size", 10).attr("fill", "#64748b"))
      .call((gg) => gg.select(".domain").remove());

    // Very light gridlines
    g.append("g")
      .selectAll("line.v")
      .data(d3.range(2, 13))
      .join("line")
      .attr("x1", (m) => (x(m) ?? 0) - x.paddingInner() * x.bandwidth() * 0.5)
      .attr("x2", (m) => (x(m) ?? 0) - x.paddingInner() * x.bandwidth() * 0.5)
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .attr("stroke", "#e2e8f0")
      .attr("stroke-opacity", 0.5);

    // Cells
    const rects = g
      .append("g")
      .attr("class", "cells")
      .selectAll("rect")
      .data(cells, (d: any) => `${d.rowKey}-${d.month}`)
      .join("rect")
      .attr("x", (d) => x(d.month) ?? 0)
      .attr("y", (d) => y(d.rowKey) ?? 0)
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("rx", 6)
      .attr("fill", (d) => color(d.value))
      .attr("stroke", "#0f172a")
      .attr("stroke-opacity", 0.08)
      .attr("stroke-width", 1);

    // Tooltip
    rects
      .on("mousemove", (event, d) => {
        const containerRect = containerRef.current?.getBoundingClientRect();
        const monthLabel = MONTHS[d.month - 1];
        const rowLabel = resolution === "decade" ? `${d.rowKey}s` : `${d.rowKey}`;

        const metricLabel =
          metric === "events"
            ? "Events"
            : metric === "deaths"
              ? "Deaths"
              : metric === "affected"
                ? "Affected"
                : "Economic damage (adj, '000 US$)";

        setTooltip({
          x: containerRect ? event.clientX - containerRect.left : 0,
          y: containerRect ? event.clientY - containerRect.top : 0,
          header: `${monthLabel} • ${rowLabel}`,
          lines: [
            `${metricLabel}: ${d.value.toLocaleString()}`,
            `Events in bucket: ${d.events.toLocaleString()}`,
          ],
        });
      })
      .on("mouseleave", () => setTooltip(null));

    // Animate (only when animTick changes)
    if (animTick > 0) {
      rects
        .attr("fill-opacity", 0)
        .attr("transform-origin", (d) => {
          const cx = (x(d.month) ?? 0) + x.bandwidth() / 2;
          const cy = (y(d.rowKey) ?? 0) + y.bandwidth() / 2;
          return `${cx}px ${cy}px`;
        })
        .attr("transform", "scale(0.92)")
        .transition()
        .duration(1050)
        .delay((d) => {
          const rowIndex = rows.indexOf(d.rowKey);
          return rowIndex * 20 + (d.month - 1) * 12;
        })
        .ease(d3.easeCubicOut)
        .attr("fill-opacity", 1)
        .attr("transform", "scale(1)");
    }

    // Small legend (right bottom corner)
    const legendW = 140;
    const legendH = 8;
    const legendX = innerWidth - legendW;
    const legendY = innerHeight + 18;

    const legend = g.append("g").attr("transform", `translate(${legendX},${legendY})`);

    // Gradient
    const defs = svg.append("defs");
    const gradId = `heat-grad-${metric}-${resolution}`;
    const grad = defs
      .append("linearGradient")
      .attr("id", gradId)
      .attr("x1", "0%")
      .attr("x2", "100%")
      .attr("y1", "0%")
      .attr("y2", "0%");

    grad.append("stop").attr("offset", "0%").attr("stop-color", color(0));
    grad.append("stop").attr("offset", "100%").attr("stop-color", color(Math.max(1, maxValue)));

    legend
      .append("rect")
      .attr("width", legendW)
      .attr("height", legendH)
      .attr("rx", 999)
      .attr("y", 6)
      .attr("fill", `url(#${gradId})`)
      .attr("stroke", "#e2e8f0");

    legend
      .append("text")
      .attr("x", 0)
      .attr("y", 4)
      .attr("text-anchor", "start")
      .attr("font-size", 10)
      .attr("fill", "#64748b")
      .text("Low");

    legend
      .append("text")
      .attr("x", legendW)
      .attr("y", 4)
      .attr("text-anchor", "end")
      .attr("font-size", 10)
      .attr("fill", "#64748b")
      .text(`High (${formatCompact(maxValue)})`);
  }, [cells, rows, maxValue, metric, resolution, animTick]);

  const hasData = rows.length > 0 && cells.length > 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Seasonality</h2>
          <p className="text-xs text-slate-500">
            Heatmap of disaster activity by month. Rows are {resolution === "decade" ? "decades" : "years"}; darker cells mean higher{" "}
            {metric === "events"
              ? "event counts"
              : metric === "deaths"
                ? "deaths"
                : metric === "affected"
                  ? "affected people"
                  : "economic damage (adjusted, '000 US$)"}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          {/* Metric */}
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Metric:</span>
            <select
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
            >
              <option value="events">Events</option>
              <option value="deaths">Deaths</option>
              <option value="affected">Affected</option>
              <option value="damage">Economic damage</option>
            </select>
          </div>

          {/* Resolution */}
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Rows:</span>
            <select
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
              value={resolution}
              onChange={(e) => setResolution(e.target.value as Resolution)}
            >
              <option value="decade">Per decade</option>
              <option value="year">Per year</option>
            </select>
          </div>

          {/* Animation trigger */}
          <button
            type="button"
            onClick={() => setAnimTick((t) => t + 1)}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 shadow-sm hover:bg-slate-50"
            disabled={!hasData}
            title={!hasData ? "No data to animate" : "Replay the build animation"}
          >
            Play animation
          </button>
        </div>
      </div>

      {loading && <p className="text-xs text-slate-500">Loading seasonality…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {!loading && !error && !hasData && (
        <p className="text-xs text-slate-500">
          No monthly seasonality data available for the current filters (missing Start Month or no events).
        </p>
      )}

      {!loading && !error && hasData && (
        <div ref={containerRef} className="relative mt-1">
          <svg ref={svgRef} className="w-full" />

          {tooltip && (
            <div
              className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[11px] shadow-lg"
              style={{
                left: tooltip.x,
                top: tooltip.y,
                transform: "translate(-10px, -50%)",
              }}
            >
              <div className="mb-1 text-xs font-semibold text-slate-800">{tooltip.header}</div>
              <div className="space-y-0.5 text-slate-700">
                {tooltip.lines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// app/countries/[countryId]/CountryTimelineStacked.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
import type { DisasterType } from "@/lib/utils/disasterTypes";

// Three modes: deaths, affected people, and economic damage.
type MetricKey = "deaths" | "affected" | "economic";

type Props = {
  countryId: string;
  selectedTypes: DisasterType[];
  yearRange: [number, number];
};

type YearTypeAgg = {
  year: number;
  type: string;
  events: number;
  deaths: number;
  affected: number;
  economic: number; // summed economicDamageAdj ('000 US$)
};

type TooltipState = {
  x: number;
  y: number;
  year: number;
  rows: YearTypeAgg[];
};

// Helpful aliases for stack types
type StackDatum = { year: number } & Record<string, number>;
type StackSeries = d3.Series<StackDatum, string>;

type StackMemo = {
  years: number[];
  types: string[];
  series: StackSeries[];
  byYearDetails: Map<number, YearTypeAgg[]>;
  maxValue: number;
};

export default function CountryTimelineStacked({
  countryId,
  selectedTypes,
  yearRange,
}: Props) {
  const [metric, setMetric] = useState<MetricKey>("deaths");
  const [data, setData] = useState<DisasterRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedType, setHighlightedType] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Load global EM-DAT data once, then filter by countryId
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

  const {
    years,
    types,
    series,
    byYearDetails,
    maxValue,
  } = useMemo<StackMemo>(() => {
    const empty: StackMemo = {
      years: [],
      types: [],
      series: [] as StackSeries[],
      byYearDetails: new Map<number, YearTypeAgg[]>(),
      maxValue: 0,
    };

    if (!data || !selectedTypes.length) {
      return empty;
    }

    const [startYear, endYear] = yearRange;

    // Filter by country and global filters
    const perCountry = data.filter(
      (d) => d.iso === countryId || d.country === countryId
    );

    const filtered = perCountry.filter(
      (d) =>
        d.year >= startYear &&
        d.year <= endYear &&
        selectedTypes.includes(d.disasterType as DisasterType)
    );

    if (!filtered.length) {
      // Still want the buckets for the whole range, but there is no data at all
      const years: number[] = [];
      for (let y = startYear; y <= endYear; y++) years.push(y);
      return {
        years,
        types: [],
        series: [] as StackSeries[],
        byYearDetails: new Map<number, YearTypeAgg[]>(),
        maxValue: 0,
      };
    }

    // 1) Determine top 5 types by event count; others => "Other"
    const eventsByType = d3.rollups(
      filtered,
      (v) => v.length,
      (d) => d.disasterType
    );
    eventsByType.sort((a, b) => d3.descending(a[1], b[1]));
    const topTypes = new Set(eventsByType.slice(0, 5).map(([t]) => t));
    const OTHER_LABEL = "Other";

    // 2) Aggregate by (year, typeKey)
    const byYearType = new Map<string, YearTypeAgg>(); // key: `${year}__${typeKey}`

    for (const d of filtered) {
      const typeKey = topTypes.has(d.disasterType)
        ? d.disasterType
        : OTHER_LABEL;

      const key = `${d.year}__${typeKey}`;
      let row = byYearType.get(key);
      if (!row) {
        row = {
          year: d.year,
          type: typeKey,
          events: 0,
          deaths: 0,
          affected: 0,
          economic: 0,
        };
        byYearType.set(key, row);
      }

      row.events += 1;
      row.deaths += d.totalDeaths ?? 0;
      row.affected += d.totalAffected ?? 0;
      row.economic += d.economicDamageAdj ?? 0;
    }

    // Types set from data
    const typesSet = new Set<string>();
    for (const row of byYearType.values()) {
      typesSet.add(row.type);
    }
    const types = Array.from(typesSet);

    // Years: **all years in the current range**, even if there is no event
    const years: number[] = [];
    for (let y = startYear; y <= endYear; y++) {
      years.push(y);
    }

    // 3) Build stacked input data: one object per year, keys = types
    const stackInput: StackDatum[] = years.map((year) => {
      const obj: StackDatum = { year };
      for (const t of types) {
        const agg = byYearType.get(`${year}__${t}`);
        obj[t] = agg ? agg[metric] : 0;
      }
      return obj;
    });

    const stack = d3.stack<StackDatum>().keys(types)(stackInput);

    const maxValue =
      d3.max(stack, (s) => d3.max(s, (d) => d[1])) ?? 0;

    // 4) Build year -> rows map for tooltip
    const byYearDetails = new Map<number, YearTypeAgg[]>();
    for (const row of byYearType.values()) {
      const arr = byYearDetails.get(row.year) ?? [];
      arr.push(row);
      byYearDetails.set(row.year, arr);
    }

    return { years, types, series: stack, byYearDetails, maxValue };
  }, [data, selectedTypes, yearRange, metric, countryId]);

  // Draw chart with D3 (stacked bars)
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (!years.length) {
      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    const { width, height } = svgRef.current.getBoundingClientRect();
    if (!width || !height) return;

    const margin = { top: 24, right: 16, bottom: 30, left: 48 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.selectAll("*").remove();

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Scales
    const x = d3
      .scaleBand<number>()
      .domain(years)
      .range([0, innerWidth])
      .paddingInner(0.15)
      .paddingOuter(0.05);

    const y = d3
      .scaleLinear()
      .domain([0, maxValue || 1]) // avoid [0,0] domain
      .nice()
      .range([innerHeight, 0]);

    const color = d3
      .scaleOrdinal<string, string>()
      .domain(types)
      .range(d3.schemeTableau10);

    // Axes
    const xAxis = d3
      .axisBottom<number>(x as any)
      .tickValues(
        years.length > 16
          ? years.filter((_, i) => i % Math.ceil(years.length / 8) === 0)
          : years
      )
      .tickFormat(d3.format("d") as any);

    const yAxis = d3
      .axisLeft<number>(y)
      .ticks(5)
      .tickSize(-innerWidth);

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .attr("class", "x-axis")
      .call(xAxis)
      .call((g) =>
        g
          .selectAll("text")
          .attr("font-size", 10)
          .attr("fill", "#64748b")
      )
      .call((g) => g.select(".domain").remove());

    g.append("g")
      .attr("class", "y-axis")
      .call(yAxis)
      .call((g) =>
        g
          .selectAll("text")
          .attr("font-size", 10)
          .attr("fill", "#64748b")
      )
      .call((g) => g.select(".domain").remove())
      .call((g) =>
        g
          .selectAll(".tick line")
          .attr("stroke", "#e2e8f0")
          .attr("stroke-opacity", 0.8)
      );

    // Stacked bars (only if we actually have any types)
    if (types.length && series.length && maxValue > 0) {
      const layerGroup = g.append("g").attr("class", "layers");

      const layer = layerGroup
        .selectAll("g.layer")
        .data(series, (d: any) => d.key)
        .join("g")
        .attr("class", "layer")
        .attr("fill", (d) => color(d.key))
        .attr("fill-opacity", (d) =>
          highlightedType && highlightedType !== d.key ? 0.2 : 0.9
        );

      layer
        .selectAll("rect")
        .data((d) => d, (d: any) => d.data.year)
        .join("rect")
        .attr("x", (d) => {
          const v = x(d.data.year);
          return v == null ? 0 : v;
        })
        .attr("width", x.bandwidth())
        .attr("y", (d) => y(d[1]))
        .attr("height", (d) => y(d[0]) - y(d[1]));
    }

    // Vertical guideline
    const guideline = g
      .append("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .style("opacity", 0);

    // Overlay for tooltip interactions
    g.append("rect")
      .attr("class", "hit-rect")
      .attr("fill", "transparent")
      .attr("pointer-events", "all")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .on("mousemove", (event) => {
        const [mx] = d3.pointer(event);

        // Find nearest year by bar centre
        let nearest = years[0];
        let minDist = Infinity;
        for (const year of years) {
          const cx = (x(year) ?? 0) + x.bandwidth() / 2;
          const dist = Math.abs(cx - mx);
          if (dist < minDist) {
            minDist = dist;
            nearest = year;
          }
        }

        const barX = (x(nearest) ?? 0) + x.bandwidth() / 2;
        guideline
          .attr("x1", barX)
          .attr("x2", barX)
          .style("opacity", 1);

        const details = byYearDetails.get(nearest) ?? [];

        const containerRect =
          containerRef.current?.getBoundingClientRect();
        const svgRect = svgRef.current?.getBoundingClientRect();
        const offsetX =
          (svgRect?.left ?? 0) - (containerRect?.left ?? 0);
        const offsetY =
          (svgRect?.top ?? 0) - (containerRect?.top ?? 0);

        setTooltip({
          x: offsetX + margin.left + barX,
          y: offsetY + margin.top + innerHeight / 2,
          year: nearest,
          rows: details,
        });
      })
      .on("mouseleave", () => {
        guideline.style("opacity", 0);
        setTooltip(null);
      });
  }, [years, types, series, maxValue, byYearDetails, highlightedType]);

  const colorForLegend = useMemo(() => {
    return d3
      .scaleOrdinal<string, string>()
      .domain(types)
      .range(d3.schemeTableau10);
  }, [types]);

  const hasAnyTypeData = types.length > 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Disasters over time
          </h2>
          <p className="text-xs text-slate-500">
            Stacked bar chart of disasters by type and year. Switch the metric to
            view betweendeaths, affected people, or economic losses (in adjusted
             M US$).
          </p>
        </div>

        {/* Metric toggle */}
        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-[11px] font-medium">
          <button
            type="button"
            onClick={() => setMetric("deaths")}
            className={`px-3 py-1 rounded-full ${
              metric === "deaths"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            Deaths
          </button>
          <button
            type="button"
            onClick={() => setMetric("affected")}
            className={`px-3 py-1 rounded-full ${
              metric === "affected"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            Affected
          </button>
          <button
            type="button"
            onClick={() => setMetric("economic")}
            className={`px-3 py-1 rounded-full ${
              metric === "economic"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            Economic damage
          </button>
        </div>
      </div>

      {loading && (
        <p className="text-xs text-slate-500">Loading timeline…</p>
      )}

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {!loading && !error && !years.length && (
        <p className="text-xs text-slate-500">
          No data for the current filters.
        </p>
      )}

      {!loading && !error && years.length > 0 && (
        <>
          <div ref={containerRef} className="relative mt-1">
            <svg
              ref={svgRef}
              className="h-64 w-full md:h-72 lg:h-80"
            />

            {tooltip && (
              <div
                className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[11px] shadow-lg"
                style={{
                  left: tooltip.x,
                  top: tooltip.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className="mb-1 text-xs font-semibold text-slate-800">
                  {tooltip.year}
                </div>
                {tooltip.rows.length === 0 ? (
                  <div className="text-[11px] text-slate-500">
                    No recorded disasters for this year.
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {tooltip.rows
                      .slice()
                      .sort((a, b) => b[metric] - a[metric])
                      .map((row) => (
                        <div
                          key={row.type}
                          className="flex flex-col gap-0.5"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-slate-600">
                              {row.type}
                            </span>
                            <span className="font-medium text-slate-800">
                              {metric === "deaths" &&
                                `${row.deaths.toLocaleString()} deaths`}
                              {metric === "affected" &&
                                `${row.affected.toLocaleString()} affected`}
                              {metric === "economic" &&
                                `$${row.economic.toLocaleString()} M`}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {row.events} event
                            {row.events !== 1 ? "s" : ""} this year
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Legend with isolate-on-click (only if we have any type data) */}
          {hasAnyTypeData && (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              {types.map((t) => {
                const active = !highlightedType || highlightedType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() =>
                      setHighlightedType((prev) =>
                        prev === t ? null : t
                      )
                    }
                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 transition ${
                      active
                        ? "border-slate-300 bg-slate-50 text-slate-700"
                        : "border-slate-200 bg-white text-slate-400 opacity-60"
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: colorForLegend(t),
                      }}
                    />
                    <span>{t}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

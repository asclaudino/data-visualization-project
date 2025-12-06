// app/countries/[countryId]/CountryTimelineStacked.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
import type { DisasterType } from "@/lib/utils/disasterTypes";

type MetricKey = "events" | "deaths" | "affected";

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
  const [metric, setMetric] = useState<MetricKey>("events");
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
    // Default empty structure – already correctly typed
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
      return empty;
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
        };
        byYearType.set(key, row);
      }

      row.events += 1;
      row.deaths += d.totalDeaths ?? 0;
      row.affected += d.totalAffected ?? 0;
    }

    const yearsSet = new Set<number>();
    const typesSet = new Set<string>();

    for (const row of byYearType.values()) {
      yearsSet.add(row.year);
      typesSet.add(row.type);
    }

    const years = Array.from(yearsSet).sort(d3.ascending);
    const types = Array.from(typesSet);

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

  // Draw chart with D3
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (!years.length || !types.length || !series.length || !maxValue) {
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
      .scaleLinear()
      .domain(d3.extent(years) as [number, number])
      .range([0, innerWidth]);

    const y = d3
      .scaleLinear()
      .domain([0, maxValue])
      .nice()
      .range([innerHeight, 0]);

    const color = d3
      .scaleOrdinal<string, string>()
      .domain(types)
      .range(d3.schemeTableau10);

    // Axes
    const xAxis = d3
      .axisBottom<number>(x)
      .ticks(Math.min(10, years.length))
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

    // Area generator
    const area = d3
      .area<d3.SeriesPoint<StackDatum>>()
      .x((d) => x(d.data.year))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX);

    // Stacked areas
    const layerGroup = g.append("g").attr("class", "layers");

    layerGroup
      .selectAll("path.layer")
      .data(series, (d: any) => d.key)
      .join("path")
      .attr("class", "layer")
      .attr("fill", (d) => color(d.key))
      .attr("fill-opacity", (d) =>
        highlightedType && highlightedType !== d.key ? 0.15 : 0.9
      )
      .attr("stroke", (d) => color(d.key))
      .attr("stroke-width", 0.5)
      .attr("d", (d) => area(d)!)
      .append("title")
      .text((d) => d.key);

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
        const xValue = x.invert(mx);

        // Find nearest year
        let nearest = years[0];
        let minDist = Math.abs(years[0] - xValue);
        for (const year of years) {
          const dist = Math.abs(year - xValue);
          if (dist < minDist) {
            minDist = dist;
            nearest = year;
          }
        }

        const xPos = x(nearest);
        guideline
          .attr("x1", xPos)
          .attr("x2", xPos)
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
          x: offsetX + margin.left + xPos,
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

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Disasters over time
          </h2>
          <p className="text-xs text-slate-500">
            Stacked area chart of disasters by type and year.
          </p>
        </div>

        {/* Metric toggle */}
        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-[11px] font-medium">
          <button
            type="button"
            onClick={() => setMetric("events")}
            className={`px-3 py-1 rounded-full ${
              metric === "events"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            Events
          </button>
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
        </div>
      </div>

      {loading && (
        <p className="text-xs text-slate-500">Loading timeline…</p>
      )}

      {error && (
        <p className="text-xs text-red-500">
          {error}
        </p>
      )}

      {!loading && !error && (!years.length || !types.length) && (
        <p className="text-xs text-slate-500">
          No data for the current filters.
        </p>
      )}

      {!loading && !error && years.length > 0 && types.length > 0 && (
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
                <div className="space-y-0.5">
                  {tooltip.rows
                    .slice()
                    .sort((a, b) => b[metric] - a[metric])
                    .map((row) => (
                      <div
                        key={row.type}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="truncate text-slate-600">
                          {row.type}
                        </span>
                        <span className="font-medium text-slate-800">
                          {metric === "events" &&
                            `${row.events} evt`}
                          {metric === "deaths" &&
                            `${row.deaths.toLocaleString()} deaths`}
                          {metric === "affected" &&
                            `${row.affected.toLocaleString()} affected`}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Legend with isolate-on-click */}
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
        </>
      )}
    </section>
  );
}

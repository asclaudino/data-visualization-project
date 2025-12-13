// app/countries/[countryId]/CountryTypeComposition.tsx
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

type AggRow = {
  type: string;
  events: number;
  deaths: number;
  affected: number;
};

type TooltipState = {
  x: number;
  y: number;
  type: string;
  value: number;
  percent: number; // 0–1
  metric: MetricKey;
};

type CompositionMemo = {
  rows: AggRow[];
  totals: {
    events: number;
    deaths: number;
    affected: number;
  };
  maxValue: number;
};

export default function CountryTypeComposition({
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

  // Load EM-DAT once
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

  const { rows, totals, maxValue } = useMemo<CompositionMemo>(() => {
    const empty: CompositionMemo = {
      rows: [],
      totals: { events: 0, deaths: 0, affected: 0 },
      maxValue: 0,
    };

    if (!data || !selectedTypes.length) return empty;

    const [startYear, endYear] = yearRange;

    // Filter per country + global controls
    const perCountry = data.filter(
      (d) => d.iso === countryId || d.country === countryId
    );

    const filtered = perCountry.filter(
      (d) =>
        d.year >= startYear &&
        d.year <= endYear &&
        selectedTypes.includes(d.disasterType as DisasterType)
    );

    if (!filtered.length) return empty;

    // Aggregate per disaster type
    const byType = new Map<string, AggRow>();

    for (const d of filtered) {
      const key = d.disasterType;
      let row = byType.get(key);
      if (!row) {
        row = {
          type: key,
          events: 0,
          deaths: 0,
          affected: 0,
        };
        byType.set(key, row);
      }

      row.events += 1;
      row.deaths += d.totalDeaths ?? 0;
      row.affected += d.totalAffected ?? 0;
    }

    const rows = Array.from(byType.values());

    const totals = rows.reduce(
      (acc, r) => {
        acc.events += r.events;
        acc.deaths += r.deaths;
        acc.affected += r.affected;
        return acc;
      },
      { events: 0, deaths: 0, affected: 0 }
    );

    // Sort rows descending according to current metric
    rows.sort((a, b) => {
      const av =
        metric === "events"
          ? a.events
          : metric === "deaths"
          ? a.deaths
          : a.affected;
      const bv =
        metric === "events"
          ? b.events
          : metric === "deaths"
          ? b.deaths
          : b.affected;
      return bv - av;
    });

    const maxValue =
      metric === "events"
        ? d3.max(rows, (r) => r.events) ?? 0
        : metric === "deaths"
        ? d3.max(rows, (r) => r.deaths) ?? 0
        : d3.max(rows, (r) => r.affected) ?? 0;

    return { rows, totals, maxValue };
  }, [data, selectedTypes, yearRange, metric, countryId]);

  // Draw horizontal bar chart
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    const { width, height } = svgRef.current.getBoundingClientRect();

    svg.selectAll("*").remove();

    if (!rows.length || !maxValue || !width || !height) {
      return;
    }

    const margin = { top: 16, right: 24, bottom: 20, left: 120 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const types = rows.map((r) => r.type);

    const x = d3
      .scaleLinear()
      .domain([0, maxValue])
      .nice()
      .range([0, innerWidth]);

    const y = d3
      .scaleBand<string>()
      .domain(types)
      .range([0, innerHeight])
      .padding(0.25);

    const color = d3
      .scaleOrdinal<string, string>()
      .domain(types)
      .range(d3.schemeTableau10);

    // Axes
    const xAxis = d3.axisBottom<number>(x).ticks(4).tickSize(-innerHeight);
    const yAxis = d3.axisLeft<string>(y);

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .attr("class", "x-axis")
      .call(xAxis)
      .call((g) =>
        g.selectAll("text").attr("font-size", 10).attr("fill", "#64748b")
      )
      .call((g) => g.select(".domain").remove())
      .call((g) =>
        g
          .selectAll(".tick line")
          .attr("stroke", "#e2e8f0")
          .attr("stroke-opacity", 0.8)
      );

    g.append("g")
      .attr("class", "y-axis")
      .call(yAxis)
      .call((g) =>
        g.selectAll("text").attr("font-size", 10).attr("fill", "#475569")
      )
      .call((g) => g.select(".domain").remove());

    // Helper to get metric value + total
    const metricTotal =
      metric === "events"
        ? totals.events
        : metric === "deaths"
        ? totals.deaths
        : totals.affected;

    const getValue = (r: AggRow): number =>
      metric === "events" ? r.events : metric === "deaths" ? r.deaths : r.affected;

    // Bars
    const bars = g
      .selectAll("rect.bar")
      .data(rows, (d: any) => d.type)
      .join("rect")
      .attr("class", "bar")
      .attr("y", (d) => y(d.type) ?? 0)
      .attr("height", y.bandwidth())
      .attr("x", 0)
      .attr("rx", 4)
      .attr("ry", 4)
      .attr("fill", (d) => color(d.type))
      .attr("fill-opacity", (d) =>
        highlightedType && highlightedType !== d.type ? 0.3 : 0.9
      )
      .attr("width", (d) => x(getValue(d)));

    // Value + % labels with smart placement (avoid overflow)
    const LABEL_PAD = 6;
    const MIN_INSIDE_SPACE = 70; // px threshold to fit label inside bar

    const labels = g
      .selectAll("text.value-label")
      .data(rows, (d: any) => d.type)
      .join("text")
      .attr("class", "value-label")
      .attr("y", (d) => (y(d.type) ?? 0) + y.bandwidth() / 2)
      .attr("dy", "0.32em")
      .attr("font-size", 10)
      .text((d) => {
        const value = getValue(d);
        const pct = metricTotal > 0 ? (value / metricTotal) * 100 : 0;
        const valueStr = metric === "events" ? `${value}` : value.toLocaleString();
        return `${valueStr} (${pct.toFixed(1)}%)`;
      });

    // Measure + position after text is set
    labels.each(function (d) {
      const textEl = this as SVGTextElement;
      const textW = textEl.getComputedTextLength();

      const barW = x(getValue(d));
      const barEnd = barW;

      // Outside placement
      const outsideX = barEnd + LABEL_PAD;
      const outsideFits = outsideX + textW <= innerWidth;

      // Inside placement (right-aligned)
      const insideFits = barW >= textW + MIN_INSIDE_SPACE;

      const useOutside = outsideFits || !insideFits;

      d3.select(textEl)
        .attr(
          "x",
          useOutside ? outsideX : Math.max(LABEL_PAD, barEnd - LABEL_PAD)
        )
        .attr("text-anchor", useOutside ? "start" : "end")
        .attr("fill", useOutside ? "#0f172a" : "#ffffff")
        .attr("paint-order", "stroke")
        .attr("stroke", useOutside ? "none" : "rgba(0,0,0,0.35)")
        .attr("stroke-width", useOutside ? 0 : 2);
    });

    // Interactivity: tooltip + highlight
    bars
      .on("mousemove", (event, d) => {
        const value = getValue(d);
        const percent = metricTotal > 0 ? value / metricTotal : 0;

        const containerRect = containerRef.current?.getBoundingClientRect();

        setTooltip({
          x: containerRect ? event.clientX - containerRect.left : 0,
          y: containerRect ? event.clientY - containerRect.top : 0,
          type: d.type,
          value,
          percent,
          metric,
        });
      })
      .on("mouseleave", () => {
        setTooltip(null);
      })
      .on("click", (_, d) => {
        setHighlightedType((prev) => (prev === d.type ? null : d.type));
      });
  }, [rows, totals, maxValue, metric, highlightedType]);

  const metricLabel =
    metric === "events" ? "Events" : metric === "deaths" ? "Deaths" : "Affected people";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Composition by disaster type
          </h2>
          <p className="text-xs text-slate-500">
            Ranked horizontal bars showing which types dominate in{" "}
            {metricLabel.toLowerCase()}.
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

      {loading && <p className="text-xs text-slate-500">Loading composition…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {!loading && !error && !rows.length && (
        <p className="text-xs text-slate-500">No data for the current filters.</p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div ref={containerRef} className="relative mt-1">
          <svg ref={svgRef} className="h-72 w-full md:h-80 lg:h-80" />

          {tooltip && (
            <div
              className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[11px] shadow-lg"
              style={{
                left: tooltip.x,
                top: tooltip.y,
                transform: "translate(-10px, -50%)",
              }}
            >
              <div className="mb-1 text-xs font-semibold text-slate-800">
                {tooltip.type}
              </div>
              <div className="space-y-0.5 text-slate-700">
                <div>
                  <span className="font-medium">{metricLabel}:</span>{" "}
                  {metric === "events"
                    ? tooltip.value
                    : tooltip.value.toLocaleString()}
                </div>
                <div>
                  <span className="font-medium">Share:</span>{" "}
                  {(tooltip.percent * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

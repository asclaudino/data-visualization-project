// app/compare/CountryTimelineDiverging.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
import { type DisasterType } from "@/lib/utils/disasterTypes";

type MetricKey = "events" | "deaths" | "affected";
type BinSize = 1 | 5 | 10;

type Props = {
  selectedCountries: string[]; // expects exactly 2 entries (country names or ISO)
  selectedTypes: DisasterType[];
  yearRange: [number, number];
};

type TooltipState = {
  x: number;
  y: number;
  binLabel: string;
  countryA: string;
  countryB: string;
  valueA: number;
  valueB: number;
  metric: MetricKey;
};

function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

function metricLabel(metric: MetricKey) {
  return metric === "events"
    ? "Events"
    : metric === "deaths"
    ? "Deaths"
    : "Affected people";
}

function formatNumber(metric: MetricKey, v: number) {
  if (metric === "events") return String(v);
  return v.toLocaleString();
}

function floorToBin(year: number, bin: BinSize) {
  if (bin === 1) return year;
  return Math.floor(year / bin) * bin;
}

function binLabel(start: number, bin: BinSize) {
  if (bin === 1) return String(start);
  return `${start}–${start + bin - 1}`;
}

export default function CountryTimelineDiverging({
  selectedCountries,
  selectedTypes,
  yearRange,
}: Props) {
  const [metric, setMetric] = useState<MetricKey>("events");
  const [binSize, setBinSize] = useState<BinSize>(5);

  const [data, setData] = useState<DisasterRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Load once
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

  const memo = useMemo(() => {
    const empty = {
      bins: [] as { binStart: number; label: string; a: number; b: number }[],
      maxAbs: 0,
      countryA: "",
      countryB: "",
    };

    if (!data) return empty;
    if (!selectedCountries || selectedCountries.length !== 2) return empty;
    if (!selectedTypes.length) return empty;

    const [startYear, endYear] = yearRange;
    const countryA = selectedCountries[0];
    const countryB = selectedCountries[1];

    const aKey = normalizeKey(countryA);
    const bKey = normalizeKey(countryB);
    const enabledSet = new Set(selectedTypes);

    // Filter rows to both selected countries + selected types + year range
    const filtered = data.filter((d) => {
      if (d.year < startYear || d.year > endYear) return false;
      const t = d.disasterType as DisasterType;
      if (!enabledSet.has(t)) return false;

      const dnCountry = normalizeKey(d.country);
      const dnIso = normalizeKey(d.iso);

      const matchA = dnCountry === aKey || dnIso === aKey;
      const matchB = dnCountry === bKey || dnIso === bKey;

      return matchA || matchB;
    });

    // Aggregate into bins
    // Map<binStart, {a, b}>
    const agg = new Map<number, { a: number; b: number }>();

    for (const d of filtered) {
      const dnCountry = normalizeKey(d.country);
      const dnIso = normalizeKey(d.iso);

      const isA = dnCountry === aKey || dnIso === aKey;
      const isB = dnCountry === bKey || dnIso === bKey;
      if (!isA && !isB) continue;

      const bStart = floorToBin(d.year, binSize);
      const cur = agg.get(bStart) ?? { a: 0, b: 0 };

      let delta = 0;
      if (metric === "events") delta = 1;
      else if (metric === "deaths") delta = d.totalDeaths ?? 0;
      else delta = d.totalAffected ?? 0;

      if (isA) cur.a += delta;
      else cur.b += delta;

      agg.set(bStart, cur);
    }

    // Include zero bins for continuity within the selected year range
    const startBin = floorToBin(startYear, binSize);
    const endBin = floorToBin(endYear, binSize);

    const bins: { binStart: number; label: string; a: number; b: number }[] = [];
    for (let y = startBin; y <= endBin; y += binSize) {
      const cur = agg.get(y) ?? { a: 0, b: 0 };
      bins.push({ binStart: y, label: binLabel(y, binSize), a: cur.a, b: cur.b });
    }

    // Timeline ordering: earliest at top (as requested)
    // If you prefer newest at top, reverse() here.
    // bins.sort((x, y) => x.binStart - y.binStart);

    const maxAbs =
      d3.max(bins.flatMap((b) => [b.a, b.b])) ?? 0;

    return { bins, maxAbs, countryA, countryB };
  }, [data, selectedCountries, selectedTypes, yearRange, metric, binSize]);

  useEffect(() => {
    const svgEl = svgRef.current;
    const containerEl = containerRef.current;
    if (!svgEl || !containerEl) return;

    const { bins, maxAbs, countryA, countryB } = memo;

    if (!bins.length || !countryA || !countryB) {
      d3.select(svgEl).selectAll("*").remove();
      return;
    }

    const ro = new ResizeObserver(() => draw());
    ro.observe(containerEl);

    function draw() {
      if (!containerEl) return;

      const viewportW = containerEl.clientWidth;

      // Height scales with number of bins; enable vertical scroll via container
      const rowH = 22; // per bin
      const H = Math.max(320, bins.length * rowH + 80);

      const margin = { top: 14, right: 18, bottom: 32, left: 74 };
      const W = Math.max(520, viewportW); // no horizontal scroll needed here
      const innerW = Math.max(0, W - margin.left - margin.right);
      const innerH = Math.max(0, H - margin.top - margin.bottom);

      const svg = d3.select(svgEl);
      svg.selectAll("*").remove();
      svg.attr("width", W).attr("height", H);

      const g = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      // Y scale: bins (earliest at top)
      const y = d3
        .scaleBand<string>()
        .domain(bins.map((b) => b.label))
        .range([0, innerH])
        .padding(0.22);

      // X scale: diverging domain
      const x = d3
        .scaleLinear()
        .domain([-maxAbs * 1.08 || -1, maxAbs * 1.08 || 1])
        .nice()
        .range([0, innerW]);

      // Center line at 0
      g.append("line")
        .attr("x1", x(0))
        .attr("x2", x(0))
        .attr("y1", 0)
        .attr("y2", innerH)
        .attr("stroke", "#cbd5e1")
        .attr("stroke-width", 1);

      // X axis (bottom)
      const xAxis = g
        .append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(
          d3
            .axisBottom(x)
            .ticks(5)
            .tickFormat((d) => {
              const v = Math.abs(Number(d));
              if (metric === "events") return String(v);
              return v >= 1_000_000
                ? `${(v / 1_000_000).toFixed(1)}M`
                : v >= 1_000
                ? `${(v / 1_000).toFixed(0)}k`
                : String(v);
            })
        );

      xAxis.selectAll("text").attr("font-size", 11).attr("fill", "#475569");
      xAxis.selectAll("path").attr("stroke", "#e2e8f0");
      xAxis.selectAll("line").attr("stroke", "#e2e8f0");

      // Y axis (left)
      const yAxis = g.append("g").call(d3.axisLeft(y).tickSize(0));
      yAxis.selectAll("text").attr("font-size", 11).attr("fill", "#475569");
      yAxis.selectAll("path").attr("stroke", "none");

      // Row groups
      const row = g
        .selectAll("g.row")
        .data(bins, (d: any) => d.label)
        .join("g")
        .attr("class", "row")
        .attr("transform", (d) => `translate(0,${y(d.label) ?? 0})`);

      // Bars:
      // Country A goes LEFT (negative), Country B goes RIGHT (positive)
      const barH = y.bandwidth();

      // A (left)
      row.append("rect")
        .attr("class", "bar-a")
        .attr("x", (d) => x(-d.a))
        .attr("y", 0)
        .attr("width", (d) => Math.max(0, x(0) - x(-d.a)))
        .attr("height", barH)
        .attr("rx", 5);

      // B (right)
      row.append("rect")
        .attr("class", "bar-b")
        .attr("x", x(0))
        .attr("y", 0)
        .attr("width", (d) => Math.max(0, x(d.b) - x(0)))
        .attr("height", barH)
        .attr("rx", 5);

      // Values near center (only if there's enough space)
      const minLabelPx = 26;

      // A value
      row.append("text")
        .attr("class", "val-a")
        .attr("x", (d) => x(0) - 6)
        .attr("y", barH / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .attr("font-size", 11)
        .attr("fill", "#0f172a")
        .text((d) => formatNumber(metric, d.a))
        .style("opacity", (d) => (x(0) - x(-d.a) >= minLabelPx ? 1 : 0));

      // B value
      row.append("text")
        .attr("class", "val-b")
        .attr("x", (d) => x(0) + 6)
        .attr("y", barH / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "start")
        .attr("font-size", 11)
        .attr("fill", "#0f172a")
        .text((d) => formatNumber(metric, d.b))
        .style("opacity", (d) => (x(d.b) - x(0) >= minLabelPx ? 1 : 0));

      // Tooltip on rows (both values at once)
      row
        .on("mousemove", (event, d: any) => {
          const rect = containerEl.getBoundingClientRect();
          const xPos = event.clientX - rect.left;
          const yPos = event.clientY - rect.top;

          setTooltip({
            x: Math.max(8, Math.min(xPos, rect.width - 260)),
            y: Math.max(8, Math.min(yPos, rect.height - 90)),
            binLabel: d.label,
            countryA,
            countryB,
            valueA: d.a,
            valueB: d.b,
            metric,
          });
        })
        .on("mouseleave", () => setTooltip(null));

      // Scoped styles
      svg
        .append("style")
        .text(`
          .bar-a { fill: #38bdf8; opacity: 0.85; }
          .bar-b { fill: #94a3b8; opacity: 0.85; }
        `);
    }

    draw();
    return () => ro.disconnect();
  }, [memo, metric]);

  const label = metricLabel(metric);
  const c0 = memo.countryA || selectedCountries[0] || "Country A";
  const c1 = memo.countryB || selectedCountries[1] || "Country B";

  const showChart = !loading && !error && selectedCountries.length === 2;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Timeline comparison (diverging bars)
          </h2>
          <p className="text-xs text-slate-500">
            Left = {c0}, Right = {c1}. Values aggregate all selected disaster types per time bin.
          </p>

          {/* Legend */}
          {selectedCountries.length === 2 && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
              <div className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: "#38bdf8" }} />
                <span>{c0}</span>
              </div>
              <div className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: "#94a3b8" }} />
                <span>{c1}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Bin toggle */}
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => setBinSize(1)}
              className={`px-3 py-1 rounded-full ${
                binSize === 1 ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              1y
            </button>
            <button
              type="button"
              onClick={() => setBinSize(5)}
              className={`px-3 py-1 rounded-full ${
                binSize === 5 ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              5y
            </button>
            <button
              type="button"
              onClick={() => setBinSize(10)}
              className={`px-3 py-1 rounded-full ${
                binSize === 10 ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              10y
            </button>
          </div>

          {/* Metric toggle */}
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => setMetric("events")}
              className={`px-3 py-1 rounded-full ${
                metric === "events" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Events
            </button>
            <button
              type="button"
              onClick={() => setMetric("deaths")}
              className={`px-3 py-1 rounded-full ${
                metric === "deaths" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Deaths
            </button>
            <button
              type="button"
              onClick={() => setMetric("affected")}
              className={`px-3 py-1 rounded-full ${
                metric === "affected" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Affected
            </button>
          </div>
        </div>
      </div>

      {selectedCountries.length !== 2 && (
        <p className="text-xs text-slate-500">
          Select exactly two countries to enable comparison.
        </p>
      )}

      {loading && <p className="text-xs text-slate-500">Loading timeline…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {showChart && (
        // Vertical scroll to handle many bins (especially 1-year)
        <div
          ref={containerRef}
          className="relative mt-2 max-h-[420px] w-full overflow-y-auto overflow-x-hidden rounded-lg"
        >
          <svg ref={svgRef} className="w-full" />

          {tooltip && (
            <div
              className="pointer-events-none absolute z-10 max-w-sm rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[11px] shadow-lg"
              style={{
                left: tooltip.x,
                top: tooltip.y,
                transform: "translate(0px, -110%)",
              }}
            >
              <div className="mb-1 text-xs font-semibold text-slate-800">
                {tooltip.binLabel}
              </div>
              <div className="space-y-0.5 text-slate-700">
                <div>
                  <span className="font-medium">{tooltip.countryA}:</span>{" "}
                  {formatNumber(tooltip.metric, tooltip.valueA)}
                </div>
                <div>
                  <span className="font-medium">{tooltip.countryB}:</span>{" "}
                  {formatNumber(tooltip.metric, tooltip.valueB)}
                </div>
                <div className="pt-1 text-slate-500">
                  Metric: {metricLabel(tooltip.metric)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && !error && selectedCountries.length === 2 && memo.bins.length === 0 && (
        <p className="text-xs text-slate-500">No data for the current filters.</p>
      )}
    </section>
  );
}

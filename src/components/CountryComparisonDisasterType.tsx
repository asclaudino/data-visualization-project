// app/compare/CountryTypeCompositionCompare.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
import { DISASTER_TYPES, type DisasterType } from "@/lib/utils/disasterTypes";

type MetricKey = "events" | "deaths" | "affected";

type Props = {
  selectedCountries: string[]; // expects 2 items (country names or ISO)
  selectedTypes: DisasterType[];
  yearRange: [number, number];
};

type TooltipState = {
  x: number;
  y: number;
  type: string; // full type
  country: string;
  value: number;
  metric: MetricKey;
};

type Row = {
  type: DisasterType;
  values: { country: string; value: number }[];
  enabled: boolean;
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

/**
 * Abbreviations for long disaster type names (x-axis only).
 * Keys must match DISASTER_TYPES strings exactly.
 */
const DISASTER_TYPE_ABBR: Partial<Record<DisasterType, string>> = {
  "Extreme temperature": "Ext. temp.",
  "Mass movement (dry)": "Mass mov. (dry)",
  "Mass movement (wet)": "Mass mov. (wet)",
  "Glacial lake outburst flood": "GLOF",
  // Add more if you want (optional):
  // "Volcanic activity": "Volcanic",
};

function shortTypeLabel(t: DisasterType): string {
  return DISASTER_TYPE_ABBR[t] ?? t;
}

export default function CountryTypeCompositionCompare({
  selectedCountries,
  selectedTypes,
  yearRange,
}: Props) {
  const [metric, setMetric] = useState<MetricKey>("events");

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
      rows: [] as Row[],
      maxValue: 0,
      countryKeys: [] as string[],
    };

    if (!data) return empty;
    if (!selectedCountries || selectedCountries.length !== 2) return empty;

    const [startYear, endYear] = yearRange;
    const countryKeys = [...selectedCountries];

    const c0n = normalizeKey(countryKeys[0]);
    const c1n = normalizeKey(countryKeys[1]);

    const enabledSet = new Set(selectedTypes);

    const filtered = data.filter((d) => {
      const dnCountry = normalizeKey(d.country);
      const dnIso = normalizeKey(d.iso);

      const match0 = dnCountry === c0n || dnIso === c0n;
      const match1 = dnCountry === c1n || dnIso === c1n;
      if (!match0 && !match1) return false;

      if (d.year < startYear || d.year > endYear) return false;

      const t = d.disasterType as DisasterType;
      if (!enabledSet.has(t)) return false;

      return true;
    });

    const agg = new Map<string, number>();
    function add(type: DisasterType, countryIndex: 0 | 1, delta: number) {
      const k = `${type}__${countryIndex}`;
      agg.set(k, (agg.get(k) ?? 0) + delta);
    }

    for (const d of filtered) {
      const dnCountry = normalizeKey(d.country);
      const dnIso = normalizeKey(d.iso);

      const idx: 0 | 1 = dnCountry === c0n || dnIso === c0n ? 0 : 1;
      const t = d.disasterType as DisasterType;

      if (metric === "events") add(t, idx, 1);
      else if (metric === "deaths") add(t, idx, d.totalDeaths ?? 0);
      else add(t, idx, d.totalAffected ?? 0);
    }

    const rows: Row[] = DISASTER_TYPES.map((t) => {
      const enabled = enabledSet.has(t);
      const v0 = enabled ? (agg.get(`${t}__0`) ?? 0) : 0;
      const v1 = enabled ? (agg.get(`${t}__1`) ?? 0) : 0;

      return {
        type: t,
        enabled,
        values: [
          { country: countryKeys[0], value: v0 },
          { country: countryKeys[1], value: v1 },
        ],
      };
    });
    // Sort by total magnitude (sum of both countries), descending
    rows.sort((a, b) => {
      const sumA = a.values[0].value + a.values[1].value;
      const sumB = b.values[0].value + b.values[1].value;
      return sumB - sumA;
    });
    

    const maxValue =
      d3.max(rows.flatMap((r) => r.values.map((v) => v.value))) ?? 0;

    return { rows, maxValue, countryKeys };
  }, [data, selectedCountries, selectedTypes, yearRange, metric]);

  useEffect(() => {
    const svgEl = svgRef.current;
    const containerEl = containerRef.current;
    if (!svgEl || !containerEl) return;

    const { rows, maxValue, countryKeys } = memo;

    if (!rows.length || countryKeys.length !== 2) {
      d3.select(svgEl).selectAll("*").remove();
      return;
    }

    // Redraw on resize of the scroll viewport (not the SVG width)
    const ro = new ResizeObserver(() => draw());
    ro.observe(containerEl);

    function draw() {
      if (!containerEl) return;

      // Width strategy for horizontal scroll:
      // - viewport width is containerEl.clientWidth
      // - actual svg width is max(viewportWidth, minSvgWidth)
      const viewportW = containerEl.clientWidth;
      const H = containerEl.clientHeight || 320;

      const minBandPx = 110;
      const margin = { top: 18, right: 16, bottom: 48, left: 56 };

      // ensure minSvgWidth accounts for margins so innerW stays consistent
      const minSvgWidth = rows.length * minBandPx + margin.left + margin.right + 20;
      const W = Math.max(viewportW, minSvgWidth);

      const innerW = Math.max(0, W - margin.left - margin.right);
      const innerH = Math.max(0, H - margin.top - margin.bottom);

      const svg = d3.select(svgEl);
      svg.selectAll("*").remove();
      svg.attr("width", W).attr("height", H);

      const g = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const x0 = d3
        .scaleBand<string>()
        .domain(rows.map((r) => r.type))
        .range([0, innerW])
        .paddingInner(0.22);

      const x1 = d3
        .scaleBand<string>()
        .domain(countryKeys)
        .range([0, x0.bandwidth()])
        .padding(0.18);

      const y = d3
        .scaleLinear()
        .domain([0, maxValue * 1.08 || 1])
        .nice()
        .range([innerH, 0]);

      // Gridlines
      g.append("g")
        .attr("class", "grid")
        .call(
          d3
            .axisLeft(y)
            .ticks(5)
            .tickSize(-innerW)
            .tickFormat(() => "")
        )
        .selectAll("line")
        .attr("stroke", "#e2e8f0");

      g.select(".grid").selectAll("path").attr("stroke", "none");

      // X axis with abbreviations
      const xAxis = g
        .append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(
          d3
            .axisBottom(x0)
            .tickSizeOuter(0)
            .tickFormat((d) => shortTypeLabel(d as DisasterType))
        );

      xAxis
        .selectAll("text")
        .attr("font-size", 11)
        .attr("fill", "#475569")
        .attr("dy", "0.9em");

      // Add full label on hover over tick labels
      xAxis
        .selectAll<SVGTextElement, unknown>("text")
        .append("title")
        .text(function () {
          // Here, "this" is the text element; the bound datum is the tick value
          // but d3 types can be awkward, so we read it from parent tick.
          const tick = d3.select(this.parentNode as SVGGElement);
          const d = tick.datum() as DisasterType;
          return d;
        });

      xAxis.selectAll("path").attr("stroke", "#e2e8f0");

      // Y axis
      g.append("g")
        .call(
          d3.axisLeft(y).ticks(5).tickFormat((d) => {
            const v = Number(d);
            if (metric === "events") return String(v);
            return v >= 1_000_000
              ? `${(v / 1_000_000).toFixed(1)}M`
              : v >= 1_000
              ? `${(v / 1_000).toFixed(0)}k`
              : String(v);
          })
        )
        .selectAll("text")
        .attr("font-size", 11)
        .attr("fill", "#475569");

      const countryClass = (c: string) =>
        normalizeKey(c) === normalizeKey(countryKeys[0]) ? "bar-a" : "bar-b";

      const groups = g
        .selectAll("g.type-group")
        .data(rows, (d: any) => d.type)
        .join("g")
        .attr("class", "type-group")
        .attr("transform", (d) => `translate(${x0(d.type) ?? 0},0)`);

      const bars = groups
        .selectAll("rect")
        .data(
          (r) =>
            r.values.map((v) => ({
              type: r.type,
              enabled: r.enabled,
              country: v.country,
              value: v.value,
            })),
          (d: any) => `${d.type}__${d.country}`
        )
        .join("rect")
        .attr("x", (d) => x1(d.country) ?? 0)
        .attr("width", x1.bandwidth())
        .attr("y", (d) => y(d.value))
        .attr("height", (d) => innerH - y(d.value))
        .attr("rx", 6)
        .attr(
          "class",
          (d) => `${countryClass(d.country)} ${d.enabled ? "" : "bar-disabled"}`
        )
        .style("cursor", "default");

      // scoped styles
      svg
        .append("style")
        .text(`
          .bar-a { fill: #38bdf8; }
          .bar-b { fill: #94a3b8; }
          .bar-disabled { opacity: 0.18; }
        `);

      bars
        .on("mousemove", (event, d: any) => {
          const rect = containerEl.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const yPos = event.clientY - rect.top;

          setTooltip({
            x: Math.max(8, Math.min(x, rect.width - 220)),
            y: Math.max(8, Math.min(yPos, rect.height - 60)),
            type: d.type, // full label
            country: d.country,
            value: d.value,
            metric,
          });
        })
        .on("mouseleave", () => setTooltip(null));
    }

    draw();
    return () => ro.disconnect();
  }, [memo, metric]);

  const c0 = memo.countryKeys[0] ?? selectedCountries[0] ?? "Country A";
  const c1 = memo.countryKeys[1] ?? selectedCountries[1] ?? "Country B";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Composition by disaster type
          </h2>

          {/* Legend outside SVG */}
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

      {selectedCountries.length !== 2 && (
        <p className="text-xs text-slate-500">
          Select exactly two countries to enable comparison.
        </p>
      )}

      {loading && <p className="text-xs text-slate-500">Loading composition…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {!loading && !error && selectedCountries.length === 2 && (
        // Horizontal scroll viewport
        <div
          ref={containerRef}
          className="relative mt-1 w-full overflow-x-auto overflow-y-hidden"
        >
          {/* SVG can be wider than viewport, enabling horizontal scroll */}
          <svg ref={svgRef} className="h-80" />

          {tooltip && (
            <div
              className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[11px] shadow-lg"
              style={{
                left: tooltip.x,
                top: tooltip.y,
                transform: "translate(0px, -110%)",
              }}
            >
              <div className="mb-1 text-xs font-semibold text-slate-800">
                {tooltip.type}
              </div>
              <div className="space-y-0.5 text-slate-700">
                <div>
                  <span className="font-medium">Country:</span> {tooltip.country}
                </div>
                <div>
                  <span className="font-medium">{metricLabel(tooltip.metric)}:</span>{" "}
                  {tooltip.metric === "events"
                    ? tooltip.value
                    : tooltip.value.toLocaleString()}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

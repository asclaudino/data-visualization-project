// app/compare/CountryRaincloudHalfViolin.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
import type { DisasterType } from "@/lib/utils/disasterTypes";

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
  country: string;
  metric: MetricKey;
  n: number;
  mean: number;
  median: number;
  p90: number;
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

function formatMetric(metric: MetricKey, v: number) {
  if (metric === "events") return String(Math.round(v));
  return Math.round(v).toLocaleString();
}

function floorToBin(year: number, bin: BinSize) {
  if (bin === 1) return year;
  return Math.floor(year / bin) * bin;
}

// --- KDE helpers (simple + robust) ---
function kernelEpanechnikov(k: number) {
  return (v: number) => {
    const x = v / k;
    return Math.abs(x) <= 1 ? (0.75 * (1 - x * x)) / k : 0;
  };
}

function kde(
  kernel: (v: number) => number,
  thresholds: number[],
  sample: number[]
): [number, number][] {
  return thresholds.map((t) => [
    t,
    d3.mean(sample, (s) => kernel(t - s)) ?? 0,
  ]);
}

export default function CountryRaincloudHalfViolin({
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
      countryA: "",
      countryB: "",
      valuesA: [] as number[],
      valuesB: [] as number[],
      maxValue: 0,
    };

    if (!data) return empty;
    if (!selectedCountries || selectedCountries.length !== 2) return empty;
    if (!selectedTypes.length) return empty;

    const [startYear, endYear] = yearRange;
    const [countryA, countryB] = selectedCountries;

    const aKey = normalizeKey(countryA);
    const bKey = normalizeKey(countryB);

    const enabledSet = new Set(selectedTypes);

    // Aggregate per time bin (one value per bin per country)
    // Map<binStart, {a, b}>
    const agg = new Map<number, { a: number; b: number }>();

    function add(binStart: number, which: "a" | "b", delta: number) {
      const cur = agg.get(binStart) ?? { a: 0, b: 0 };
      cur[which] += delta;
      agg.set(binStart, cur);
    }

    for (const d of data) {
      if (d.year < startYear || d.year > endYear) continue;

      const t = d.disasterType as DisasterType;
      if (!enabledSet.has(t)) continue;

      const dnCountry = normalizeKey(d.country);
      const dnIso = normalizeKey(d.iso);

      const isA = dnCountry === aKey || dnIso === aKey;
      const isB = dnCountry === bKey || dnIso === bKey;
      if (!isA && !isB) continue;

      const bStart = floorToBin(d.year, binSize);

      let delta = 0;
      if (metric === "events") delta = 1;
      else if (metric === "deaths") delta = d.totalDeaths ?? 0;
      else delta = d.totalAffected ?? 0;

      add(bStart, isA ? "a" : "b", delta);
    }

    // Include zero bins for continuity (important for distributions)
    const startBin = floorToBin(startYear, binSize);
    const endBin = floorToBin(endYear, binSize);

    const valuesA: number[] = [];
    const valuesB: number[] = [];

    for (let y = startBin; y <= endBin; y += binSize) {
      const cur = agg.get(y) ?? { a: 0, b: 0 };
      valuesA.push(cur.a);
      valuesB.push(cur.b);
    }

    const maxValue =
      d3.max([...valuesA, ...valuesB].filter((v) => Number.isFinite(v))) ?? 0;

    return { countryA, countryB, valuesA, valuesB, maxValue };
  }, [data, selectedCountries, selectedTypes, yearRange, metric, binSize]);

  useEffect(() => {
    const svgEl = svgRef.current;
    const containerEl = containerRef.current;
    if (!svgEl || !containerEl) return;

    const { countryA, countryB, valuesA, valuesB, maxValue } = memo;

    if (
      !countryA ||
      !countryB ||
      selectedCountries.length !== 2 ||
      !valuesA.length ||
      !valuesB.length
    ) {
      d3.select(svgEl).selectAll("*").remove();
      return;
    }

    const ro = new ResizeObserver(() => draw());
    ro.observe(containerEl);

    function draw() {
      if (!containerEl) return;

      const viewportW = containerEl.clientWidth;
      const H = 360;

      // Horizontal scroll pattern: SVG can be wider than viewport
      const minW = 860;
      const W = Math.max(viewportW, minW);

      const margin = { top: 18, right: 18, bottom: 44, left: 64 };
      const innerW = Math.max(0, W - margin.left - margin.right);
      const innerH = Math.max(0, H - margin.top - margin.bottom);

      const svg = d3.select(svgEl);
      svg.selectAll("*").remove();
      svg.attr("width", W).attr("height", H);

      const g = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const countries = [countryA, countryB];

      // X band for countries
      const x = d3
        .scaleBand<string>()
        .domain(countries)
        .range([0, innerW])
        .paddingInner(0.34);

      const bandW = x.bandwidth();
      const halfW = bandW * 0.38; // half-plot width inside band

      // Y is the metric value
      const y = d3
        .scaleLinear()
        .domain([0, (maxValue || 1) * 1.08])
        .nice()
        .range([innerH, 0]);

      // Gridlines
      g.append("g")
        .call(
          d3
            .axisLeft(y)
            .ticks(5)
            .tickSize(-innerW)
            .tickFormat(() => "")
        )
        .selectAll("line")
        .attr("stroke", "#e2e8f0");

      g.selectAll(".domain").remove();

      // Axes
      const yAxis = g.append("g").call(
        d3.axisLeft(y).ticks(5).tickFormat((d) => {
          const v = Number(d);
          if (metric === "events") return String(v);
          return v >= 1_000_000
            ? `${(v / 1_000_000).toFixed(1)}M`
            : v >= 1_000
            ? `${(v / 1_000).toFixed(0)}k`
            : String(v);
        })
      );

      yAxis.selectAll("text").attr("font-size", 11).attr("fill", "#475569");
      yAxis.selectAll("path").attr("stroke", "#e2e8f0");
      yAxis.selectAll("line").attr("stroke", "#e2e8f0");

      const xAxis = g
        .append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).tickSizeOuter(0));

      xAxis.selectAll("text").attr("font-size", 11).attr("fill", "#475569");
      xAxis.selectAll("path").attr("stroke", "#e2e8f0");

      // Center lines for each country (split between half-hist and half-violin)
      const centers = countries.map((c) => (x(c) ?? 0) + bandW / 2);

      g.selectAll("line.center")
        .data(centers)
        .join("line")
        .attr("class", "center")
        .attr("x1", (d) => d)
        .attr("x2", (d) => d)
        .attr("y1", 0)
        .attr("y2", innerH)
        .attr("stroke", "#cbd5e1")
        .attr("stroke-width", 1);

      // Prepare samples
      const sampleA = valuesA.map((v) => Math.max(0, v));
      const sampleB = valuesB.map((v) => Math.max(0, v));

      const sampleByCountry = new Map<string, number[]>([
        [countryA, sampleA],
        [countryB, sampleB],
      ]);

      // Histogram bins
      const nBins = 18;
      const binGen = d3
        .bin<number, number>()
        .domain(y.domain() as [number, number])
        .thresholds(nBins);

      // KDE grid (vertical)
      const y0 = y.domain()[0];
      const y1 = y.domain()[1];
      const kdeSteps = 80;
      const kdeY = d3.range(kdeSteps).map((i) => y0 + (i / (kdeSteps - 1)) * (y1 - y0));

      // Bandwidth heuristic: a fraction of range
      const bw = Math.max(1e-9, (y1 - y0) * 0.06);
      const kernel = kernelEpanechnikov(bw);

      // Compute per-country histogram + kde
      const computed = countries.map((c) => {
        const s = sampleByCountry.get(c) ?? [];
        const bins = binGen(s);
        const density = kde(kernel, kdeY, s);

        const maxCount = d3.max(bins, (b) => b.length) ?? 1;
        const maxDen = d3.max(density, (d) => d[1]) ?? 1e-9;

        return { country: c, sample: s, bins, density, maxCount, maxDen };
      });

      // Scales within band
      const countScale = d3
        .scaleLinear()
        .domain([0, d3.max(computed, (d) => d.maxCount) ?? 1])
        .range([0, halfW]);

      const denScale = d3
        .scaleLinear()
        .domain([0, d3.max(computed, (d) => d.maxDen) ?? 1e-9])
        .range([0, halfW]);

      // Draw per-country group
      const groups = g
        .selectAll("g.country")
        .data(computed, (d: any) => d.country)
        .join("g")
        .attr("class", "country")
        .attr("transform", (d) => `translate(${x(d.country) ?? 0},0)`);

      // Scoped styles
      svg.append("style").text(`
        .hist-a { fill: #38bdf8; opacity: 0.40; }
        .violin-a { fill: #38bdf8; opacity: 0.70; }
        .hist-b { fill: #94a3b8; opacity: 0.40; }
        .violin-b { fill: #94a3b8; opacity: 0.70; }
        .summary-dot { fill: #0f172a; opacity: 0.85; }
      `);

      function clsFor(country: string) {
        return normalizeKey(country) === normalizeKey(countryA) ? "a" : "b";
      }

      // Histogram (LEFT half)
      groups.each(function (d) {
        const group = d3.select(this);
        const center = bandW / 2;

        const histCls = clsFor(d.country) === "a" ? "hist-a" : "hist-b";

        group
          .selectAll("rect.hist")
          .data(d.bins)
          .join("rect")
          .attr("class", `hist ${histCls}`)
          .attr("x", (b) => {
            const w = countScale(b.length);
            return center - w;
          })
          .attr("width", (b) => countScale(b.length))
          .attr("y", (b) => y(b.x1 ?? 0))
          .attr("height", (b) => Math.max(0, y(b.x0 ?? 0) - y(b.x1 ?? 0)))
          .attr("rx", 2);
      });

      // Half violin (RIGHT half) using area
      const area = d3
        .area<[number, number]>()
        .y((p) => y(p[0]))
        .x0(() => bandW / 2)
        .x1((p) => bandW / 2 + denScale(p[1]))
        .curve(d3.curveCatmullRom);

      groups.each(function (d) {
        const group = d3.select(this);
        const violinCls = clsFor(d.country) === "a" ? "violin-a" : "violin-b";

        group
          .selectAll("path.violin")
          .data([d.density])
          .join("path")
          .attr("class", `violin ${violinCls}`)
          .attr("d", area as any);
      });

      // Summary marker (median dot on center line)
      groups.each(function (d) {
        const group = d3.select(this);
        const s = d.sample.slice().sort(d3.ascending);
        if (!s.length) return;

        const med = d3.quantile(s, 0.5) ?? 0;

        group
          .selectAll("circle.summary-dot")
          .data([med])
          .join("circle")
          .attr("class", "summary-dot")
          .attr("cx", bandW / 2)
          .attr("cy", (v) => y(v))
          .attr("r", 3.2);
      });

      // Tooltip via invisible overlay per country band
      groups
        .selectAll("rect.overlay")
        .data((d) => [d])
        .join("rect")
        .attr("class", "overlay")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", bandW)
        .attr("height", innerH)
        .attr("fill", "transparent")
        .on("mousemove", (event, d) => {
          const rect = containerEl.getBoundingClientRect();
          const xPos = event.clientX - rect.left;
          const yPos = event.clientY - rect.top;

          const s = d.sample.slice().sort(d3.ascending);
          const n = s.length;

          const mean = d3.mean(s) ?? 0;
          const median = d3.quantile(s, 0.5) ?? 0;
          const p90 = d3.quantile(s, 0.9) ?? 0;

          setTooltip({
            x: Math.max(8, Math.min(xPos, rect.width - 260)),
            y: Math.max(8, Math.min(yPos, rect.height - 92)),
            country: d.country,
            metric,
            n,
            mean,
            median,
            p90,
          });
        })
        .on("mouseleave", () => setTooltip(null));
    }

    draw();
    return () => ro.disconnect();
  }, [memo, metric, selectedCountries.length]);

  const showChart =
    !loading &&
    !error &&
    selectedCountries.length === 2 &&
    selectedTypes.length > 0 &&
    memo.valuesA.length > 0 &&
    memo.valuesB.length > 0;

  const c0 = memo.countryA || selectedCountries[0] || "Country A";
  const c1 = memo.countryB || selectedCountries[1] || "Country B";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Distribution comparison via Violin Plot
          </h2>
          <p className="text-xs text-slate-500">
            Left half = histogram (counts), right half = density. 
          </p>
          <p className="text-xs text-slate-500">
            Y-axis = metric value per bin (e.g., events per year). Width = how frequently that value occurs.
          </p>

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
              <span className="text-slate-400">•</span>
              <span className="text-slate-500">
                Median shown as a dot on the center line.
              </span>
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

      {selectedTypes.length === 0 && (
        <p className="text-xs text-slate-500">
          Select at least one disaster type to compute distributions.
        </p>
      )}

      {loading && <p className="text-xs text-slate-500">Loading distribution…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {showChart && (
        <div
          ref={containerRef}
          className="relative mt-2 w-full overflow-x-auto overflow-y-hidden"
        >
          <svg ref={svgRef} className="h-[360px]" />

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
                {tooltip.country}
              </div>
              <div className="space-y-0.5 text-slate-700">
                <div>
                  <span className="font-medium">Metric:</span> {metricLabel(tooltip.metric)}
                </div>
                <div>
                  <span className="font-medium">N bins:</span> {tooltip.n}
                </div>
                <div>
                  <span className="font-medium">Mean:</span> {formatMetric(tooltip.metric, tooltip.mean)}
                </div>
                <div>
                  <span className="font-medium">Median:</span> {formatMetric(tooltip.metric, tooltip.median)}
                </div>
                <div>
                  <span className="font-medium">P90:</span> {formatMetric(tooltip.metric, tooltip.p90)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && !error && selectedCountries.length === 2 && selectedTypes.length > 0 && !showChart && (
        <p className="text-xs text-slate-500">No data for the current filters.</p>
      )}
    </section>
  );
}

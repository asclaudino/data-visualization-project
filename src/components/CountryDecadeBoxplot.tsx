// app/countries/[countryId]/CountryDecadeBoxplot.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
import type { DisasterType } from "@/lib/utils/disasterTypes";

type MetricKey = "deaths" | "affected" | "economic";

type Props = {
  countryId: string;
  selectedTypes: DisasterType[];
  yearRange: [number, number];
};

type DecadeStats = {
  decade: number; // e.g. 1950 = 1950–1959
  values: number[];
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
};

type TooltipState = {
  x: number;
  y: number;
  decade: number;
  stats: DecadeStats;
};

export default function CountryDecadeBoxplot({
  countryId,
  selectedTypes,
  yearRange,
}: Props) {
  const [metric, setMetric] = useState<MetricKey>("deaths");
  const [data, setData] = useState<DisasterRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef =
    useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

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

  const { decades, stats, globalMax } = useMemo(() => {
    const empty = {
      decades: [] as number[],
      stats: [] as DecadeStats[],
      globalMax: 0,
    };

    if (!data || !selectedTypes.length) return empty;

    const [startYear, endYear] = yearRange;

    // Filter to this country and selection
    const perCountry = data.filter(
      (d) => d.iso === countryId || d.country === countryId
    );

    const filtered = perCountry.filter(
      (d) =>
        d.year >= startYear &&
        d.year <= endYear &&
        selectedTypes.includes(d.disasterType as DisasterType)
    );

    // Build decade buckets for the whole range even if empty
    const decadeSet = new Set<number>();
    for (let y = startYear; y <= endYear; y++) {
      const dec = Math.floor(y / 10) * 10;
      decadeSet.add(dec);
    }

    // Map decade -> values for chosen metric
    const valuesByDecade = new Map<number, number[]>();
    for (const d of filtered) {
      const dec = Math.floor(d.year / 10) * 10;
      const arr = valuesByDecade.get(dec) ?? [];
      let value = 0;

      if (metric === "deaths") {
        value = d.totalDeaths ?? 0;
      } else if (metric === "affected") {
        value = d.totalAffected ?? 0;
      } else {
        // economic
        value = d.economicDamageAdj ?? 0;
      }

      // For economic damage, ignore zeros (missing); for others keep zero
      if (metric === "economic") {
        if (value > 0) arr.push(value);
      } else {
        arr.push(value);
      }

      if (!valuesByDecade.has(dec)) valuesByDecade.set(dec, arr);
    }

    const decades = Array.from(decadeSet).sort(d3.ascending);

    const stats: DecadeStats[] = [];
    let globalMax = 0;

    for (const dec of decades) {
      const vals = (valuesByDecade.get(dec) ?? []).slice().sort(d3.ascending);

      if (vals.length === 0) {
        stats.push({
          decade: dec,
          values: [],
          min: 0,
          q1: 0,
          median: 0,
          q3: 0,
          max: 0,
        });
        continue;
      }

      const min = d3.min(vals)!;
      const max = d3.max(vals)!;
      const q1 = d3.quantileSorted(vals, 0.25)!;
      const median = d3.quantileSorted(vals, 0.5)!;
      const q3 = d3.quantileSorted(vals, 0.75)!;

      globalMax = Math.max(globalMax, max);

      stats.push({
        decade: dec,
        values: vals,
        min,
        q1,
        median,
        q3,
        max,
      });
    }

    return { decades, stats, globalMax };
  }, [data, selectedTypes, yearRange, countryId, metric]);

  // Draw boxplots with zoom on Y
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svgEl = svgRef.current;
    const svg = d3.select(svgEl);
    const { width, height } = svgEl.getBoundingClientRect();
    if (!width || !height) return;

    svg.selectAll("*").remove();
    zoomRef.current = null;

    if (!decades.length) return;

    const margin = { top: 24, right: 16, bottom: 32, left: 56 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Y scale – if globalMax is 0, make a small range to avoid flat line
    const yMax = globalMax > 0 ? globalMax : 1;
    const y0 = d3
      .scaleLinear()
      .domain([0, yMax])
      .nice()
      .range([innerHeight, 0]);

    // X scale on decades
    const x = d3
      .scaleBand<number>()
      .domain(decades)
      .range([0, innerWidth])
      .paddingInner(0.25)
      .paddingOuter(0.05);

    const boxWidth = x.bandwidth() * 0.6;

    // Axes
    const xAxis = d3
      .axisBottom<number>(x as any)
      .tickFormat((d) => `${d}s`);

    const yAxisBase = d3
      .axisLeft<number>(y0)
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

    const yAxisG = g
      .append("g")
      .attr("class", "y-axis")
      .call(yAxisBase)
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

    // Axis label
    g.append("text")
      .attr("x", -innerHeight / 2)
      .attr("y", -42)
      .attr("transform", "rotate(-90)")
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("fill", "#475569")
      .text(
        metric === "deaths"
          ? "Deaths per event"
          : metric === "affected"
          ? "People affected per event"
          : "Economic damage per event (M US$)"
      );

    const boxGroup = g.append("g").attr("class", "boxes");
    const statByDecade = new Map(stats.map((s) => [s.decade, s]));

    const renderBoxes = (y: d3.ScaleLinear<number, number>) => {
      boxGroup.selectAll("*").remove();

      const boxes = boxGroup
        .selectAll<SVGGElement, number>("g.decade")
        .data(decades)
        .join("g")
        .attr("class", "decade")
        .attr("transform", (d) => {
          const x0 = x(d) ?? 0;
          return `translate(${x0 + x.bandwidth() / 2},0)`;
        });

      boxes.each(function (dec) {
        const s = statByDecade.get(dec);
        const gDec = d3.select(this);

        if (!s || s.values.length === 0) {
          // Faint baseline marker for "no data"
          gDec
            .append("line")
            .attr("x1", -boxWidth * 0.25)
            .attr("x2", boxWidth * 0.25)
            .attr("y1", y(0))
            .attr("y2", y(0))
            .attr("stroke", "#cbd5f5")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "2,2");
          return;
        }

        const yMin = y(s.min);
        const yMax = y(s.max);
        const yQ1 = y(s.q1);
        const yQ3 = y(s.q3);
        const yMed = y(s.median);

        const halfBox = boxWidth / 2;

        // Whiskers
        gDec
          .append("line")
          .attr("x1", 0)
          .attr("x2", 0)
          .attr("y1", yMin)
          .attr("y2", yMax)
          .attr("stroke", "#64748b")
          .attr("stroke-width", 1);

        // Whisker caps
        gDec
          .append("line")
          .attr("x1", -halfBox * 0.6)
          .attr("x2", halfBox * 0.6)
          .attr("y1", yMin)
          .attr("y2", yMin)
          .attr("stroke", "#64748b")
          .attr("stroke-width", 1);

        gDec
          .append("line")
          .attr("x1", -halfBox * 0.6)
          .attr("x2", halfBox * 0.6)
          .attr("y1", yMax)
          .attr("y2", yMax)
          .attr("stroke", "#64748b")
          .attr("stroke-width", 1);

        // Box (IQR)
        gDec
          .append("rect")
          .attr("x", -halfBox)
          .attr("width", boxWidth)
          .attr("y", yQ3)
          .attr("height", yQ1 - yQ3)
          .attr("fill", "#e0f2fe")
          .attr("stroke", "#0284c7")
          .attr("stroke-width", 1);

        // Median
        gDec
          .append("line")
          .attr("x1", -halfBox)
          .attr("x2", halfBox)
          .attr("y1", yMed)
          .attr("y2", yMed)
          .attr("stroke", "#0f172a")
          .attr("stroke-width", 1.2);
      });
    };

    // Initial render
    renderBoxes(y0);

    // Interaction overlay for tooltip (independent of zoom)
    g.append("rect")
      .attr("fill", "transparent")
      .attr("pointer-events", "all")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .on("mousemove", (event) => {
        const [mx] = d3.pointer(event);
        // find nearest decade by band center
        let nearest = decades[0];
        let minDist = Infinity;
        for (const dec of decades) {
          const cx = (x(dec) ?? 0) + x.bandwidth() / 2;
          const dist = Math.abs(cx - mx);
          if (dist < minDist) {
            minDist = dist;
            nearest = dec;
          }
        }

        const s = statByDecade.get(nearest);
        if (!s) return;

        const containerRect =
          containerRef.current?.getBoundingClientRect();
        const svgRect = svgRef.current?.getBoundingClientRect();
        const offsetX =
          (svgRect?.left ?? 0) - (containerRect?.left ?? 0);
        const offsetY =
          (svgRect?.top ?? 0) - (containerRect?.top ?? 0);

        const cx = (x(nearest) ?? 0) + x.bandwidth() / 2;

        setTooltip({
          x: offsetX + margin.left + cx,
          y: offsetY + margin.top + innerHeight / 2,
          decade: nearest,
          stats: s,
        });
      })
      .on("mouseleave", () => setTooltip(null));

    // Zoom: vertical only (Y axis)
    const zoomed = (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      const t = event.transform;
      const zy = t.rescaleY(y0);

      const yAxis = yAxisBase.scale(zy);
      yAxisG
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

      renderBoxes(zy);
    };

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 20])
      .translateExtent([
        [0, 0],
        [width, height],
      ])
      .extent([
        [0, 0],
        [width, height],
      ])
      .on("zoom", zoomed);

    zoomRef.current = zoom;
    svg.call(zoom as any);
  }, [decades, stats, globalMax, metric]);

  const hasAnyData =
    stats.some((s) => s.values.length > 0) && decades.length > 0;

  // Reset zoom handler
  const handleResetZoom = () => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg
      .transition()
      .duration(250)
      .call(zoomRef.current.transform as any, d3.zoomIdentity);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Severity per decade
          </h2>
          <p className="text-xs text-slate-500">
            Boxplots showing how severe individual events are in each decade
            (per event). Boxes show median and interquartile range; lines show
            min and max. Use zoom to inspect extreme values.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          {/* Metric toggle */}
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 font-medium">
            <button
              type="button"
              onClick={() => setMetric("deaths")}
              className={`px-3 py-1 rounded-full ${
                metric === "deaths"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              Deaths / event
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
              Affected / event
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
              Economic / event
            </button>
          </div>

          {/* Reset zoom button */}
          <button
            type="button"
            onClick={handleResetZoom}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 shadow-sm hover:bg-slate-50"
          >
            Reset zoom
          </button>
        </div>
      </div>

      {loading && (
        <p className="text-xs text-slate-500">
          Loading decade statistics…
        </p>
      )}

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {!loading && !error && !hasAnyData && (
        <p className="text-xs text-slate-500">
          No per-event data available for the current filters and decades.
        </p>
      )}

      {!loading && !error && decades.length > 0 && (
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
                  {tooltip.decade}s
                </div>
                {tooltip.stats.values.length === 0 ? (
                  <div className="text-[11px] text-slate-500">
                    No recorded events in this decade.
                  </div>
                ) : (
                  <div className="space-y-0.5 text-slate-700">
                    <div>
                      <span className="font-medium">Min:</span>{" "}
                      {tooltip.stats.min.toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">Q1:</span>{" "}
                      {tooltip.stats.q1.toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">Median:</span>{" "}
                      {tooltip.stats.median.toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">Q3:</span>{" "}
                      {tooltip.stats.q3.toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">Max:</span>{" "}
                      {tooltip.stats.max.toLocaleString()}
                    </div>
                    <div className="pt-1 text-[10px] text-slate-500">
                      {tooltip.stats.values.length} event
                      {tooltip.stats.values.length !== 1 ? "s" : ""} in this
                      decade.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

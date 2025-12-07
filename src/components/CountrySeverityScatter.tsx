// app/countries/[countryId]/CountrySeverityScatter.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
import type { DisasterType } from "@/lib/utils/disasterTypes";

type Mode = "event" | "year";

type Props = {
  countryId: string;
  selectedTypes: DisasterType[];
  yearRange: [number, number];
};

type EventPoint = {
  id: string;
  year: number;
  type: string;
  deaths: number;
  affected: number;
  damage: number;
};

type YearPoint = {
  year: number;
  events: number;
  deaths: number;
  affected: number;
};

type SeverityMemo = {
  eventPoints: EventPoint[];
  yearPoints: YearPoint[];
  colorDomain: string[];
};

type TooltipState = {
  x: number;
  y: number;
  header: string;
  lines: string[];
};

export default function CountrySeverityScatter({
  countryId,
  selectedTypes,
  yearRange,
}: Props) {
  const [mode, setMode] = useState<Mode>("event");
  const [hideMinorEvents, setHideMinorEvents] = useState(true);
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

  const { eventPoints, yearPoints, colorDomain } = useMemo<SeverityMemo>(() => {
    const empty: SeverityMemo = {
      eventPoints: [],
      yearPoints: [],
      colorDomain: [],
    };

    if (!data || !selectedTypes.length) return empty;

    const [startYear, endYear] = yearRange;

    // Filter per country + global filters
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

    // Event-level points
    const eventPoints: EventPoint[] = filtered.map((d, i) => ({
      id: `${d.iso}-${d.year}-${d.disasterType}-${i}`,
      year: d.year,
      type: d.disasterType,
      deaths: d.totalDeaths ?? 0,
      affected: d.totalAffected ?? 0,
      damage: d.economicDamageAdj ?? 0,
    }));

    // Year-level aggregation
    const yearAgg = d3.rollups(
      filtered,
      (v) => {
        let deaths = 0;
        let affected = 0;
        for (const d of v) {
          deaths += d.totalDeaths ?? 0;
          affected += d.totalAffected ?? 0;
        }
        return {
          events: v.length,
          deaths,
          affected,
        };
      },
      (d) => d.year
    );

    const yearPoints: YearPoint[] = yearAgg
      .map(([year, vals]) => ({
        year,
        events: vals.events,
        deaths: vals.deaths,
        affected: vals.affected,
      }))
      .sort((a, b) => d3.ascending(a.year, b.year));

    const colorDomain = Array.from(
      new Set(filtered.map((d) => d.disasterType))
    );

    return { eventPoints, yearPoints, colorDomain };
  }, [data, selectedTypes, yearRange, countryId]);

  // Shared colour scale for legend + circles
  const colorScale = useMemo(() => {
    return d3
      .scaleOrdinal<string, string>()
      .domain(colorDomain)
      .range(d3.schemeTableau10);
  }, [colorDomain]);

  // Draw scatter / bubble chart with zoom
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    const { width, height } = svgRef.current.getBoundingClientRect();

    svg.selectAll("*").remove();
    zoomRef.current = null; // will set inside each mode

    const MINOR_AFFECTED_THRESHOLD = 1000;
    const filteredEvents = hideMinorEvents
      ? eventPoints.filter(
          (d) =>
            !(
              d.deaths === 0 &&
              d.affected > 0 &&
              d.affected < MINOR_AFFECTED_THRESHOLD
            )
        )
      : eventPoints;

    const points =
      mode === "event" ? filteredEvents : yearPoints;

    if (!points.length || !width || !height) {
      return;
    }

    const margin = { top: 24, right: 28, bottom: 40, left: 52 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    if (mode === "event") {
      const pts = filteredEvents;

      const affectedMin =
        d3.min(pts, (d) => (d.affected > 0 ? d.affected : Infinity)) ?? 1;
      const affectedMax =
        d3.max(pts, (d) => (d.affected > 0 ? d.affected : 1)) ?? 1;

      const xMin = isFinite(affectedMin) ? affectedMin : 1;
      const xMax = Math.max(affectedMax, xMin);

      const deathsMax = d3.max(pts, (d) => d.deaths) ?? 0;
      const damageMax =
        d3.max(pts, (d) => (d.damage > 0 ? d.damage : 0)) ?? 0;

      // Linear of log10 so zoom.rescaleX works
      const log = (v: number) => Math.log10(Math.max(v, xMin));

      const x0 = d3
        .scaleLinear()
        .domain([Math.log10(xMin), Math.log10(xMax)])
        .range([0, innerWidth]);

      const y0 = d3
        .scaleLinear()
        .domain([0, deathsMax || 1])
        .nice()
        .range([innerHeight, 0]);

      const r =
        damageMax > 0
          ? d3
              .scaleSqrt()
              .domain([0, damageMax])
              .range([3, 12]) // slightly bigger + vivid
          : d3.scaleSqrt<number, number>().domain([0, 1]).range([3, 7]);

      const xAxisBase = d3
        .axisBottom<number>(x0)
        .ticks(5)
        .tickFormat((d: any) => {
          const v = Math.pow(10, d);
          if (v >= 1_000_000_000) return `${v / 1_000_000_000}B`;
          if (v >= 1_000_000) return `${v / 1_000_000}M`;
          if (v >= 1_000) return `${v / 1_000}k`;
          return v.toFixed(0);
        })
        .tickSize(-innerHeight);

      const yAxisBase = d3
        .axisLeft<number>(y0)
        .ticks(5)
        .tickSize(-innerWidth);

      const xAxisG = g
        .append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .attr("class", "x-axis")
        .call(xAxisBase)
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
            .attr("stroke-opacity", 0.7)
        );

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
            .attr("stroke-opacity", 0.7)
        );

      // Axis labels
      g.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 32)
        .attr("text-anchor", "middle")
        .attr("font-size", 11)
        .attr("fill", "#475569")
        .text("Total affected (log scale)");

      g.append("text")
        .attr("x", -innerHeight / 2)
        .attr("y", -38)
        .attr("transform", "rotate(-90)")
        .attr("text-anchor", "middle")
        .attr("font-size", 11)
        .attr("fill", "#475569")
        .text("Total deaths");

      // Circles (more vivid: higher opacity, same Tableau palette)
      const circles = g
        .append("g")
        .attr("class", "points")
        .selectAll("circle")
        .data(pts, (d: any) => d.id)
        .join("circle")
        .attr("cx", (d) => x0(log(d.affected)))
        .attr("cy", (d) => y0(d.deaths))
        .attr("r", (d) => r(d.damage))
        .attr("fill", (d) => colorScale(d.type))
        .attr("fill-opacity", 0.8)
        .attr("stroke", "#0f172a")
        .attr("stroke-opacity", 0.7)
        .attr("stroke-width", 0.6);

      // Tooltip
      circles
        .on("mousemove", (event, d) => {
          const containerRect =
            containerRef.current?.getBoundingClientRect();

          setTooltip({
            x: containerRect
              ? event.clientX - containerRect.left
              : 0,
            y: containerRect
              ? event.clientY - containerRect.top
              : 0,
            header: d.type,
            lines: [
              `Year: ${d.year}`,
              `Deaths: ${d.deaths.toLocaleString()}`,
              `Affected: ${d.affected.toLocaleString()}`,
              d.damage
                ? `Damage (adj, '000 US$): ${d.damage.toLocaleString()}`
                : "Damage: n/a",
            ],
          });
        })
        .on("mouseleave", () => setTooltip(null));

      // Zoom behaviour
      const zoomed = (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const t = event.transform;
        const zx = t.rescaleX(x0);
        const zy = t.rescaleY(y0);

        const xAxis = xAxisBase.scale(zx);
        const yAxis = yAxisBase.scale(zy);

        xAxisG.call(xAxis)
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
              .attr("stroke-opacity", 0.7)
          );

        yAxisG.call(yAxis)
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
              .attr("stroke-opacity", 0.7)
          );

        circles
          .attr("cx", (d) => zx(log(d.affected)))
          .attr("cy", (d) => zy(d.deaths));
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
    } else {
      // YEAR MODE
      const pts = yearPoints;

      const eventsMax = d3.max(pts, (d) => d.events) ?? 0;
      const deathsMax = d3.max(pts, (d) => d.deaths) ?? 0;
      const affectedMax = d3.max(pts, (d) => d.affected) ?? 0;

      const x0 = d3
        .scaleLinear()
        .domain([0, eventsMax || 1])
        .nice()
        .range([0, innerWidth]);

      const y0 = d3
        .scaleLinear()
        .domain([0, deathsMax || 1])
        .nice()
        .range([innerHeight, 0]);

      const r =
        affectedMax > 0
          ? d3
              .scaleSqrt()
              .domain([0, affectedMax])
              .range([3, 14])
          : d3.scaleSqrt<number, number>().domain([0, 1]).range([3, 6]);

      const xAxisBase = d3
        .axisBottom<number>(x0)
        .ticks(5)
        .tickSize(-innerHeight);

      const yAxisBase = d3
        .axisLeft<number>(y0)
        .ticks(5)
        .tickSize(-innerWidth);

      const xAxisG = g
        .append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .attr("class", "x-axis")
        .call(xAxisBase)
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
            .attr("stroke-opacity", 0.7)
        );

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
            .attr("stroke-opacity", 0.7)
        );

      // Axis labels
      g.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 32)
        .attr("text-anchor", "middle")
        .attr("font-size", 11)
        .attr("fill", "#475569")
        .text("Events per year");

      g.append("text")
        .attr("x", -innerHeight / 2)
        .attr("y", -40)
        .attr("transform", "rotate(-90)")
        .attr("text-anchor", "middle")
        .attr("font-size", 11)
        .attr("fill", "#475569")
        .text("Deaths per year");

      const circles = g
        .append("g")
        .attr("class", "points")
        .selectAll("circle")
        .data(pts, (d: any) => d.year)
        .join("circle")
        .attr("cx", (d) => x0(d.events))
        .attr("cy", (d) => y0(d.deaths))
        .attr("r", (d) => r(d.affected))
        .attr("fill", "#0284c7") // a bit more vivid blue
        .attr("fill-opacity", 0.75)
        .attr("stroke", "#0f172a")
        .attr("stroke-width", 0.6);

      circles
        .on("mousemove", (event, d) => {
          const containerRect =
            containerRef.current?.getBoundingClientRect();

          setTooltip({
            x: containerRect
              ? event.clientX - containerRect.left
              : 0,
            y: containerRect
              ? event.clientY - containerRect.top
              : 0,
            header: `Year ${d.year}`,
            lines: [
              `Events: ${d.events}`,
              `Deaths: ${d.deaths.toLocaleString()}`,
              `Affected: ${d.affected.toLocaleString()}`,
            ],
          });
        })
        .on("mouseleave", () => setTooltip(null));

      const zoomed = (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const t = event.transform;
        const zx = t.rescaleX(x0);
        const zy = t.rescaleY(y0);

        const xAxis = xAxisBase.scale(zx);
        const yAxis = yAxisBase.scale(zy);

        xAxisG.call(xAxis)
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
              .attr("stroke-opacity", 0.7)
          );

        yAxisG.call(yAxis)
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
              .attr("stroke-opacity", 0.7)
          );

        circles
          .attr("cx", (d) => zx(d.events))
          .attr("cy", (d) => zy(d.deaths));
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
    }
  }, [
    mode,
    hideMinorEvents,
    eventPoints,
    yearPoints,
    colorDomain,
    colorScale,
  ]);

  const hasEventData = eventPoints.length > 0;
  const hasYearData = yearPoints.length > 0;

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
            Severity vs frequency
          </h2>
          <p className="text-xs text-slate-500">
            Bubble chart showing whether disasters are frequent but mild
            or rare and catastrophic.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          {/* Mode dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-slate-500">View as:</span>
            <select
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="event">Per event</option>
              <option value="year">Aggregated by year</option>
            </select>
          </div>

          {/* Hide minor events toggle (event mode only) */}
          {mode === "event" && (
            <label className="inline-flex items-center gap-1 cursor-pointer text-slate-500">
              <input
                type="checkbox"
                className="h-3 w-3 accent-sky-500"
                checked={hideMinorEvents}
                onChange={(e) => setHideMinorEvents(e.target.checked)}
              />
              <span>Hide minor events</span>
            </label>
          )}

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
          Loading severity data…
        </p>
      )}

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {!loading && !error && mode === "event" && !hasEventData && (
        <p className="text-xs text-slate-500">
          No event-level data available for the current filters.
        </p>
      )}

      {!loading && !error && mode === "year" && !hasYearData && (
        <p className="text-xs text-slate-500">
          No yearly aggregates available for the current filters.
        </p>
      )}

      {!loading &&
        !error &&
        ((mode === "event" && hasEventData) ||
          (mode === "year" && hasYearData)) && (
          <>
            <div ref={containerRef} className="relative mt-1">
              <svg
                ref={svgRef}
                className="h-72 w-full md:h-80 lg:h-80"
              />

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
                    {tooltip.header}
                  </div>
                  <div className="space-y-0.5 text-slate-700">
                    {tooltip.lines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Colour legend (event mode only) */}
            {mode === "event" && colorDomain.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {colorDomain.map((t) => (
                  <div
                    key={t}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: colorScale(t) }}
                    />
                    <span className="text-slate-700">{t}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
    </section>
  );
}

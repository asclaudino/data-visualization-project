// app/countries/[countryId]/TotalEventsCard.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { DisasterType } from "@/lib/utils/disasterTypes";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";

type Props = {
  countryId: string;
  selectedTypes: DisasterType[];
  yearRange: [number, number];
};

const WIDTH = 120; // logical SVG width
const HEIGHT = 40;
const MARGIN = { top: 4, right: 4, bottom: 4, left: 4 };

export default function TotalEventsCard({
  countryId,
  selectedTypes,
  yearRange,
}: Props) {
  const [data, setData] = useState<DisasterRecord[] | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Load EM-DAT data once, via cached loader
  useEffect(() => {
    let isMounted = true;

    getDisasterData()
      .then((records) => {
        if (isMounted) {
          setData(records);
          console.log(
            "[TotalEventsCard] Loaded disaster data records:",
            records.length
          );
        }
      })
      .catch((err) => {
        console.error("Failed to load disaster data", err);
        if (isMounted) setData([]);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Filter for this country + filters
  const filteredEvents = useMemo(() => {
    if (!data) return [];
    const [startYear, endYear] = yearRange;

    const typeSet = new Set(selectedTypes.map((t) => t.toLowerCase()));
    const idLower = countryId.toLowerCase();

    const result = data.filter((d) => {
      const countryLower = d.country.toLowerCase();
      const matchesCountry = countryLower === idLower;

      const matchesType =
        typeSet.size === 0 ||
        typeSet.has(d.disasterType.toLowerCase());

      const matchesYear = d.year >= startYear && d.year <= endYear;

      return matchesCountry && matchesType && matchesYear;
    });

    console.log(
      "[TotalEventsCard] Filtered events",
      { countryId, selectedTypes, yearRange },
      "=>",
      result.length
    );

    return result;
  }, [data, countryId, selectedTypes, yearRange]);

  // Aggregate to counts per year for the sparkline
  const yearlyCounts = useMemo(() => {
    if (!filteredEvents.length) return [];

    const rollup = d3.rollups(
      filteredEvents,
      (v) => v.length,
      (d) => d.year
    );

    return rollup
      .map(([year, count]) => ({ year: Number(year), count }))
      .sort((a, b) => a.year - b.year);
  }, [filteredEvents]);

  const totalEvents = filteredEvents.length;

  // Draw sparkline when data changes
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    // Responsive SVG
    svg
      .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    if (!yearlyCounts.length) {
      svg
        .append("text")
        .attr("x", WIDTH / 2)
        .attr("y", HEIGHT / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("font-size", 9)
        .attr("fill", "#9ca3af")
        .text("No data");
      return;
    }

    const years = yearlyCounts.map((d) => d.year);
    const counts = yearlyCounts.map((d) => d.count);

    const x = d3
      .scaleLinear()
      .domain(d3.extent(years) as [number, number])
      .range([MARGIN.left, WIDTH - MARGIN.right]);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(counts) || 1])
      .nice()
      .range([HEIGHT - MARGIN.bottom, MARGIN.top]);

    const area = d3
      .area<{ year: number; count: number }>()
      .x((d) => x(d.year))
      .y0(HEIGHT - MARGIN.bottom)
      .y1((d) => y(d.count))
      .curve(d3.curveMonotoneX);

    const line = d3
      .line<{ year: number; count: number }>()
      .x((d) => x(d.year))
      .y((d) => y(d.count))
      .curve(d3.curveMonotoneX);

    // Area
    svg
      .append("path")
      .datum(yearlyCounts)
      .attr("d", area)
      .attr("fill", "#e0f2fe");

    // Line
    svg
      .append("path")
      .datum(yearlyCounts)
      .attr("d", line)
      .attr("fill", "none")
      .attr("stroke", "#0ea5e9")
      .attr("stroke-width", 1.2);

    // Dot on last point
    const last = yearlyCounts[yearlyCounts.length - 1];
    svg
      .append("circle")
      .attr("cx", x(last.year))
      .attr("cy", y(last.count))
      .attr("r", 2)
      .attr("fill", "#0284c7");
  }, [yearlyCounts]);

  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          Total events
        </span>
        <span className="mt-1 text-xl font-semibold text-slate-900">
          {data ? totalEvents.toLocaleString() : "—"}
        </span>
        <span className="text-[11px] text-slate-400 mt-1">
          {yearRange[0]}–{yearRange[1]}
          {selectedTypes.length > 0
            ? ` • ${selectedTypes.length} type${
                selectedTypes.length === 1 ? "" : "s"
              }`
            : " • all types"}
        </span>
      </div>

      {/* Sparkline container: controls physical size and hides overflow */}
      <div className="ml-4 h-14 w-28 overflow-hidden flex items-center">
        <svg ref={svgRef} aria-hidden="true" className="w-full h-full" />
      </div>
    </div>
  );
}

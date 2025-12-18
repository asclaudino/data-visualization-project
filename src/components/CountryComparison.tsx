// app/countries/[countryId]/CountryTypeComposition.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
import type { DisasterType } from "@/lib/utils/disasterTypes";

type MetricKey = "events" | "deaths" | "affected";

type Props = {
  selectedCountries: string[];
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
  selectedCountries,
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
      (d) => selectedCountries.includes(d.iso) || selectedCountries.includes(d.country)
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
  }, [data, selectedTypes, yearRange, metric, selectedCountries]);

  // Draw bar chart
  useEffect(() => {
    //  TODO
  }, [rows, totals, maxValue, metric, highlightedType]);

  const metricLabel =
    metric === "events"
      ? "Events"
      : metric === "deaths"
      ? "Deaths"
      : "Affected people";

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

      {loading && (
        <p className="text-xs text-slate-500">
          Loading composition…
        </p>
      )}

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {!loading && !error && !rows.length && (
        <p className="text-xs text-slate-500">
          No data for the current filters.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
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
                {tooltip.type}
              </div>
              <div className="space-y-0.5 text-slate-700">
                <div>
                  <span className="font-medium">
                    {metricLabel}:
                  </span>{" "}
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

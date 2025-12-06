"use client";

import { useEffect, useMemo, useState } from "react";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
import type { DisasterType } from "@/lib/utils/disasterTypes";

type Props = {
  countryId: string;
  selectedTypes: DisasterType[];
  yearRange: [number, number];
};

function matchesCountry(record: DisasterRecord, countryId: string): boolean {
  const cid = countryId.toLowerCase();
  const iso = record.iso?.toLowerCase() ?? "";
  const country = record.country?.toLowerCase() ?? "";
  return iso === cid || country === cid;
}

const SPARKLINE_VIEWBOX_WIDTH = 100;
const SPARKLINE_VIEWBOX_HEIGHT = 40;
const SPARKLINE_PADDING_X = 6;
const SPARKLINE_PADDING_Y = 6;

export default function TotalDeathsCard({
  countryId,
  selectedTypes,
  yearRange,
}: Props) {
  const [allData, setAllData] = useState<DisasterRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getDisasterData()
      .then((rows) => {
        if (cancelled) return;
        setAllData(rows);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error in TotalDeathsCard getDisasterData:", err);
        setError("Failed to load deaths data");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { totalDeaths, yearlySeries } = useMemo(() => {
    // When filters are cleared, hard-reset card
    if (selectedTypes.length === 0) {
      return {
        totalDeaths: 0,
        yearlySeries: [] as { year: number; value: number }[],
      };
    }

    if (!allData || allData.length === 0) {
      return {
        totalDeaths: 0,
        yearlySeries: [] as { year: number; value: number }[],
      };
    }

    const [startYear, endYear] = yearRange;

    const filtered = allData.filter((d) => {
      if (!matchesCountry(d, countryId)) return false;
      if (d.year < startYear || d.year > endYear) return false;
      if (!selectedTypes.includes(d.disasterType as DisasterType)) return false;
      return true;
    });

    if (filtered.length === 0) {
      return {
        totalDeaths: 0,
        yearlySeries: [] as { year: number; value: number }[],
      };
    }

    let sumDeaths = 0;
    const byYear = new Map<number, number>();

    for (const row of filtered) {
      const deaths = row.totalDeaths ?? 0;
      if (!Number.isFinite(deaths) || deaths <= 0) continue;

      sumDeaths += deaths;
      const y = row.year;
      byYear.set(y, (byYear.get(y) ?? 0) + deaths);
    }

    const yearlySeries = Array.from(byYear.entries())
      .map(([year, value]) => ({ year, value }))
      .sort((a, b) => a.year - b.year);

    return { totalDeaths: sumDeaths, yearlySeries };
  }, [allData, countryId, selectedTypes, yearRange]);

  // Build sparkline path in viewBox coordinates
  let pathD = "";
  if (yearlySeries.length > 1) {
    const years = yearlySeries.map((d) => d.year);
    const values = yearlySeries.map((d) => d.value);

    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const maxVal = Math.max(...values);

    const yearSpan = maxYear - minYear || 1;
    const valSpan = maxVal || 1;

    const xScale = (year: number) =>
      SPARKLINE_PADDING_X +
      ((year - minYear) / yearSpan) *
        (SPARKLINE_VIEWBOX_WIDTH - 2 * SPARKLINE_PADDING_X);

    const yScale = (v: number) =>
      SPARKLINE_VIEWBOX_HEIGHT -
      SPARKLINE_PADDING_Y -
      (v / valSpan) *
        (SPARKLINE_VIEWBOX_HEIGHT - 2 * SPARKLINE_PADDING_Y);

    pathD = yearlySeries
      .map((d, i) => {
        const x = xScale(d.year);
        const y = yScale(d.value);
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  }

  const hasFilters = selectedTypes.length > 0;
  const showSparkline = hasFilters && yearlySeries.length > 1 && !!pathD;

  const displayValue =
    !hasFilters || error
      ? "–"
      : loading || allData === null
      ? "…"
      : totalDeaths.toLocaleString();

  return (
    <div className="h-full flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Total deaths
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
            {displayValue}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Sum of <span className="font-medium">Total Deaths</span> for the
            current filters.
          </p>
          {error && (
            <p className="mt-1 text-[11px] text-red-500">{error}</p>
          )}
        </div>

        {/* Sparkline – responsive, no clipping */}
        <div className="ml-2 flex-1 flex items-start justify-end">
          {showSparkline && (
            <svg
              className="h-10 w-full max-w-[220px] text-sky-500"
              viewBox={`0 0 ${SPARKLINE_VIEWBOX_WIDTH} ${SPARKLINE_VIEWBOX_HEIGHT}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d={pathD}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>
      </div>

      {showSparkline && (
        <p className="mt-2 text-[10px] text-slate-400">
          Sparkline: deaths per year ({yearRange[0]}–{yearRange[1]}), using{" "}
          <span className="font-medium">Start Year</span>.
        </p>
      )}
    </div>
  );
}

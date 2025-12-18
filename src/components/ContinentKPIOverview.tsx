//src/components/ContinentKPIOverview.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";

type MetricKey = "events" | "deaths" | "affected" | "damage";

type Props = {
  initialMetric?: MetricKey;
  fixedYearRange?: [number, number];
};

type Continent = "Africa" | "Americas" | "Asia" | "Europe" | "Oceania" | "Other";

const CONTINENTS: Continent[] = [
  "Africa",
  "Americas",
  "Asia",
  "Europe",
  "Oceania",
  "Other",
];

const SPARKLINE_W = 100;
const SPARKLINE_H = 40;
const SPARK_PAD_X = 6;
const SPARK_PAD_Y = 6;

function safeNum(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function formatInt(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function formatMoneyThousandsUSD(valueInMillions: number): string {
  const usd = valueInMillions * 1000000;
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 2,
    style: "currency",
    currency: "USD",
  }).format(usd);
}

function inferContinent(r: DisasterRecord): Continent {
  const region = (r.region || "").trim().toLowerCase();
  const subregion = (r.subregion || "").trim().toLowerCase();

  if (region.includes("africa")) return "Africa";
  if (region.includes("americ")) return "Americas";
  if (region.includes("asia")) return "Asia";
  if (region.includes("europe")) return "Europe";
  if (region.includes("oceania")) return "Oceania";

  if (subregion.includes("africa")) return "Africa";
  if (subregion.includes("americ")) return "Americas";
  if (subregion.includes("asia")) return "Asia";
  if (subregion.includes("europe")) return "Europe";
  if (subregion.includes("oceania")) return "Oceania";

  return "Other";
}

function buildSparkPath(values: number[]): string {
  if (values.length <= 1) return "";

  const xs = values.map((_, i) => i);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minV = Math.min(...values, 0);
  const maxV = Math.max(...values, 1);

  const xSpan = maxX - minX || 1;
  const vSpan = maxV - minV || 1;

  const xScale = (i: number) =>
    SPARK_PAD_X + ((i - minX) / xSpan) * (SPARKLINE_W - 2 * SPARK_PAD_X);

  const yScale = (v: number) =>
    SPARKLINE_H -
    SPARK_PAD_Y -
    ((v - minV) / vSpan) * (SPARKLINE_H - 2 * SPARK_PAD_Y);

  return values
    .map((v, i) => {
      const x = xScale(i);
      const y = yScale(v);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function metricLabel(metric: MetricKey): string {
  switch (metric) {
    case "events":
      return "Events";
    case "deaths":
      return "Deaths";
    case "affected":
      return "Affected";
    case "damage":
      return "Economic loss";
  }
}

function metricHelp(metric: MetricKey): string {
  switch (metric) {
    case "events":
      return "Number of disaster entries.";
    case "deaths":
      return "Sum of Total Deaths.";
    case "affected":
      return "Sum of Total Affected.";
    case "damage":
      return "Sum of adjusted economic damage.";
  }
}

export default function ContinentKPIOverview({
  initialMetric = "events",
  fixedYearRange,
}: Props) {
  const [allData, setAllData] = useState<DisasterRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [metric, setMetric] = useState<MetricKey>(initialMetric);

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
        console.error("Error in ContinentKPIOverview getDisasterData:", err);
        setError("Failed to load EM-DAT data");
        setAllData([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const yearBounds = useMemo(() => {
    const rows = allData ?? [];
    const ys = rows.map((d) => d.year).filter((y) => Number.isFinite(y));
    const minY = ys.length ? Math.min(...ys) : 1900;
    const maxY = ys.length ? Math.max(...ys) : 2025;
    return { minY, maxY };
  }, [allData]);

  const MIN_YEAR = yearBounds.minY;
  const MAX_YEAR = yearBounds.maxY;

  const [yearRange, setYearRange] = useState<[number, number]>([
    fixedYearRange?.[0] ?? 1900,
    fixedYearRange?.[1] ?? 2025,
  ]);

  // sync after load / fixedYearRange changes
  useEffect(() => {
    if (!allData) return;

    if (fixedYearRange) {
      setYearRange([fixedYearRange[0], fixedYearRange[1]]);
      return;
    }

    setYearRange(([start, end]) => {
      const s = Number.isFinite(start) ? start : MIN_YEAR;
      const e = Number.isFinite(end) ? end : MAX_YEAR;
      return [Math.max(MIN_YEAR, Math.min(s, e)), Math.min(MAX_YEAR, Math.max(e, s))];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allData, fixedYearRange?.[0], fixedYearRange?.[1], MIN_YEAR, MAX_YEAR]);

  function updateStartYear(value: number) {
    if (fixedYearRange) return;
    setYearRange(([_, end]) => {
      const clamped = Math.max(MIN_YEAR, Math.min(value, end));
      return [clamped, end];
    });
  }

  function updateEndYear(value: number) {
    if (fixedYearRange) return;
    setYearRange(([start, _]) => {
      const clamped = Math.min(MAX_YEAR, Math.max(value, start));
      return [start, clamped];
    });
  }

  const filtered = useMemo(() => {
    if (!allData || allData.length === 0) return [];
    const [startYear, endYear] = yearRange;
    return allData.filter((d) => d.year >= startYear && d.year <= endYear);
  }, [allData, yearRange]);

  const yearList = useMemo(() => {
    const [lo, hi] = yearRange;
    const arr: number[] = [];
    for (let y = lo; y <= hi; y++) arr.push(y);
    return arr;
  }, [yearRange]);

  type ContRow = {
    continent: Continent;
    events: number;
    deaths: number;
    affected: number;
    damage: number; // '000 US$
    spark: number[];
    sparkPath: string;
  };

  const byContinent = useMemo<ContRow[]>(() => {
    const idx = new Map<number, number>();
    yearList.forEach((y, i) => idx.set(y, i));

    const init = (c: Continent): ContRow => ({
      continent: c,
      events: 0,
      deaths: 0,
      affected: 0,
      damage: 0,
      spark: new Array(yearList.length).fill(0),
      sparkPath: "",
    });

    const rows = new Map<Continent, ContRow>();
    for (const c of CONTINENTS) rows.set(c, init(c));

    for (const r of filtered) {
      const c = inferContinent(r);
      const row = rows.get(c) ?? init(c);

      row.events += 1;
      row.deaths += safeNum(r.totalDeaths);
      row.affected += safeNum(r.totalAffected);
      row.damage += safeNum(r.economicDamageAdj);

      const j = idx.get(r.year);
      if (j !== undefined) {
        if (metric === "events") row.spark[j] += 1;
        if (metric === "deaths") row.spark[j] += safeNum(r.totalDeaths);
        if (metric === "affected") row.spark[j] += safeNum(r.totalAffected);
        if (metric === "damage") row.spark[j] += safeNum(r.economicDamageAdj);
      }

      rows.set(c, row);
    }

    const out = Array.from(rows.values()).map((r) => ({
      ...r,
      sparkPath: buildSparkPath(r.spark),
    }));

    const getMain = (r: ContRow) =>
      metric === "events"
        ? r.events
        : metric === "deaths"
        ? r.deaths
        : metric === "affected"
        ? r.affected
        : r.damage;

    out.sort((a, b) => getMain(b) - getMain(a));
    return out;
  }, [filtered, yearList, metric]);

  const totals = useMemo(() => {
    let events = 0;
    let deaths = 0;
    let affected = 0;
    let damage = 0;

    for (const r of filtered) {
      events += 1;
      deaths += safeNum(r.totalDeaths);
      affected += safeNum(r.totalAffected);
      damage += safeNum(r.economicDamageAdj);
    }

    return { events, deaths, affected, damage };
  }, [filtered]);

  const hasData = !loading && !error && (allData?.length ?? 0) > 0;

  const globalDisplay =
    !hasData
      ? loading
        ? "…"
        : "–"
      : metric === "events"
      ? formatInt(totals.events)
      : metric === "deaths"
      ? formatInt(totals.deaths)
      : metric === "affected"
      ? formatInt(totals.affected)
      : formatMoneyThousandsUSD(totals.damage);

  return (
    <div className="mt-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {/* Filters row (metric + year range), same UI logic as CountryOverviewClient */}
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
          {/* Metric */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-800">Metric</h2>
              <span className="text-xs text-slate-500">{metricLabel(metric)}</span>
            </div>

            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide sr-only">
              Metric
            </label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
              className="h-9 w-full min-w-[180px] rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="events">Events</option>
              <option value="deaths">Deaths</option>
              <option value="affected">Affected</option>
              <option value="damage">Economic loss (adj.)</option>
            </select>

            <p className="mt-2 text-[11px] text-slate-500">{metricHelp(metric)}</p>
          </div>

          {/* Year range filter (copied structure/style from CountryOverviewClient) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-800">Year range</h2>
              <span className="text-xs text-slate-500">
                {yearRange[0]} – {yearRange[1]}
              </span>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <label className="text-slate-500">Start year</label>
                  <input
                    type="range"
                    min={MIN_YEAR}
                    max={MAX_YEAR}
                    value={yearRange[0]}
                    onChange={(e) => updateStartYear(Number(e.target.value))}
                    title={String(yearRange[0])}
                    className="w-full cursor-pointer disabled:opacity-60"
                    disabled={!!fixedYearRange || loading || !!error}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-slate-500">End year</label>
                  <input
                    type="range"
                    min={MIN_YEAR}
                    max={MAX_YEAR}
                    value={yearRange[1]}
                    onChange={(e) => updateEndYear(Number(e.target.value))}
                    title={String(yearRange[1])}
                    className="w-full cursor-pointer disabled:opacity-60"
                    disabled={!!fixedYearRange || loading || !!error}
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                Hover the slider handles to see the exact year. Data will be filtered
                to events between these years.
              </p>

              {error && <p className="text-[11px] text-red-500">{error}</p>}
            </div>
          </div>
        </div>

        {/* Global total card */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Global total • {metricLabel(metric)}
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
                {globalDisplay}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {yearRange[0]}–{yearRange[1]}
              </p>
            </div>

            <div className="ml-2 flex-1 flex items-start justify-end">
              {hasData && yearList.length > 1 && (
                <svg
                  className="h-10 w-full max-w-[220px] text-sky-500"
                  viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d={buildSparkPath(
                      byContinent.reduce<number[]>(
                        (acc, r) => acc.map((v, i) => v + (r.spark[i] ?? 0)),
                        new Array(yearList.length).fill(0)
                      )
                    )}
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
        </div>

        {/* Continent KPI grid */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {byContinent.map((row) => {
            const main =
              metric === "events"
                ? row.events
                : metric === "deaths"
                ? row.deaths
                : metric === "affected"
                ? row.affected
                : row.damage;

            const mainDisplay =
              !hasData
                ? loading
                  ? "…"
                  : "–"
                : metric === "damage"
                ? formatMoneyThousandsUSD(main)
                : formatInt(main);

            const showSpark = hasData && row.sparkPath && yearList.length > 1;

            return (
              <div
                key={row.continent}
                className="h-full flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                      {row.continent}
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
                      {mainDisplay}
                    </p>
                    {hasData && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        {yearRange[0]}–{yearRange[1]} • {formatInt(row.events)} event
                        {row.events === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>

                  <div className="ml-2 flex-1 flex items-start justify-end">
                    {showSpark && (
                      <svg
                        className="h-10 w-full max-w-[220px] text-sky-500"
                        viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path
                          d={row.sparkPath}
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
              </div>
            );
          })}
        </div>

        {loading && (
          <p className="mt-3 text-[11px] text-slate-500">Loading…</p>
        )}
      </div>
    </div>
  );
}

import type { DisasterRecord } from "@/lib/emdatData";

export type Continent = "Africa" | "Americas" | "Asia" | "Europe" | "Oceania" | "Other";

export const CONTINENTS: Continent[] = [
  "Africa",
  "Americas",
  "Asia",
  "Europe",
  "Oceania",
  "Other",
];

export function inferContinentFromRecord(r: DisasterRecord): Continent {
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

/**
 * Build a stable ISO->continent mapping (majority vote over all records for each ISO).
 * This lets the map highlight continents even without TopoJSON continent metadata.
 */
export function buildIsoToContinent(rows: DisasterRecord[]): Record<string, Continent> {
  const counts = new Map<string, Map<Continent, number>>();

  for (const r of rows) {
    const iso = (r.iso || "").trim().toUpperCase();
    if (!iso) continue;
    const c = inferContinentFromRecord(r);

    if (!counts.has(iso)) counts.set(iso, new Map());
    const m = counts.get(iso)!;
    m.set(c, (m.get(c) ?? 0) + 1);
  }

  const out: Record<string, Continent> = {};
  for (const [iso, m] of counts.entries()) {
    let best: Continent = "Other";
    let bestN = -1;
    for (const [c, n] of m.entries()) {
      if (n > bestN) {
        bestN = n;
        best = c;
      }
    }
    out[iso] = best;
  }
  return out;
}

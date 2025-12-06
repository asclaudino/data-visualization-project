// src/lib/emdatData.ts
import * as d3 from "d3";

export type DisasterRecord = {
  iso: string;
  country: string;
  year: number;
  disasterType: string;

  // NEW FIELDS
  totalDeaths: number | null;
  totalAffected: number | null;
  /**
   * Monetary fields are in '000 US$ (as in the CSV).
   * We keep the raw adjusted components plus a convenience field
   * `economicDamageAdj` that prefers Reconstruction Costs, Adjusted
   * and falls back to Insured Damage, Adjusted when missing.
   */
  reconstructionCostsAdj: number | null;
  insuredDamageAdj: number | null;
  economicDamageAdj: number | null;
};

const DATA_PATH = "/data/emdat_data.csv"; // public/data/emdat_data.csv

let cachedData: Promise<DisasterRecord[]> | null = null;

// Small helper: safely parse numeric fields (handles "", undefined, etc.)
function parseNumericField(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // EM-DAT values should be plain numbers, but just in case, strip commas.
  const num = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

export function getDisasterData(): Promise<DisasterRecord[]> {
  if (!cachedData) {
    cachedData = d3
      .dsv(";", DATA_PATH, (row) => {
        // row is a d3.DSVRowString<string>
        const iso = (row.ISO || "").trim();
        const country = (row.Country || "").trim();
        const yearStr = row["Start Year"];
        const disasterType = (row["Disaster Type"] || "").trim();

        const year = yearStr ? +yearStr : NaN;

        // --- NEW: numeric metrics ------------------------------------------
        const totalDeaths = parseNumericField(
          row["Total Deaths"] as string | undefined
        );

        const totalAffected = parseNumericField(
          row["Total Affected"] as string | undefined
        );

        const reconstructionCostsAdj = parseNumericField(
          row["Reconstruction Costs, Adjusted ('000 US$)"] as
            | string
            | undefined
        );

        // Different EM-DAT extracts sometimes vary in the insured column name.
        const insuredDamageAdj =
          parseNumericField(
            row["Insured Damage, Adjusted ('000 US$)"] as string | undefined
          ) ??
          parseNumericField(
            row["Insured, Adjusted ('000 US$)"] as string | undefined
          ) ??
          parseNumericField(row["Insured"] as string | undefined);

        // Convenience field for your "Total economic damage" card:
        // prefer reconstructionCostsAdj, otherwise fall back to insuredDamageAdj.
        const economicDamageAdj =
          reconstructionCostsAdj ?? insuredDamageAdj ?? null;

        return {
          iso,
          country,
          year,
          disasterType,
          totalDeaths,
          totalAffected,
          reconstructionCostsAdj,
          insuredDamageAdj,
          economicDamageAdj,
        } as DisasterRecord;
      })
      .then((rows) => {
        console.log("[EMDAT] Raw rows:", rows.length);

        const cleaned = rows.filter(
          (d) => d.country && !Number.isNaN(d.year) && d.disasterType
        );

        console.log("[EMDAT] Cleaned rows:", cleaned.length);
        console.log(
          "[EMDAT] Example disaster types:",
          Array.from(new Set(cleaned.map((d) => d.disasterType))).slice(0, 10)
        );

        return cleaned;
      })
      .catch((err) => {
        console.error("Error loading EM-DAT CSV:", err);
        return [];
      });
  }

  return cachedData;
}
// Usage: import { getDisasterData, type DisasterRecord } from "@/lib/emdatData";
// src/lib/emdatData.ts
import * as d3 from "d3";

export type DisasterRecord = {
  iso: string;
  country: string;

  // NEW: geography
  region: string;     // e.g. "Africa", "Europe", ...
  subregion: string;  // e.g. "Western Europe", ...

  year: number;
  startMonth: number | null;
  startDay: number | null;
  endMonth: number | null;
  endDay: number | null;

  disasterType: string;

  // Metrics
  totalDeaths: number | null;
  totalAffected: number | null;

  /**
   * Monetary fields are in '000 US$ (as in the CSV).
   *
   * totalDamageAdj:
   *   EM-DAT "Total Damage, Adjusted ('000 US$)" – usually the combined figure.
   *
   * reconstructionCostsAdj:
   *   EM-DAT "Reconstruction Costs, Adjusted ('000 US$)".
   *
   * insuredDamageAdj:
   *   EM-DAT "Insured Damage, Adjusted ('000 US$)" (fallback variants handled).
   *
   * economicDamageAdj:
   *   Convenience field for your KPI:
   *   prefers totalDamageAdj, then reconstructionCostsAdj, then insuredDamageAdj.
   */
  totalDamageAdj: number | null;
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

function parseStringField(raw: string | undefined): string {
  if (raw == null) return "";
  return raw.trim();
}

export function getDisasterData(): Promise<DisasterRecord[]> {
  if (!cachedData) {
    cachedData = d3
      .dsv(";", DATA_PATH, (row) => {
        const iso = parseStringField(row.ISO);
        const country = parseStringField(row.Country);

        // NEW: Region & Subregion (your CSV headers show "Region" and "Subregion")
        const region =
          parseStringField(row.Region) ||
          parseStringField((row as any)["EMDAT Region"]) ||
          "";

        const subregion =
          parseStringField(row.Subregion) ||
          parseStringField((row as any)["EMDAT Subregion"]) ||
          "";

        const yearStr = row["Start Year"];
        const year = yearStr ? +yearStr : NaN;

        const disasterType = parseStringField(row["Disaster Type"]);

        const startMonth = parseNumericField(row["Start Month"]);
        const startDay = parseNumericField(row["Start Day"]);
        const endMonth = parseNumericField(row["End Month"]);
        const endDay = parseNumericField(row["End Day"]);

        const totalDeaths = parseNumericField(row["Total Deaths"] as string | undefined);
        const totalAffected = parseNumericField(row["Total Affected"] as string | undefined);

        const totalDamageAdj = parseNumericField(
          row["Total Damage, Adjusted ('000 US$)"] as string | undefined
        );

        const reconstructionCostsAdj = parseNumericField(
          row["Reconstruction Costs, Adjusted ('000 US$)"] as string | undefined
        );

        const insuredDamageAdj =
          parseNumericField(row["Insured Damage, Adjusted ('000 US$)"] as string | undefined) ??
          parseNumericField(row["Insured, Adjusted ('000 US$)"] as string | undefined) ??
          parseNumericField(row["Insured"] as string | undefined);

        let economicDamageAdj =
          totalDamageAdj ?? reconstructionCostsAdj ?? insuredDamageAdj ?? null;

        if (economicDamageAdj !== null) {
          economicDamageAdj = economicDamageAdj / 1000;
        }

        return {
          iso,
          country,
          region,
          subregion,
          year,
          startMonth,
          startDay,
          endMonth,
          endDay,
          disasterType,
          totalDeaths,
          totalAffected,
          totalDamageAdj,
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
          "[EMDAT] Example regions:",
          Array.from(new Set(cleaned.map((d) => d.region))).slice(0, 10)
        );
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

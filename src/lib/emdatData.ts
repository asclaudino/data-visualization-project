// src/lib/emdatData.ts
import * as d3 from "d3";

export type DisasterRecord = {
  iso: string;
  country: string;
  year: number;
  disasterType: string;
  // we can add deaths, affected, damage later
};

const DATA_PATH = "/data/emdat_data.csv"; // public/data/emdat_data.csv

let cachedData: Promise<DisasterRecord[]> | null = null;

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

        return {
          iso,
          country,
          year,
          disasterType,
        } as DisasterRecord;
      })
      .then((rows) => {
        console.log("[EMDAT] Raw rows:", rows.length);

        const cleaned = rows.filter(
          (d) =>
            d.country &&
            !Number.isNaN(d.year) &&
            d.disasterType
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

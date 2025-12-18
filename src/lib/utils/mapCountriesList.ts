import fs from "fs";
import path from "path";

// Loads the CSV and returns a list of country names
function loadCountriesFromCSV() {
  const csvPath = path.join(process.cwd(), "public/data/map_country_names.csv"); // adjust if needed
  const csv = fs.readFileSync(csvPath, "utf8");

  const lines = csv.trim().split("\n").slice(1); // skip header

  const countries = lines.map((line) => line.replace(/"/g, "").trim());

  return countries;
}

// Call once and export as a constant
export const mapCountriesList = loadCountriesFromCSV();

export type CountriesType = (typeof mapCountriesList)[number];

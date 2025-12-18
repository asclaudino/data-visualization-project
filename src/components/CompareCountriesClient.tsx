"use client";

import { useState } from "react";
import { DISASTER_TYPES, type DisasterType } from "@/lib/utils/disasterTypes";
import {type CountriesType } from "@/lib/utils/mapCountriesList";
import CountryComparison from "./CountryComparisonDisasterType";
import CountryTimelineDiverging from "./CountryCompareTimelineDiverging";

const MIN_YEAR = 1900;
const MAX_YEAR = 2025;

type Props = {
  mapCountriesList: string[];
};

export default function CompareCountriesClient({mapCountriesList} : Props) {
  const [selectedDisasterTypes, setSelectedDisasterTypes] = useState<DisasterType[]>(
    () => [...DISASTER_TYPES]
  );

  const [selectedCountries, setSelectedCountries] = useState<CountriesType[]>(
    () => []
  );

  const [yearRange, setYearRange] = useState<[number, number]>([
    MIN_YEAR,
    MAX_YEAR,
  ]);

  const allDisasterSelected = selectedDisasterTypes.length === DISASTER_TYPES.length;
  
  const [searchTerm, setSearchTerm] = useState<string>("");

function toggleCountry(type: CountriesType) {
  setSelectedCountries((prev) => {
    if (prev.includes(type)) {
      return prev.filter((t) => t !== type);
    }
    return [...prev, type];
  });
}

function toggleSelectAllCountries() {
  setSelectedCountries((prev) =>
    prev.length === 2 ? [] : [...mapCountriesList.slice(0, 2)]
  );
}

const filteredCountries = mapCountriesList.filter((country) =>
  country.toLowerCase().includes(searchTerm.toLowerCase())
);

const showCountryList = filteredCountries.length <= 20;

const displayedCountries = selectedCountries.concat(
  showCountryList 
    ? filteredCountries.filter((country) => !selectedCountries.includes(country)) 
    : []
);

const handleCountrySelect = (country: CountriesType) => {
  if (selectedCountries.length < 2 || selectedCountries.includes(country)) {
    toggleCountry(country);
  }
};

  function toggleDisasterType(type: DisasterType) {
    setSelectedDisasterTypes((prev) => {
      if (prev.includes(type)) {
        return prev.filter((t) => t !== type);
      }
      return [...prev, type];
    });
  }

  function toggleSelectAllDisasters() {
    setSelectedDisasterTypes((prev) =>
      prev.length === DISASTER_TYPES.length ? [] : [...DISASTER_TYPES]
    );
  }


  function updateStartYear(value: number) {
    setYearRange(([_, end]) => {
      const clamped = Math.max(MIN_YEAR, Math.min(value, end));
      return [clamped, end];
    });
  }

  function updateEndYear(value: number) {
    setYearRange(([start, _]) => {
      const clamped = Math.min(MAX_YEAR, Math.max(value, start));
      return [start, clamped];
    });
  }

  return (
    <section
      aria-label="Compare countries"
      className="mt-8 rounded-2xl border border-slate-100 bg-slate-50 p-6 shadow-inner text-left"
    >
      <p className="text-slate-500 text-sm mb-4">
        D3 visualizations for comparing countries live here.
      </p>

      {/* Filters */}
      <div className="mb-6 space-y-4">
        
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
          {/* Country filter */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-800">Countries</h2>
              <button
                type="button"
                onClick={() => setSelectedCountries([])} // Clear selection
                className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2"
              >
                {selectedCountries.length === 2 ? "Clear all" : "Select two countries"}
              </button>
            </div>

            <input
              type="text"
              placeholder="Search countries..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="mb-2 border rounded px-2 py-1"
            />

            {displayedCountries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {displayedCountries.map((type) => {
                  const selected = selectedCountries.includes(type);
                  return (
                    <label
                      key={type}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs cursor-pointer transition
                      ${
                        selected
                          ? "border-sky-500 bg-sky-50 text-sky-700"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
                      }`}
                      onClick={() => handleCountrySelect(type)}
                    >
                      <span>{type}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Disaster type filter */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-800">
                Disaster types
              </h2>
              <button
                type="button"
                onClick={toggleSelectAllDisasters}
                className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2"
              >
                {allDisasterSelected ? "Clear all" : "Select all"}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {DISASTER_TYPES.map((type) => {
                const checked = selectedDisasterTypes.includes(type);
                return (
                  <label
                    key={type}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs cursor-pointer transition 
                    ${
                      checked
                        ? "border-sky-500 bg-sky-50 text-sky-700"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3 w-3 accent-sky-500"
                      checked={checked}
                      onChange={() => toggleDisasterType(type)}
                    />
                    <span>{type}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Year range filter */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-800">
                Year range
              </h2>
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
                    className="w-full cursor-pointer"
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
                    className="w-full cursor-pointer"
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                Hover the slider handles to see the exact year. Data will be
                filtered to events between these years.
              </p>
            </div>
          </div>
        </div>

        {/* Current filters summary */}
        <p className="text-xs text-slate-500">
          Currently showing{" "}
          <span className="font-semibold">
            {selectedDisasterTypes.length || "0"} type
            {selectedDisasterTypes.length === 1 ? "" : "s"}
          </span>{" "}
          from{" "}
          <span className="font-semibold">
            {yearRange[0]}–{yearRange[1]}
          </span>
          .
        </p>
      </div>

      {/* Full-width visualizations, one per line */}
      <div className="space-y-6">
        <CountryComparison
          selectedCountries={selectedCountries}
          selectedTypes={selectedDisasterTypes}
          yearRange={yearRange}
        />

        <CountryTimelineDiverging
          selectedCountries={selectedCountries}
          selectedTypes={selectedDisasterTypes}
          yearRange={yearRange}
        />        
                    
        {/* future visualizations can stack below, each taking one full line */}
        {/* <AnotherVisualization ... /> */}
      </div>
    </section>
  );
}

"use client";
//export const metadata = { title: "World Map • Data Visualization Project" };

import Link from "next/link";
import WorldMap from "@/components/WorldMap";
import { use } from "react";

export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-6 text-center">
      <div className="max-w-3xl rounded-2xl bg-white p-10 shadow-xl border border-slate-100">
        <h1 className="text-4xl font-bold tracking-tight text-slate-800">
          World Map
        </h1>
        <p className="mt-4 text-slate-600 text-base">
          Interactive, responsive world map rendered with{" "}
          <span className="font-semibold text-slate-800">D3.js</span> and{" "}
          <span className="font-semibold text-slate-800">TopoJSON</span>.
        </p>

        <div className="mt-8 rounded-2xl border border-slate-100 bg-slate-50 p-6 shadow-inner">
          {/* <WorldMap /> */}
          <WorldMap
            dataUrl="data/countries-110m.json"
            objectName="countries" // change if your file uses another name (e.g., "units")
            onCountryClick={(props) => {
              // Example: wire to a router, side panel, or state
              console.log("Clicked:", props?.name ?? props?.ADMIN ?? props);
            }}
          />
        </div>

        <div className="mt-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-3 text-white text-sm font-medium hover:bg-slate-700 transition-all"
          >
            Back to Home
          </Link>
        </div>
      </div>

      <footer className="mt-10 text-sm text-slate-500">
        © {new Date().getFullYear()} Data Visualization Project
      </footer>
    </main>
  );
}

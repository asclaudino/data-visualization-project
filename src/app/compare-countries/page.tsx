import { mapCountriesList, type CountriesType } from "@/lib/utils/mapCountriesList";

import CompareCountriesClient from "../../components/CompareCountriesClient";

export const metadata = { title: "Compare Countries • Data Visualization Project" };

import Link from "next/link";
// import CompareCountries from "@/components/CompareCountries";

export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-6 text-center">
      <div className="max-w-3xl rounded-2xl bg-white p-10 shadow-xl border border-slate-100">
        <h1 className="text-4xl font-bold tracking-tight text-slate-800">
          Compare Countries
        </h1>
        {/* <p className="mt-4 text-slate-600 text-base">
          Select two countries and a metric —{" "}
          <span className="font-semibold text-slate-800">D3</span> will render a
          clean comparative visualization.
        </p> */}

        <div className="mt-8 rounded-2xl border border-slate-100 bg-slate-50 p-6 shadow-inner">
          <CompareCountriesClient mapCountriesList={mapCountriesList}/>
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

// app/countries/[countryId]/page.tsx
import Link from "next/link";
import CountryOverviewClient from "../../../components/CountryOverviewClient";
//import { mapCountriesList } from "@/lib/utils/mapCountriesList";

type CountryPageProps = {
  params: {
    countryName: string; // or countryName if your folder is [countryName]
  };
};

export default async function CountryPage({ params }: CountryPageProps) {
  const { countryName } = await params;
  const decodedName = decodeURIComponent(countryName);

  console.log("Rendering CountryPage for:", decodedName);
  //console.log("Available countries:", mapCountriesList);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-6 text-center">
      <div className="max-w-4xl rounded-2xl bg-white p-10 shadow-xl border border-slate-100">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="text-left">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-800">
              {decodedName}
            </h1>
            <p className="mt-2 text-slate-600 text-sm md:text-base">
              Detailed data visualizations and insights for this country.
            </p>
          </div>

          <Link
            href="/world-map"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-white text-sm font-medium hover:bg-slate-700 transition-all"
          >
            ← Back to World Map
          </Link>
        </div>

        {/* All D3 / interactive stuff goes into a client component */}
        <CountryOverviewClient countryId={decodedName} />
      </div>

      <footer className="mt-10 text-sm text-slate-500">
        © {new Date().getFullYear()} Data Visualization Project
      </footer>
    </main>
  );
}

// app/page.tsx
//import { ArrowRight } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-6 text-center">
      <div className="max-w-2xl rounded-2xl bg-white p-10 shadow-xl border border-slate-100">
        <h1 className="text-4xl font-bold tracking-tight text-slate-800">
          Data Visualization Project
        </h1>
        <p className="mt-4 text-slate-600">
          Explore powerful insights through interactive charts and intuitive design.
          Built with <span className="font-semibold text-slate-800">Next.js</span> and{" "}
          <span className="font-semibold text-slate-800">D3.js</span>.
        </p>

        <div className="mt-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-3 text-white text-sm font-medium hover:bg-slate-700 transition-all"
          >
            Go to Dashboard
            {/* <ArrowRight size={18} /> */}
          </Link>
        </div>
      </div>

      <footer className="mt-10 text-sm text-slate-500">
        © {new Date().getFullYear()} Data Visualization Project
      </footer>
    </main>
  );
}

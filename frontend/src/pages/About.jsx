import { Link } from "react-router-dom";
import { Compass, Layers, Server, ShieldCheck, ArrowRight } from "lucide-react";
import { TRICITY_LANDMARKS } from "../components/routing/mapConstants";

const TECH_STACK = [
  {
    layer: "Frontend",
    items: "React 19, Vite, Tailwind CSS, React Router, Leaflet & React-Leaflet, CARTO Basemaps",
  },
  {
    layer: "Backend API",
    items: "FastAPI, Pydantic v2, SQLAlchemy (async), Alembic, SQLite, Argon2id & JWT/CSRF auth",
  },
  {
    layer: "Geospatial & Routing",
    items: "OpenStreetMap Nominatim, OSRM Driving API, OSMnx & NetworkX GraphML road network",
  },
  {
    layer: "Machine Learning",
    items: "scikit-learn RandomForestClassifier trained on UCI Metro Interstate Traffic Volume",
  },
];

export default function About() {
  return (
    <div className="bg-slate-950 text-slate-100 py-14 md:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="max-w-3xl space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            About ITMS
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Intelligent Traffic Management System for Chandigarh Tricity
          </h1>
          <p className="text-base text-slate-300 leading-relaxed">
            ITMS is an urban mobility and traffic-engineering software platform
            designed to help commuters compare alternative driving corridors
            using road-network topology, signal delay modeling, and
            departure-time ML traffic context.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
            <Compass size={22} className="text-emerald-400" />
            <h2 className="text-base font-semibold text-white">
              Problem Addressed
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Conventional shortest-distance routing ignores signalized
              intersections and junction density, often sending drivers through
              stop-and-go urban grids instead of smoother arterial corridors.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
            <Layers size={22} className="text-cyan-400" />
            <h2 className="text-base font-semibold text-white">
              Project Objectives
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Combine open routing (OSRM), local road-graph topology (OSMnx),
              uniform signal-delay estimation, and transparent ML traffic
              classification inside an accessible, role-separated web product.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
            <ShieldCheck size={22} className="text-amber-400" />
            <h2 className="text-base font-semibold text-white">
              Engineering Approach
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Every metric distinguishes measured graph topology, OSRM baseline
              estimates, and historical ML predictions—avoiding fabricated live
              traffic claims and degrading gracefully on provider errors.
            </p>
          </div>
        </div>

        {/* Coverage & Stack */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8 space-y-4">
            <h2 className="text-xl font-bold text-white">
              Chandigarh Tricity Coverage
            </h2>
            <p className="text-sm text-slate-400">
              Bounded to 30.54°N–30.85°N and 76.59°E–76.93°E across seven key
              urban areas:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {TRICITY_LANDMARKS.map((area) => (
                <div
                  key={area.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"
                >
                  <p className="text-xs font-semibold text-white">{area.name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {area.subtitle}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8 space-y-4">
            <div className="flex items-center gap-2">
              <Server size={18} className="text-cyan-400" />
              <h2 className="text-xl font-bold text-white">Technology Stack</h2>
            </div>
            <div className="space-y-3 pt-1">
              {TECH_STACK.map((row) => (
                <div
                  key={row.layer}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                    {row.layer}
                  </p>
                  <p className="text-sm text-slate-300 mt-1">{row.items}</p>
                </div>
              ))}
            </div>
            <div className="pt-2">
              <Link
                to="/route-planner"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition"
              >
                <span>Open Route Planner</span>
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

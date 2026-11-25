import { Link } from "react-router-dom";
import {
  MapPin,
  Search,
  GitFork,
  Network,
  BarChart3,
  Cpu,
  Scale,
  Map,
  Info,
  ArrowRight,
} from "lucide-react";

const PIPELINE_STEPS = [
  {
    step: "01",
    title: "User Enters Origin, Destination & Departure Time",
    description:
      "You select a starting point, destination, and departure date/time within Chandigarh Tricity—either by searching or clicking directly on the map.",
    icon: MapPin,
  },
  {
    step: "02",
    title: "Nominatim Geocoding Resolves Locations",
    description:
      "The backend geocoding adapter resolves natural-language queries via OpenStreetMap Nominatim bounded to the Tricity viewbox, with LRU caching and boundary checks.",
    icon: Search,
  },
  {
    step: "03",
    title: "OSRM Generates Alternative Routes",
    description:
      "The routing service queries OSRM (/route/v1/driving) with alternatives enabled to retrieve 2–3 drivable candidate routes, GeoJSON geometries, and baseline durations.",
    icon: GitFork,
  },
  {
    step: "04",
    title: "OSMnx / NetworkX Road-Graph Analysis",
    description:
      "Each candidate polyline is matched against the local Chandigarh Tricity GraphML road network to count topological intersections and mapped highway=traffic_signals nodes.",
    icon: Network,
  },
  {
    step: "05",
    title: "Route Metrics & Uniform Signal Delay Evaluation",
    description:
      "The signal delay service estimates uniform random-arrival delay at mapped signalized junctions and combines it with OSRM baseline duration.",
    icon: BarChart3,
  },
  {
    step: "06",
    title: "Random Forest Supplies Departure-Time Traffic Context",
    description:
      "Using your departure hour, day, month, weekday, and weekend flag (plus nominal weather defaults), the trained Random Forest classifier predicts Low, Medium, or High traffic context.",
    icon: Cpu,
  },
  {
    step: "07",
    title: "Weighted Multi-Criteria Scoring Ranks Alternatives",
    description:
      "The deterministic route scorer normalizes metrics across candidate routes using the documented weights below to select the optimal rank-1 recommendation.",
    icon: Scale,
  },
  {
    step: "08",
    title: "Leaflet Visualizes Routes & Interactive Telemetry",
    description:
      "All candidate routes, markers, and signal nodes render on the interactive CARTO/Leaflet map with two-way selection synchronization and detailed explanations.",
    icon: Map,
  },
];

const SCORING_WEIGHTS = [
  { label: "Estimated Journey Duration (OSRM + signal delay)", weight: "60%" },
  { label: "Total Route Distance", weight: "20%" },
  { label: "Mapped Traffic Signal Count", weight: "10%" },
  { label: "Intersection Density (nodes/km)", weight: "10%" },
];

export default function HowItWorks() {
  return (
    <div className="bg-slate-950 text-slate-100 py-14 md:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-14">
        <div className="max-w-3xl space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
            System Pipeline
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            How ITMS Evaluates &amp; Recommends Routes
          </h1>
          <p className="text-base text-slate-400 leading-relaxed">
            An end-to-end look at the eight-stage pipeline connecting geocoding,
            OSRM routing, OSMnx graph analysis, ML temporal inference, and
            multi-criteria route scoring.
          </p>
        </div>

        {/* 8-Step Visual Workflow */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          {PIPELINE_STEPS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-emerald-400">
                    STAGE {item.step}
                  </span>
                  <div className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-cyan-400">
                    <Icon size={16} />
                  </div>
                </div>
                <h2 className="text-sm font-semibold text-white leading-snug">
                  {item.title}
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* Scoring Weights & ML Transparency */}
        <div
          id="ml-transparency"
          className="grid grid-cols-1 gap-8 lg:grid-cols-12"
        >
          <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8 space-y-5">
            <h2 className="text-xl font-bold text-white">
              Multi-Criteria Route Scoring Weights
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Candidate routes are ranked deterministically using min-max
              normalization across four measurable route criteria. Missing
              metrics are conservatively imputed rather than assumed zero.
            </p>
            <div className="space-y-3">
              {SCORING_WEIGHTS.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm"
                >
                  <span className="text-slate-300">{row.label}</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {row.weight}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6 rounded-2xl border border-blue-500/25 bg-blue-500/5 p-6 sm:p-8 space-y-4">
            <div className="flex items-center gap-2 text-blue-300 text-xs font-semibold uppercase tracking-wider">
              <Info size={15} />
              <span>ML Scope &amp; Scientific Limitations</span>
            </div>
            <h2 className="text-xl font-bold text-white">
              Role of the ML Model in Route Selection
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              The Random Forest model is trained on the{" "}
              <strong className="text-white">
                UCI Minnesota Metro Interstate Traffic Volume
              </strong>{" "}
              dataset using 11 temporal and weather features. It{" "}
              <strong className="text-white">
                does not directly determine the winning route
              </strong>{" "}
              and does not predict traffic on individual Chandigarh road
              segments.
            </p>
            <p className="text-sm text-slate-300 leading-relaxed">
              Instead, it provides shared departure-time congestion context
              (Low, Medium, or High), while the multi-criteria route scorer
              selects the optimal route from OSRM baseline times, mapped OSM
              signals, distance, and intersection density.
            </p>
            <div className="pt-2">
              <Link
                to="/route-planner"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition"
              >
                <span>Try the Route Planner</span>
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

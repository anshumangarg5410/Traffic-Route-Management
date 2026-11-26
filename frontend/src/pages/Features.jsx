import { Link } from "react-router-dom";
import {
  Route,
  GitFork,
  BarChart3,
  Cpu,
  TrafficCone,
  Activity,
  CarFront,
  Map,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

const FEATURE_MODULES = [
  {
    title: "Smart Route Planning",
    subtitle: "Bounded Chandigarh Tricity Geocoding",
    description:
      "Search addresses, sectors, and landmarks across Chandigarh, Mohali, Panchkula, Zirakpur, Kharar, New Chandigarh, and Dera Bassi using debounced Nominatim geocoding and coordinate snapping.",
    highlights: [
      "35×35 km Tricity bounding-box enforcement",
      "Direct map-click origin/destination selection",
      "One-click swap and quick regional hubs",
    ],
    icon: Route,
    accent: "text-emerald-600 bg-emerald-500/10 border-emerald-500/25",
  },
  {
    title: "Alternative Routes",
    subtitle: "OSRM Multi-Corridor Generation",
    description:
      "Queries the Open Source Routing Machine (OSRM) driving profile with full GeoJSON geometries and turn-by-turn steps to surface 2–3 candidate routes when available.",
    highlights: [
      "Full polyline geometry per candidate route",
      "Baseline free-flow distance and duration",
      "Graceful handling of single-route or disconnected pairs",
    ],
    icon: GitFork,
    accent: "text-cyan-400 bg-cyan-500/10 border-cyan-500/25",
  },
  {
    title: "Route Comparison",
    subtitle: "Weighted Multi-Criteria Scoring",
    description:
      "Evaluates every candidate route with min-max normalization across estimated journey duration (60%), distance (20%), mapped signal count (10%), and intersection density (10%).",
    highlights: [
      "Deterministic composite score (0–100 scale)",
      "Data-driven recommendation reasons and trade-offs",
      "Conservative imputation when partial metrics are missing",
    ],
    icon: BarChart3,
    accent: "text-blue-400 bg-blue-500/10 border-blue-500/25",
  },
  {
    title: "ML Traffic Context",
    subtitle: "Departure-Time Random Forest Inference",
    description:
      "Extracts temporal features from your chosen departure date and time under nominal weather assumptions to classify expected traffic tier (Low, Medium, High) with class probabilities.",
    highlights: [
      "Trained on UCI Metro Interstate Traffic Volume data",
      "Explicit provenance and non-sensor disclosure",
      "Graceful fallback if ML inference is unavailable",
    ],
    icon: Cpu,
    accent: "text-amber-600 bg-amber-500/10 border-amber-500/25",
  },
  {
    title: "Intersection Analysis",
    subtitle: "OSMnx / NetworkX Graph Matching",
    description:
      "Matches route polylines against the persisted Chandigarh Tricity GraphML road network to identify topological junctions, mapped traffic signals, and uniform signal delay.",
    highlights: [
      "Ordered sequence of matched intersections",
      "Per-signal uniform random-arrival delay modeling",
      "Interactive node inspection synced with the map",
    ],
    icon: TrafficCone,
    accent: "text-indigo-400 bg-indigo-500/10 border-indigo-500/25",
  },
  {
    title: "Signal Optimization",
    subtitle: "Adaptive Green-Time Allocation",
    description:
      "Calculates directional green-phase splits from north, south, east, and west approach vehicle counts to balance intersection throughput.",
    highlights: [
      "Proportional demand-driven phase timing",
      "Bounded minimum/maximum green constraints",
      "Interactive cycle timeline visualizer",
    ],
    icon: Activity,
    accent: "text-purple-400 bg-purple-500/10 border-purple-500/25",
  },
  {
    title: "Traffic Simulation",
    subtitle: "Multi-Run Poisson Queue Modeling",
    description:
      "Simulates multi-cycle directional vehicle arrivals and discharges to compare fixed-time versus adaptive signal control strategies.",
    highlights: [
      "Configurable arrival rates, lanes, and cycles",
      "Deterministic seeded reproducibility",
      "Validation and parameter sensitivity sweeps",
    ],
    icon: CarFront,
    accent: "text-rose-400 bg-rose-500/10 border-rose-500/25",
  },
  {
    title: "Map Visualization",
    subtitle: "Interactive Leaflet & CARTO Canvas",
    description:
      "Displays all alternative route geometries simultaneously with distinct color/dash styling, origin/destination markers, signal pins, and two-way card synchronization.",
    highlights: [
      "CARTO basemap tiles with OSM fallback",
      "Click-to-select synchronization between map and cards",
      "Responsive desktop, tablet, and mobile controls",
    ],
    icon: Map,
    accent: "text-teal-400 bg-teal-500/10 border-teal-500/25",
  },
];

export default function Features() {
  return (
    <div className="bg-slate-50 text-slate-900 py-14 md:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="max-w-3xl space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
            Platform Capabilities
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
            Features Built for Transparent Urban Mobility
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">
            Explore the implemented routing, road-network analysis, signal
            optimization, simulation, and ML context modules powering ITMS.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {FEATURE_MODULES.map((mod) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.title}
                className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 hover:border-slate-300 transition"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${mod.accent}`}
                  >
                    <Icon size={21} />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      {mod.title}
                    </h2>
                    <p className="text-xs font-medium text-slate-600">
                      {mod.subtitle}
                    </p>
                  </div>
                </div>

                <p className="text-sm text-slate-700 leading-relaxed">
                  {mod.description}
                </p>

                <ul className="space-y-1.5 pt-1">
                  {mod.highlights.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-xs text-slate-600"
                    >
                      <CheckCircle2
                        size={14}
                        className="shrink-0 mt-0.5 text-emerald-600"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Ready to test multi-criteria route planning?
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Launch the Chandigarh Tricity route planner directly in your
              browser.
            </p>
          </div>
          <Link
            to="/route-planner"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition shrink-0"
          >
            <span>Plan Your Journey</span>
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}

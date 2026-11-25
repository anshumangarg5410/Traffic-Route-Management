import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpDown,
  Clock,
  Compass,
  Cpu,
  GitFork,
  MapPin,
  Route,
  TrafficCone,
  AlertCircle,
  CarFront,
  Activity,
  Info,
} from "lucide-react";
import LocationSearchInput from "../components/routing/LocationSearchInput";
import { TRICITY_LANDMARKS } from "../components/routing/mapConstants";

function getDefaultDepartureLocalValue() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

const CORE_FEATURES = [
  {
    title: "Smart Route Planning",
    description:
      "Dynamic Nominatim geocoding bounded to Chandigarh Tricity with instant coordinate validation and map-click selection.",
    icon: Route,
    accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
  },
  {
    title: "Alternative Route Comparison",
    description:
      "Generates 2–3 drivable OSRM corridors and compares estimated duration, distance, signal exposure, and composite scores side by side.",
    icon: GitFork,
    accent: "text-cyan-400 bg-cyan-500/10 border-cyan-500/25",
  },
  {
    title: "ML Traffic Context",
    description:
      "Supplies departure-time traffic tier context (Low, Medium, High) from a Random Forest classifier trained on historical interstate data.",
    icon: Cpu,
    accent: "text-amber-400 bg-amber-500/10 border-amber-500/25",
  },
  {
    title: "Intersection & Signal Analysis",
    description:
      "Matches candidate routes against the local OSMnx/NetworkX road graph to count junctions, mapped signals, and uniform signal delay.",
    icon: TrafficCone,
    accent: "text-blue-400 bg-blue-500/10 border-blue-500/25",
  },
  {
    title: "Adaptive Signal Optimization",
    description:
      "Computes directional green-time allocations from approach vehicle counts to reduce intersection queue buildup.",
    icon: Activity,
    accent: "text-purple-400 bg-purple-500/10 border-purple-500/25",
  },
  {
    title: "Traffic Simulation",
    description:
      "Runs multi-run Poisson arrival simulations comparing fixed-time and adaptive signal control strategies across intersections.",
    icon: CarFront,
    accent: "text-rose-400 bg-rose-500/10 border-rose-500/25",
  },
];

/**
 * LandingPage
 * ===========
 * Public SaaS homepage for the Intelligent Traffic Management System (ITMS).
 */
export default function LandingPage() {
  const navigate = useNavigate();

  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceLocation, setSourceLocation] = useState(null);
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destinationLocation, setDestinationLocation] = useState(null);
  const [departureTime, setDepartureTime] = useState(getDefaultDepartureLocalValue);
  const [formError, setFormError] = useState(null);

  const handleSwap = () => {
    setFormError(null);
    const prevSrcQ = sourceQuery;
    const prevSrcLoc = sourceLocation;
    setSourceQuery(destinationQuery);
    setSourceLocation(destinationLocation);
    setDestinationQuery(prevSrcQ);
    setDestinationLocation(prevSrcLoc);
  };

  const handleQuickCorridor = (originLandmark, destLandmark) => {
    setFormError(null);
    setSourceLocation({
      displayName: `${originLandmark.name} (${originLandmark.subtitle})`,
      coordinates: originLandmark.coordinates,
      sourceType: "landmark",
    });
    setSourceQuery(`${originLandmark.name} (${originLandmark.subtitle})`);

    setDestinationLocation({
      displayName: `${destLandmark.name} (${destLandmark.subtitle})`,
      coordinates: destLandmark.coordinates,
      sourceType: "landmark",
    });
    setDestinationQuery(`${destLandmark.name} (${destLandmark.subtitle})`);
  };

  const handleSubmitPlan = (e) => {
    e.preventDefault();
    setFormError(null);

    if (!sourceLocation?.coordinates) {
      setFormError(
        "Please select a valid starting location within Chandigarh Tricity from the suggestions."
      );
      return;
    }
    if (!destinationLocation?.coordinates) {
      setFormError(
        "Please select a valid destination within Chandigarh Tricity from the suggestions."
      );
      return;
    }
    if (
      sourceLocation.coordinates[0] === destinationLocation.coordinates[0] &&
      sourceLocation.coordinates[1] === destinationLocation.coordinates[1]
    ) {
      setFormError("Origin and destination cannot be the exact same location.");
      return;
    }

    navigate("/route-planner", {
      state: {
        sourceLocation,
        sourceQuery,
        destinationLocation,
        destinationQuery,
        departureTime,
        autoSearch: true,
      },
    });
  };

  return (
    <div className="bg-slate-950 text-slate-100">
      {/* 1. Hero Section */}
      <section className="border-b border-slate-800/80 bg-gradient-to-b from-slate-900/60 to-slate-950 py-12 md:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                <Compass size={13} />
                <span>Chandigarh Tricity • Urban Mobility Platform</span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
                Navigate Smarter. Move Better.
              </h1>

              <p className="text-base text-slate-300 leading-relaxed max-w-xl">
                Plan smarter journeys across Chandigarh Tricity with intelligent
                route optimization, interactive maps and ML-informed traffic
                insights.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  to="/route-planner"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition shadow-sm"
                >
                  <span>Plan Your Journey</span>
                  <ArrowRight size={16} />
                </Link>
                <Link
                  to="/features"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800 transition"
                >
                  <span>Explore Features</span>
                </Link>
              </div>
            </div>

            {/* Interactive Journey Launcher Card */}
            <div className="lg:col-span-6">
              <form
                onSubmit={handleSubmitPlan}
                className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-2xl space-y-4"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-base font-semibold text-white">
                      Plan a Tricity Journey
                    </h2>
                    <p className="text-xs text-slate-400">
                      Enter origin, destination, and departure time
                    </p>
                  </div>
                  <span className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-mono text-slate-300">
                    Tricity BBox
                  </span>
                </div>

                {formError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
                  >
                    <AlertCircle size={15} className="shrink-0 mt-0.5 text-rose-400" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="space-y-3">
                  <LocationSearchInput
                    label="Starting Location"
                    badgeLetter="A"
                    badgeColor="emerald"
                    query={sourceQuery}
                    selectedLocation={sourceLocation}
                    onChangeQuery={(val) => {
                      setSourceQuery(val);
                      setFormError(null);
                    }}
                    onSelectLocation={(loc) => {
                      setSourceLocation(loc);
                      setFormError(null);
                    }}
                    onClearLocation={() => {
                      setSourceLocation(null);
                      setFormError(null);
                    }}
                    onPickOnMap={() =>
                      navigate("/route-planner", {
                        state: {
                          sourceLocation,
                          sourceQuery,
                          destinationLocation,
                          destinationQuery,
                          departureTime,
                        },
                      })
                    }
                    placeholder="e.g., Sector 17 Chandigarh, Mohali..."
                  />

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleSwap}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-400 hover:border-slate-700 hover:text-white transition"
                    >
                      <ArrowUpDown size={13} />
                      <span>Swap</span>
                    </button>
                  </div>

                  <LocationSearchInput
                    label="Destination"
                    badgeLetter="B"
                    badgeColor="rose"
                    query={destinationQuery}
                    selectedLocation={destinationLocation}
                    onChangeQuery={(val) => {
                      setDestinationQuery(val);
                      setFormError(null);
                    }}
                    onSelectLocation={(loc) => {
                      setDestinationLocation(loc);
                      setFormError(null);
                    }}
                    onClearLocation={() => {
                      setDestinationLocation(null);
                      setFormError(null);
                    }}
                    onPickOnMap={() =>
                      navigate("/route-planner", {
                        state: {
                          sourceLocation,
                          sourceQuery,
                          destinationLocation,
                          destinationQuery,
                          departureTime,
                        },
                      })
                    }
                    placeholder="e.g., Panchkula, Zirakpur, Kharar..."
                  />

                  <div className="space-y-1.5 pt-1">
                    <label
                      htmlFor="landing-departure-time"
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-300"
                    >
                      <Clock size={13} className="text-cyan-400" />
                      <span>Departure Date &amp; Time</span>
                    </label>
                    <input
                      id="landing-departure-time"
                      type="datetime-local"
                      value={departureTime}
                      onChange={(e) => setDepartureTime(e.target.value)}
                      className="w-full rounded-xl border border-slate-700/80 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                  <span className="text-slate-400 mr-1">Quick corridors:</span>
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickCorridor(TRICITY_LANDMARKS[0], TRICITY_LANDMARKS[1])
                    }
                    className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-slate-300 hover:border-slate-700 hover:text-white transition"
                  >
                    Chandigarh → Mohali
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickCorridor(TRICITY_LANDMARKS[0], TRICITY_LANDMARKS[2])
                    }
                    className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-slate-300 hover:border-slate-700 hover:text-white transition"
                  >
                    Chandigarh → Panchkula
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickCorridor(TRICITY_LANDMARKS[3], TRICITY_LANDMARKS[4])
                    }
                    className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-slate-300 hover:border-slate-700 hover:text-white transition"
                  >
                    Zirakpur → Kharar
                  </button>
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition shadow-md"
                >
                  <Route size={16} />
                  <span>Plan Your Journey</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Geographic Coverage Section */}
      <section className="border-b border-slate-800/80 py-12 bg-slate-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Regional Road Network Scope
              </p>
              <h2 className="mt-1 text-xl font-bold text-white">
                Built Specifically for Chandigarh Tricity
              </h2>
              <p className="mt-1.5 text-sm text-slate-400">
                All geocoding, road-network topology, and route analysis operate
                within the 35×35 km Tricity bounding box covering seven urban
                centers.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {TRICITY_LANDMARKS.map((area) => (
                <div
                  key={area.id}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-2"
                >
                  <MapPin size={13} className="text-emerald-400 shrink-0" />
                  <p className="text-xs font-semibold text-white whitespace-nowrap">
                    {area.name.replace(" (SAS Nagar)", "")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 3. Core Features Section */}
      <section className="border-b border-slate-800/80 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-10">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold text-white">
                Core Platform Capabilities
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Every capability in ITMS is backed by implemented routing,
                graph-analysis, signal-optimization, and ML modules.
              </p>
            </div>
            <Link
              to="/features"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition"
            >
              <span>View all features</span>
              <ArrowRight size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {CORE_FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3 hover:border-slate-700 transition"
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-xl border ${feature.accent}`}
                  >
                    <Icon size={20} />
                  </div>
                  <h3 className="text-base font-semibold text-white">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 4. How It Works Preview */}
      <section className="border-b border-slate-800/80 py-16 bg-slate-900/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-10">
            <div>
              <h2 className="text-2xl font-bold text-white">How It Works</h2>
              <p className="mt-2 text-sm text-slate-400">
                From address lookup to multi-criteria corridor ranking in three
                steps.
              </p>
            </div>
            <Link
              to="/how-it-works"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition"
            >
              <span>See Full Architecture</span>
              <ArrowRight size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 space-y-2">
              <span className="text-xs font-mono font-bold text-emerald-400">
                STEP 01
              </span>
              <h3 className="text-base font-semibold text-white">
                Enter your journey
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Search origin and destination across Chandigarh Tricity using
                Nominatim geocoding or click directly on the map, then choose
                your departure time.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 space-y-2">
              <span className="text-xs font-mono font-bold text-cyan-400">
                STEP 02
              </span>
              <h3 className="text-base font-semibold text-white">
                Analyze alternative routes
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                OSRM retrieves alternative driving paths while our OSMnx graph
                counts mapped signals and intersections and our ML model supplies
                departure-time context.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 space-y-2">
              <span className="text-xs font-mono font-bold text-amber-400">
                STEP 03
              </span>
              <h3 className="text-base font-semibold text-white">
                Compare and select your preferred route
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Review ranked route cards, inspect signal breakdowns on the
                interactive map, and optionally bookmark corridors in your
                workspace.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. ML Transparency Section */}
      <section className="border-b border-slate-800/80 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <Info size={20} className="shrink-0 mt-0.5 text-blue-400" />
              <div className="space-y-3">
                <h2 className="text-xl font-bold text-white">
                  ML Model &amp; Routing Transparency
                </h2>
                <p className="text-sm text-slate-300 leading-relaxed max-w-3xl">
                  ITMS integrates a Random Forest classifier trained on the
                  historical{" "}
                  <strong className="text-white">
                    UCI Minnesota Metro Interstate Traffic Volume
                  </strong>{" "}
                  dataset. We present predictions honestly without fabricating
                  local sensor feeds:
                </p>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs text-slate-300 pt-1">
                  <li className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    • Predicts <strong className="text-white">departure-time traffic context</strong> (Low / Medium / High) from temporal &amp; nominal weather inputs.
                  </li>
                  <li className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    • <strong className="text-white">Does not use live Chandigarh sensor data</strong> or claim corridor-specific ML validation.
                  </li>
                  <li className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    • <strong className="text-white">OSRM route duration is a baseline estimate</strong>, augmented by modeled uniform signal delay.
                  </li>
                  <li className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    • Route recommendation uses{" "}
                    <strong className="text-white">
                      multi-criteria optimization
                    </strong>{" "}
                    (60% duration, 20% distance, 10% signals, 10% density).
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Final CTA */}
      <section className="py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            Your next journey starts here.
          </h2>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            Compare Chandigarh Tricity driving routes on an interactive map with
            signal topology and departure-time traffic context—no account
            required.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Link
              to="/route-planner"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition shadow-md"
            >
              <span>Plan Your Journey</span>
              <ArrowRight size={16} />
            </Link>
            <Link
              to="/register"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-6 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800 transition"
            >
              <span>Create Free Account</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

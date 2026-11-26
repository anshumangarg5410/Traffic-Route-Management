import { useState } from "react";
import {
  Sparkles,
  Info,
  Scale,
  Clock,
  MapPin,
  Compass,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Sliders,
} from "lucide-react";

/**
 * RecommendationExplanationPanel Component
 * ========================================
 * Phase 10.4: Deep-dive explanation of the backend route scoring engine,
 * transparent scoring weight breakdown, and methodological engineering notices.
 */
export default function RecommendationExplanationPanel({
  recommendation,
  recommendedRoute,
  mlPrediction = null,
}) {
  const [isLimitationsExpanded, setIsLimitationsExpanded] = useState(false);

  if (!recommendation && !recommendedRoute) return null;

  const weights = recommendation?.scoring_weights || {
    estimated_duration: 0.60,
    distance: 0.20,
    signal_count: 0.10,
    intersection_density: 0.10,
  };

  const rankingMethod = recommendation?.ranking_method || "Weighted Multi-Criteria Evaluation";
  const summaryNarrative = recommendation?.recommendation_summary || recommendedRoute?.recommendation_reasons?.[0] || "";
  const compositeScore = recommendedRoute?.score != null ? recommendedRoute.score : null;
  const reasons = Array.isArray(recommendedRoute?.recommendation_reasons)
    ? recommendedRoute.recommendation_reasons
    : [];

  const normalizedScores = recommendedRoute?.score_details?.metric_normalized_scores || null;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl backdrop-blur-sm">
      {/* Panel Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-600 border border-emerald-500/20">
            <Scale size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Recommendation Engine Analysis
            </h3>
            <p className="text-[11px] text-slate-600">
              Method: <span className="font-mono text-slate-700">{rankingMethod}</span>
            </p>
          </div>
        </div>

        {compositeScore != null && (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-600 uppercase font-semibold">
              Top Score
            </span>
            <span className="text-base font-bold font-mono text-emerald-600">
              {(compositeScore * 100).toFixed(1)} / 100
            </span>
          </div>
        )}
      </div>

      {/* Summary Narrative */}
      {summaryNarrative && (
        <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
          <p className="text-xs font-medium text-slate-800 leading-relaxed">
            {summaryNarrative}
          </p>
        </div>
      )}

      {/* Educational Methodological Disclaimer */}
      <div className="flex items-start gap-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-blue-300">
        <Info size={16} className="shrink-0 mt-0.5 text-blue-400" />
        <div className="space-y-1">
          <p className="font-semibold text-blue-200">
            About the Multi-Criteria Score
          </p>
          <p className="text-[11px] text-blue-300/90 leading-relaxed">
            The composite route score is a min-max normalized weighted index evaluating journey duration, distance, signal count, and intersection density. It is an engineering comparison metric, <strong>not</strong> an arrival probability or a live congestion prediction.
          </p>
        </div>
      </div>

      {/* ML Departure Traffic Context & Provenance */}
      {mlPrediction && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800">
              ML Temporal Traffic Context
            </span>
            <span className="font-mono text-[10px] text-slate-600">
              {mlPrediction.status === "available"
                ? `${mlPrediction.predicted_traffic_level} (${mlPrediction.departure_time_iso})`
                : "Unavailable"}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {mlPrediction.status === "available"
              ? mlPrediction.limitation_note
              : mlPrediction.error_message}
          </p>
        </div>
      )}

      {/* Configurable Evaluation Weights */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
          <div className="flex items-center gap-1.5">
            <Sliders size={13} className="text-purple-400" />
            <span>Evaluation Criteria & Weights</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">Sum = 100%</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          {/* Estimated Duration Weight */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-600 flex items-center gap-1">
                <Clock size={11} className="text-blue-400" />
                <span>Est. Duration</span>
              </span>
              <span className="font-mono font-bold text-slate-900 text-xs">
                {(weights.estimated_duration * 100).toFixed(0)}%
              </span>
            </div>
            {normalizedScores?.estimated_duration != null && (
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>Norm Score:</span>
                <span className="text-emerald-600 font-semibold">
                  {(normalizedScores.estimated_duration * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </div>

          {/* Route Distance Weight */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-600 flex items-center gap-1">
                <MapPin size={11} className="text-purple-400" />
                <span>Distance</span>
              </span>
              <span className="font-mono font-bold text-slate-900 text-xs">
                {(weights.distance * 100).toFixed(0)}%
              </span>
            </div>
            {normalizedScores?.distance != null && (
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>Norm Score:</span>
                <span className="text-emerald-600 font-semibold">
                  {(normalizedScores.distance * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </div>

          {/* Signal Count Weight */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-600 flex items-center gap-1">
                <span className="text-xs">🚦</span>
                <span>Signal Count</span>
              </span>
              <span className="font-mono font-bold text-slate-900 text-xs">
                {(weights.signal_count * 100).toFixed(0)}%
              </span>
            </div>
            {normalizedScores?.signal_count != null && (
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>Norm Score:</span>
                <span className="text-emerald-600 font-semibold">
                  {(normalizedScores.signal_count * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </div>

          {/* Intersection Density Weight */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-600 flex items-center gap-1">
                <Compass size={11} className="text-amber-600" />
                <span>Density</span>
              </span>
              <span className="font-mono font-bold text-slate-900 text-xs">
                {(weights.intersection_density * 100).toFixed(0)}%
              </span>
            </div>
            {normalizedScores?.intersection_density != null && (
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>Norm Score:</span>
                <span className="text-emerald-600 font-semibold">
                  {(normalizedScores.intersection_density * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recommendation Reasons */}
      {reasons.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-slate-200">
          <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
            <Sparkles size={13} className="text-emerald-600" />
            <span>Why This Route is Recommended:</span>
          </p>
          <ul className="space-y-1.5 text-xs text-slate-700">
            {reasons.map((reason, idx) => (
              <li key={idx} className="flex items-start gap-2 bg-slate-50/40 p-2 rounded-lg">
                <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-emerald-600" />
                <span className="leading-relaxed">{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Collapsible Model Assumptions & Engineering Limitations */}
      <div className="pt-2 border-t border-slate-200">
        <button
          type="button"
          onClick={() => setIsLimitationsExpanded(!isLimitationsExpanded)}
          className="flex w-full items-center justify-between rounded-xl bg-slate-50 p-2.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-600" />
            <span>Signal Modeling Assumptions & Limitations</span>
          </div>
          <span className="text-slate-500">
            {isLimitationsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>

        {isLimitationsExpanded && (
          <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 border border-slate-200">
            <p className="font-semibold text-slate-800">
              Delay Modeling Formulation:
            </p>
            <p className="leading-relaxed">
              Signal delays are estimated using a uniform-random-arrival delay approximation (the first term of traffic queueing delay formulations):
              <br />
              <code className="text-emerald-600 font-mono">d = R² / (2 · C)</code>
              <br />
              Standard uncalibrated regional baseline assumes Cycle length <code className="text-slate-700">C = 90.0s</code> and Effective red time <code className="text-slate-700">R = 60.0s</code>, yielding <code className="text-emerald-600">~20.0s</code> uniform delay per signalized encounter. Configurable regional profiles support major arterials (<code className="text-slate-700">C=120s, R=75s &rarr; ~23.4s</code>) and minor collectors (<code className="text-slate-700">C=60s, R=35s &rarr; ~10.2s</code>).
            </p>
            <p className="font-semibold text-slate-800 pt-1">
              Methodological Disclaimers:
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-600 leading-relaxed">
              <li>
                <strong>OSM Signal Completeness:</strong> OpenStreetMap mapping is incomplete. The 26 mapped traffic signals in the road graph represent tagged signals, not the entirety of physical signal controllers in Chandigarh Tricity.
              </li>
              <li>
                <strong>Fixed Timing Assumptions:</strong> Signal timings reflect nominal engineering baseline profiles, not verified real-time adaptive controller SCADA telemetry.
              </li>
              <li>
                <strong>Absence of OSM Signal Tags:</strong> OpenStreetMap mapping is incomplete. Absence of a <code className="text-amber-700">highway=traffic_signals</code> tag does not establish the absence of an operational physical traffic signal. Individual delay is not modeled for intersections without mapped signal data.
              </li>
              <li>
                <strong>Live Traffic Conditions:</strong> Estimates reflect free-flow baseline travel times plus uniform signal exposure; they do not incorporate live GPS probe speeds or incident reports.
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

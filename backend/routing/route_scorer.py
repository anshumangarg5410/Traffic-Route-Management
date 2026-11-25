"""
Route Scoring and Recommendation Engine
=======================================

Phase 9.5: Intelligent Route Scoring and Recommendation Engine.

Evaluates candidate driving routes across Chandigarh Tricity based on:
1. Estimated journey duration (baseline OSRM + estimated signal delay) [Weight: 60%]
2. Route distance [Weight: 20%]
3. Mapped signalized intersection count [Weight: 10%]
4. Intersection density (intersections per km) [Weight: 10%]

Key Engineering Principles:
- Pure Python service independent of FastAPI, fully testable in isolation.
- Scientifically defensible duration comparability: prevents comparing free-flow baseline
  directly against signal-delayed durations without imputation or qualification.
- Min-max normalization where lower is better (norm = (max - val) / (max - min)).
- Neutral normalized score (1.0) when all candidate routes have identical metric values.
- Full 64-bit IEEE 754 precision ranking: no premature rounding in sort keys.
- Deterministic multi-tier tie-breaking:
    1. Composite score descending
    2. Estimated journey duration ascending
    3. Route distance ascending
    4. Original candidate sequence index
- Data-driven, grounded recommendation explanations: avoids false claims when metrics are missing.
- Robust numerical validation: rejects non-positive, non-finite, NaN, and Inf values.
"""

import math
from typing import Dict, Any, List, Optional, Tuple

from backend.routing.config import (
    DEFAULT_SCORING_WEIGHTS,
    DEFAULT_SIGNAL_CYCLE_LENGTH_S,
    DEFAULT_SIGNAL_EFFECTIVE_RED_S,
    validate_scoring_weights,
)
from backend.routing.models import (
    RouteResult,
    ScoredRouteSummary,
    RouteRecommendationResponse,
)


def normalize_metric(values: List[float], lower_is_better: bool = True) -> List[float]:
    """
    Perform min-max normalization across a list of numeric values.

    Parameters
    ----------
    values : List[float]
        Numeric values across candidate routes.
    lower_is_better : bool, default=True
        If True, minimum value maps to 1.0 (best) and maximum maps to 0.0 (worst):
            norm = (max - val) / (max - min)
        If False, maximum value maps to 1.0 (best) and minimum maps to 0.0 (worst):
            norm = (val - min) / (max - min)

    Returns
    -------
    List[float]
        Normalized values in [0.0, 1.0].
        If all values are identical (or single route), returns [1.0] * len(values)
        as a neutral optimal score so no route is penalized.
    """
    if not values:
        return []

    for idx, v in enumerate(values):
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            raise ValueError(f"Cannot normalize non-numeric value at index {idx}: {v}")
        if math.isnan(v) or math.isinf(v):
            raise ValueError(f"Cannot normalize non-finite value at index {idx}: {v}")

    min_val = min(values)
    max_val = max(values)
    val_range = max_val - min_val

    # Equal values across all routes -> assign neutral optimal score 1.0 to all
    if math.isclose(val_range, 0.0, abs_tol=1e-9):
        return [1.0] * len(values)

    if lower_is_better:
        return [round((max_val - v) / val_range, 8) for v in values]
    else:
        return [round((v - min_val) / val_range, 8) for v in values]


def _validate_route_inputs(routes: List[RouteResult]) -> None:
    """
    Validate route candidate inputs for numerical sanity and physical bounds.
    """
    for idx, r in enumerate(routes):
        if not isinstance(r, RouteResult):
            raise TypeError(f"Route item at index {idx} must be a RouteResult instance, got {type(r).__name__}.")

        # Distance check
        if not isinstance(r.distance_m, (int, float)) or isinstance(r.distance_m, bool):
            raise ValueError(f"Route '{r.route_id}' distance_m must be numeric.")
        if math.isnan(r.distance_m) or math.isinf(r.distance_m) or r.distance_m <= 0.0:
            raise ValueError(f"Route '{r.route_id}' has invalid distance_m ({r.distance_m}): must be a finite positive number.")

        # Baseline duration check
        if not isinstance(r.duration_s, (int, float)) or isinstance(r.duration_s, bool):
            raise ValueError(f"Route '{r.route_id}' duration_s must be numeric.")
        if math.isnan(r.duration_s) or math.isinf(r.duration_s) or r.duration_s <= 0.0:
            raise ValueError(f"Route '{r.route_id}' has invalid duration_s ({r.duration_s}): must be a finite positive number.")

        # Signal delay summary check if present
        if r.signal_delay_summary is not None:
            s = r.signal_delay_summary
            if math.isnan(s.total_estimated_signal_delay_s) or math.isinf(s.total_estimated_signal_delay_s) or s.total_estimated_signal_delay_s < 0.0:
                raise ValueError(f"Route '{r.route_id}' has invalid total_estimated_signal_delay_s: {s.total_estimated_signal_delay_s}")
            if math.isnan(s.estimated_duration_s) or math.isinf(s.estimated_duration_s) or s.estimated_duration_s <= 0.0:
                raise ValueError(f"Route '{r.route_id}' has invalid estimated_duration_s: {s.estimated_duration_s}")


def _extract_metric_values(
    routes: List[RouteResult],
) -> Tuple[List[Dict[str, Any]], List[str], bool]:
    """
    Extract metric values from candidate routes and apply scientifically defensible
    duration comparability and imputation rules.

    Returns
    -------
    Tuple[List[Dict[str, Any]], List[str], bool]
        Extracted raw metrics list, warnings list, and is_degraded flag.
    """
    extracted: List[Dict[str, Any]] = []
    warnings: List[str] = []
    is_degraded = False

    # First pass: collect raw data and determine availability status per route
    for r in routes:
        data: Dict[str, Any] = {
            "route_id": r.route_id,
            "route_ref": r,
            "baseline_duration_s": float(r.duration_s),
            "distance_m": float(r.distance_m),
            "distance_km": float(r.distance_km),
            "signal_delay_available": False,
            "intersection_analysis_available": False,
            "is_delay_imputed": False,
            "signal_count": None,
            "intersection_count": None,
            "intersection_density_per_km": None,
            "total_estimated_signal_delay_s": 0.0,
            "estimated_duration_s": float(r.duration_s),
            "estimated_duration_min": float(r.duration_min),
        }

        # Check intersection analysis availability
        if (
            r.intersection_analysis is not None
            and getattr(r.intersection_analysis, "analysis_status", "") in ("success", "no_intersections_matched")
        ):
            data["intersection_analysis_available"] = True
            data["intersection_count"] = int(r.intersection_analysis.total_intersection_nodes)
            data["intersection_density_per_km"] = float(r.intersection_analysis.intersection_density_per_km)
            data["signal_count"] = int(r.intersection_analysis.signalized_intersection_nodes)
        else:
            is_degraded = True
            warnings.append(
                f"Intersection analysis unavailable for route '{r.route_id}'."
            )

        # Check signal delay availability
        if (
            r.signal_delay_summary is not None
            and getattr(r.signal_delay_summary, "analysis_status", "") in ("success", "no_signals_matched")
            and r.signal_delay_summary.estimated_duration_s > 0
        ):
            data["signal_delay_available"] = True
            data["estimated_duration_s"] = float(r.signal_delay_summary.estimated_duration_s)
            data["estimated_duration_min"] = float(r.signal_delay_summary.estimated_duration_min)
            data["total_estimated_signal_delay_s"] = float(r.signal_delay_summary.total_estimated_signal_delay_s)
            if data["signal_count"] is None:
                data["signal_count"] = int(r.signal_delay_summary.signal_count)
        else:
            is_degraded = True
            warnings.append(
                f"Estimated signal delay unavailable for route '{r.route_id}'."
            )

        extracted.append(data)

    # Second pass: Missing intersection & signal count imputation
    known_signals = [d["signal_count"] for d in extracted if d["signal_count"] is not None]
    known_densities = [d["intersection_density_per_km"] for d in extracted if d["intersection_density_per_km"] is not None]
    known_intersections = [d["intersection_count"] for d in extracted if d["intersection_count"] is not None]

    if not known_signals:
        # All routes lack intersection analysis
        for d in extracted:
            d["signal_count"] = 0
            d["intersection_count"] = 0
            d["intersection_density_per_km"] = 0.0
        warnings.append(
            "Intersection and signal analyses are unavailable across all candidate routes; "
            "signal count and density metrics are neutralized in evaluation."
        )
    else:
        # Partial missing: conservatively impute using maximum of known routes to avoid unearned bonus
        fallback_signals = max(known_signals)
        fallback_density = max(known_densities)
        fallback_intersections = max(known_intersections)
        for d in extracted:
            imputed_any = False
            if d["signal_count"] is None:
                d["signal_count"] = fallback_signals
                imputed_any = True
            if d["intersection_count"] is None:
                d["intersection_count"] = fallback_intersections
                imputed_any = True
            if d["intersection_density_per_km"] is None:
                d["intersection_density_per_km"] = fallback_density
                imputed_any = True

            if imputed_any:
                warnings.append(
                    f"Route '{d['route_id']}' missing intersection metrics; conservatively assigned "
                    f"{fallback_signals} signals ({fallback_density}/km) based on candidate alternatives."
                )

    # Third pass: Duration comparability and signal delay imputation
    valid_delay_routes = [d for d in extracted if d["signal_delay_available"]]
    missing_delay_routes = [d for d in extracted if not d["signal_delay_available"]]

    if missing_delay_routes:
        if not valid_delay_routes:
            # Case A: ALL routes lack signal delay -> evaluate purely on baseline duration
            warnings.append(
                "Signal delay estimation is unavailable across all candidate routes; "
                "journey duration evaluated on free-flow baseline only."
            )
            for d in extracted:
                d["estimated_duration_s"] = d["baseline_duration_s"]
                d["estimated_duration_min"] = round(d["baseline_duration_s"] / 60.0, 2)
        else:
            # Case B: MIXED availability -> impute signal delay on missing routes
            # to prevent unfair comparison of baseline vs (baseline + delay)
            default_delay_per_signal = (DEFAULT_SIGNAL_EFFECTIVE_RED_S ** 2) / (2.0 * DEFAULT_SIGNAL_CYCLE_LENGTH_S)

            total_valid_delay = sum(v["total_estimated_signal_delay_s"] for v in valid_delay_routes)
            total_valid_km = sum(v["distance_km"] for v in valid_delay_routes)
            peer_delay_rate_per_km = (total_valid_delay / total_valid_km) if total_valid_km > 0 else 0.0

            for d in missing_delay_routes:
                if d["intersection_analysis_available"] and d["signal_count"] is not None and d["signal_count"] > 0:
                    imputed_delay = float(d["signal_count"]) * default_delay_per_signal
                    d["total_estimated_signal_delay_s"] = imputed_delay
                    d["estimated_duration_s"] = d["baseline_duration_s"] + imputed_delay
                    d["estimated_duration_min"] = round(d["estimated_duration_s"] / 60.0, 2)
                    d["is_delay_imputed"] = True
                    warnings.append(
                        f"Estimated signal delay for route '{d['route_id']}' was imputed ({round(imputed_delay, 1)}s "
                        f"across {d['signal_count']} signals) using default timing parameters to maintain equitable duration comparability."
                    )
                else:
                    imputed_delay = d["distance_km"] * peer_delay_rate_per_km
                    d["total_estimated_signal_delay_s"] = imputed_delay
                    d["estimated_duration_s"] = d["baseline_duration_s"] + imputed_delay
                    d["estimated_duration_min"] = round(d["estimated_duration_s"] / 60.0, 2)
                    d["is_delay_imputed"] = True
                    warnings.append(
                        f"Estimated signal delay for route '{d['route_id']}' was imputed using peer average delay rate "
                        f"({round(peer_delay_rate_per_km, 2)} s/km, {round(imputed_delay, 1)}s total) to prevent unearned advantage over analyzed alternatives."
                    )

    return extracted, warnings, is_degraded


def _generate_recommendation_reasons(
    rec: ScoredRouteSummary,
    all_scored: List[ScoredRouteSummary],
    rec_raw: Dict[str, Any],
) -> List[str]:
    """
    Generate data-driven reasons explaining why a route was recommended over alternatives.
    """
    reasons: List[str] = []
    others = [r for r in all_scored if r.route_id != rec.route_id]

    if not others:
        return ["Only candidate route available from routing provider; recommended by default."]

    # 1. Duration comparison
    durations = [o.estimated_duration_min for o in others]
    min_other_dur = min(durations)
    dur_diff = min_other_dur - rec.estimated_duration_min

    if dur_diff > 0.05:
        reasons.append(
            f"Lowest estimated journey duration ({round(rec.estimated_duration_min, 1)} min, {round(dur_diff, 1)} min faster than next alternative)."
        )
    elif math.isclose(rec.estimated_duration_min, min_other_dur, abs_tol=0.05):
        reasons.append(
            f"Tied for lowest estimated journey duration ({round(rec.estimated_duration_min, 1)} min)."
        )
    else:
        reasons.append(
            f"Competitive journey duration ({round(rec.estimated_duration_min, 1)} min) with superior trade-offs in distance and signal exposure."
        )

    # 2. Distance comparison
    distances = [o.distance_km for o in others]
    min_other_dist = min(distances)
    dist_diff = min_other_dist - rec.distance_km

    if dist_diff > 0.05:
        reasons.append(
            f"Shortest route distance ({round(rec.distance_km, 2)} km, {round(dist_diff, 2)} km shorter than next alternative)."
        )
    elif rec.distance_km > min_other_dist + 0.05:
        diff_km = round(rec.distance_km - min_other_dist, 2)
        reasons.append(
            f"Longer distance by {diff_km} km ({round(rec.distance_km, 2)} km), but achieves optimal overall travel time and fewer delays."
        )

    # 3. Traffic signals comparison (only if signal analysis was genuinely available)
    if rec_raw.get("signal_delay_available", False) or rec_raw.get("intersection_analysis_available", False):
        signals = [o.signal_count for o in others]
        min_other_signals = min(signals)

        if rec.signal_count == 0:
            reasons.append("No mapped traffic signals encountered along this route.")
        elif rec.signal_count < min_other_signals:
            reasons.append(
                f"Fewer mapped traffic signals ({rec.signal_count} vs {min_other_signals} on nearest alternative), reducing potential intersection stops."
            )

    # 4. Intersection density
    if rec_raw.get("intersection_analysis_available", False):
        densities = [o.intersection_density_per_km for o in others]
        min_other_density = min(densities)
        if rec.intersection_density_per_km < min_other_density - 0.05:
            reasons.append(
                f"Lowest intersection density ({round(rec.intersection_density_per_km, 2)}/km), indicating fewer turning conflicts."
            )

    if not reasons:
        reasons.append(
            f"Highest composite multi-criteria evaluation score ({round(rec.score, 4)})."
        )

    return reasons


def _generate_alternative_reasons(
    r: ScoredRouteSummary,
    rec: ScoredRouteSummary,
) -> List[str]:
    """
    Generate data-driven explanations highlighting why an alternative route ranked lower.
    """
    reasons: List[str] = []

    # Duration deficit
    if r.estimated_duration_min > rec.estimated_duration_min + 0.05:
        diff_min = round(r.estimated_duration_min - rec.estimated_duration_min, 1)
        reasons.append(
            f"Higher estimated journey duration ({round(r.estimated_duration_min, 1)} min, +{diff_min} min vs recommended)."
        )

    # Distance trade-off
    if r.distance_km < rec.distance_km - 0.05 and r.estimated_duration_min > rec.estimated_duration_min + 0.05:
        reasons.append(
            f"Shorter route ({round(r.distance_km, 2)} km vs {round(rec.distance_km, 2)} km), but slower overall due to signal delays."
        )
    elif r.distance_km > rec.distance_km + 0.05:
        diff_km = round(r.distance_km - rec.distance_km, 2)
        reasons.append(
            f"Longer route distance ({round(r.distance_km, 2)} km, +{diff_km} km vs recommended)."
        )

    # Signal count deficit
    if r.signal_count > rec.signal_count:
        reasons.append(
            f"More mapped traffic signals ({r.signal_count} vs {rec.signal_count}), contributing {round(r.total_estimated_signal_delay_s, 1)}s estimated signal delay."
        )

    # Intersection density deficit
    if r.intersection_density_per_km > rec.intersection_density_per_km + 0.05:
        reasons.append(
            f"Higher intersection density ({round(r.intersection_density_per_km, 2)}/km vs {round(rec.intersection_density_per_km, 2)}/km)."
        )

    if not reasons:
        reasons.append(
            f"Lower overall composite evaluation score ({round(r.score, 4)} vs {round(rec.score, 4)})."
        )

    return reasons


def score_and_rank_routes(
    routes: List[RouteResult],
    weights: Optional[Dict[str, float]] = None,
) -> RouteRecommendationResponse:
    """
    Score, rank, and recommend the best route among candidate alternatives.

    Parameters
    ----------
    routes : List[RouteResult]
        List of candidate driving routes.
    weights : Optional[Dict[str, float]], default=None
        Custom evaluation weights for:
        - 'estimated_duration' (default 0.60)
        - 'distance' (default 0.20)
        - 'signal_count' (default 0.10)
        - 'intersection_density' (default 0.10)
        If None, DEFAULT_SCORING_WEIGHTS is used.

    Returns
    -------
    RouteRecommendationResponse
        Structured ranking, scores, recommendation, and analytical summary.
    """
    # 1. Determine and validate scoring weights
    effective_weights = dict(weights) if weights is not None else dict(DEFAULT_SCORING_WEIGHTS)
    validate_scoring_weights(effective_weights)

    # 2. Handle empty route list
    if not routes:
        return RouteRecommendationResponse(
            recommended_route_id=None,
            ranking_method="weighted_multicriteria",
            scoring_weights=effective_weights,
            routes_ranked=[],
            recommendation_summary="No candidate routes were provided for scoring.",
            analysis_status="error",
            analysis_warnings=["No candidate routes provided to score_and_rank_routes."],
        )

    # 3. Validate route candidate inputs
    _validate_route_inputs(routes)

    # 4. Extract metrics, harmonize duration comparability, and impute missing data
    raw_data, warnings, is_degraded = _extract_metric_values(routes)

    # Add standard methodological disclaimer warnings
    warnings.append(
        "Route recommendation is based on a multi-criteria model evaluating baseline OSRM duration, "
        "assumed uniform signal delay, distance, and intersection density. It does not represent live traffic navigation."
    )

    # 5. Normalize metrics across routes
    durations = [d["estimated_duration_s"] for d in raw_data]
    distances = [d["distance_m"] for d in raw_data]
    signals = [float(d["signal_count"]) for d in raw_data]
    densities = [float(d["intersection_density_per_km"]) for d in raw_data]

    norm_durations = normalize_metric(durations, lower_is_better=True)
    norm_distances = normalize_metric(distances, lower_is_better=True)
    norm_signals = normalize_metric(signals, lower_is_better=True)
    norm_densities = normalize_metric(densities, lower_is_better=True)

    # 6. Compute composite weighted scores
    scored_list: List[Dict[str, Any]] = []
    w_dur = effective_weights["estimated_duration"]
    w_dist = effective_weights["distance"]
    w_sig = effective_weights["signal_count"]
    w_den = effective_weights["intersection_density"]

    for idx, d in enumerate(raw_data):
        raw_score = (
            w_dur * norm_durations[idx]
            + w_dist * norm_distances[idx]
            + w_sig * norm_signals[idx]
            + w_den * norm_densities[idx]
        )
        raw_score = max(0.0, min(1.0, float(raw_score)))

        normalized_breakdown = {
            "estimated_duration": norm_durations[idx],
            "distance": norm_distances[idx],
            "signal_count": norm_signals[idx],
            "intersection_density": norm_densities[idx],
        }

        scored_list.append({
            "route_id": d["route_id"],
            "route_ref": d["route_ref"],
            "raw_score": raw_score,
            "score": round(raw_score, 4),
            "estimated_duration_s": d["estimated_duration_s"],
            "estimated_duration_min": d["estimated_duration_min"],
            "baseline_duration_s": d["baseline_duration_s"],
            "distance_m": d["distance_m"],
            "distance_km": d["distance_km"],
            "signal_count": d["signal_count"],
            "total_estimated_signal_delay_s": d["total_estimated_signal_delay_s"],
            "intersection_count": d["intersection_count"],
            "intersection_density_per_km": d["intersection_density_per_km"],
            "metric_normalized_scores": normalized_breakdown,
            "original_index": idx,
            "raw_data_ref": d,
        })

    # 7. Rank routes with full floating-point precision (no premature 6-decimal rounding)
    # Sort order:
    # 1. Full-precision score descending (-item["raw_score"])
    # 2. Estimated journey duration ascending (lower is better)
    # 3. Route distance ascending (lower is better)
    # 4. Original candidate index ascending (strict determinism)
    scored_list.sort(
        key=lambda item: (
            -item["raw_score"],
            item["estimated_duration_s"],
            item["distance_m"],
            item["original_index"],
        )
    )

    # 8. Build ScoredRouteSummary items and assign ranks
    ranked_summaries: List[ScoredRouteSummary] = []
    for rank_idx, item in enumerate(scored_list, start=1):
        is_rec = (rank_idx == 1)
        summary = ScoredRouteSummary(
            route_id=item["route_id"],
            rank=rank_idx,
            score=item["score"],
            estimated_duration_s=item["estimated_duration_s"],
            estimated_duration_min=item["estimated_duration_min"],
            baseline_duration_s=item["baseline_duration_s"],
            distance_m=item["distance_m"],
            distance_km=item["distance_km"],
            signal_count=item["signal_count"],
            total_estimated_signal_delay_s=item["total_estimated_signal_delay_s"],
            intersection_count=item["intersection_count"],
            intersection_density_per_km=item["intersection_density_per_km"],
            is_recommended=is_rec,
            recommendation_reasons=[],
            metric_normalized_scores=item["metric_normalized_scores"],
        )
        ranked_summaries.append(summary)

    # 9. Generate recommendation reasons
    recommended_route = ranked_summaries[0]
    rec_raw_data = scored_list[0]["raw_data_ref"]
    recommended_route.recommendation_reasons = _generate_recommendation_reasons(
        recommended_route,
        ranked_summaries,
        rec_raw_data,
    )

    for item in ranked_summaries[1:]:
        item.recommendation_reasons = _generate_alternative_reasons(
            item,
            recommended_route,
        )

    # 10. Update original RouteResult objects in-place
    summary_by_id = {s.route_id: s for s in ranked_summaries}
    for r in routes:
        if r.route_id in summary_by_id:
            s = summary_by_id[r.route_id]
            r.rank = s.rank
            r.score = s.score
            r.is_recommended = s.is_recommended
            r.recommendation_reasons = list(s.recommendation_reasons)
            r.score_details = s

    # 11. Generate overall summary narrative
    rec = recommended_route
    total_routes = len(routes)
    if total_routes == 1:
        summary_text = (
            f"Route '{rec.route_id}' is the only candidate route provided; recommended by default "
            f"({round(rec.estimated_duration_min, 1)} min, {round(rec.distance_km, 2)} km)."
        )
        status = "single_route" if not is_degraded else "degraded"
    else:
        summary_text = (
            f"Route '{rec.route_id}' is recommended with a score of {round(rec.score, 3)} "
            f"(Rank 1 of {total_routes}). It provides an estimated journey duration of "
            f"{round(rec.estimated_duration_min, 1)} min across {round(rec.distance_km, 2)} km "
            f"with {rec.signal_count} mapped traffic signal(s)."
        )
        status = "degraded" if is_degraded else "success"

    return RouteRecommendationResponse(
        recommended_route_id=rec.route_id,
        ranking_method="weighted_multicriteria",
        scoring_weights=effective_weights,
        routes_ranked=ranked_summaries,
        recommendation_summary=summary_text,
        analysis_status=status,
        analysis_warnings=warnings,
    )

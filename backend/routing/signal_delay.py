"""
Intersection Signal Delay Estimation Service
============================================

Phase 9.4: Intersection Signal Delay Estimation Engine.

Estimates the additional travel time caused by encountering traffic signals
along candidate driving routes in Chandigarh Tricity.

IMPORTANT MODELING NOTICE:
- Actual signal-controller timing plans and live intersection telemetry are
  currently not available for Chandigarh Tricity.
- This service implements a transparent, configurable uniform random-arrival
  signal-delay approximation model:
      d = R^2 / (2 * C)
  where d is average uniform delay in seconds, R is effective red time in seconds,
  and C is cycle length in seconds.
- Formulation note: This is a uniform random-arrival signal-delay approximation
  (the deterministic first term under Poisson arrivals) and not a complete Webster
  delay model, as it deliberately excludes empirical queue overflow and stochastic
  saturation terms.
- Values must be understood as illustrative engineering baselines, not observed delays.
- Unsignalized intersections do NOT receive traffic signal delay.
"""

from typing import Dict, Any, List, Optional, Union
import math

from backend.routing.config import (
    DEFAULT_SIGNAL_CYCLE_LENGTH_S,
    DEFAULT_SIGNAL_EFFECTIVE_RED_S,
    SIGNAL_DELAY_MODEL,
    SIGNAL_TIMING_PROFILES,
    validate_signal_timing_config,
)
from backend.routing.models import (
    RouteResult,
    MatchedIntersection,
    RouteIntersectionAnalysis,
    SignalizedIntersectionDelay,
    RouteSignalDelaySummary,
)


def calculate_uniform_delay(cycle_length_s: float, effective_red_s: float) -> float:
    """
    Calculate average vehicle delay using the uniform random-arrival approximation:
        d = R^2 / (2 * C)
    
    Parameters:
    - cycle_length_s: Signal cycle duration in seconds (C > 0).
    - effective_red_s: Effective red phase duration in seconds (0 <= R < C).

    Returns:
    - Average uniform delay in seconds per vehicle.
    """
    validate_signal_timing_config(cycle_length_s, effective_red_s)
    if effective_red_s == 0.0:
        return 0.0
    return (effective_red_s ** 2) / (2.0 * cycle_length_s)


def estimate_intersection_signal_delay(
    matched_intersection: MatchedIntersection,
    cycle_length_s: float = DEFAULT_SIGNAL_CYCLE_LENGTH_S,
    effective_red_s: float = DEFAULT_SIGNAL_EFFECTIVE_RED_S,
    method: str = SIGNAL_DELAY_MODEL,
) -> Optional[SignalizedIntersectionDelay]:
    """
    Estimate traffic signal delay for a single matched intersection.
    Returns None if the intersection is unsignalized.
    """
    if not matched_intersection.is_signalized:
        return None

    validate_signal_timing_config(cycle_length_s, effective_red_s)
    delay_s = calculate_uniform_delay(cycle_length_s, effective_red_s)

    assumptions = {
        "arrival_process": "uniform_random",
        "signal_control": "isolated_fixed_time",
        "cycle_source": "assumed_default_profile",
        "oversaturation_modeled": False,
        "queue_spillback_modeled": False,
        "coordination_modeled": False,
        "timing_rationale": f"C={cycle_length_s}s, R={effective_red_s}s -> d={delay_s:.1f}s",
    }

    return SignalizedIntersectionDelay(
        osm_node_id=matched_intersection.osm_node_id,
        distance_along_route_m=matched_intersection.distance_along_route_m,
        cycle_length_s=cycle_length_s,
        effective_red_time_s=effective_red_s,
        estimated_delay_s=round(delay_s, 2),
        estimation_method=method,
        confidence_level="low_uncalibrated_heuristic",
        assumptions=assumptions,
    )


def estimate_route_signal_delay(
    route: Union[RouteResult, Dict[str, Any]],
    intersection_analysis: Optional[RouteIntersectionAnalysis] = None,
    cycle_length_s: float = DEFAULT_SIGNAL_CYCLE_LENGTH_S,
    effective_red_s: float = DEFAULT_SIGNAL_EFFECTIVE_RED_S,
    method: str = SIGNAL_DELAY_MODEL,
) -> RouteSignalDelaySummary:
    """
    Estimate aggregate traffic-signal delays for all matched signalized intersections
    along a candidate route and compute combined estimated travel duration.
    
    Formula:
        T_estimated = T_OSRM_baseline + T_signal_delay
    """
    # 1. Extract baseline duration
    if isinstance(route, RouteResult):
        baseline_duration_s = float(route.duration_s)
        analysis = intersection_analysis or route.intersection_analysis
    elif isinstance(route, dict):
        baseline_duration_s = float(route.get("duration_s", route.get("duration", 0.0)))
        analysis = intersection_analysis or route.get("intersection_analysis")
    else:
        baseline_duration_s = 0.0
        analysis = intersection_analysis

    # 2. Check for missing intersection analysis
    if analysis is None:
        return RouteSignalDelaySummary(
            signal_count=0,
            total_estimated_signal_delay_s=0.0,
            total_estimated_signal_delay_min=0.0,
            average_delay_per_signal_s=0.0,
            baseline_duration_s=round(baseline_duration_s, 1),
            estimated_duration_s=round(baseline_duration_s, 1),
            estimated_duration_min=round(baseline_duration_s / 60.0, 2),
            delay_model=method,
            signal_delays=[],
            analysis_status="missing_intersection_analysis",
            analysis_warnings=["Intersection analysis is missing; cannot estimate signal delays."],
        )

    # 3. Validate signal timing configuration
    try:
        validate_signal_timing_config(cycle_length_s, effective_red_s)
    except ValueError as e:
        return RouteSignalDelaySummary(
            signal_count=0,
            total_estimated_signal_delay_s=0.0,
            total_estimated_signal_delay_min=0.0,
            average_delay_per_signal_s=0.0,
            baseline_duration_s=round(baseline_duration_s, 1),
            estimated_duration_s=round(baseline_duration_s, 1),
            estimated_duration_min=round(baseline_duration_s / 60.0, 2),
            delay_model=method,
            signal_delays=[],
            analysis_status="error",
            analysis_warnings=[f"Invalid signal timing configuration: {str(e)}"],
        )

    # 4. Filter signalized intersections
    matched_intersections = getattr(analysis, "matched_intersections", [])
    if isinstance(analysis, dict):
        matched_intersections = analysis.get("matched_intersections", [])

    signal_delays: List[SignalizedIntersectionDelay] = []
    for inter in matched_intersections:
        is_sig = getattr(inter, "is_signalized", False) if not isinstance(inter, dict) else inter.get("is_signalized", False)
        if is_sig:
            if isinstance(inter, dict):
                # Construct MatchedIntersection helper for dictionary
                inter_obj = MatchedIntersection(**inter)
            else:
                inter_obj = inter
            delay_obj = estimate_intersection_signal_delay(
                inter_obj,
                cycle_length_s=cycle_length_s,
                effective_red_s=effective_red_s,
                method=method,
            )
            if delay_obj is not None:
                signal_delays.append(delay_obj)

    signal_count = len(signal_delays)

    # 5. Handle zero signals matched
    if signal_count == 0:
        return RouteSignalDelaySummary(
            signal_count=0,
            total_estimated_signal_delay_s=0.0,
            total_estimated_signal_delay_min=0.0,
            average_delay_per_signal_s=0.0,
            baseline_duration_s=round(baseline_duration_s, 1),
            estimated_duration_s=round(baseline_duration_s, 1),
            estimated_duration_min=round(baseline_duration_s / 60.0, 2),
            delay_model=method,
            signal_delays=[],
            analysis_status="no_signals_matched",
            analysis_warnings=[
                "Zero OSM-mapped traffic signals were matched along this route.",
                "OpenStreetMap traffic signal tagging in Chandigarh Tricity may be incomplete; unmapped signals receive zero delay.",
            ],
        )

    # 6. Aggregate delay metrics
    total_delay_s = sum(s.estimated_delay_s for s in signal_delays)
    total_delay_min = total_delay_s / 60.0
    avg_delay_s = total_delay_s / float(signal_count)
    estimated_duration_s = baseline_duration_s + total_delay_s
    estimated_duration_min = estimated_duration_s / 60.0

    warnings = [
        "Signal timings (cycle length and red time) are assumed engineering baselines, not field-measured controller timings.",
        "Delay is calculated using the uniform random-arrival approximation (d = R^2 / 2C) and does not model oversaturation, queue spillback, vehicle platooning, or coordinated green waves.",
        "Combined estimated duration is an additive approximation (OSRM baseline free-flow time + estimated signal delay).",
    ]

    return RouteSignalDelaySummary(
        signal_count=signal_count,
        total_estimated_signal_delay_s=round(total_delay_s, 1),
        total_estimated_signal_delay_min=round(total_delay_min, 2),
        average_delay_per_signal_s=round(avg_delay_s, 1),
        baseline_duration_s=round(baseline_duration_s, 1),
        estimated_duration_s=round(estimated_duration_s, 1),
        estimated_duration_min=round(estimated_duration_min, 2),
        delay_model=method,
        signal_delays=signal_delays,
        analysis_status="success",
        analysis_warnings=warnings,
    )

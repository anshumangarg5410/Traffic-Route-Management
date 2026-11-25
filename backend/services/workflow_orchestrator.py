"""
End-to-End Workflow Orchestrator
================================

Phase 8.3: Unified Backend End-to-End Workflow Orchestration

Orchestrates:
1. Regional ML traffic classification.
2. Explicit directional intersection traffic configuration.
3. Baseline signal timing optimization (from initial queues).
4. Adaptive traffic simulation (single-run realization for visualization).
5. Paired fixed-versus-adaptive Monte Carlo strategy comparison (using Common Random Numbers).
6. Comprehensive model assumptions, limitations, and statistical documentation.
"""

from typing import Any, Dict, Optional
import numpy as np

from backend.services.prediction import predict_traffic
from backend.services.signal_optimizer import optimize_signal
from backend.services.traffic_simulator import (
    simulate_intersection,
    validate_intersection_capacity_parameters,
    DIRECTIONS,
)
from backend.services.strategy_comparator import compare_strategies_multi_run


def run_unified_workflow(
    regional_features: Dict[str, Any],
    initial_queues: Dict[str, int],
    arrival_rates: Dict[str, float],
    lanes: Optional[Dict[str, int]] = None,
    saturation_flow_rates: Optional[Dict[str, float]] = None,
    startup_lost_times: Optional[Dict[str, float]] = None,
    discharge_policy: str = "independent_floor",
    cycles: int = 5,
    runs: int = 5,
    random_seed: Optional[int] = None,
    apply_ml_scenario_scaling: bool = False,
) -> Dict[str, Any]:
    """
    Executes the end-to-end traffic management workflow.

    Parameters:
    - regional_features: Dictionary of temporal and weather features for ML classification.
    - initial_queues: Explicit vehicle queues for North, South, East, West approaches.
    - arrival_rates: Explicit Poisson arrival rates (vehicles/minute) for each approach.
    - lanes: Number of discharge lanes per approach.
    - saturation_flow_rates: Saturation flow rate per lane (veh/hr/lane).
    - startup_lost_times: Startup lost time per phase (seconds).
    - discharge_policy: 'independent_floor' or 'fractional_carryover'.
    - cycles: Number of signal cycles to simulate.
    - runs: Number of Monte Carlo trials for paired strategy comparison.
    - random_seed: Master deterministic seed (or None for randomized execution).
    - apply_ml_scenario_scaling: Optional boolean flag to apply an illustrative scenario multiplier.
    """
    # 1. Run regional ML prediction pipeline
    prediction_result = predict_traffic(regional_features)
    pred_level = prediction_result.get("predicted_traffic_level", "Medium")

    # 2. Determine directional arrival rates (preserving original inputs)
    effective_arrival_rates = arrival_rates.copy()
    scenario_info = {
        "applied": False,
        "multiplier": 1.0,
        "predicted_category": pred_level,
        "note": "Directional arrival rates used exactly as supplied by the user. Regional ML prediction is not coupled to directional queues."
    }

    if apply_ml_scenario_scaling:
        factor_map = {"Low": 0.85, "Medium": 1.0, "High": 1.25}
        factor = factor_map.get(pred_level, 1.0)
        effective_arrival_rates = {
            d: round(arrival_rates[d] * factor, 2) for d in DIRECTIONS
        }
        scenario_info = {
            "applied": True,
            "multiplier": factor,
            "predicted_category": pred_level,
            "note": (
                f"Illustrative scenario multiplier: directional arrival rates scaled by {factor}x "
                f"based on regional {pred_level} traffic level. This is a configurable scenario multiplier, "
                f"NOT a learned directional output of the ML model."
            )
        }

    # 3. Validate geometry parameters
    norm_lanes, norm_sat_rates, norm_lost_times = validate_intersection_capacity_parameters(
        lanes=lanes,
        saturation_flow_rates=saturation_flow_rates,
        startup_lost_times=startup_lost_times,
    )

    # 4. Baseline signal timing allocation (computed from initial queues at t=0)
    baseline_allocation = optimize_signal(initial_queues)

    # 5. Deterministic seed management for single run and Monte Carlo
    if random_seed is not None:
        effective_seed = random_seed
    else:
        effective_seed = int(np.random.default_rng().integers(0, 2**31 - 1))

    # 6. Adaptive simulation (single-run realization for visualization)
    single_run_sim = simulate_intersection(
        initial_queues=initial_queues,
        arrival_rates=effective_arrival_rates,
        cycles=cycles,
        strategy="adaptive",
        random_seed=effective_seed,
        lanes=norm_lanes,
        saturation_flow_rates=norm_sat_rates,
        startup_lost_times=norm_lost_times,
        discharge_policy=discharge_policy,
    )

    overall_metrics = single_run_sim["metrics"]["overall"]
    conservation_check = {
        "total_initial_queue": overall_metrics["total_initial_queue"],
        "total_arrivals": overall_metrics["total_arrivals"],
        "total_discharged": overall_metrics["total_discharged"],
        "total_remaining": overall_metrics["total_remaining"],
        "is_conserved": overall_metrics["vehicle_conservation_verified"],
        "discrepancy": (
            (overall_metrics["total_initial_queue"] + overall_metrics["total_arrivals"])
            - (overall_metrics["total_discharged"] + overall_metrics["total_remaining"])
        ),
    }

    # 7. Paired Fixed vs Adaptive Monte Carlo Comparison (using Common Random Numbers)
    mc_comparison = compare_strategies_multi_run(
        initial_queues=initial_queues,
        arrival_rates=effective_arrival_rates,
        cycles=cycles,
        runs=runs,
        base_seed=effective_seed,
        lanes=norm_lanes,
        saturation_flow_rates=norm_sat_rates,
        startup_lost_times=norm_lost_times,
        discharge_policy=discharge_policy,
    )

    # 8. Assemble structured unified response contract
    return {
        "ml_prediction": {
            "predicted_traffic_level": prediction_result["predicted_traffic_level"],
            "class_probabilities": prediction_result["confidence"],
            "classification_thresholds": prediction_result["thresholds"],
            "model_metadata": {
                "model": "Random Forest Classifier",
                "dataset": "UCI Metro Interstate Traffic Volume Dataset",
                "scope": "Macro-level highway corridor classification (Low / Medium / High)",
                "features_used": list(regional_features.keys()),
            },
            "model_scope": (
                "Regional freeway corridor classification based on time and weather. "
                "Does not model intersection-specific turning movements or directional approach splits."
            ),
            "confidence_interpretation": (
                "Class probabilities represent Random Forest tree voting fractions and "
                "should not be interpreted as calibrated posterior confidence."
            ),
        },
        "directional_inputs": {
            "initial_queues": initial_queues,
            "arrival_rates": arrival_rates,
            "effective_arrival_rates": effective_arrival_rates,
            "lanes": norm_lanes,
            "saturation_flow_rates": norm_sat_rates,
            "startup_lost_times": norm_lost_times,
            "discharge_policy": discharge_policy,
            "scenario_scaling": scenario_info,
        },
        "signal_allocation": {
            "timing_source": "initial_queue_baseline",
            "description": (
                "Signal timing allocation computed from initial queues at cycle 0. "
                "In adaptive simulation, green times are dynamically re-optimized each cycle based on evolving queues."
            ),
            "green_times": baseline_allocation["green_times"],
            "relative_demands": baseline_allocation["relative_demands"],
            "cycle_time": baseline_allocation["cycle_time"],
            "clearance_time": baseline_allocation["clearance_time"],
            "total_green_time": baseline_allocation["total_green_time"],
            "min_green": baseline_allocation["min_green"],
            "max_green": baseline_allocation["max_green"],
        },
        "simulation_results": {
            "strategy": "adaptive",
            "random_seed": effective_seed,
            "cycles_simulated": single_run_sim["cycles_simulated"],
            "final_queues": single_run_sim["final_queues"],
            "history": single_run_sim["history"],
            "metrics": single_run_sim["metrics"],
            "vehicle_conservation": conservation_check,
        },
        "strategy_comparison": {
            "monte_carlo_runs": mc_comparison["statistical_reliability"]["total_runs"],
            "base_seed": mc_comparison["statistical_reliability"]["base_seed"],
            "fixed_strategy": mc_comparison["fixed_strategy"],
            "adaptive_strategy": mc_comparison["adaptive_strategy"],
            "comparison_summary": mc_comparison["comparison"],
            "paired_difference_statistics": mc_comparison["statistical_reliability"]["paired_difference_statistics"],
            "win_tie_statistics": {
                "total_runs": mc_comparison["statistical_reliability"]["total_runs"],
                "adaptive_wins": mc_comparison["statistical_reliability"]["adaptive_wins"],
                "fixed_wins": mc_comparison["statistical_reliability"]["fixed_wins"],
                "ties": mc_comparison["statistical_reliability"]["ties"],
                "win_rate_adaptive_percentage": mc_comparison["statistical_reliability"]["win_rate_adaptive_percentage"],
                "win_rate_fixed_percentage": mc_comparison["statistical_reliability"]["win_rate_fixed_percentage"],
            },
            "simulation_distinction": (
                "The single-run simulation results in 'simulation_results' represent one specific stochastic realization "
                f"(seed: {effective_seed}) for timeline visualization, whereas 'strategy_comparison' reports multi-run "
                f"aggregate statistics across {runs} Monte Carlo trials under Common Random Numbers."
            ),
        },
        "model_assumptions": {
            "regional_ml_scope": (
                "Trained on UCI freeway volume data; provides macro-level corridor context, "
                "not local intersection turning movements."
            ),
            "directional_input_independence": (
                "Directional queues and arrival rates are independently supplied and never "
                "derived from regional ML classification."
            ),
            "macroscopic_simulation": (
                "Point-queue macroscopic fluid model; does not simulate vehicle car-following, "
                "lane changes, or spatial acceleration/deceleration."
            ),
            "arrival_process": "Poisson arrivals with stationary mean rates per cycle.",
            "signal_control_phasing": (
                "Isolated 4-approach split-phase sequence (North -> South -> East -> West) "
                "with 120s cycle and 20s total clearance time. Compatible opposing through movements "
                "are not served concurrently."
            ),
            "capacity_and_discharge": (
                "HCM-based saturation flow (default 1800 veh/hr/ln) and startup lost time "
                "(default 2.0s) with integer vehicle discharge."
            ),
            "statistical_inference": (
                "Confidence intervals are pointwise 95% Student's t intervals on paired differences "
                "under Common Random Numbers."
            ),
            "calibration_status": (
                "Illustrative research and demonstration platform; parameters are not field-calibrated "
                "against local intersection telemetry."
            ),
        },
    }

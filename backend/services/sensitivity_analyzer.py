"""
Modular Sensitivity Analysis Service
====================================

Phase 7.1.1: Controlled one-parameter-at-a-time (OAT) Monte Carlo sensitivity experiments
evaluating macroscopic simulator behavior under varying demand, geometry,
and signal control parameters with Common Random Numbers (CRN), sample variance,
replicate-level paired differences, and Student's t confidence intervals.
"""

import math
from typing import Any, Dict, List, Optional
import numpy as np
from scipy.stats import t as student_t

from backend.services.traffic_simulator import simulate_intersection

DIRECTIONS = ["north", "south", "east", "west"]

DEFAULT_BASELINE = {
    "initial_queues": {"north": 30, "south": 25, "east": 15, "west": 10},
    "arrival_rates": {"north": 10.0, "south": 8.0, "east": 5.0, "west": 3.0},
    "cycles": 5,
    "strategy": "adaptive",
    "lanes": {"north": 1, "south": 1, "east": 1, "west": 1},
    "saturation_flow_rates": {"north": 1800.0, "south": 1800.0, "east": 1800.0, "west": 1800.0},
    "startup_lost_times": {"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0},
    "random_seed": 42,
    "discharge_policy": "independent_floor"
}

PARAM_RANGES = {
    "arrival_rate": [2.0, 5.0, 10.0, 15.0, 20.0, 25.0],
    "initial_queue": [0, 15, 30, 50, 75, 100],
    "lanes": [1, 2, 3, 4],
    "saturation_flow_rate": [1200.0, 1500.0, 1800.0, 2100.0, 2400.0],
    "startup_lost_time": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
    "cycles": [1, 2, 3, 5, 8, 10]
}


def validate_parameter_values_for_type(parameter_name: str, values: List[Any]) -> None:
    """
    Validate parameter values against their physical and simulation domain requirements.
    - Lanes: integer between 1 and 8.
    - Saturation flow rate: strictly positive and finite.
    - Startup lost time: non-negative and finite.
    - Arrival rate: non-negative and finite.
    - Initial queue: non-negative integer.
    - Cycles: integer >= 1.
    - Strategy: 'fixed' or 'adaptive'.
    - General: rejects booleans, NaN, positive/negative infinity, and lists > 20 items.
    """
    if not isinstance(values, list) or len(values) == 0:
        raise ValueError("parameter_values must be a non-empty list.")
    if len(values) > 20:
        raise ValueError("parameter_values cannot exceed 20 values per request.")

    for val in values:
        if isinstance(val, bool):
            raise ValueError(f"Invalid parameter value {val}: booleans are not allowed.")

        if parameter_name == "lanes":
            if not isinstance(val, int) or val < 1 or val > 8:
                raise ValueError(f"Lane count must be an integer between 1 and 8, got {val}.")
        elif parameter_name == "saturation_flow_rate":
            if not isinstance(val, (int, float)) or math.isnan(val) or math.isinf(val) or val <= 0:
                raise ValueError(f"Saturation flow rate must be strictly positive and finite, got {val}.")
        elif parameter_name == "startup_lost_time":
            if not isinstance(val, (int, float)) or math.isnan(val) or math.isinf(val) or val < 0:
                raise ValueError(f"Startup lost time must be non-negative and finite, got {val}.")
        elif parameter_name == "arrival_rate":
            if not isinstance(val, (int, float)) or math.isnan(val) or math.isinf(val) or val < 0:
                raise ValueError(f"Arrival rate must be non-negative and finite, got {val}.")
        elif parameter_name == "initial_queue":
            if not isinstance(val, int) or val < 0:
                raise ValueError(f"Initial queue must be a non-negative integer, got {val}.")
        elif parameter_name == "cycles":
            if not isinstance(val, int) or val < 1:
                raise ValueError(f"Cycle count must be an integer >= 1, got {val}.")
        elif parameter_name == "strategy":
            if val not in ("fixed", "adaptive"):
                raise ValueError(f"Strategy parameter value must be 'fixed' or 'adaptive', got {val}.")
        else:
            if not isinstance(val, (int, float)) or math.isnan(val) or math.isinf(val) or val < 0:
                raise ValueError(f"Invalid parameter value {val}.")


def _calc_stats(
    data: List[float],
    calculate_ci: bool = False,
    non_negative_ci: bool = True
) -> Dict[str, Any]:
    """
    Calculate sample mean, sample standard deviation (ddof=1),
    and pointwise 95% Student's t confidence interval (df = n - 1)
    quantifying simulation sampling uncertainty for this parameter setting.
    """
    n = len(data)
    if n == 0:
        return {
            "mean": 0.0,
            "std": 0.0,
            "ci_95": [0.0, 0.0],
            "margin_of_error": 0.0
        }

    mean_val = float(np.mean(data))
    std_val = float(np.std(data, ddof=1)) if n >= 2 else 0.0

    res = {
        "mean": round(mean_val, 2),
        "std": round(std_val, 2)
    }

    if calculate_ci:
        if n >= 2 and std_val > 1e-9:
            df = n - 1
            t_crit = float(student_t.ppf(0.975, df=df))
            me = float(t_crit * (std_val / math.sqrt(n)))
            lower = mean_val - me
            upper = mean_val + me
            if non_negative_ci:
                lower = max(0.0, lower)
            res["ci_95"] = [round(lower, 2), round(upper, 2)]
            res["margin_of_error"] = round(me, 2)
        else:
            lower = max(0.0, mean_val) if non_negative_ci else mean_val
            res["ci_95"] = [round(lower, 2), round(mean_val, 2)]
            res["margin_of_error"] = 0.0

    return res


def _calc_paired_diff_stats(diffs: List[float], sign_convention: str) -> Dict[str, Any]:
    """
    Calculate paired difference statistics (fixed - adaptive) across Monte Carlo replicates:
    - Paired mean difference
    - Paired sample standard deviation (ddof=1)
    - Standard error (SE = s_d / sqrt(R))
    - Pointwise 95% Student's t confidence interval (df = R - 1)
    """
    n = len(diffs)
    if n == 0:
        return {
            "mean_difference": 0.0,
            "std_difference": 0.0,
            "standard_error": 0.0,
            "ci_95": [0.0, 0.0],
            "margin_of_error": 0.0,
            "sign_convention": sign_convention
        }

    mean_diff = float(np.mean(diffs))
    if n >= 2:
        std_diff = float(np.std(diffs, ddof=1))
        se_diff = float(std_diff / math.sqrt(n))
    else:
        std_diff = 0.0
        se_diff = 0.0

    if n >= 2 and std_diff > 1e-9:
        df = n - 1
        t_crit = float(student_t.ppf(0.975, df=df))
        me = float(t_crit * se_diff)
        ci = [round(mean_diff - me, 2), round(mean_diff + me, 2)]
    else:
        me = 0.0
        ci = [round(mean_diff, 2), round(mean_diff, 2)]

    return {
        "mean_difference": round(mean_diff, 2),
        "std_difference": round(std_diff, 2),
        "standard_error": round(se_diff, 2),
        "ci_95": ci,
        "margin_of_error": round(me, 2),
        "sign_convention": sign_convention
    }


def run_parameter_sensitivity_sweep(
    parameter_name: str,
    parameter_values: Optional[List[Any]] = None,
    target_direction: Optional[str] = None,
    baseline_override: Optional[Dict[str, Any]] = None,
    compare_both_strategies: bool = True,
    runs: int = 30
) -> Dict[str, Any]:
    """
    Execute a controlled Monte Carlo sensitivity sweep varying one parameter across specified values
    while holding all other parameters fixed, using Common Random Numbers (CRN) across replicates.
    """
    if not isinstance(runs, int) or isinstance(runs, bool) or runs < 2 or runs > 100:
        raise ValueError("runs must be an integer between 2 and 100.")

    if parameter_name not in PARAM_RANGES and parameter_name != "strategy":
        raise ValueError(
            f"Unsupported parameter: {parameter_name}. "
            f"Supported parameters: {list(PARAM_RANGES.keys())} or 'strategy'."
        )

    values = parameter_values if parameter_values is not None else PARAM_RANGES.get(parameter_name, [])
    validate_parameter_values_for_type(parameter_name, values)

    cfg = DEFAULT_BASELINE.copy()
    if baseline_override:
        cfg.update(baseline_override)

    # Establish deterministic paired replicate seeds using Common Random Numbers
    base_seed = cfg.get("random_seed", 42)
    if base_seed is not None:
        rng = np.random.default_rng(base_seed)
        replicate_seeds = [int(s) for s in rng.integers(1, 2**31 - 1, size=runs)]
    else:
        replicate_seeds = [None] * runs

    results_sweep = []

    for val in values:
        # Prepare inputs for this point in sweep
        init_q = cfg["initial_queues"].copy()
        arr_rates = cfg["arrival_rates"].copy()
        lanes = cfg["lanes"].copy()
        sat_rates = cfg["saturation_flow_rates"].copy()
        lost_times = cfg["startup_lost_times"].copy()
        cycles = cfg["cycles"]
        policy = cfg.get("discharge_policy", "independent_floor")

        if parameter_name == "arrival_rate":
            if target_direction:
                arr_rates[target_direction] = float(val)
            else:
                arr_rates = {d: float(val) for d in DIRECTIONS}
        elif parameter_name == "initial_queue":
            if target_direction:
                init_q[target_direction] = int(val)
            else:
                init_q = {d: int(val) for d in DIRECTIONS}
        elif parameter_name == "lanes":
            if target_direction:
                lanes[target_direction] = int(val)
            else:
                lanes = {d: int(val) for d in DIRECTIONS}
        elif parameter_name == "saturation_flow_rate":
            if target_direction:
                sat_rates[target_direction] = float(val)
            else:
                sat_rates = {d: float(val) for d in DIRECTIONS}
        elif parameter_name == "startup_lost_time":
            if target_direction:
                lost_times[target_direction] = float(val)
            else:
                lost_times = {d: float(val) for d in DIRECTIONS}
        elif parameter_name == "cycles":
            cycles = int(val)

        # Run Monte Carlo replicates
        adapt_queues = []
        adapt_discharged = []
        adapt_arrivals = []
        adapt_wait_times = []
        adapt_utilization = []
        adapt_conservations = []
        adapt_max_queues = []
        adapt_theoretical_caps = []

        fixed_queues = []
        fixed_discharged = []
        fixed_arrivals = []
        fixed_wait_times = []
        fixed_utilization = []
        fixed_conservations = []
        fixed_max_queues = []
        fixed_theoretical_caps = []

        for r in range(runs):
            rep_seed = replicate_seeds[r]

            sim_adaptive = simulate_intersection(
                initial_queues=init_q,
                arrival_rates=arr_rates,
                cycles=cycles,
                strategy="adaptive",
                random_seed=rep_seed,
                lanes=lanes,
                saturation_flow_rates=sat_rates,
                startup_lost_times=lost_times,
                discharge_policy=policy
            )
            m_adapt = sim_adaptive["metrics"]["overall"]
            adapt_queues.append(m_adapt["total_remaining"])
            adapt_discharged.append(m_adapt["total_discharged"])
            adapt_arrivals.append(m_adapt["total_arrivals"])
            adapt_wait_times.append(m_adapt["estimated_average_waiting_time_seconds"])
            adapt_utilization.append(m_adapt["overall_capacity_utilization_percentage"])
            adapt_conservations.append(m_adapt["vehicle_conservation_verified"])
            adapt_max_queues.append(m_adapt["maximum_queue_length"])
            adapt_theoretical_caps.append(m_adapt["total_theoretical_capacity"])

            if compare_both_strategies:
                sim_fixed = simulate_intersection(
                    initial_queues=init_q,
                    arrival_rates=arr_rates,
                    cycles=cycles,
                    strategy="fixed",
                    random_seed=rep_seed,  # Identical seed paired with adaptive
                    lanes=lanes,
                    saturation_flow_rates=sat_rates,
                    startup_lost_times=lost_times,
                    discharge_policy=policy
                )
                m_fixed = sim_fixed["metrics"]["overall"]
                fixed_queues.append(m_fixed["total_remaining"])
                fixed_discharged.append(m_fixed["total_discharged"])
                fixed_arrivals.append(m_fixed["total_arrivals"])
                fixed_wait_times.append(m_fixed["estimated_average_waiting_time_seconds"])
                fixed_utilization.append(m_fixed["overall_capacity_utilization_percentage"])
                fixed_conservations.append(m_fixed["vehicle_conservation_verified"])
                fixed_max_queues.append(m_fixed["maximum_queue_length"])
                fixed_theoretical_caps.append(m_fixed["total_theoretical_capacity"])

        # Compute statistics for adaptive
        ad_q_stat = _calc_stats(adapt_queues, calculate_ci=True, non_negative_ci=True)
        ad_w_stat = _calc_stats(adapt_wait_times, calculate_ci=True, non_negative_ci=True)
        ad_d_stat = _calc_stats(adapt_discharged, calculate_ci=False)
        ad_a_stat = _calc_stats(adapt_arrivals, calculate_ci=False)
        ad_u_stat = _calc_stats(adapt_utilization, calculate_ci=False)
        ad_mq_stat = _calc_stats(adapt_max_queues, calculate_ci=False)
        ad_tc_stat = _calc_stats(adapt_theoretical_caps, calculate_ci=False)

        step_data = {
            "parameter_value": val,
            "runs": runs,
            "adaptive": {
                "final_queue_mean": ad_q_stat["mean"],
                "final_queue_std": ad_q_stat["std"],
                "final_queue_ci95": ad_q_stat["ci_95"],
                "final_queue": ad_q_stat["mean"],
                "total_discharged_mean": ad_d_stat["mean"],
                "total_discharged_std": ad_d_stat["std"],
                "total_discharged": ad_d_stat["mean"],
                "total_arrivals_mean": ad_a_stat["mean"],
                "total_arrivals_std": ad_a_stat["std"],
                "total_arrivals": ad_a_stat["mean"],
                "average_waiting_time_mean": ad_w_stat["mean"],
                "average_waiting_time_std": ad_w_stat["std"],
                "average_waiting_time_ci95": ad_w_stat["ci_95"],
                "average_waiting_time": ad_w_stat["mean"],
                "capacity_utilization_mean": ad_u_stat["mean"],
                "capacity_utilization_std": ad_u_stat["std"],
                "capacity_utilization": ad_u_stat["mean"],
                "maximum_queue": ad_mq_stat["mean"],
                "total_theoretical_capacity": ad_tc_stat["mean"],
                "vehicle_conservation_verified": all(adapt_conservations)
            }
        }

        if compare_both_strategies:
            fx_q_stat = _calc_stats(fixed_queues, calculate_ci=True, non_negative_ci=True)
            fx_w_stat = _calc_stats(fixed_wait_times, calculate_ci=True, non_negative_ci=True)
            fx_d_stat = _calc_stats(fixed_discharged, calculate_ci=False)
            fx_a_stat = _calc_stats(fixed_arrivals, calculate_ci=False)
            fx_u_stat = _calc_stats(fixed_utilization, calculate_ci=False)
            fx_mq_stat = _calc_stats(fixed_max_queues, calculate_ci=False)
            fx_tc_stat = _calc_stats(fixed_theoretical_caps, calculate_ci=False)

            step_data["fixed"] = {
                "final_queue_mean": fx_q_stat["mean"],
                "final_queue_std": fx_q_stat["std"],
                "final_queue_ci95": fx_q_stat["ci_95"],
                "final_queue": fx_q_stat["mean"],
                "total_discharged_mean": fx_d_stat["mean"],
                "total_discharged_std": fx_d_stat["std"],
                "total_discharged": fx_d_stat["mean"],
                "total_arrivals_mean": fx_a_stat["mean"],
                "total_arrivals_std": fx_a_stat["std"],
                "total_arrivals": fx_a_stat["mean"],
                "average_waiting_time_mean": fx_w_stat["mean"],
                "average_waiting_time_std": fx_w_stat["std"],
                "average_waiting_time_ci95": fx_w_stat["ci_95"],
                "average_waiting_time": fx_w_stat["mean"],
                "capacity_utilization_mean": fx_u_stat["mean"],
                "capacity_utilization_std": fx_u_stat["std"],
                "capacity_utilization": fx_u_stat["mean"],
                "maximum_queue": fx_mq_stat["mean"],
                "total_theoretical_capacity": fx_tc_stat["mean"],
                "vehicle_conservation_verified": all(fixed_conservations)
            }

            # Paired strategy-difference statistics (fixed - adaptive per replicate)
            paired_diff_queues = [float(fixed_queues[r] - adapt_queues[r]) for r in range(runs)]
            paired_diff_wait = [float(fixed_wait_times[r] - adapt_wait_times[r]) for r in range(runs)]

            paired_q_stats = _calc_paired_diff_stats(
                paired_diff_queues,
                "fixed - adaptive (positive value indicates adaptive reduction in remaining queue)"
            )
            paired_w_stats = _calc_paired_diff_stats(
                paired_diff_wait,
                "fixed - adaptive (positive value indicates adaptive delay reduction in seconds)"
            )

            step_data["paired_differences"] = {
                "final_queue": paired_q_stats,
                "average_waiting_time": paired_w_stats
            }

            # Difference metrics (aligned with paired mean differences)
            step_data["vehicles_saved_mean"] = paired_q_stats["mean_difference"]
            step_data["delay_saved_seconds_mean"] = paired_w_stats["mean_difference"]
            step_data["vehicles_saved"] = paired_q_stats["mean_difference"]
            step_data["delay_saved_seconds"] = paired_w_stats["mean_difference"]

        results_sweep.append(step_data)

    return {
        "parameter_name": parameter_name,
        "target_direction": target_direction or "all_directions",
        "paired_seed": base_seed,
        "runs": runs,
        "sweep_count": len(results_sweep),
        "results": results_sweep,
        "methodology": {
            "technique": "Monte Carlo One-at-a-time (OAT) parameter variation with paired Common Random Numbers (CRN).",
            "purpose": "Evaluates parameter sensitivity with statistical variance and Student's t confidence intervals.",
            "paired_difference_analysis": {
                "formula": "replicate_difference = fixed_metric - adaptive_metric",
                "sign_convention": "fixed - adaptive. Positive differences indicate that Adaptive outperformed Fixed by reducing final queue or average delay.",
                "confidence_interval": "Student's t confidence interval on paired replicate-level differences with df = R - 1 and standard error SE = s_d / sqrt(R)."
            },
            "note": "Common Random Numbers (CRN) ensures identical Poisson arrival streams across strategies and parameter values.",
            "confidence_interval_disclaimer": "Confidence intervals represent simulation sampling uncertainty under modeled assumptions and must not be interpreted as empirical guarantees of real-world intersection performance."
        }
    }

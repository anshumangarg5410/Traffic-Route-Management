"""
Multi-Run Statistical Strategy Comparator
=========================================

Phase 4, 5 & 6: Monte Carlo Statistical Comparison between Fixed and Adaptive Strategies
incorporating Lane-Based Capacity Constraints.

Methodology:
- Evaluates Fixed-Time and Adaptive Signal Optimization across N independent
  simulation runs (Monte Carlo trials).
- Paired Common Random Numbers (CRN): In each run i, Fixed and Adaptive simulations
  are initialized with an identical deterministic run seed derived from a master
  base seed. This guarantees identical stochastic Poisson vehicle arrival sequences
  per run, enabling fair variance reduction and direct paired comparisons.
- Identical Capacity & Geometry: Both strategies receive identical lane counts,
  saturation flow rates, and startup lost times.
- Statistical Rigor:
  * Calculates per-run paired differences D_i = W_F,i - W_A,i.
  * Calculates sample mean paired difference and sample standard deviation of paired differences.
  * Constructs a 95% Student's t Confidence Interval for the mean paired difference.
  * Clearly distinguishes paired-difference standard deviation from separate strategy standard deviations.
  * Formulates CRN as a variance-reduction technique that depends on model monotonicity.
"""

from math import sqrt
from typing import Any, Dict, List, Optional
import numpy as np

try:
    from scipy.stats import t as student_t
    def get_t_critical(df: int) -> float:
        return float(student_t.ppf(0.975, df))
except ImportError:
    # Table of two-tailed 95% t-values (alpha = 0.05)
    T_TABLE = {
        1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
        6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
        15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042, 40: 2.021, 50: 2.009
    }
    def get_t_critical(df: int) -> float:
        for k in sorted(T_TABLE.keys()):
            if df <= k:
                return T_TABLE[k]
        return 1.96

from backend.services.traffic_simulator import simulate_intersection

DIRECTIONS = ["north", "south", "east", "west"]


def calculate_sample_std(values: List[float]) -> float:
    """Calculate sample standard deviation with Bessel's correction (N - 1)."""
    n = len(values)
    if n <= 1:
        return 0.0
    mean_val = sum(values) / n
    variance = sum((x - mean_val) ** 2 for x in values) / (n - 1)
    return round(sqrt(max(0.0, variance)), 2)


def compute_relative_improvement(
    fixed_val: float,
    adaptive_val: float,
    lower_is_better: bool = True
) -> Dict[str, Any]:
    """
    Compute absolute difference and percentage improvement.

    Parameters:
    - lower_is_better: True for queues and waiting time; False for throughput/discharge/utilization.
    """
    if lower_is_better:
        abs_diff = round(fixed_val - adaptive_val, 2)
        better_dir = "lower_is_better"
        pct_imp = (
            round(((fixed_val - adaptive_val) / fixed_val) * 100.0, 2)
            if fixed_val > 0
            else None
        )
    else:
        abs_diff = round(adaptive_val - fixed_val, 2)
        better_dir = "higher_is_better"
        pct_imp = (
            round(((adaptive_val - fixed_val) / fixed_val) * 100.0, 2)
            if fixed_val > 0
            else None
        )

    return {
        "fixed": round(fixed_val, 2),
        "adaptive": round(adaptive_val, 2),
        "absolute_difference": abs_diff,
        "improvement_percentage": pct_imp,
        "direction": better_dir
    }


def compare_strategies_multi_run(
    initial_queues: Dict[str, int],
    arrival_rates: Dict[str, float],
    cycles: int = 5,
    runs: int = 5,
    base_seed: Optional[int] = None,
    lanes: Optional[Dict[str, int]] = None,
    saturation_flow_rates: Optional[Dict[str, float]] = None,
    startup_lost_times: Optional[Dict[str, float]] = None,
    discharge_policy: str = "independent_floor"
) -> Dict[str, Any]:
    """
    Run multi-trial Monte Carlo comparison between Fixed and Adaptive strategies
    with synchronized Common Random Numbers and identical capacity constraints.
    Limits: 1 <= runs <= 50 to prevent unbounded computation while ensuring statistical rigor.
    """
    if not isinstance(runs, int) or isinstance(runs, bool) or runs < 1 or runs > 50:
        raise ValueError("Simulation runs must be an integer between 1 and 50.")

    if base_seed is not None:
        if not isinstance(base_seed, int) or isinstance(base_seed, bool) or base_seed < 0:
            raise ValueError("base_seed must be a non-negative integer or None.")

    effective_base_seed = (
        base_seed
        if base_seed is not None
        else int(np.random.default_rng().integers(0, 2**31 - 1))
    )

    base_rng = np.random.default_rng(effective_base_seed)
    run_seeds = [int(base_rng.integers(0, 2**31 - 1)) for _ in range(runs)]

    per_run_results = []

    fixed_final_waitings = []
    adaptive_final_waitings = []

    fixed_wait_times = []
    adaptive_wait_times = []

    fixed_discharged_totals = []
    adaptive_discharged_totals = []

    fixed_avg_queues = []
    adaptive_avg_queues = []

    fixed_max_queues = []
    adaptive_max_queues = []

    fixed_cap_utilizations = []
    adaptive_cap_utilizations = []

    fixed_dir_final_queues: Dict[str, List[int]] = {d: [] for d in DIRECTIONS}
    adaptive_dir_final_queues: Dict[str, List[int]] = {d: [] for d in DIRECTIONS}

    fixed_dir_wait_times: Dict[str, List[float]] = {d: [] for d in DIRECTIONS}
    adaptive_dir_wait_times: Dict[str, List[float]] = {d: [] for d in DIRECTIONS}

    fixed_dir_green_times: Dict[str, List[float]] = {d: [] for d in DIRECTIONS}
    adaptive_dir_green_times: Dict[str, List[float]] = {d: [] for d in DIRECTIONS}

    adaptive_wins = 0
    fixed_wins = 0
    ties = 0

    # Paired differences per run
    paired_waiting_differences = []  # D_i = Fixed - Adaptive (vehicles saved)
    paired_waiting_time_differences = []  # Delay saved in seconds

    for idx, r_seed in enumerate(run_seeds, 1):
        # Run identical arrivals and capacity parameters for both strategies
        fixed_res = simulate_intersection(
            initial_queues=initial_queues,
            arrival_rates=arrival_rates,
            cycles=cycles,
            strategy="fixed",
            random_seed=r_seed,
            lanes=lanes,
            saturation_flow_rates=saturation_flow_rates,
            startup_lost_times=startup_lost_times,
            discharge_policy=discharge_policy
        )

        adaptive_res = simulate_intersection(
            initial_queues=initial_queues,
            arrival_rates=arrival_rates,
            cycles=cycles,
            strategy="adaptive",
            random_seed=r_seed,
            lanes=lanes,
            saturation_flow_rates=saturation_flow_rates,
            startup_lost_times=startup_lost_times,
            discharge_policy=discharge_policy
        )

        f_wait = sum(fixed_res["final_queues"].values())
        a_wait = sum(adaptive_res["final_queues"].values())

        fixed_final_waitings.append(f_wait)
        adaptive_final_waitings.append(a_wait)

        diff_wait = f_wait - a_wait
        paired_waiting_differences.append(diff_wait)

        f_metrics = fixed_res["metrics"]["overall"]
        a_metrics = adaptive_res["metrics"]["overall"]

        f_wait_time = f_metrics["estimated_average_waiting_time_seconds"]
        a_wait_time = a_metrics["estimated_average_waiting_time_seconds"]

        fixed_wait_times.append(f_wait_time)
        adaptive_wait_times.append(a_wait_time)
        paired_waiting_time_differences.append(round(f_wait_time - a_wait_time, 2))

        fixed_discharged_totals.append(f_metrics["total_discharged"])
        adaptive_discharged_totals.append(a_metrics["total_discharged"])

        fixed_avg_queues.append(f_metrics["average_queue_length"])
        adaptive_avg_queues.append(a_metrics["average_queue_length"])

        fixed_max_queues.append(f_metrics["maximum_queue_length"])
        adaptive_max_queues.append(a_metrics["maximum_queue_length"])

        f_cap_util = f_metrics.get("overall_capacity_utilization_percentage", 0.0)
        a_cap_util = a_metrics.get("overall_capacity_utilization_percentage", 0.0)
        fixed_cap_utilizations.append(f_cap_util)
        adaptive_cap_utilizations.append(a_cap_util)

        for d in DIRECTIONS:
            fixed_dir_final_queues[d].append(fixed_res["final_queues"][d])
            adaptive_dir_final_queues[d].append(adaptive_res["final_queues"][d])

            fixed_dir_wait_times[d].append(
                fixed_res["metrics"]["by_direction"][d]["estimated_average_waiting_time_seconds"]
            )
            adaptive_dir_wait_times[d].append(
                adaptive_res["metrics"]["by_direction"][d]["estimated_average_waiting_time_seconds"]
            )

            fixed_dir_green_times[d].append(
                fixed_res["metrics"]["by_direction"][d]["average_green_time_seconds"]
            )
            adaptive_dir_green_times[d].append(
                adaptive_res["metrics"]["by_direction"][d]["average_green_time_seconds"]
            )

        if a_wait < f_wait:
            winner = "adaptive"
            adaptive_wins += 1
        elif f_wait < a_wait:
            winner = "fixed"
            fixed_wins += 1
        else:
            winner = "tie"
            ties += 1

        per_run_results.append({
            "run": idx,
            "run_seed": r_seed,
            "fixed_final_waiting": f_wait,
            "adaptive_final_waiting": a_wait,
            "vehicles_saved": diff_wait,
            "fixed_waiting_time": f_wait_time,
            "adaptive_waiting_time": a_wait_time,
            "fixed_discharged": f_metrics["total_discharged"],
            "adaptive_discharged": a_metrics["total_discharged"],
            "fixed_capacity_utilization": f_cap_util,
            "adaptive_capacity_utilization": a_cap_util,
            "winner": winner
        })

    # Calculate aggregate averages
    fixed_mean_final_waiting = sum(fixed_final_waitings) / runs
    adaptive_mean_final_waiting = sum(adaptive_final_waitings) / runs

    fixed_mean_wait_time = sum(fixed_wait_times) / runs
    adaptive_mean_wait_time = sum(adaptive_wait_times) / runs

    fixed_mean_discharged = sum(fixed_discharged_totals) / runs
    adaptive_mean_discharged = sum(adaptive_discharged_totals) / runs

    fixed_mean_avg_queue = sum(fixed_avg_queues) / runs
    adaptive_mean_avg_queue = sum(adaptive_avg_queues) / runs

    fixed_mean_max_queue = sum(fixed_max_queues) / runs
    adaptive_mean_max_queue = sum(adaptive_max_queues) / runs

    fixed_mean_cap_util = sum(fixed_cap_utilizations) / runs
    adaptive_mean_cap_util = sum(adaptive_cap_utilizations) / runs

    fixed_dir_means = {
        d: round(sum(fixed_dir_final_queues[d]) / runs, 2) for d in DIRECTIONS
    }
    adaptive_dir_means = {
        d: round(sum(adaptive_dir_final_queues[d]) / runs, 2) for d in DIRECTIONS
    }

    direction_comparisons = {}
    for d in DIRECTIONS:
        direction_comparisons[d] = {
            "final_queue": compute_relative_improvement(
                fixed_dir_means[d],
                adaptive_dir_means[d],
                lower_is_better=True
            ),
            "waiting_time": compute_relative_improvement(
                sum(fixed_dir_wait_times[d]) / runs,
                sum(adaptive_dir_wait_times[d]) / runs,
                lower_is_better=True
            ),
            "average_green_time": {
                "fixed": round(sum(fixed_dir_green_times[d]) / runs, 2),
                "adaptive": round(sum(adaptive_dir_green_times[d]) / runs, 2)
            },
            "maximum_observed_queue": {
                "fixed": max(fixed_dir_final_queues[d]),
                "adaptive": max(adaptive_dir_final_queues[d])
            }
        }

    overall_vehicles_saved = round(fixed_mean_final_waiting - adaptive_mean_final_waiting, 2)
    overall_imp_pct = (
        round(((fixed_mean_final_waiting - adaptive_mean_final_waiting) / fixed_mean_final_waiting) * 100.0, 2)
        if fixed_mean_final_waiting > 0
        else 0.0
    )

    # Paired-difference statistics
    mean_paired_diff = sum(paired_waiting_differences) / runs
    std_paired_diff = calculate_sample_std(paired_waiting_differences)
    se_paired_diff = round(std_paired_diff / sqrt(runs), 2) if runs > 0 else 0.0

    if runs > 1:
        t_crit = get_t_critical(runs - 1)
        margin = t_crit * (std_paired_diff / sqrt(runs))
        ci_95 = {
            "lower": round(mean_paired_diff - margin, 2),
            "upper": round(mean_paired_diff + margin, 2),
            "confidence_level": 0.95,
            "degrees_of_freedom": runs - 1,
            "t_critical": round(t_crit, 3)
        }
    else:
        ci_95 = {
            "lower": None,
            "upper": None,
            "confidence_level": 0.95,
            "degrees_of_freedom": 0,
            "t_critical": None,
            "note": "Confidence interval requires at least 2 simulation runs"
        }

    metrics_comparison = {
        "final_waiting": compute_relative_improvement(
            fixed_mean_final_waiting, adaptive_mean_final_waiting, lower_is_better=True
        ),
        "waiting_time": compute_relative_improvement(
            fixed_mean_wait_time, adaptive_mean_wait_time, lower_is_better=True
        ),
        "total_discharged": compute_relative_improvement(
            fixed_mean_discharged, adaptive_mean_discharged, lower_is_better=False
        ),
        "capacity_utilization": compute_relative_improvement(
            fixed_mean_cap_util, adaptive_mean_cap_util, lower_is_better=False
        ),
        "average_queue_length": compute_relative_improvement(
            fixed_mean_avg_queue, adaptive_mean_avg_queue, lower_is_better=True
        ),
        "maximum_queue_length": compute_relative_improvement(
            fixed_mean_max_queue, adaptive_mean_max_queue, lower_is_better=True
        ),
    }

    statistical_reliability = {
        "total_runs": runs,
        "base_seed": effective_base_seed,
        "adaptive_wins": adaptive_wins,
        "fixed_wins": fixed_wins,
        "ties": ties,
        "win_rate_adaptive_percentage": round((adaptive_wins / runs) * 100.0, 2),
        "win_rate_fixed_percentage": round((fixed_wins / runs) * 100.0, 2),
        "standard_deviations": {
            "fixed_final_waiting": calculate_sample_std(fixed_final_waitings),
            "adaptive_final_waiting": calculate_sample_std(adaptive_final_waitings),
            "fixed_waiting_time": calculate_sample_std(fixed_wait_times),
            "adaptive_waiting_time": calculate_sample_std(adaptive_wait_times),
            "fixed_discharged": calculate_sample_std(fixed_discharged_totals),
            "adaptive_discharged": calculate_sample_std(adaptive_discharged_totals),
            "fixed_capacity_utilization": calculate_sample_std(fixed_cap_utilizations),
            "adaptive_capacity_utilization": calculate_sample_std(adaptive_cap_utilizations),
        },
        "paired_difference_statistics": {
            "metric": "vehicles_saved (fixed_waiting - adaptive_waiting)",
            "mean_paired_difference": round(mean_paired_diff, 2),
            "sample_std_paired_difference": std_paired_diff,
            "standard_error": se_paired_diff,
            "confidence_interval_95": ci_95,
            "distinction_note": "The paired-difference standard deviation s_D reflects the variance of run-by-run differences (D_i = W_F,i - W_A,i). Because Common Random Numbers induce positive correlation between paired runs, s_D is typically smaller than the sum of individual strategy standard deviations: Var(W_F - W_A) = Var(W_F) + Var(W_A) - 2*Cov(W_F, W_A).",
            "crn_methodology_note": "Common Random Numbers (CRN) synchronizes arrival streams to isolate control strategy effects from arrival stochasticity. While effective for variance reduction on monotonic queuing models, CRN is a variance-reduction technique and does not guarantee variance reduction under arbitrary non-monotonic traffic dynamics."
        },
        "ranges": {
            "fixed_final_waiting": {
                "min": min(fixed_final_waitings),
                "max": max(fixed_final_waitings)
            },
            "adaptive_final_waiting": {
                "min": min(adaptive_final_waitings),
                "max": max(adaptive_final_waitings)
            }
        },
        "maximum_observed_queue_overall": {
            "fixed": max(fixed_max_queues),
            "adaptive": max(adaptive_max_queues)
        },
        "note": "Traffic arrivals vary according to independent Poisson processes per run. Multi-run comparisons quantify expected performance gains and statistical variability under identical capacity configurations."
    }

    sim_config = fixed_res["configuration"]

    return {
        # Preserved legacy response fields for backward compatibility
        "fixed_strategy": {
            "final_queues": fixed_dir_means,
            "total_waiting": round(fixed_mean_final_waiting, 2),
            "average_waiting_time": round(fixed_mean_wait_time, 2),
            "average_discharged": round(fixed_mean_discharged, 2),
            "average_queue_length": round(fixed_mean_avg_queue, 2),
            "maximum_queue_length": round(fixed_mean_max_queue, 2),
            "average_capacity_utilization": round(fixed_mean_cap_util, 2),
            "std_final_waiting": calculate_sample_std(fixed_final_waitings)
        },
        "adaptive_strategy": {
            "final_queues": adaptive_dir_means,
            "total_waiting": round(adaptive_mean_final_waiting, 2),
            "average_waiting_time": round(adaptive_mean_wait_time, 2),
            "average_discharged": round(adaptive_mean_discharged, 2),
            "average_queue_length": round(adaptive_mean_avg_queue, 2),
            "maximum_queue_length": round(adaptive_mean_max_queue, 2),
            "average_capacity_utilization": round(adaptive_mean_cap_util, 2),
            "std_final_waiting": calculate_sample_std(adaptive_final_waitings)
        },
        "comparison": {
            "vehicles_saved": overall_vehicles_saved,
            "improvement_percentage": overall_imp_pct,
            "random_seed": effective_base_seed,
            "metrics": metrics_comparison,
            "by_direction": direction_comparisons
        },
        "statistical_reliability": statistical_reliability,
        "per_run_results": per_run_results,
        "configuration": {
            "initial_queues": initial_queues,
            "arrival_rates": arrival_rates,
            "cycles": cycles,
            "runs": runs,
            "base_seed": effective_base_seed,
            "lanes": sim_config["lanes"],
            "saturation_flow_rates": sim_config["saturation_flow_rates"],
            "startup_lost_times": sim_config["startup_lost_times"],
            "integer_discharge_policy": sim_config["integer_discharge_policy"]
        }
    }

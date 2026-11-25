from math import isinf, isnan
from typing import Any, Dict, List, Optional

DIRECTIONS = ["north", "south", "east", "west"]


def calculate_simulation_metrics(
    history: List[Dict[str, Any]],
    initial_queues: Dict[str, int],
    cycle_time: int = 120,
    lanes: Optional[Dict[str, int]] = None,
    saturation_flow_rates: Optional[Dict[str, float]] = None,
    startup_lost_times: Optional[Dict[str, float]] = None
) -> Dict[str, Any]:
    """
    Calculate cycle-level, directional, and overall macroscopic performance metrics
    from traffic simulation history, incorporating lane capacity constraints.

    Mathematical Assumptions:
    - Discrete Cycle-Level Aggregation:
      The simulation operates at macroscopic cycle-level intervals (default: 120s)
      without continuous microscopic vehicle trajectories.
    - Capacity Formulation (HCM-based):
      Effective green time: g_d = max(0, G_d - l_s)
      Theoretical capacity: C_d = s_d * L_d * (g_d / 3600)
      Discharge capacity: floor(C_d) (strict integer policy, no upward rounding)
      Capacity utilization: (actual_discharged / theoretical_capacity) * 100%
    - Queue Delay Approximation:
      For each cycle c and direction d, the effective average queue size is
      approximated trapezoidally as:
          q_avg = (queue_before_discharge + queue_after) / 2
      The accumulated delay in vehicle-seconds is:
          delay_cycle = q_avg * cycle_time
    - Estimated Average Waiting Time:
      Calculated as total vehicle-seconds of delay divided by total vehicle
      demand (initial queue + total arrivals). This is a macroscopic proxy
      for relative strategy comparison, not an exact real-world sensor telemetry.
    - Queue Reduction Percentage:
      Calculated as:
          ((total_initial_queue - total_final_queue) / total_initial_queue) * 100
      When initial queue is 0, reduction is reported as 0.0%.
    - Vehicle Conservation Law:
      Final Queue = Initial Queue + Total Arrivals - Total Discharged
    """
    directions = DIRECTIONS

    if not isinstance(history, list) or len(history) == 0:
        raise ValueError("Simulation history must be a non-empty list of cycles.")

    if set(initial_queues.keys()) != set(directions):
        raise ValueError("Initial queues must contain north, south, east, and west.")

    if not isinstance(cycle_time, int) or isinstance(cycle_time, bool) or cycle_time <= 0:
        raise ValueError("cycle_time must be a positive integer.")

    num_cycles = len(history)
    total_initial_queue = sum(initial_queues[d] for d in directions)

    direction_metrics: Dict[str, Dict[str, Any]] = {}

    total_arrivals_overall = 0
    total_discharged_overall = 0
    total_delay_seconds_overall = 0.0
    total_theoretical_capacity_overall = 0.0
    all_cycle_queues_overall: List[int] = []

    for d in directions:
        init_q = initial_queues[d]
        d_arrivals = sum(c["arrivals"][d] for c in history)
        d_discharged = sum(c["discharged"][d] for c in history)
        d_green_total = sum(c["green_times"][d] for c in history)
        final_q = history[-1]["queues_after"][d]

        # Capacity metrics
        d_theo_capacity = sum(
            c.get("theoretical_capacities", {}).get(d, 0.0) for c in history
        )
        d_eff_green_total = sum(
            c.get("effective_green_times", {}).get(d, float(c["green_times"][d]))
            for c in history
        )

        d_cap_utilization = (
            round((d_discharged / d_theo_capacity) * 100.0, 2)
            if d_theo_capacity > 0
            else 0.0
        )

        # Queue tracking across all cycles for this direction
        queues_after_list = [c["queues_after"][d] for c in history]
        all_cycle_queues_overall.extend(queues_after_list)

        avg_queue_d = sum(queues_after_list) / num_cycles
        max_queue_d = max(
            [init_q]
            + [
                c.get("queues_before_discharge", {}).get(d, c["queues_before"][d] + c["arrivals"][d])
                for c in history
            ]
            + queues_after_list
        )

        # Queue reduction percentage
        if init_q > 0:
            reduction_pct_d = ((init_q - final_q) / init_q) * 100.0
        else:
            reduction_pct_d = 0.0

        # Accumulated delay in vehicle-seconds for direction d
        d_delay_seconds = 0.0
        for c in history:
            q_start = c.get("queues_before_discharge", {}).get(
                d, c["queues_before"][d] + c["arrivals"][d]
            )
            q_end = c["queues_after"][d]
            q_avg = (q_start + q_end) / 2.0
            d_delay_seconds += q_avg * cycle_time

        d_demand = init_q + d_arrivals
        d_avg_wait_sec = (d_delay_seconds / d_demand) if d_demand > 0 else 0.0

        direction_metrics[d] = {
            "initial_queue": init_q,
            "total_arrivals": d_arrivals,
            "total_discharged": d_discharged,
            "actual_vehicles_discharged": d_discharged,
            "theoretical_discharge_capacity": round(d_theo_capacity, 2),
            "capacity_utilization_percentage": d_cap_utilization,
            "final_queue": final_q,
            "average_queue_length": round(avg_queue_d, 2),
            "maximum_queue_length": max_queue_d,
            "queue_reduction_percentage": round(reduction_pct_d, 2),
            "total_green_time_seconds": d_green_total,
            "average_green_time_seconds": round(d_green_total / num_cycles, 2),
            "total_effective_green_time_seconds": round(d_eff_green_total, 2),
            "average_effective_green_time_seconds": round(d_eff_green_total / num_cycles, 2),
            "estimated_average_waiting_time_seconds": round(d_avg_wait_sec, 2),
            "lanes": lanes.get(d) if lanes else None,
            "saturation_flow_rate": saturation_flow_rates.get(d) if saturation_flow_rates else None,
            "startup_lost_time_seconds": startup_lost_times.get(d) if startup_lost_times else None,
        }

        total_arrivals_overall += d_arrivals
        total_discharged_overall += d_discharged
        total_delay_seconds_overall += d_delay_seconds
        total_theoretical_capacity_overall += d_theo_capacity

    total_final_queue = sum(history[-1]["queues_after"][d] for d in directions)

    if total_initial_queue > 0:
        total_reduction_pct = ((total_initial_queue - total_final_queue) / total_initial_queue) * 100.0
    else:
        total_reduction_pct = 0.0

    total_demand_overall = total_initial_queue + total_arrivals_overall
    overall_avg_wait_sec = (
        (total_delay_seconds_overall / total_demand_overall)
        if total_demand_overall > 0
        else 0.0
    )

    avg_queue_overall = sum(all_cycle_queues_overall) / len(all_cycle_queues_overall)
    max_queue_overall = max(direction_metrics[d]["maximum_queue_length"] for d in directions)

    overall_capacity_utilization = (
        round((total_discharged_overall / total_theoretical_capacity_overall) * 100.0, 2)
        if total_theoretical_capacity_overall > 0
        else 0.0
    )

    conservation_verified = bool(
        total_final_queue == (total_initial_queue + total_arrivals_overall - total_discharged_overall)
    )

    overall_metrics = {
        "total_initial_queue": total_initial_queue,
        "total_arrivals": total_arrivals_overall,
        "total_discharged": total_discharged_overall,
        "total_throughput": total_discharged_overall,
        "total_remaining": total_final_queue,
        "total_theoretical_capacity": round(total_theoretical_capacity_overall, 2),
        "overall_capacity_utilization_percentage": overall_capacity_utilization,
        "average_queue_length": round(avg_queue_overall, 2),
        "maximum_queue_length": max_queue_overall,
        "queue_reduction_percentage": round(total_reduction_pct, 2),
        "estimated_average_waiting_time_seconds": round(overall_avg_wait_sec, 2),
        "vehicle_conservation_verified": conservation_verified,
    }

    return {
        "overall": overall_metrics,
        "by_direction": direction_metrics,
        "assumptions": {
            "capacity_formulation": "C_d = s_d * L_d * (g_d / 3600) with g_d = max(0, G_d - l_s)",
            "integer_discharge_policy": "floor(C_d) - no upward rounding of theoretical capacity",
            "capacity_utilization": "(discharged / theoretical_capacity) * 100%",
            "waiting_time_model": "Macroscopic cycle-average queue accumulation (delay = avg_queue * cycle_time)",
            "queue_profile": "Trapezoidal approximation between pre-discharge and post-discharge queue",
            "cycle_duration_seconds": cycle_time,
            "note": "Estimates are macroscopic comparative proxies for traffic signal strategy evaluation, not microscopic simulation telemetry (e.g. SUMO/VISSIM)."
        }
    }

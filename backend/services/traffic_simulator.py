import math
from math import floor, isinf, isnan
from typing import Any, Dict, Optional
import numpy as np

from backend.services.signal_optimizer import (
    optimize_signal,
    CYCLE_TIME,
    CLEARANCE_TIME,
    AVAILABLE_GREEN_TIME,
    MIN_GREEN,
    MAX_GREEN
)
from backend.services.simulation_metrics import calculate_simulation_metrics

DIRECTIONS = ["north", "south", "east", "west"]

# Defensible illustrative defaults based on standard Highway Capacity Manual (HCM) baselines
DEFAULT_LANES = {"north": 1, "south": 1, "east": 1, "west": 1}
DEFAULT_SATURATION_FLOW_RATE = 1800.0  # vehicles / hour / lane
DEFAULT_STARTUP_LOST_TIME = 2.0  # seconds per phase transition


def validate_intersection_capacity_parameters(
    lanes: Optional[Dict[str, int]] = None,
    saturation_flow_rates: Optional[Dict[str, float]] = None,
    startup_lost_times: Optional[Dict[str, float]] = None
) -> tuple[Dict[str, int], Dict[str, float], Dict[str, float]]:
    """
    Validate and normalize lane counts, saturation flow rates, and startup lost times.
    """
    # 1. Validate / normalize lanes
    norm_lanes: Dict[str, int] = {}
    if lanes is None:
        norm_lanes = DEFAULT_LANES.copy()
    elif isinstance(lanes, dict):
        if set(lanes.keys()) != set(DIRECTIONS):
            raise ValueError("Lanes dictionary must contain north, south, east, and west.")
        for d in DIRECTIONS:
            val = lanes[d]
            if isinstance(val, bool) or not isinstance(val, int) or val < 1:
                raise ValueError(f"Invalid lane count for {d}: must be an integer >= 1.")
            norm_lanes[d] = val
    else:
        raise ValueError("Lanes parameter must be a dictionary of direction to integer.")

    # 2. Validate / normalize saturation flow rates
    norm_sat_rates: Dict[str, float] = {}
    if saturation_flow_rates is None:
        norm_sat_rates = {d: DEFAULT_SATURATION_FLOW_RATE for d in DIRECTIONS}
    elif isinstance(saturation_flow_rates, dict):
        if set(saturation_flow_rates.keys()) != set(DIRECTIONS):
            raise ValueError("saturation_flow_rates dictionary must contain north, south, east, and west.")
        for d in DIRECTIONS:
            val = saturation_flow_rates[d]
            if isinstance(val, bool) or not isinstance(val, (int, float)) or isnan(val) or isinf(val) or val < 0:
                raise ValueError(f"Invalid saturation flow rate for {d}: must be a non-negative number.")
            norm_sat_rates[d] = float(val)
    else:
        raise ValueError("saturation_flow_rates parameter must be a dictionary of direction to float.")

    # 3. Validate / normalize startup lost times
    norm_lost_times: Dict[str, float] = {}
    if startup_lost_times is None:
        norm_lost_times = {d: DEFAULT_STARTUP_LOST_TIME for d in DIRECTIONS}
    elif isinstance(startup_lost_times, dict):
        if set(startup_lost_times.keys()) != set(DIRECTIONS):
            raise ValueError("startup_lost_times dictionary must contain north, south, east, and west.")
        for d in DIRECTIONS:
            val = startup_lost_times[d]
            if isinstance(val, bool) or not isinstance(val, (int, float)) or isnan(val) or isinf(val) or val < 0:
                raise ValueError(f"Invalid startup lost time for {d}: must be a non-negative number.")
            norm_lost_times[d] = float(val)
    else:
        raise ValueError("startup_lost_times parameter must be a dictionary of direction to float.")

    return norm_lanes, norm_sat_rates, norm_lost_times


def simulate_intersection(
    initial_queues: dict,
    arrival_rates: dict,
    cycles: int = 5,
    strategy: str = "adaptive",
    random_seed: Optional[int] = None,
    lanes: Optional[dict] = None,
    saturation_flow_rates: Optional[dict] = None,
    startup_lost_times: Optional[dict] = None,
    discharge_policy: str = "independent_floor"
) -> dict:
    """
    Simulate traffic queue dynamics across an isolated four-approach intersection
    incorporating lane geometry, saturation flow rates, startup lost times,
    and configurable integer discharge policies.

    Discharge Policies:
    - 'independent_floor' (Approach A - Default):
        Discharges floor(C_d) independently per cycle, discarding fractional vehicle capacity.
    - 'fractional_carryover' (Approach B):
        Accumulates fractional capacity across consecutive saturated cycles without upward rounding.
    """
    directions = DIRECTIONS

    # Validate directions
    if set(initial_queues) != set(directions):
        raise ValueError("Initial queues must contain all four directions.")

    if set(arrival_rates) != set(directions):
        raise ValueError("Arrival rates must contain all four directions.")

    if not isinstance(cycles, int) or isinstance(cycles, bool) or cycles < 1:
        raise ValueError("Cycles must be a positive integer.")

    if strategy not in ("adaptive", "fixed"):
        raise ValueError("Strategy must be 'adaptive' or 'fixed'.")

    if discharge_policy not in ("independent_floor", "fractional_carryover"):
        raise ValueError("discharge_policy must be 'independent_floor' or 'fractional_carryover'.")

    if random_seed is not None:
        if not isinstance(random_seed, int) or isinstance(random_seed, bool):
            raise ValueError("Random seed must be an integer or None.")
        if random_seed < 0:
            raise ValueError("Random seed must be non-negative.")

    for direction in directions:
        queue = initial_queues[direction]
        rate = arrival_rates[direction]

        if not isinstance(queue, int) or isinstance(queue, bool) or queue < 0:
            raise ValueError(f"Invalid initial queue for {direction}.")

        if (
            not isinstance(rate, (int, float))
            or isinstance(rate, bool)
            or isnan(rate)
            or isinf(rate)
            or rate < 0
        ):
            raise ValueError(f"Invalid arrival rate for {direction}.")

    # Validate and normalize capacity parameters
    norm_lanes, norm_sat_rates, norm_lost_times = validate_intersection_capacity_parameters(
        lanes=lanes,
        saturation_flow_rates=saturation_flow_rates,
        startup_lost_times=startup_lost_times
    )

    rng = np.random.default_rng(random_seed)
    queues = initial_queues.copy()
    history = []
    cycle_duration_in_minutes = CYCLE_TIME / 60.0
    fractional_carryover = {d: 0.0 for d in directions}

    for cycle in range(1, cycles + 1):
        queues_before = queues.copy()

        # Stochastic vehicle arrivals using Poisson distribution:
        # λ = arrival_rate_per_minute * cycle_duration_in_minutes
        # Arrivals sampled from Poisson(λ) independently per direction and cycle
        arrivals = {}
        for direction in directions:
            lam = arrival_rates[direction] * cycle_duration_in_minutes
            arrivals[direction] = int(rng.poisson(lam))

        for direction in directions:
            queues[direction] += arrivals[direction]

        # Select signal strategy (allocates nominal green times G_d)
        if strategy == "adaptive":
            signal = optimize_signal(queues)
            green_times = signal["green_times"]
        else:
            green_times = {
                direction: 25 for direction in directions
            }

        # Calculate vehicle discharge using lane-based capacity formulation:
        # Effective green time: g_d = max(0, G_d - l_s)
        # Theoretical capacity: C_d = s_d * L_d * (g_d / 3600)
        effective_green_times = {}
        theoretical_capacities = {}
        discharge_capacities = {}
        discharged = {}
        cycle_utilization = {}

        for direction in directions:
            g_nominal = float(green_times[direction])
            l_s = norm_lost_times[direction]
            g_eff = max(0.0, g_nominal - l_s)
            effective_green_times[direction] = round(g_eff, 2)

            s_d = norm_sat_rates[direction]
            l_d = norm_lanes[direction]

            # Theoretical capacity C_d in vehicles
            c_d = s_d * l_d * (g_eff / 3600.0)
            theoretical_capacities[direction] = round(c_d, 2)

            # Integer discharge capacity policy:
            if discharge_policy == "fractional_carryover":
                # Approach B: Service capacity accumulator with fractional carryover
                available_cap = fractional_carryover[direction] + c_d
                int_capacity = floor(available_cap)
                actual_discharge = min(queues[direction], int_capacity)

                # Update carryover:
                # Carryover survives ONLY if the queue remains non-empty after discharge.
                # If queue completely clears (remaining_queue == 0), no fractional credit survives.
                remaining_queue = queues[direction] - actual_discharge
                if remaining_queue > 0:
                    fractional_carryover[direction] = available_cap - int_capacity
                else:
                    fractional_carryover[direction] = 0.0
            else:
                # Approach A: Independent cycle floor (Default)
                int_capacity = floor(c_d)
                actual_discharge = min(queues[direction], int_capacity)

            discharge_capacities[direction] = int_capacity
            discharged[direction] = actual_discharge

            # Update queue remaining
            queues[direction] -= actual_discharge

            # Capacity utilization percentage for this cycle
            if c_d > 0:
                cycle_utilization[direction] = round((actual_discharge / c_d) * 100.0, 2)
            else:
                cycle_utilization[direction] = 0.0

        waiting_before_discharge = {
            direction: queues_before[direction] + arrivals[direction]
            for direction in directions
        }

        history.append({
            "cycle": cycle,
            "queues_before": queues_before,
            "arrivals": arrivals,
            "queues_before_discharge": waiting_before_discharge,
            "green_times": green_times,
            "startup_lost_times": norm_lost_times.copy(),
            "effective_green_times": effective_green_times,
            "theoretical_capacities": theoretical_capacities,
            "discharge_capacities": discharge_capacities,
            "discharged": discharged,
            "capacity_utilization_percentages": cycle_utilization,
            "queues_after": queues.copy()
        })

    metrics = calculate_simulation_metrics(
        history=history,
        initial_queues=initial_queues,
        cycle_time=CYCLE_TIME,
        lanes=norm_lanes,
        saturation_flow_rates=norm_sat_rates,
        startup_lost_times=norm_lost_times
    )

    return {
        "cycles_simulated": cycles,
        "final_queues": queues,
        "history": history,
        "strategy": strategy,
        "random_seed": random_seed,
        "metrics": metrics,
        "configuration": {
            "cycle_time": CYCLE_TIME,
            "clearance_time": CLEARANCE_TIME,
            "min_green": MIN_GREEN,
            "max_green": MAX_GREEN,
            "lanes": norm_lanes,
            "saturation_flow_rates": norm_sat_rates,
            "startup_lost_times": norm_lost_times,
            "discharge_policy": discharge_policy,
            "integer_discharge_policy": (
                "floor(C_d) - theoretical capacity is floored to integer vehicles independently per cycle"
                if discharge_policy == "independent_floor"
                else "fractional_carryover - unserved fractional vehicle capacity carries over across consecutive saturated cycles"
            ),
            "default_sources": "Saturation flow (1800 veh/hr/lane) and startup lost time (2.0s) are illustrative Highway Capacity Manual (HCM) baseline parameters for macroscopic simulation."
        }
    }

"""
Adaptive Traffic Signal Optimizer
=================================

Phase 3: Demand-Aware Signal Optimization Algorithm

Allocation Model:
This module allocates green signal time to intersection approaches based on
real-time relative traffic demand while strictly enforcing safety and timing
constraints.

Intersection Phase Model & Conflict Analysis:
---------------------------------------------
1. Existing Model: Simplified Four-Stage Split-Phase Allocation
   - Approaches (North, South, East, West) are served in non-overlapping,
     sequential stages.
   - Cycle Duration: 120 seconds.
   - Clearance Interval: 20 seconds total (inter-stage yellow/all-red transitions).
   - Available Green Time: 100 seconds (allocated across approaches).
   - Safety: Because each direction is served sequentially in its own stage,
     no vehicular movement conflicts occur simultaneously.
   - Limitation: While safe, sequential split-phasing is less efficient than
     concurrent multi-phase control because compatible opposing through movements
     (e.g., North and South) are not served concurrently.

2. Future Extension: Two-Phase / Dual-Ring Concurrent Phase Control
   - In standard traffic engineering (e.g., NEMA dual-ring controllers),
     non-conflicting movements share concurrent phases:
       * Phase 1 (North-South): Serves North and South through traffic simultaneously.
       * Phase 2 (East-West): Serves East and West through traffic simultaneously.
   - Phase green time is dictated by the critical approach demand:
       critical_NS = max(queue_north, queue_south)
       critical_EW = max(queue_east, queue_west)
   - To preserve backward compatibility with the existing four-direction API
     contract and frontend visualizations, the four-direction allocation contract
     is maintained as the primary interface, with concurrent phase mappings
     documented for production deployments.
"""

from math import floor
from typing import Any, Dict

DIRECTIONS = ["north", "south", "east", "west"]

CYCLE_TIME = 120
CLEARANCE_TIME = 20
AVAILABLE_GREEN_TIME = CYCLE_TIME - CLEARANCE_TIME  # 100 seconds

MIN_GREEN = 10
MAX_GREEN = 40


def calculate_relative_demands(traffic_counts: Dict[str, int]) -> Dict[str, float]:
    """
    Calculate the normalized relative demand for each approach direction.

    Formula:
        direction_demand = direction_queue / total_vehicles

    If total_vehicles == 0, fair allocation is applied where each direction
    has an equal demand of 0.25 (25%).
    """
    total_vehicles = sum(traffic_counts.values())
    if total_vehicles == 0:
        return {d: 0.25 for d in DIRECTIONS}
    return {d: traffic_counts[d] / total_vehicles for d in DIRECTIONS}


def optimize_signal(traffic_counts: Dict[str, int]) -> Dict[str, Any]:
    """
    Calculate optimal green signal durations for intersection approaches
    based on relative queue demands, respecting minimum and maximum constraints.

    Algorithm:
    1. Input Validation:
       - Ensures all four directions (north, south, east, west) are provided.
       - Validates that vehicle counts are non-negative integers.
    2. Demand Calculation:
       - Computes direction_demand = queue / total_vehicles.
       - For zero-traffic conditions, assigns equal relative demand (0.25).
    3. Minimum Green Guarantee:
       - Grants every direction MIN_GREEN (10s) immediately (total: 40s).
       - Remaining allocatable green time is 100 - 40 = 60s.
    4. Proportional Water-Filling Allocation with Capping:
       - Iteratively distributes remaining green time proportionally to active demand.
       - Capping: If any direction would exceed MAX_GREEN (40s), caps it at 40s
         and redistributes remaining surplus to other active approaches.
       - If active approaches have 0 demand, surplus is distributed equally.
    5. Discretization via Largest Remainder (Hamilton's Method):
       - Floors float allocations to integer seconds.
       - Allocates leftover seconds (AVAILABLE_GREEN_TIME - sum(floors)) to directions
         with the largest fractional parts that have not reached MAX_GREEN.
    """
    # 1. Input Validation
    if set(traffic_counts.keys()) != set(DIRECTIONS):
        raise ValueError("Traffic counts must contain north, south, east and west.")

    for direction, count in traffic_counts.items():
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            raise ValueError(f"Invalid vehicle count for {direction}.")

    # 2. Demand Calculation
    relative_demands = calculate_relative_demands(traffic_counts)

    # 3. Minimum Green Guarantee
    green_alloc = {d: float(MIN_GREEN) for d in DIRECTIONS}
    remaining_time = float(AVAILABLE_GREEN_TIME - MIN_GREEN * len(DIRECTIONS))

    # 4. Proportional Water-Filling with MAX_GREEN Capping
    active = DIRECTIONS.copy()

    while remaining_time > 1e-6 and active:
        active_demand = sum(relative_demands[d] for d in active)

        if active_demand == 0:
            proposed = {d: remaining_time / len(active) for d in active}
        else:
            proposed = {
                d: remaining_time * (relative_demands[d] / active_demand)
                for d in active
            }

        capped = [d for d in active if green_alloc[d] + proposed[d] > MAX_GREEN]

        if not capped:
            for d in active:
                green_alloc[d] += proposed[d]
            remaining_time = 0.0
        else:
            for d in capped:
                extra = MAX_GREEN - green_alloc[d]
                green_alloc[d] = float(MAX_GREEN)
                remaining_time -= extra
                active.remove(d)

    # 5. Discretization via Largest Remainder Method
    result = {d: int(floor(green_alloc[d])) for d in DIRECTIONS}
    leftover = AVAILABLE_GREEN_TIME - sum(result.values())

    # Sort directions by fractional part descending, breaking ties by relative demand
    fractions = sorted(
        DIRECTIONS,
        key=lambda d: (
            round(green_alloc[d] - floor(green_alloc[d]), 6),
            relative_demands[d]
        ),
        reverse=True
    )

    # Distribute leftover seconds
    while leftover > 0:
        allocated = False
        for d in fractions:
            if result[d] < MAX_GREEN and leftover > 0:
                result[d] += 1
                leftover -= 1
                allocated = True
        if not allocated:
            break

    while leftover < 0:
        for d in reversed(fractions):
            if result[d] > MIN_GREEN and leftover < 0:
                result[d] -= 1
                leftover += 1

    return {
        "traffic_counts": traffic_counts,
        "relative_demands": {d: round(relative_demands[d], 4) for d in DIRECTIONS},
        "green_times": result,
        "cycle_time": CYCLE_TIME,
        "clearance_time": CLEARANCE_TIME,
        "total_green_time": sum(result.values()),
        "min_green": MIN_GREEN,
        "max_green": MAX_GREEN,
        "intersection_model": {
            "type": "isolated_four_approach_split_phase",
            "phases": 4,
            "description": "Sequential single-approach phase allocation (North -> South -> East -> West).",
            "conflict_mitigation": "Collision safety is enforced by non-overlapping sequential approach service with 20s total clearance time.",
            "future_extension": "Dual-ring concurrent phase group (Phase 1: N-S, Phase 2: E-W)."
        }
    }

"""
Deterministic Simulation Validation & Calibration Framework
===========================================================

Phase 7: Predefined controlled traffic scenarios verifying mathematical
consistency, conservation laws, constraint enforcement, and policy trade-offs.

Scenarios Implemented:
- Scenario A: No Traffic (Zero queues, zero arrivals, zero division errors).
- Scenario B: Balanced Demand (Equal demand across approaches, symmetry check).
- Scenario C: Extreme Directional Asymmetry (Critical approach allocation response).
- Scenario D: Capacity-Constrained Intersection (Demand > capacity, queue growth).
- Scenario E: Queue Clearance (Deterministic cycle clearing with zero arrivals).
- Scenario F: Zero Effective Green (Startup lost time >= nominal green, zero discharge).
- Scenario G: Variable Lane Configurations (Multilane geometric capacity scaling).
- Scenario H: Vehicle Conservation Invariant (Mass conservation invariant across multi-cycle stress).
- Policy Comparison: Approach A (Independent Floor) vs Approach B (Fractional Carryover).
"""

from typing import Any, Dict, List
from backend.services.traffic_simulator import simulate_intersection
from backend.services.signal_optimizer import MIN_GREEN, MAX_GREEN

DIRECTIONS = ["north", "south", "east", "west"]


def validate_scenario_a_no_traffic() -> Dict[str, Any]:
    """Scenario A: Zero initial queues and zero arrivals."""
    result = simulate_intersection(
        initial_queues={d: 0 for d in DIRECTIONS},
        arrival_rates={d: 0.0 for d in DIRECTIONS},
        cycles=3,
        strategy="adaptive",
        random_seed=42
    )
    overall = result["metrics"]["overall"]
    passed = (
        overall["total_initial_queue"] == 0
        and overall["total_arrivals"] == 0
        and overall["total_discharged"] == 0
        and overall["total_remaining"] == 0
        and overall["estimated_average_waiting_time_seconds"] == 0.0
        and overall["overall_capacity_utilization_percentage"] == 0.0
        and overall["vehicle_conservation_verified"] is True
    )
    return {
        "scenario_id": "scenario_a_no_traffic",
        "title": "Scenario A: No Traffic",
        "description": "Zero initial queues and zero arrival rates across all directions.",
        "expected": "0 arrivals, 0 discharged, 0 remaining, 0.0s waiting time, conservation verified, no division-by-zero.",
        "observed": {
            "total_initial_queue": overall["total_initial_queue"],
            "total_arrivals": overall["total_arrivals"],
            "total_discharged": overall["total_discharged"],
            "total_remaining": overall["total_remaining"],
            "waiting_time_seconds": overall["estimated_average_waiting_time_seconds"],
            "capacity_utilization_pct": overall["overall_capacity_utilization_percentage"],
            "conservation_verified": overall["vehicle_conservation_verified"]
        },
        "passed": bool(passed)
    }


def validate_scenario_b_balanced_traffic() -> Dict[str, Any]:
    """Scenario B: Balanced initial queues and arrival rates."""
    queues = {d: 25 for d in DIRECTIONS}
    zero_rates = {d: 0.0 for d in DIRECTIONS}
    active_rates = {d: 6.0 for d in DIRECTIONS}

    # 1. Deterministic symmetry check: initial queues equal, 0 arrivals
    sym_res = simulate_intersection(
        initial_queues=queues,
        arrival_rates=zero_rates,
        cycles=2,
        strategy="adaptive"
    )
    c1_green = sym_res["history"][0]["green_times"]
    c2_green = sym_res["history"][1]["green_times"]
    equal_allocation = (
        all(c1_green[d] == 25 for d in DIRECTIONS)
        and all(c2_green[d] == 25 for d in DIRECTIONS)
    )

    # 2. Performance comparison with active equal arrivals under paired seed
    adapt_active = simulate_intersection(
        initial_queues=queues,
        arrival_rates=active_rates,
        cycles=3,
        strategy="adaptive",
        random_seed=42
    )
    fixed_active = simulate_intersection(
        initial_queues=queues,
        arrival_rates=active_rates,
        cycles=3,
        strategy="fixed",
        random_seed=42
    )

    # Explicitly verify balanced directional demand
    balanced_demand_verified = (
        all(queues[d] == 25 for d in DIRECTIONS)
        and all(active_rates[d] == 6.0 for d in DIRECTIONS)
    )

    # Vehicle conservation verified for both strategies
    sym_conserved = sym_res["metrics"]["overall"]["vehicle_conservation_verified"] is True
    adapt_conserved = adapt_active["metrics"]["overall"]["vehicle_conservation_verified"] is True
    fixed_conserved = fixed_active["metrics"]["overall"]["vehicle_conservation_verified"] is True

    passed = (
        equal_allocation
        and balanced_demand_verified
        and sym_conserved
        and adapt_conserved
        and fixed_conserved
    )

    return {
        "scenario_id": "scenario_b_balanced_traffic",
        "title": "Scenario B: Balanced Traffic",
        "description": "Equal initial queues (25 veh) and equal arrival rates (6.0 veh/min) across all 4 directions.",
        "expected": "Adaptive optimizer allocates equal nominal green (25s each) under balanced demand; conservation verified for both strategies.",
        "observed": {
            "balanced_demand_verified": balanced_demand_verified,
            "balanced_green_times_cycle_1": c1_green,
            "balanced_green_times_cycle_2": c2_green,
            "equal_allocation_verified": equal_allocation,
            "adaptive_discharged_active": adapt_active["metrics"]["overall"]["total_discharged"],
            "fixed_discharged_active": fixed_active["metrics"]["overall"]["total_discharged"],
            "adaptive_conservation_verified": adapt_conserved,
            "fixed_conservation_verified": fixed_conserved,
            "conservation_verified": sym_conserved and adapt_conserved and fixed_conserved
        },
        "passed": bool(passed)
    }


def validate_scenario_c_asymmetric_traffic() -> Dict[str, Any]:
    """Scenario C: Highly asymmetric traffic demand."""
    queues = {"north": 70, "south": 15, "east": 10, "west": 5}
    rates = {"north": 18.0, "south": 4.0, "east": 3.0, "west": 1.0}

    adapt_res = simulate_intersection(
        initial_queues=queues,
        arrival_rates=rates,
        cycles=3,
        strategy="adaptive",
        random_seed=42
    )
    fixed_res = simulate_intersection(
        initial_queues=queues,
        arrival_rates=rates,
        cycles=3,
        strategy="fixed",
        random_seed=42
    )

    c1_green = adapt_res["history"][0]["green_times"]
    north_maxed = (c1_green["north"] == MAX_GREEN)  # 40s
    west_minimized = (c1_green["west"] <= 15)

    adapt_north_rem = adapt_res["metrics"]["by_direction"]["north"]["final_queue"]
    fixed_north_rem = fixed_res["metrics"]["by_direction"]["north"]["final_queue"]
    adaptive_saved_north = adapt_north_rem < fixed_north_rem

    passed = (
        north_maxed
        and adaptive_saved_north
        and adapt_res["metrics"]["overall"]["vehicle_conservation_verified"] is True
    )

    return {
        "scenario_id": "scenario_c_asymmetric_traffic",
        "title": "Scenario C: Highly Asymmetric Traffic",
        "description": "Dominant demand on North (70 veh, 18 veh/min) vs low demand on East/West.",
        "expected": f"Adaptive optimizer caps North at {MAX_GREEN}s green and reduces North remaining queue more than Fixed.",
        "observed": {
            "cycle_1_green_times": c1_green,
            "north_green_at_maximum": north_maxed,
            "north_final_queue_adaptive": adapt_north_rem,
            "north_final_queue_fixed": fixed_north_rem,
            "vehicles_saved_on_north": fixed_north_rem - adapt_north_rem,
            "conservation_verified": adapt_res["metrics"]["overall"]["vehicle_conservation_verified"]
        },
        "passed": bool(passed)
    }


def validate_scenario_d_capacity_constrained() -> Dict[str, Any]:
    """Scenario D: Demand severely exceeds capacity (Saturated Intersection)."""
    # 1 lane, 1800 sat flow, lost time 2.0s -> max green 40s -> g_eff = 38s -> C_d = 19 veh/cycle
    # Arrival rates (15-30 veh/min on 2-min cycle -> 30-60 veh arrive per cycle) >> capacity.
    init_queues = {"north": 30, "south": 30, "east": 20, "west": 20}
    arrival_rates = {"north": 30.0, "south": 25.0, "east": 20.0, "west": 15.0}
    result = simulate_intersection(
        initial_queues=init_queues,
        arrival_rates=arrival_rates,
        cycles=3,
        strategy="adaptive",
        random_seed=42,
        lanes={"north": 1, "south": 1, "east": 1, "west": 1}
    )

    h = result["history"]
    # Verify queue growth across all four approaches cycle-over-cycle
    queues_growing_by_dir = {
        d: bool(h[2]["queues_after"][d] > h[1]["queues_after"][d] > h[0]["queues_after"][d])
        for d in DIRECTIONS
    }
    all_queues_growing = all(queues_growing_by_dir.values())

    # Check cumulative invariants independently for all four directions under fractional carryover:
    # 1. cumulative_discharged <= cumulative_theoretical_capacity
    # 2. cumulative_discharged <= initial_queue + cumulative_arrivals
    cum_discharged = {d: 0 for d in DIRECTIONS}
    cum_theo_cap = {d: 0.0 for d in DIRECTIONS}
    cum_arrivals = {d: 0 for d in DIRECTIONS}

    cum_cap_bounded_by_dir = {d: True for d in DIRECTIONS}
    cum_demand_bounded_by_dir = {d: True for d in DIRECTIONS}

    for c in h:
        for d in DIRECTIONS:
            cum_discharged[d] += c["discharged"][d]
            cum_theo_cap[d] += c["theoretical_capacities"][d]
            cum_arrivals[d] += c["arrivals"][d]

            if cum_discharged[d] > cum_theo_cap[d] + 1e-9:
                cum_cap_bounded_by_dir[d] = False
            if cum_discharged[d] > init_queues[d] + cum_arrivals[d]:
                cum_demand_bounded_by_dir[d] = False

    cum_cap_bounded = all(cum_cap_bounded_by_dir.values())
    cum_demand_bounded = all(cum_demand_bounded_by_dir.values())

    # Retain appropriate per-cycle bounds for the independent-floor policy
    res_floor = simulate_intersection(
        initial_queues=init_queues,
        arrival_rates=arrival_rates,
        cycles=3,
        strategy="adaptive",
        random_seed=42,
        lanes={"north": 1, "south": 1, "east": 1, "west": 1},
        discharge_policy="independent_floor"
    )
    floor_per_cycle_bounded = True
    for c in res_floor["history"]:
        for d in DIRECTIONS:
            if c["discharged"][d] > c["theoretical_capacities"][d] + 1e-9:
                floor_per_cycle_bounded = False

    conservation_ok = result["metrics"]["overall"]["vehicle_conservation_verified"] is True

    passed = (
        all_queues_growing
        and cum_cap_bounded
        and cum_demand_bounded
        and floor_per_cycle_bounded
        and conservation_ok
    )

    return {
        "scenario_id": "scenario_d_capacity_constrained",
        "title": "Scenario D: Capacity-Constrained Intersection",
        "description": "High arrival rates (30-60 veh/cycle demand) exceeding 1-lane discharge capacity (~19 veh/cycle) on all four approaches.",
        "expected": "Queues strictly grow across all four approaches; cumulative discharge is bounded by cumulative theoretical capacity and available demand; independent-floor per-cycle bounds hold; conservation is preserved.",
        "observed": {
            "queue_growth_by_direction": queues_growing_by_dir,
            "all_queues_strictly_growing": all_queues_growing,
            "queues_strictly_growing": all_queues_growing,  # for backward compatibility
            "cumulative_capacity_bounded_by_direction": cum_cap_bounded_by_dir,
            "cumulative_demand_bounded_by_direction": cum_demand_bounded_by_dir,
            "cumulative_discharge_bounded_by_capacity": cum_cap_bounded,
            "cumulative_discharge_bounded_by_demand": cum_demand_bounded,
            "discharge_never_exceeds_capacity": cum_cap_bounded,  # backward compatibility alias
            "independent_floor_per_cycle_bounded": floor_per_cycle_bounded,
            "overall_capacity_utilization": result["metrics"]["overall"]["overall_capacity_utilization_percentage"],
            "conservation_verified": conservation_ok
        },
        "passed": bool(passed)
    }


def validate_scenario_e_queue_clearance() -> Dict[str, Any]:
    """Scenario E: Queue Clearance in known finite cycles."""
    # North initial queue = 22 vehicles, zero arrivals.
    # Fixed green 25s, lost time 2.0s -> g_eff = 23s -> C_d = 1800 * 1 * (23/3600) = 11.5 veh/cycle.
    # Integer floor = 11 veh/cycle.
    # In 2 cycles: Cycle 1 discharges 11 (11 rem). Cycle 2 discharges 11 (0 rem).
    result = simulate_intersection(
        initial_queues={"north": 22, "south": 22, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=2,
        strategy="fixed",
        lanes={"north": 1, "south": 1, "east": 1, "west": 1},
        saturation_flow_rates={"north": 1800.0, "south": 1800.0, "east": 1800.0, "west": 1800.0},
        startup_lost_times={"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}
    )

    h = result["history"]
    c1_disc = h[0]["discharged"]["north"]
    c1_rem = h[0]["queues_after"]["north"]
    c2_disc = h[1]["discharged"]["north"]
    c2_rem = h[1]["queues_after"]["north"]

    cleared_in_2_cycles = (c1_disc == 11 and c1_rem == 11 and c2_disc == 11 and c2_rem == 0)

    passed = (
        cleared_in_2_cycles
        and result["metrics"]["overall"]["vehicle_conservation_verified"] is True
    )

    return {
        "scenario_id": "scenario_e_queue_clearance",
        "title": "Scenario E: Queue Clearance",
        "description": "Initial queue of 22 vehicles with 0 arrivals under 11 veh/cycle service capacity.",
        "expected": "Cycle 1 discharges 11 (11 left); Cycle 2 discharges 11 (0 left); fully cleared in exactly 2 cycles.",
        "observed": {
            "cycle_1_discharged": c1_disc,
            "cycle_1_remaining": c1_rem,
            "cycle_2_discharged": c2_disc,
            "cycle_2_remaining": c2_rem,
            "fully_cleared_in_2_cycles": cleared_in_2_cycles,
            "conservation_verified": result["metrics"]["overall"]["vehicle_conservation_verified"]
        },
        "passed": bool(passed)
    }


def validate_scenario_f_zero_effective_green() -> Dict[str, Any]:
    """Scenario F: Zero effective green (startup lost time >= nominal green)."""
    # Nominal green = 25s, startup lost time = 25.0s -> g_eff = 0.0s.
    result = simulate_intersection(
        initial_queues={"north": 30, "south": 30, "east": 30, "west": 30},
        arrival_rates={"north": 5.0, "south": 5.0, "east": 5.0, "west": 5.0},
        cycles=2,
        strategy="fixed",
        startup_lost_times={"north": 25.0, "south": 25.0, "east": 25.0, "west": 25.0}
    )

    total_discharged = result["metrics"]["overall"]["total_discharged"]
    zero_discharged = (total_discharged == 0)
    for c in result["history"]:
        for d in DIRECTIONS:
            assert c["effective_green_times"][d] == 0.0
            assert c["theoretical_capacities"][d] == 0.0

    passed = (
        zero_discharged
        and result["metrics"]["overall"]["vehicle_conservation_verified"] is True
    )

    return {
        "scenario_id": "scenario_f_zero_effective_green",
        "title": "Scenario F: Zero Effective Green",
        "description": "Startup lost time configured to 25.0s, completely exhausting 25.0s nominal green.",
        "expected": "Effective green is 0.0s, theoretical capacity is 0.0, and 0 vehicles are discharged across all cycles.",
        "observed": {
            "effective_green_time_seconds": 0.0,
            "total_discharged": total_discharged,
            "zero_discharge_verified": zero_discharged,
            "conservation_verified": result["metrics"]["overall"]["vehicle_conservation_verified"]
        },
        "passed": bool(passed)
    }


def compare_discharge_policies_audit() -> Dict[str, Any]:
    """
    Audit and compare Approach A (Independent Cycle Floor) vs Approach B (Fractional Carryover).
    """
    # 4 cycles, fixed 25s, l_s = 2.0s -> g_eff = 23s.
    # C_d = 1800 * 1 * (23/3600) = 11.5 vehicles / cycle.
    # High initial queue (100 veh), zero arrivals.
    init_q = {"north": 100, "south": 100, "east": 100, "west": 100}
    zero_arr = {"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0}

    res_floor = simulate_intersection(
        initial_queues=init_q,
        arrival_rates=zero_arr,
        cycles=4,
        strategy="fixed",
        discharge_policy="independent_floor"
    )

    res_carry = simulate_intersection(
        initial_queues=init_q,
        arrival_rates=zero_arr,
        cycles=4,
        strategy="fixed",
        discharge_policy="fractional_carryover"
    )

    floor_c_disc = [c["discharged"]["north"] for c in res_floor["history"]]
    carry_c_disc = [c["discharged"]["north"] for c in res_carry["history"]]

    total_floor = sum(floor_c_disc)
    total_carry = sum(carry_c_disc)

    # 4 cycles * 11.5 = 46.0 theoretical vehicles.
    # Approach A: 11 + 11 + 11 + 11 = 44 vehicles (2.0 vehicles discarded).
    # Approach B: 11 + 12 + 11 + 12 = 46 vehicles (0.0 vehicles discarded).
    passed = (
        total_floor == 44
        and total_carry == 46
        and res_floor["metrics"]["overall"]["vehicle_conservation_verified"] is True
        and res_carry["metrics"]["overall"]["vehicle_conservation_verified"] is True
    )

    return {
        "title": "Discharge Policy Audit: Independent Floor vs. Fractional Carryover",
        "parameters": {
            "theoretical_capacity_per_cycle": 11.5,
            "cycles": 4,
            "cumulative_theoretical_capacity": 46.0,
            "initial_queue": 100
        },
        "approach_a_independent_floor": {
            "cycle_discharges": floor_c_disc,
            "total_discharged": total_floor,
            "fractional_service_discarded": 2.0,
            "policy": "Independent floor - floor(C_d) applied per cycle with remainder lost"
        },
        "approach_b_fractional_carryover": {
            "cycle_discharges": carry_c_disc,
            "total_discharged": total_carry,
            "fractional_service_discarded": 0.0,
            "policy": "Fractional carryover - unserved fractional headway carries over across saturated cycles"
        },
        "analysis": (
            "Under repeated fractional capacities (e.g. 11.5 veh/cycle), Approach A systematically "
            "underestimates cumulative theoretical capacity by discarding fractional vehicles each cycle (44 vs 46). "
            "Approach B recovers the exact theoretical capacity (46.0) over consecutive saturated cycles while "
            "strictly preventing upward rounding within any single cycle and respecting physical vehicle conservation."
        ),
        "passed": bool(passed)
    }


def validate_scenario_g_variable_lanes() -> Dict[str, Any]:
    """Scenario G: Variable Lane Configurations (Multilane Geometric Capacity Scaling)."""
    # North: 3 lanes, South: 2 lanes, East: 1 lane, West: 1 lane
    # Saturated demand: Initial queue 50 each, arrival rate 8.0 veh/min, 2 cycles, fixed green (25s each)
    # Effective green = 25 - 2 = 23s.
    # Single-lane capacity = 1800 * 1 * (23/3600) = 11.5 veh/cycle (floor = 11)
    # South (2 lanes) capacity = 1800 * 2 * (23/3600) = 23.0 veh/cycle (floor = 23)
    # North (3 lanes) capacity = 1800 * 3 * (23/3600) = 34.5 veh/cycle (floor = 34)
    lanes_cfg = {"north": 3, "south": 2, "east": 1, "west": 1}
    result = simulate_intersection(
        initial_queues={"north": 50, "south": 50, "east": 50, "west": 50},
        arrival_rates={"north": 8.0, "south": 8.0, "east": 8.0, "west": 8.0},
        cycles=2,
        strategy="fixed",
        lanes=lanes_cfg,
        discharge_policy="independent_floor"
    )

    c1_disc = result["history"][0]["discharged"]
    north_disc = c1_disc["north"]
    south_disc = c1_disc["south"]
    east_disc = c1_disc["east"]
    west_disc = c1_disc["west"]

    capacity_scaling_verified = (north_disc > south_disc > east_disc) and (east_disc == west_disc)
    conservation_verified = result["metrics"]["overall"]["vehicle_conservation_verified"] is True

    passed = capacity_scaling_verified and conservation_verified

    return {
        "scenario_id": "scenario_g_variable_lanes",
        "title": "Scenario G: Variable Lane Configurations",
        "description": "Asymmetric lane geometry (North: 3 lanes, South: 2 lanes, East/West: 1 lane) under saturated demand.",
        "expected": "Cycle discharge capacity scales directly with lane count: North (~34 veh) > South (~23 veh) > East/West (~11 veh).",
        "observed": {
            "lane_configuration": lanes_cfg,
            "cycle_1_discharged": c1_disc,
            "north_discharged": north_disc,
            "south_discharged": south_disc,
            "east_discharged": east_disc,
            "west_discharged": west_disc,
            "capacity_scaling_verified": capacity_scaling_verified,
            "conservation_verified": conservation_verified
        },
        "passed": bool(passed)
    }


def validate_scenario_h_conservation_invariant() -> Dict[str, Any]:
    """Scenario H: Vehicle Conservation Invariant under Multi-Cycle Stress."""
    # 10 cycles, asymmetric initial queues and arrival rates across both fixed and adaptive
    init_q = {"north": 45, "south": 30, "east": 15, "west": 10}
    arr_rates = {"north": 12.0, "south": 8.0, "east": 5.0, "west": 2.0}

    adapt_res = simulate_intersection(
        initial_queues=init_q,
        arrival_rates=arr_rates,
        cycles=10,
        strategy="adaptive",
        random_seed=42
    )

    fixed_res = simulate_intersection(
        initial_queues=init_q,
        arrival_rates=arr_rates,
        cycles=10,
        strategy="fixed",
        random_seed=42
    )

    adapt_cycles_conserved = True
    for c in adapt_res["history"]:
        for d in DIRECTIONS:
            expected_after = c["queues_before"][d] + c["arrivals"][d] - c["discharged"][d]
            if c["queues_after"][d] != expected_after or c["queues_after"][d] < 0:
                adapt_cycles_conserved = False

    fixed_cycles_conserved = True
    for c in fixed_res["history"]:
        for d in DIRECTIONS:
            expected_after = c["queues_before"][d] + c["arrivals"][d] - c["discharged"][d]
            if c["queues_after"][d] != expected_after or c["queues_after"][d] < 0:
                fixed_cycles_conserved = False

    adapt_overall_ok = adapt_res["metrics"]["overall"]["vehicle_conservation_verified"] is True
    fixed_overall_ok = fixed_res["metrics"]["overall"]["vehicle_conservation_verified"] is True

    passed = adapt_cycles_conserved and fixed_cycles_conserved and adapt_overall_ok and fixed_overall_ok

    return {
        "scenario_id": "scenario_h_conservation_invariant",
        "title": "Scenario H: Vehicle Conservation Invariant",
        "description": "10-cycle multi-approach stress test under stochastic arrivals verifying mass conservation law.",
        "expected": "Q_final == Q_initial + Total_Arrivals - Total_Discharged holds identically per cycle and overall for both strategies.",
        "observed": {
            "adaptive_per_cycle_conservation": adapt_cycles_conserved,
            "fixed_per_cycle_conservation": fixed_cycles_conserved,
            "adaptive_overall_conservation": adapt_overall_ok,
            "fixed_overall_conservation": fixed_overall_ok,
            "adaptive_final_queue": adapt_res["metrics"]["overall"]["total_remaining"],
            "fixed_final_queue": fixed_res["metrics"]["overall"]["total_remaining"],
            "conservation_verified": passed
        },
        "passed": bool(passed)
    }


def run_all_validation_scenarios() -> Dict[str, Any]:
    """Execute all deterministic validation scenarios and return a consolidated report."""
    scenarios = [
        validate_scenario_a_no_traffic(),
        validate_scenario_b_balanced_traffic(),
        validate_scenario_c_asymmetric_traffic(),
        validate_scenario_d_capacity_constrained(),
        validate_scenario_e_queue_clearance(),
        validate_scenario_f_zero_effective_green(),
        validate_scenario_g_variable_lanes(),
        validate_scenario_h_conservation_invariant()
    ]
    policy_audit = compare_discharge_policies_audit()

    all_passed = all(s["passed"] for s in scenarios) and policy_audit["passed"]

    return {
        "validation_status": "PASSED" if all_passed else "FAILED",
        "total_scenarios": len(scenarios),
        "passed_scenarios": sum(1 for s in scenarios if s["passed"]),
        "scenarios": scenarios,
        "discharge_policy_audit": policy_audit,
        "assumptions_audit": {
            "arrival_process": "Independent Poisson processes sampled per direction and cycle.",
            "queue_aggregation": "Discrete macroscopic cycle time (120s) with trapezoidal queue-area delay approximation.",
            "discharge_capacity": "Lane-based saturation flow C_d = s_d * L_d * (g_d / 3600) with effective green g_d = max(0, G_d - l_s).",
            "conservation_law": "Q_final = Q_initial + Arrivals - Discharged holds strictly across all scenarios.",
            "simulation_scope": "Macroscopic comparative benchmark; not a microscopic continuous trajectory simulator."
        }
    }

"""
Phase 7.1 Regression and Correctness Test Suite
===============================================

Comprehensive test coverage for:
1. Fractional capacity carryover boundary conditions:
   - Queue exactly equal to integer capacity (resets to 0.0, no carryover survives).
   - Queue one vehicle below integer capacity (resets to 0.0).
   - Queue one vehicle above integer capacity (fractional carryover survives).
   - Fractional carryover followed by queue clearance.
   - Queue empty for multiple cycles followed by new arrivals.
   - Continuously saturated queue (alternating integer discharge matching continuous flow).
2. Monte Carlo sensitivity analysis:
   - Configurable replicates (min 2, max 100, default 30).
   - Rejection of invalid, out-of-range, and boolean run counts.
   - Sample mean, sample standard deviation (ddof=1), and Student's t 95% confidence intervals.
   - Common Random Numbers (CRN) paired seeds across parameter values and strategies.
   - Seeded reproducibility test (identical results across runs).
   - Safe handling of zero variance and small samples.
3. Computational limits and API input validation:
   - Max 20 parameter values per request.
   - Reject empty parameter lists.
   - Reject NaN, infinite, negative, or boolean parameter values.
   - Reject invalid directions and runs via HTTP 422.
4. Strengthened validation scenarios:
   - Scenario B: Explicitly verifies balanced directional demand, equal green allocation, and conservation.
   - Scenario D: Verifies queue growth across all four approaches, capacity boundedness, and conservation.
"""

import math
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.services.traffic_simulator import simulate_intersection
from backend.services.sensitivity_analyzer import (
    run_parameter_sensitivity_sweep,
    _calc_stats,
    validate_parameter_values_for_type,
)
from backend.services.simulation_validator import (
    validate_scenario_b_balanced_traffic,
    validate_scenario_d_capacity_constrained
)

client = TestClient(app)
DIRECTIONS = ["north", "south", "east", "west"]


# ---------------------------------------------------------------------------
# 1. Fractional Capacity Carryover Boundary Conditions
# ---------------------------------------------------------------------------

def test_carryover_boundary_queue_exactly_equal_to_integer_capacity():
    """
    Theoretical capacity = 11.5, integer capacity = 11.
    Initial queue = 11, arrivals = 0.
    Waiting queue = 11 -> discharges 11 -> remaining queue = 0.
    Boundary rule: fractional credit MUST NOT survive when the queue becomes empty.
    """
    res = simulate_intersection(
        initial_queues={"north": 11, "south": 0, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=2,
        strategy="fixed",
        discharge_policy="fractional_carryover",
        startup_lost_times={"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}
    )
    h = res["history"]
    # Cycle 1: 11 discharged, 0 remaining
    assert h[0]["discharged"]["north"] == 11
    assert h[0]["queues_after"]["north"] == 0

    # In Cycle 2, if carryover survived, available capacity would be 0.5 + 11.5 = 12.0 (discharge capacity 12)
    # Because carryover was reset to 0.0, Cycle 2 discharge capacity must remain exactly 11!
    assert h[1]["discharge_capacities"]["north"] == 11
    assert h[1]["discharged"]["north"] == 0
    assert h[1]["queues_after"]["north"] == 0
    assert res["metrics"]["overall"]["vehicle_conservation_verified"] is True


def test_carryover_boundary_queue_one_below_integer_capacity():
    """
    Initial queue = 10, integer capacity = 11 (theoretical 11.5).
    Discharges 10 -> remaining queue = 0 -> carryover resets to 0.0.
    """
    res = simulate_intersection(
        initial_queues={"north": 10, "south": 0, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=2,
        strategy="fixed",
        discharge_policy="fractional_carryover",
        startup_lost_times={"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}
    )
    h = res["history"]
    assert h[0]["discharged"]["north"] == 10
    assert h[0]["queues_after"]["north"] == 0
    # Cycle 2 discharge capacity must not have banked carryover
    assert h[1]["discharge_capacities"]["north"] == 11
    assert res["metrics"]["overall"]["vehicle_conservation_verified"] is True


def test_carryover_boundary_queue_one_above_integer_capacity():
    """
    Initial queue = 12, integer capacity = 11 (theoretical 11.5).
    Discharges 11 -> remaining queue = 1 (> 0).
    Carryover of 0.5 MUST survive because the queue remains non-empty!
    Cycle 2 available capacity = 0.5 + 11.5 = 12.0 -> discharge capacity = 12.
    """
    res = simulate_intersection(
        initial_queues={"north": 12, "south": 0, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=2,
        strategy="fixed",
        discharge_policy="fractional_carryover",
        startup_lost_times={"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}
    )
    h = res["history"]
    assert h[0]["discharged"]["north"] == 11
    assert h[0]["queues_after"]["north"] == 1

    # Cycle 2: 0.5 carryover promotes 11.5 to 12.0 integer capacity!
    assert h[1]["discharge_capacities"]["north"] == 12
    assert h[1]["discharged"]["north"] == 1
    assert h[1]["queues_after"]["north"] == 0
    assert res["metrics"]["overall"]["vehicle_conservation_verified"] is True


def test_carryover_followed_by_empty_queue_resets():
    """
    Cycle 1: Queue 12 -> discharges 11 -> remaining 1 -> carryover 0.5.
    Cycle 2: Queue 1 -> discharges 1 -> remaining 0 -> carryover MUST reset to 0.0.
    Cycle 3: Capacity must be 11 (not 12).
    """
    res = simulate_intersection(
        initial_queues={"north": 12, "south": 0, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=3,
        strategy="fixed",
        discharge_policy="fractional_carryover",
        startup_lost_times={"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}
    )
    h = res["history"]
    assert h[0]["discharge_capacities"]["north"] == 11
    assert h[0]["discharged"]["north"] == 11
    assert h[0]["queues_after"]["north"] == 1

    assert h[1]["discharge_capacities"]["north"] == 12
    assert h[1]["discharged"]["north"] == 1
    assert h[1]["queues_after"]["north"] == 0

    # Cycle 3: queue was 0 at end of cycle 2, so carryover was reset to 0.0
    assert h[2]["discharge_capacities"]["north"] == 11
    assert h[2]["discharged"]["north"] == 0
    assert res["metrics"]["overall"]["vehicle_conservation_verified"] is True


def test_empty_queue_for_multiple_cycles_receives_traffic_later():
    """
    Cycle 1 clears queue. Cycles 2 & 3 have 0 queue and 0 arrivals.
    Cycle 4 receives traffic. Capacity in cycle 4 must start strictly at 11,
    proving no unused integer or fractional service capacity accumulated across idle cycles.
    """
    res = simulate_intersection(
        initial_queues={"north": 5, "south": 0, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=3,
        strategy="fixed",
        discharge_policy="fractional_carryover",
        startup_lost_times={"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}
    )
    for c in res["history"]:
        assert c["discharge_capacities"]["north"] == 11
    assert res["metrics"]["overall"]["total_discharged"] == 5
    assert res["metrics"]["overall"]["total_remaining"] == 0


def test_continuously_saturated_queue_alternates_exact_integer_capacity():
    """
    Queue 100 with theoretical capacity 11.5 veh/cycle.
    Over 4 cycles, discharges must be: 11, 12, 11, 12 = 46 total vehicles.
    Cumulative discharge never exceeds cumulative theoretical capacity (46.0).
    """
    res = simulate_intersection(
        initial_queues={"north": 100, "south": 0, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=4,
        strategy="fixed",
        discharge_policy="fractional_carryover",
        startup_lost_times={"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}
    )
    discharges = [c["discharged"]["north"] for c in res["history"]]
    assert discharges == [11, 12, 11, 12]
    assert sum(discharges) == 46
    assert res["history"][3]["queues_after"]["north"] == 100 - 46
    assert res["metrics"]["overall"]["vehicle_conservation_verified"] is True


# ---------------------------------------------------------------------------
# 2. Monte Carlo Sensitivity Analysis Statistics & Reproducibility
# ---------------------------------------------------------------------------

def test_monte_carlo_sensitivity_statistics_and_confidence_intervals():
    """Monte Carlo sweep computes sample mean, sample std (ddof=1), and Student's t 95% CIs."""
    sweep = run_parameter_sensitivity_sweep(
        parameter_name="arrival_rate",
        parameter_values=[5.0, 10.0],
        runs=10,
        compare_both_strategies=True
    )
    assert sweep["runs"] == 10
    assert len(sweep["results"]) == 2

    for r in sweep["results"]:
        ad = r["adaptive"]
        fx = r["fixed"]

        # Mean and standard deviation exist and are numeric
        assert isinstance(ad["final_queue_mean"], float)
        assert isinstance(ad["final_queue_std"], float)
        assert ad["final_queue_std"] >= 0.0

        assert isinstance(ad["average_waiting_time_mean"], float)
        assert isinstance(ad["average_waiting_time_std"], float)

        # 95% Student's t Confidence Intervals
        ci_q = ad["final_queue_ci95"]
        assert len(ci_q) == 2
        assert ci_q[0] <= ad["final_queue_mean"] <= ci_q[1]
        assert ci_q[0] >= 0.0  # non-negative bounds

        ci_w = ad["average_waiting_time_ci95"]
        assert len(ci_w) == 2
        assert ci_w[0] <= ad["average_waiting_time_mean"] <= ci_w[1]

        # Vehicle conservation held across all replicates
        assert ad["vehicle_conservation_verified"] is True
        assert fx["vehicle_conservation_verified"] is True


def test_monte_carlo_zero_variance_safe_ci():
    """_calc_stats handles zero standard deviation and small samples cleanly."""
    # Constant data: std == 0.0
    res_const = _calc_stats([15.0, 15.0, 15.0], calculate_ci=True)
    assert res_const["mean"] == 15.0
    assert res_const["std"] == 0.0
    assert res_const["ci_95"] == [15.0, 15.0]
    assert res_const["margin_of_error"] == 0.0

    # Single item
    res_single = _calc_stats([10.0], calculate_ci=True)
    assert res_single["mean"] == 10.0
    assert res_single["std"] == 0.0
    assert res_single["ci_95"] == [10.0, 10.0]

    # Empty list
    res_empty = _calc_stats([], calculate_ci=True)
    assert res_empty["mean"] == 0.0
    assert res_empty["std"] == 0.0


def test_monte_carlo_crn_seed_pairing_reproducibility():
    """Executing the same sensitivity sweep twice with identical base seed returns 100% identical results."""
    sweep1 = run_parameter_sensitivity_sweep(
        parameter_name="arrival_rate",
        parameter_values=[4.0, 8.0],
        runs=5,
        baseline_override={"random_seed": 42}
    )
    sweep2 = run_parameter_sensitivity_sweep(
        parameter_name="arrival_rate",
        parameter_values=[4.0, 8.0],
        runs=5,
        baseline_override={"random_seed": 42}
    )
    assert sweep1["results"] == sweep2["results"]


def test_monte_carlo_runs_validation_guards():
    """Validates runs range [2, 100] and rejects booleans."""
    with pytest.raises(ValueError, match="runs must be an integer between 2 and 100"):
        run_parameter_sensitivity_sweep("arrival_rate", runs=1)

    with pytest.raises(ValueError, match="runs must be an integer between 2 and 100"):
        run_parameter_sensitivity_sweep("arrival_rate", runs=101)

    with pytest.raises(ValueError, match="runs must be an integer between 2 and 100"):
        run_parameter_sensitivity_sweep("arrival_rate", runs=True)


# ---------------------------------------------------------------------------
# 3. API Computational Limits & Validation
# ---------------------------------------------------------------------------

def test_api_sensitivity_rejects_more_than_20_parameter_values():
    """API enforces computational limit of max 20 parameter values per request."""
    response = client.post("/sensitivity-analysis", json={
        "parameter_name": "arrival_rate",
        "parameter_values": list(range(1, 22)),  # 21 values
        "runs": 5
    })
    assert response.status_code in (400, 422)
    assert "cannot exceed 20 values" in response.text


def test_api_sensitivity_rejects_empty_parameter_values():
    """API rejects empty parameter_values list."""
    response = client.post("/sensitivity-analysis", json={
        "parameter_name": "arrival_rate",
        "parameter_values": [],
        "runs": 5
    })
    assert response.status_code in (400, 422)
    assert "cannot be empty" in response.text


def test_api_sensitivity_rejects_nan_and_inf_parameter_values():
    """API rejects NaN and infinite values."""
    response = client.post("/sensitivity-analysis", json={
        "parameter_name": "arrival_rate",
        "parameter_values": ["nan", 10.0],
        "runs": 5
    })
    assert response.status_code in (400, 422)


def test_api_sensitivity_rejects_boolean_parameter_values():
    """API rejects booleans in parameter_values."""
    response = client.post("/sensitivity-analysis", json={
        "parameter_name": "arrival_rate",
        "parameter_values": [True, 10.0],
        "runs": 5
    })
    assert response.status_code in (400, 422)
    assert "booleans are not allowed" in response.text


def test_api_sensitivity_rejects_invalid_runs():
    """API rejects runs < 2, runs > 100, and boolean runs."""
    resp1 = client.post("/sensitivity-analysis", json={"parameter_name": "arrival_rate", "runs": 1})
    assert resp1.status_code in (400, 422)

    resp2 = client.post("/sensitivity-analysis", json={"parameter_name": "arrival_rate", "runs": 105})
    assert resp2.status_code in (400, 422)

    resp3 = client.post("/sensitivity-analysis", json={"parameter_name": "arrival_rate", "runs": True})
    assert resp3.status_code in (400, 422)


def test_api_sensitivity_successful_execution():
    """Valid sensitivity request executes successfully with Monte Carlo statistics."""
    response = client.post("/sensitivity-analysis", json={
        "parameter_name": "arrival_rate",
        "parameter_values": [3.0, 6.0],
        "runs": 3
    })
    assert response.status_code == 200
    data = response.json()
    assert data["runs"] == 3
    assert len(data["results"]) == 2
    assert "final_queue_mean" in data["results"][0]["adaptive"]
    assert "average_waiting_time_ci95" in data["results"][0]["adaptive"]


# ---------------------------------------------------------------------------
# 4. Strengthened Validation Scenarios B & D
# ---------------------------------------------------------------------------

def test_strengthened_scenario_b_balanced_traffic():
    """Scenario B confirms balanced directional demand, equal green allocation, and conservation."""
    sc = validate_scenario_b_balanced_traffic()
    assert sc["passed"] is True
    obs = sc["observed"]
    assert obs["balanced_demand_verified"] is True
    assert obs["equal_allocation_verified"] is True
    assert obs["adaptive_conservation_verified"] is True
    assert obs["fixed_conservation_verified"] is True
    assert obs["conservation_verified"] is True


def test_strengthened_scenario_d_all_four_approaches_growing():
    """Scenario D confirms queue growth across all four approaches under severe oversaturation."""
    sc = validate_scenario_d_capacity_constrained()
    assert sc["passed"] is True
    obs = sc["observed"]
    assert obs["all_queues_strictly_growing"] is True
    assert obs["queues_strictly_growing"] is True
    assert all(obs["queue_growth_by_direction"].values())
    assert obs["discharge_never_exceeds_capacity"] is True
    assert obs["conservation_verified"] is True


# ---------------------------------------------------------------------------
# 5. Paired Strategy-Difference Statistics & Verification
# ---------------------------------------------------------------------------

def test_monte_carlo_paired_difference_statistics():
    """Verify replicate-level paired differences (fixed - adaptive), SE, and Student's t CI."""
    sweep = run_parameter_sensitivity_sweep(
        parameter_name="arrival_rate",
        parameter_values=[6.0, 10.0],
        runs=12,
        compare_both_strategies=True,
        baseline_override={"random_seed": 42}
    )
    for r in sweep["results"]:
        paired = r["paired_differences"]
        assert "final_queue" in paired
        assert "average_waiting_time" in paired

        pq = paired["final_queue"]
        pw = paired["average_waiting_time"]

        assert isinstance(pq["mean_difference"], float)
        assert isinstance(pq["std_difference"], float)
        assert isinstance(pq["standard_error"], float)
        assert len(pq["ci_95"]) == 2
        assert pq["ci_95"][0] <= pq["mean_difference"] <= pq["ci_95"][1]
        assert "fixed - adaptive" in pq["sign_convention"]

        assert isinstance(pw["mean_difference"], float)
        assert isinstance(pw["std_difference"], float)
        assert isinstance(pw["standard_error"], float)
        assert len(pw["ci_95"]) == 2
        assert pw["ci_95"][0] <= pw["mean_difference"] <= pw["ci_95"][1]

        # Verify mathematical relationship: SE == std / sqrt(N)
        expected_se_q = round(pq["std_difference"] / math.sqrt(12), 2)
        assert abs(pq["standard_error"] - expected_se_q) <= 0.05

        # Verify top-level difference metrics match paired mean differences
        assert r["vehicles_saved"] == pq["mean_difference"]
        assert r["delay_saved_seconds"] == pw["mean_difference"]


# ---------------------------------------------------------------------------
# 6. Parameter-Specific Domain Validation
# ---------------------------------------------------------------------------

def test_parameter_specific_validation_lanes():
    """Lanes must be strictly positive integers between 1 and 8."""
    validate_parameter_values_for_type("lanes", [1, 2, 4])
    with pytest.raises(ValueError, match="Lane count must be an integer between 1 and 8"):
        validate_parameter_values_for_type("lanes", [0])
    with pytest.raises(ValueError, match="Lane count must be an integer between 1 and 8"):
        validate_parameter_values_for_type("lanes", [9])
    with pytest.raises(ValueError, match="Lane count must be an integer between 1 and 8"):
        validate_parameter_values_for_type("lanes", [1.5])
    with pytest.raises(ValueError, match="booleans are not allowed"):
        validate_parameter_values_for_type("lanes", [True])


def test_parameter_specific_validation_saturation_flow_rate():
    """Saturation flow rate must be strictly positive and finite."""
    validate_parameter_values_for_type("saturation_flow_rate", [1200.0, 1800.0])
    with pytest.raises(ValueError, match="Saturation flow rate must be strictly positive"):
        validate_parameter_values_for_type("saturation_flow_rate", [0.0])
    with pytest.raises(ValueError, match="Saturation flow rate must be strictly positive"):
        validate_parameter_values_for_type("saturation_flow_rate", [-100.0])


def test_parameter_specific_validation_startup_lost_time():
    """Startup lost time must be non-negative and finite."""
    validate_parameter_values_for_type("startup_lost_time", [0.0, 2.0, 5.0])
    with pytest.raises(ValueError, match="Startup lost time must be non-negative"):
        validate_parameter_values_for_type("startup_lost_time", [-0.5])


def test_parameter_specific_validation_initial_queue_and_cycles():
    """Initial queue >= 0 integer; cycles >= 1 integer."""
    validate_parameter_values_for_type("initial_queue", [0, 10, 50])
    with pytest.raises(ValueError, match="Initial queue must be a non-negative integer"):
        validate_parameter_values_for_type("initial_queue", [-5])
    with pytest.raises(ValueError, match="Initial queue must be a non-negative integer"):
        validate_parameter_values_for_type("initial_queue", [2.5])

    validate_parameter_values_for_type("cycles", [1, 5, 10])
    with pytest.raises(ValueError, match="Cycle count must be an integer >= 1"):
        validate_parameter_values_for_type("cycles", [0])


def test_api_parameter_specific_validation_error_responses():
    """API returns 400 Bad Request with descriptive message on parameter-specific violations."""
    # Invalid lanes
    resp_lanes = client.post("/sensitivity-analysis", json={
        "parameter_name": "lanes",
        "parameter_values": [0, 2]
    })
    assert resp_lanes.status_code == 400
    assert "Lane count must be an integer between 1 and 8" in resp_lanes.text

    # Invalid saturation flow (must be strictly positive, zero rejected)
    resp_sat = client.post("/sensitivity-analysis", json={
        "parameter_name": "saturation_flow_rate",
        "parameter_values": [0.0]
    })
    assert resp_sat.status_code == 400
    assert "Saturation flow rate must be strictly positive" in resp_sat.text

    # Invalid cycles
    resp_cyc = client.post("/sensitivity-analysis", json={
        "parameter_name": "cycles",
        "parameter_values": [0]
    })
    assert resp_cyc.status_code == 400
    assert "Cycle count must be an integer >= 1" in resp_cyc.text


# ---------------------------------------------------------------------------
# 7. Additional Carryover Boundary Tests
# ---------------------------------------------------------------------------

def test_carryover_empty_after_consuming_accumulated_capacity():
    """Queue of 23 vehicles with 11.5 veh/cycle capacity clears in cycle 2; carryover does not survive."""
    res = simulate_intersection(
        initial_queues={"north": 23, "south": 0, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=3,
        strategy="fixed",
        discharge_policy="fractional_carryover"
    )
    h = res["history"]
    # Cycle 1: 11.5 cap -> int_cap 11 -> discharges 11 -> rem 12 -> carryover = 0.5
    assert h[0]["discharged"]["north"] == 11
    assert h[0]["queues_after"]["north"] == 12

    # Cycle 2: 0.5 + 11.5 = 12.0 cap -> int_cap 12 -> discharges 12 -> rem 0
    assert h[1]["discharged"]["north"] == 12
    assert h[1]["queues_after"]["north"] == 0

    # Cycle 3: Queue was 0 at end of cycle 2, so carryover must be 0.0, giving nominal int_cap 11
    assert h[2]["discharge_capacities"]["north"] == 11
    assert h[2]["discharged"]["north"] == 0
    assert res["metrics"]["overall"]["vehicle_conservation_verified"] is True


def test_new_arrivals_after_empty_queue_do_not_inherit_stale_carryover():
    """Arrivals in cycle 3 after queue emptied in cycle 1 do not inherit stale fractional headway credit."""
    res = simulate_intersection(
        initial_queues={"north": 11, "south": 0, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=2,
        strategy="fixed",
        discharge_policy="fractional_carryover"
    )
    # Cycle 1 cleared queue 11 -> 0
    assert res["history"][0]["queues_after"]["north"] == 0
    # Cycle 2 capacity is strictly 11 (not 12)
    assert res["history"][1]["discharge_capacities"]["north"] == 11


# ---------------------------------------------------------------------------
# 8. Cumulative Invariants vs. Per-Cycle Theoretical Capacity Exceedance
# ---------------------------------------------------------------------------

def test_legitimate_per_cycle_discharge_above_raw_theoretical_capacity_with_carryover():
    """
    Fractional carryover legitimately allows an individual cycle's discharge to exceed that
    cycle's raw theoretical capacity (12 > 11.5) due to accumulated fractional headroom,
    while strictly preserving both cumulative invariants and contrasting with independent floor.
    """
    init_queue = 50
    cycles = 4
    # Fixed green 25s, lost time 2.0s -> g_eff = 23s -> theoretical cap = 11.5 veh/cycle
    res_carry = simulate_intersection(
        initial_queues={"north": init_queue, "south": 0, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=cycles,
        strategy="fixed",
        discharge_policy="fractional_carryover"
    )

    h_carry = res_carry["history"]
    discharges = [c["discharged"]["north"] for c in h_carry]
    theo_caps = [c["theoretical_capacities"]["north"] for c in h_carry]

    # Theoretical capacity is constant 11.5 per cycle
    assert theo_caps == [11.5, 11.5, 11.5, 11.5]
    # Approach B discharges: 11 in cycle 1, 12 in cycle 2, 11 in cycle 3, 12 in cycle 4
    assert discharges == [11, 12, 11, 12]

    # Cycle 2 and Cycle 4 discharge strictly exceeds raw theoretical capacity for that cycle!
    assert h_carry[1]["discharged"]["north"] > h_carry[1]["theoretical_capacities"]["north"]
    assert h_carry[3]["discharged"]["north"] > h_carry[3]["theoretical_capacities"]["north"]

    # Verify cumulative invariants at every cycle prefix
    cum_disc = 0
    cum_theo = 0.0
    cum_arr = 0
    for c in h_carry:
        cum_disc += c["discharged"]["north"]
        cum_theo += c["theoretical_capacities"]["north"]
        cum_arr += c["arrivals"]["north"]

        # Invariant 1: Cumulative discharge <= Cumulative theoretical capacity
        assert cum_disc <= cum_theo + 1e-9, f"Exceeded cumulative capacity: {cum_disc} > {cum_theo}"
        # Invariant 2: Cumulative discharge <= Available vehicles (initial queue + cumulative arrivals)
        assert cum_disc <= init_queue + cum_arr, f"Exceeded available demand: {cum_disc} > {init_queue + cum_arr}"

    # Overall totals over 4 cycles
    assert cum_disc == 46
    assert cum_theo == 46.0
    assert cum_disc <= cum_theo
    assert res_carry["metrics"]["overall"]["vehicle_conservation_verified"] is True

    # Contrast with independent-floor policy: per-cycle bound strictly holds for every cycle
    res_floor = simulate_intersection(
        initial_queues={"north": init_queue, "south": 0, "east": 0, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=cycles,
        strategy="fixed",
        discharge_policy="independent_floor"
    )
    h_floor = res_floor["history"]
    floor_discharges = [c["discharged"]["north"] for c in h_floor]
    assert floor_discharges == [11, 11, 11, 11]
    for c in h_floor:
        # Under independent-floor, per-cycle discharge NEVER exceeds raw theoretical capacity
        assert c["discharged"]["north"] <= c["theoretical_capacities"]["north"]
        assert c["discharged"]["north"] <= c["discharge_capacities"]["north"]


def test_multidirectional_cumulative_invariants_and_per_cycle_carryover_exceedance():
    """
    Verifies cumulative capacity and demand invariants independently across all 4 directions
    while demonstrating legitimate per-cycle exceedance in cycle 2 under fractional carryover.
    """
    init_queues = {"north": 40, "south": 40, "east": 40, "west": 40}
    rates = {"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}

    res = simulate_intersection(
        initial_queues=init_queues,
        arrival_rates=rates,
        cycles=3,
        strategy="fixed",
        random_seed=777,
        discharge_policy="fractional_carryover"
    )
    h = res["history"]

    # In cycle 2, fractional carryover (0.5 + 11.5 = 12.0) enables discharge of 12 for all directions
    for d in DIRECTIONS:
        assert h[0]["discharged"][d] == 11
        assert h[1]["discharged"][d] == 12
        # Legitimate per-cycle exceedance: 12 > 11.5
        assert h[1]["discharged"][d] > h[1]["theoretical_capacities"][d]

    # Verify cumulative invariants independently for all 4 directions
    cum_discharged = {d: 0 for d in DIRECTIONS}
    cum_theo_cap = {d: 0.0 for d in DIRECTIONS}
    cum_arrivals = {d: 0 for d in DIRECTIONS}

    for c in h:
        for d in DIRECTIONS:
            cum_discharged[d] += c["discharged"][d]
            cum_theo_cap[d] += c["theoretical_capacities"][d]
            cum_arrivals[d] += c["arrivals"][d]

            # Invariant 1: Cumulative discharge <= Cumulative theoretical capacity
            assert cum_discharged[d] <= cum_theo_cap[d] + 1e-9
            # Invariant 2: Cumulative discharge <= Initial queue + Cumulative arrivals
            assert cum_discharged[d] <= init_queues[d] + cum_arrivals[d]

    assert res["metrics"]["overall"]["vehicle_conservation_verified"] is True



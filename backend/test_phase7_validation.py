import math
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.services.simulation_validator import (
    validate_scenario_a_no_traffic,
    validate_scenario_b_balanced_traffic,
    validate_scenario_c_asymmetric_traffic,
    validate_scenario_d_capacity_constrained,
    validate_scenario_e_queue_clearance,
    validate_scenario_f_zero_effective_green,
    validate_scenario_g_variable_lanes,
    validate_scenario_h_conservation_invariant,
    compare_discharge_policies_audit,
    run_all_validation_scenarios,
)
from backend.services.sensitivity_analyzer import run_parameter_sensitivity_sweep
from backend.services.traffic_simulator import simulate_intersection
from backend.services.simulation_metrics import calculate_simulation_metrics

client = TestClient(app)
DIRECTIONS = ["north", "south", "east", "west"]


def test_validation_scenario_a_no_traffic():
    """Scenario A: Zero initial queues and zero arrivals produce zero discharge and no division errors."""
    report = validate_scenario_a_no_traffic()
    assert report["passed"] is True
    obs = report["observed"]
    assert obs["total_initial_queue"] == 0
    assert obs["total_arrivals"] == 0
    assert obs["total_discharged"] == 0
    assert obs["total_remaining"] == 0
    assert obs["waiting_time_seconds"] == 0.0
    assert obs["capacity_utilization_pct"] == 0.0
    assert obs["conservation_verified"] is True


def test_validation_scenario_b_balanced_traffic():
    """Scenario B: Equal initial queues and arrivals allocate identical green times across approaches."""
    report = validate_scenario_b_balanced_traffic()
    assert report["passed"] is True
    obs = report["observed"]
    assert obs["equal_allocation_verified"] is True
    assert obs["balanced_green_times_cycle_1"] == {"north": 25, "south": 25, "east": 25, "west": 25}
    assert obs["balanced_green_times_cycle_2"] == {"north": 25, "south": 25, "east": 25, "west": 25}
    assert obs["conservation_verified"] is True


def test_validation_scenario_c_asymmetric_traffic():
    """Scenario C: Highly asymmetric traffic allocates maximum green (40s) to critical approach."""
    report = validate_scenario_c_asymmetric_traffic()
    assert report["passed"] is True
    obs = report["observed"]
    assert obs["north_green_at_maximum"] is True
    assert obs["vehicles_saved_on_north"] > 0
    assert obs["conservation_verified"] is True


def test_validation_scenario_d_capacity_constrained():
    """Scenario D: When arrival rate exceeds discharge capacity, queues grow and cumulative invariants hold."""
    report = validate_scenario_d_capacity_constrained()
    assert report["passed"] is True
    obs = report["observed"]
    assert obs["queues_strictly_growing"] is True
    assert obs["cumulative_discharge_bounded_by_capacity"] is True
    assert obs["cumulative_discharge_bounded_by_demand"] is True
    assert all(obs["cumulative_capacity_bounded_by_direction"].values())
    assert all(obs["cumulative_demand_bounded_by_direction"].values())
    assert obs["discharge_never_exceeds_capacity"] is True  # backward compatibility alias
    assert obs["independent_floor_per_cycle_bounded"] is True
    assert obs["conservation_verified"] is True


def test_validation_scenario_e_queue_clearance():
    """Scenario E: Known finite queue of 22 vehicles with 0 arrivals clears in exactly 2 cycles."""
    report = validate_scenario_e_queue_clearance()
    assert report["passed"] is True
    obs = report["observed"]
    assert obs["cycle_1_discharged"] == 11
    assert obs["cycle_1_remaining"] == 11
    assert obs["cycle_2_discharged"] == 11
    assert obs["cycle_2_remaining"] == 0
    assert obs["fully_cleared_in_2_cycles"] is True
    assert obs["conservation_verified"] is True


def test_validation_scenario_f_zero_effective_green():
    """Scenario F: Startup lost time >= nominal green results in 0.0s effective green and 0 discharge."""
    report = validate_scenario_f_zero_effective_green()
    assert report["passed"] is True
    obs = report["observed"]
    assert obs["effective_green_time_seconds"] == 0.0
    assert obs["total_discharged"] == 0
    assert obs["zero_discharge_verified"] is True
    assert obs["conservation_verified"] is True


def test_validation_scenario_g_variable_lanes():
    """Scenario G: Multilane geometry scales discharge capacity directly with lane count."""
    report = validate_scenario_g_variable_lanes()
    assert report["passed"] is True
    obs = report["observed"]
    assert obs["capacity_scaling_verified"] is True
    assert obs["north_discharged"] > obs["south_discharged"] > obs["east_discharged"]
    assert obs["east_discharged"] == obs["west_discharged"]
    assert obs["conservation_verified"] is True


def test_validation_scenario_h_conservation_invariant():
    """Scenario H: Mass conservation invariant strictly holds across 10-cycle multi-approach stress test."""
    report = validate_scenario_h_conservation_invariant()
    assert report["passed"] is True
    obs = report["observed"]
    assert obs["adaptive_per_cycle_conservation"] is True
    assert obs["fixed_per_cycle_conservation"] is True
    assert obs["adaptive_overall_conservation"] is True
    assert obs["fixed_overall_conservation"] is True
    assert obs["conservation_verified"] is True


def test_discharge_policy_audit_fractional_carryover():
    """Audit confirms Approach B accumulates fractional capacity while preserving conservation."""
    audit = compare_discharge_policies_audit()
    assert audit["passed"] is True
    app_a = audit["approach_a_independent_floor"]
    app_b = audit["approach_b_fractional_carryover"]

    # Over 4 cycles with 11.5 veh/cycle theoretical capacity (total 46.0 veh):
    # Approach A discards 0.5 each cycle -> 44 veh discharged
    # Approach B carries over 0.5 headway -> 46 veh discharged
    assert app_a["total_discharged"] == 44
    assert app_b["total_discharged"] == 46
    assert app_b["total_discharged"] <= audit["parameters"]["cumulative_theoretical_capacity"]


def test_waiting_time_approximation_deterministic_trajectories():
    """Waiting time formula rigorously integrates cycle delay: total delay / total demand."""
    cycle_time = 120
    # Case 1: Constant queue of 10 vehicles across 2 cycles, 0 arrivals, 0 discharged
    history_const = [
        {
            "cycle": 1,
            "queues_before": {d: 10 for d in DIRECTIONS},
            "arrivals": {d: 0 for d in DIRECTIONS},
            "queues_before_discharge": {d: 10 for d in DIRECTIONS},
            "green_times": {d: 25 for d in DIRECTIONS},
            "discharged": {d: 0 for d in DIRECTIONS},
            "queues_after": {d: 10 for d in DIRECTIONS}
        },
        {
            "cycle": 2,
            "queues_before": {d: 10 for d in DIRECTIONS},
            "arrivals": {d: 0 for d in DIRECTIONS},
            "queues_before_discharge": {d: 10 for d in DIRECTIONS},
            "green_times": {d: 25 for d in DIRECTIONS},
            "discharged": {d: 0 for d in DIRECTIONS},
            "queues_after": {d: 10 for d in DIRECTIONS}
        }
    ]
    # Each direction: q_avg = (10 + 10) / 2 = 10. Delay = 10 * 120 * 2 = 2400 veh-sec.
    # Total delay across 4 directions = 4 * 2400 = 9600 veh-sec.
    # Total demand = 4 * 10 = 40 vehicles.
    # Average wait time = 9600 / 40 = 240.0 seconds.
    metrics_const = calculate_simulation_metrics(
        history=history_const,
        initial_queues={d: 10 for d in DIRECTIONS},
        cycle_time=cycle_time
    )
    assert metrics_const["overall"]["estimated_average_waiting_time_seconds"] == 240.0
    for d in DIRECTIONS:
        assert metrics_const["by_direction"][d]["estimated_average_waiting_time_seconds"] == 240.0

    # Case 2: Linear clearance from 20 to 0 in 1 cycle, 0 arrivals, 20 discharged
    history_cleared = [
        {
            "cycle": 1,
            "queues_before": {d: 20 for d in DIRECTIONS},
            "arrivals": {d: 0 for d in DIRECTIONS},
            "queues_before_discharge": {d: 20 for d in DIRECTIONS},
            "green_times": {d: 25 for d in DIRECTIONS},
            "discharged": {d: 20 for d in DIRECTIONS},
            "queues_after": {d: 0 for d in DIRECTIONS}
        }
    ]
    # q_avg = (20 + 0) / 2 = 10. Delay per dir = 10 * 120 = 1200 veh-sec.
    # Total delay = 4 * 1200 = 4800 veh-sec. Total demand = 80 veh.
    # Average wait time = 4800 / 80 = 60.0 seconds (half a cycle delay).
    metrics_cleared = calculate_simulation_metrics(
        history=history_cleared,
        initial_queues={d: 20 for d in DIRECTIONS},
        cycle_time=cycle_time
    )
    assert metrics_cleared["overall"]["estimated_average_waiting_time_seconds"] == 60.0


def test_sensitivity_analysis_arrival_rate_monotonicity():
    """Increasing arrival rates monotonically increases remaining queue and waiting time."""
    sweep = run_parameter_sensitivity_sweep(
        parameter_name="arrival_rate",
        parameter_values=[2.0, 5.0, 10.0, 15.0, 20.0],
        compare_both_strategies=True
    )
    assert sweep["sweep_count"] == 5
    results = sweep["results"]

    # Final queue should strictly increase as arrival rate increases
    queues = [r["adaptive"]["final_queue"] for r in results]
    assert queues == sorted(queues)


def test_sensitivity_analysis_lanes_monotonicity():
    """Increasing lanes increases total discharge throughput and reduces final queue."""
    sweep = run_parameter_sensitivity_sweep(
        parameter_name="lanes",
        parameter_values=[1, 2, 3, 4],
        compare_both_strategies=False
    )
    assert sweep["sweep_count"] == 4
    results = sweep["results"]

    # 1 lane to 4 lanes: theoretical capacity increases monotonically
    caps = [r["adaptive"]["total_theoretical_capacity"] for r in results]
    assert caps == sorted(caps)


def test_sensitivity_analysis_startup_lost_time_effect():
    """Increasing startup lost time decreases effective capacity and increases waiting time."""
    sweep = run_parameter_sensitivity_sweep(
        parameter_name="startup_lost_time",
        parameter_values=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
        compare_both_strategies=False
    )
    assert sweep["sweep_count"] == 6
    results = sweep["results"]

    caps = [r["adaptive"]["total_theoretical_capacity"] for r in results]
    # Higher lost time -> lower total capacity
    assert caps == sorted(caps, reverse=True)


def test_sensitivity_analysis_unsupported_parameter():
    """run_parameter_sensitivity_sweep raises ValueError on invalid parameter names."""
    with pytest.raises(ValueError, match="Unsupported parameter"):
        run_parameter_sensitivity_sweep(parameter_name="invalid_param")

    with pytest.raises(ValueError, match="parameter_values must be a non-empty list"):
        run_parameter_sensitivity_sweep(parameter_name="arrival_rate", parameter_values=[])


def test_api_validation_scenarios_endpoint():
    """GET /validation-scenarios returns 200 with all scenarios passing."""
    response = client.get("/validation-scenarios")
    assert response.status_code == 200
    data = response.json()
    assert data["validation_status"] == "PASSED"
    assert data["total_scenarios"] == 8
    assert data["passed_scenarios"] == 8
    assert "discharge_policy_audit" in data


def test_api_sensitivity_analysis_endpoint():
    """POST /sensitivity-analysis returns 200 with complete parameter sweep output."""
    payload = {
        "parameter_name": "arrival_rate",
        "parameter_values": [3.0, 7.0, 12.0],
        "compare_both_strategies": True
    }
    response = client.post("/sensitivity-analysis", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["parameter_name"] == "arrival_rate"
    assert len(data["results"]) == 3
    assert "adaptive" in data["results"][0]
    assert "fixed" in data["results"][0]
    assert "vehicles_saved" in data["results"][0]


def test_api_simulate_with_discharge_policy():
    """POST /simulate supports discharge_policy parameter."""
    payload = {
        "initial_queues": {"north": 50, "south": 40, "east": 30, "west": 20},
        "arrival_rates": {"north": 10.0, "south": 8.0, "east": 5.0, "west": 3.0},
        "cycles": 3,
        "discharge_policy": "fractional_carryover"
    }
    response = client.post("/simulate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["configuration"]["discharge_policy"] == "fractional_carryover"
    assert data["metrics"]["overall"]["vehicle_conservation_verified"] is True

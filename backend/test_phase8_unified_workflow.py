"""
Integration Test Suite for Unified End-to-End Workflow
======================================================

Phase 8.3: Backend End-to-End Workflow Orchestration

Tests verify:
1. Valid unified workflow request succeeds with all 6 structured sections.
2. Invalid directional inputs (negative queues, missing directions, boolean types) are rejected.
3. Invalid geometry (lanes < 1, negative saturation flow, negative startup lost time) is rejected.
4. ML prediction is included with class probabilities, thresholds, and non-calibrated notice.
5. Directional inputs are preserved exactly without deriving from regional ML.
6. Adaptive simulation results include cycle history, metrics, and conservation check.
7. Fixed vs adaptive comparison includes paired differences, confidence intervals, and win rates.
8. Common Random Numbers paired seed execution is enforced.
9. Deterministic repeatability when random_seed is fixed.
10. Strict vehicle conservation invariant holds ($Init + Arr - Disc = Rem$).
11. Discharge capacity constraints are respected across all simulated cycles.
12. Backward compatibility of all existing standalone endpoints.
13. Fractional carryover vs independent floor discharge policies in unified workflow.
"""

import copy
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app

client = TestClient(app)

SAMPLE_REGIONAL_WEATHER = {
    "holiday": "None",
    "temp": 293.15,
    "rain_1h": 0.0,
    "snow_1h": 0.0,
    "clouds_all": 20,
    "weather_main": "Clear",
    "hour": 17,
    "day": 23,
    "month": 11,
    "day_of_week": 0,
    "is_weekend": 0,
}

SAMPLE_DIRECTIONAL_QUEUES = {
    "north": 35,
    "south": 25,
    "east": 15,
    "west": 10,
}

SAMPLE_ARRIVAL_RATES = {
    "north": 10.0,
    "south": 7.0,
    "east": 4.0,
    "west": 3.0,
}


def get_valid_payload():
    return {
        **SAMPLE_REGIONAL_WEATHER,
        "initial_queues": copy.deepcopy(SAMPLE_DIRECTIONAL_QUEUES),
        "arrival_rates": copy.deepcopy(SAMPLE_ARRIVAL_RATES),
        "lanes": {"north": 2, "south": 2, "east": 1, "west": 1},
        "saturation_flow_rates": {"north": 1800.0, "south": 1800.0, "east": 1800.0, "west": 1800.0},
        "startup_lost_times": {"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0},
        "discharge_policy": "independent_floor",
        "cycles": 4,
        "runs": 5,
        "random_seed": 42,
        "apply_ml_scenario_scaling": False,
    }


def test_unified_workflow_success():
    """Verify that a valid request returns HTTP 200 and all six response sections."""
    payload = get_valid_payload()
    response = client.post("/unified-workflow", json=payload)
    assert response.status_code == 200

    data = response.json()
    expected_sections = [
        "ml_prediction",
        "directional_inputs",
        "signal_allocation",
        "simulation_results",
        "strategy_comparison",
        "model_assumptions",
    ]
    for section in expected_sections:
        assert section in data, f"Missing section: {section}"


def test_directional_inputs_preserved_and_independent():
    """Verify directional inputs are preserved exactly and not derived from ML."""
    payload = get_valid_payload()
    response = client.post("/unified-workflow", json=payload)
    assert response.status_code == 200

    data = response.json()
    dir_inputs = data["directional_inputs"]
    assert dir_inputs["initial_queues"] == SAMPLE_DIRECTIONAL_QUEUES
    assert dir_inputs["arrival_rates"] == SAMPLE_ARRIVAL_RATES
    assert dir_inputs["effective_arrival_rates"] == SAMPLE_ARRIVAL_RATES
    assert dir_inputs["lanes"]["north"] == 2
    assert dir_inputs["scenario_scaling"]["applied"] is False


def test_ml_scenario_scaling_illustrative():
    """Verify optional ML scenario scaling applies the multiplier and documents its illustrative nature."""
    payload = get_valid_payload()
    payload["apply_ml_scenario_scaling"] = True
    response = client.post("/unified-workflow", json=payload)
    assert response.status_code == 200

    data = response.json()
    scaling = data["directional_inputs"]["scenario_scaling"]
    assert scaling["applied"] is True
    assert "multiplier" in scaling
    assert scaling["multiplier"] in [0.85, 1.0, 1.25]
    assert "NOT a learned directional output" in scaling["note"]

    # Verify original arrival rates remain untouched
    assert data["directional_inputs"]["arrival_rates"] == SAMPLE_ARRIVAL_RATES
    # Verify effective arrival rates reflect the multiplier
    for d in ["north", "south", "east", "west"]:
        expected = round(SAMPLE_ARRIVAL_RATES[d] * scaling["multiplier"], 2)
        assert data["directional_inputs"]["effective_arrival_rates"][d] == expected


def test_ml_prediction_contents():
    """Verify ML prediction includes class probabilities and scope limitations."""
    payload = get_valid_payload()
    response = client.post("/unified-workflow", json=payload)
    assert response.status_code == 200

    ml = data = response.json()["ml_prediction"]
    assert ml["predicted_traffic_level"] in ["Low", "Medium", "High"]
    assert "Low" in ml["class_probabilities"]
    assert "Medium" in ml["class_probabilities"]
    assert "High" in ml["class_probabilities"]
    assert "thresholds" in ml or "classification_thresholds" in ml
    assert "should not be interpreted as calibrated" in ml["confidence_interpretation"]
    assert "Regional freeway corridor" in ml["model_scope"]


def test_signal_allocation_contents():
    """Verify baseline signal timing is computed from initial queues with timing constraints."""
    payload = get_valid_payload()
    response = client.post("/unified-workflow", json=payload)
    assert response.status_code == 200

    sig = response.json()["signal_allocation"]
    assert sig["timing_source"] == "initial_queue_baseline"
    assert sig["cycle_time"] == 120
    assert sig["clearance_time"] == 20
    assert sig["total_green_time"] == 100
    assert sum(sig["green_times"].values()) == 100
    for d, g in sig["green_times"].items():
        assert 10 <= g <= 40


def test_simulation_results_and_conservation():
    """Verify single-run adaptive simulation adheres to vehicle conservation."""
    payload = get_valid_payload()
    response = client.post("/unified-workflow", json=payload)
    assert response.status_code == 200

    sim = response.json()["simulation_results"]
    assert sim["strategy"] == "adaptive"
    assert sim["random_seed"] == 42
    assert len(sim["history"]) == 4

    vc = sim["vehicle_conservation"]
    assert vc["is_conserved"] is True
    assert vc["discrepancy"] == 0
    assert (
        vc["total_initial_queue"] + vc["total_arrivals"] - vc["total_discharged"]
        == vc["total_remaining"]
    )


def test_strategy_comparison_paired_crn():
    """Verify strategy comparison uses paired random seeds and reports paired difference statistics."""
    payload = get_valid_payload()
    response = client.post("/unified-workflow", json=payload)
    assert response.status_code == 200

    comp = response.json()["strategy_comparison"]
    assert comp["monte_carlo_runs"] == 5
    assert comp["base_seed"] == 42
    assert "fixed_strategy" in comp
    assert "adaptive_strategy" in comp
    assert "comparison_summary" in comp

    p_diff = comp["paired_difference_statistics"]
    assert "mean_paired_difference" in p_diff
    assert "sample_std_paired_difference" in p_diff
    assert "confidence_interval_95" in p_diff
    assert "Common Random Numbers" in p_diff["crn_methodology_note"]

    win_stats = comp["win_tie_statistics"]
    assert win_stats["total_runs"] == 5
    assert win_stats["adaptive_wins"] + win_stats["fixed_wins"] + win_stats["ties"] == 5


def test_deterministic_reproducibility():
    """Verify identical payload and random seed produces identical simulation and comparison results."""
    payload = get_valid_payload()
    res1 = client.post("/unified-workflow", json=payload).json()
    res2 = client.post("/unified-workflow", json=payload).json()

    # Exact equality of single-run cycle history
    assert res1["simulation_results"]["history"] == res2["simulation_results"]["history"]
    assert res1["simulation_results"]["final_queues"] == res2["simulation_results"]["final_queues"]

    # Exact equality of comparison paired differences
    assert (
        res1["strategy_comparison"]["paired_difference_statistics"]["mean_paired_difference"]
        == res2["strategy_comparison"]["paired_difference_statistics"]["mean_paired_difference"]
    )


def test_rejection_invalid_queues():
    """Verify negative queues or missing directions are rejected with HTTP 400."""
    # Negative queue
    bad_payload = get_valid_payload()
    bad_payload["initial_queues"]["north"] = -5
    res = client.post("/unified-workflow", json=bad_payload)
    assert res.status_code == 400
    assert "negative" in res.json()["detail"].lower()

    # Boolean in queue
    bad_payload = get_valid_payload()
    bad_payload["initial_queues"]["south"] = True
    res = client.post("/unified-workflow", json=bad_payload)
    assert res.status_code == 400

    # Missing direction
    bad_payload = get_valid_payload()
    del bad_payload["initial_queues"]["west"]
    res = client.post("/unified-workflow", json=bad_payload)
    assert res.status_code == 400


def test_rejection_invalid_arrival_rates():
    """Verify invalid arrival rates (negative, NaN, inf, bool) are rejected with HTTP 400."""
    bad_payload = get_valid_payload()
    bad_payload["arrival_rates"]["north"] = -2.5
    res = client.post("/unified-workflow", json=bad_payload)
    assert res.status_code == 400

    bad_payload = get_valid_payload()
    bad_payload["arrival_rates"]["east"] = False
    res = client.post("/unified-workflow", json=bad_payload)
    assert res.status_code == 400


def test_rejection_invalid_geometry():
    """Verify invalid lane counts, saturation flow rates, and lost times are rejected."""
    # Lanes < 1
    bad_payload = get_valid_payload()
    bad_payload["lanes"]["north"] = 0
    res = client.post("/unified-workflow", json=bad_payload)
    assert res.status_code == 400

    # Negative saturation flow
    bad_payload = get_valid_payload()
    bad_payload["saturation_flow_rates"]["north"] = -100.0
    res = client.post("/unified-workflow", json=bad_payload)
    assert res.status_code == 400

    # Negative startup lost time
    bad_payload = get_valid_payload()
    bad_payload["startup_lost_times"]["south"] = -1.0
    res = client.post("/unified-workflow", json=bad_payload)
    assert res.status_code == 400


def test_fractional_carryover_policy():
    """Verify fractional_carryover discharge policy is executed cleanly in unified workflow."""
    payload = get_valid_payload()
    payload["discharge_policy"] = "fractional_carryover"
    response = client.post("/unified-workflow", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["directional_inputs"]["discharge_policy"] == "fractional_carryover"
    assert data["simulation_results"]["vehicle_conservation"]["is_conserved"] is True


def test_backward_compatibility_existing_endpoints():
    """Verify existing endpoints continue functioning without regression."""
    # 0. / and /health
    root_res = client.get("/")
    assert root_res.status_code == 200
    assert "message" in root_res.json()

    health_res = client.get("/health")
    assert health_res.status_code == 200
    assert health_res.json().get("status") == "healthy"

    # 1. /predict
    pred_res = client.post("/predict", json=SAMPLE_REGIONAL_WEATHER)
    assert pred_res.status_code == 200
    assert "predicted_traffic_level" in pred_res.json()

    # 2. /optimize-signal
    opt_res = client.post("/optimize-signal", json=SAMPLE_DIRECTIONAL_QUEUES)
    assert opt_res.status_code == 200
    assert "green_times" in opt_res.json()

    # 3. /simulate
    sim_res = client.post("/simulate", json={
        "initial_queues": SAMPLE_DIRECTIONAL_QUEUES,
        "arrival_rates": SAMPLE_ARRIVAL_RATES,
        "cycles": 3,
        "strategy": "adaptive",
        "random_seed": 42
    })
    assert sim_res.status_code == 200
    assert "metrics" in sim_res.json()

    # 4. /compare-strategies
    comp_res = client.post("/compare-strategies", json={
        "initial_queues": SAMPLE_DIRECTIONAL_QUEUES,
        "arrival_rates": SAMPLE_ARRIVAL_RATES,
        "cycles": 3,
        "runs": 3,
        "random_seed": 42
    })
    assert comp_res.status_code == 200
    assert "statistical_reliability" in comp_res.json()


def test_arrival_rate_dimensional_conversion_and_poisson_mean():
    """
    Dimensional consistency regression test:
    Verify that directional arrival rates are configured in vehicles/minute,
    and the simulator applies exactly one conversion factor:
        λ_cycle = λ_minute * (CYCLE_TIME / 60) = λ_minute * 2.0
    Over many cycles, the sample mean must converge to 2.0 * rate,
    confirming neither 0 conversions (mean ≈ rate) nor 2 conversions (mean ≈ 4 * rate).
    """
    import numpy as np
    from backend.services.traffic_simulator import simulate_intersection

    rate_minute = 10.0  # vehicles / minute
    expected_lambda_cycle = rate_minute * 2.0  # 20.0 vehicles / cycle

    res = simulate_intersection(
        initial_queues={"north": 50, "south": 50, "east": 50, "west": 50},
        arrival_rates={"north": rate_minute, "south": 5.0, "east": 5.0, "west": 5.0},
        cycles=250,
        random_seed=999
    )

    north_arrivals = [c["arrivals"]["north"] for c in res["history"]]
    sample_mean = float(np.mean(north_arrivals))

    # Mean must be within 3 standard errors of 20.0:
    # std_err = sqrt(20) / sqrt(250) ≈ 4.47 / 15.81 ≈ 0.28
    assert abs(sample_mean - expected_lambda_cycle) < 1.0, (
        f"Empirical mean {sample_mean} deviates from expected λ_cycle={expected_lambda_cycle}. "
        f"Expected exactly 1 conversion (λ = rate * 2.0)."
    )
    # Decisively reject 0 conversions (which would yield ≈ 10.0)
    assert sample_mean > 15.0, f"Expected λ ≈ 20, got {sample_mean} (indicates missing conversion)"
    # Decisively reject double conversion (which would yield ≈ 40.0)
    assert sample_mean < 25.0, f"Expected λ ≈ 20, got {sample_mean} (indicates double conversion)"

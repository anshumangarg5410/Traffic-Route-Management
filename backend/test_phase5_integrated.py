import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.services.strategy_comparator import compare_strategies_multi_run

client = TestClient(app)

SAMPLE_WEATHER = {
    "holiday": "None",
    "temp": 290.0,
    "rain_1h": 0.0,
    "snow_1h": 0.0,
    "clouds_all": 20,
    "weather_main": "Clear",
    "hour": 18,
    "day": 23,
    "month": 11,
    "day_of_week": 0,
    "is_weekend": 0
}

SAMPLE_QUEUES = {
    "north": 45,
    "south": 30,
    "east": 15,
    "west": 10
}

SAMPLE_RATES = {
    "north": 12.0,
    "south": 8.0,
    "east": 4.0,
    "west": 3.0
}


def test_integrated_endpoint_success():
    """POST /integrated-prediction returns separated ML context and stochastic simulation results."""
    payload = {
        **SAMPLE_WEATHER,
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3,
        "strategy": "adaptive",
        "random_seed": 42
    }

    response = client.post("/integrated-prediction", json=payload)
    assert response.status_code == 200
    data = response.json()

    # 1. Verification of ML context
    assert "ml_context" in data
    ml = data["ml_context"]
    assert ml["predicted_traffic_level"] in ["Low", "Medium", "High"]
    assert "confidence" in ml
    assert "thresholds" in ml
    assert "model_metadata" in ml
    assert "The ML model does not predict directional vehicle counts" in ml["model_metadata"]["limitation"]

    # 2. Verification of simulation results
    assert "simulation_results" in data
    sim = data["simulation_results"]
    assert sim["cycles_simulated"] == 3
    assert sim["strategy"] == "adaptive"
    assert sim["random_seed"] == 42
    assert "final_queues" in sim
    assert "metrics" in sim
    assert "history" in sim

    # 3. Verification of scenario metadata
    assert "scenario_metadata" in data
    assert data["scenario_metadata"]["applied"] is False


def test_reproducible_integrated_simulations_with_seed():
    """Identical calls with the same seed produce identical ML predictions and simulation outcomes."""
    payload = {
        **SAMPLE_WEATHER,
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3,
        "strategy": "adaptive",
        "random_seed": 777
    }

    resp1 = client.post("/integrated-prediction", json=payload).json()
    resp2 = client.post("/integrated-prediction", json=payload).json()

    assert resp1["ml_context"]["predicted_traffic_level"] == resp2["ml_context"]["predicted_traffic_level"]
    assert resp1["simulation_results"]["final_queues"] == resp2["simulation_results"]["final_queues"]
    assert resp1["simulation_results"]["history"] == resp2["simulation_results"]["history"]


def test_vehicle_conservation_in_integrated_simulation():
    """Conservation law holds strictly in integrated simulation: final = initial + arrived - discharged."""
    payload = {
        **SAMPLE_WEATHER,
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 4,
        "strategy": "adaptive",
        "random_seed": 42
    }

    data = client.post("/integrated-prediction", json=payload).json()
    overall = data["simulation_results"]["metrics"]["overall"]

    total_init = sum(SAMPLE_QUEUES.values())
    total_arr = overall["total_arrivals"]
    total_disc = overall["total_discharged"]
    total_final = overall["total_remaining"]

    assert total_final == total_init + total_arr - total_disc


def test_invalid_weather_time_inputs():
    """Schema rejects invalid weather/time inputs (negative temp, invalid hour/month/day)."""
    # Negative temperature
    bad_temp = {**SAMPLE_WEATHER, "temp": -10.0, "initial_queues": SAMPLE_QUEUES, "arrival_rates": SAMPLE_RATES}
    assert client.post("/integrated-prediction", json=bad_temp).status_code == 400

    # Invalid hour
    bad_hour = {**SAMPLE_WEATHER, "hour": 25, "initial_queues": SAMPLE_QUEUES, "arrival_rates": SAMPLE_RATES}
    assert client.post("/integrated-prediction", json=bad_hour).status_code == 400

    # Invalid month
    bad_month = {**SAMPLE_WEATHER, "month": 13, "initial_queues": SAMPLE_QUEUES, "arrival_rates": SAMPLE_RATES}
    assert client.post("/integrated-prediction", json=bad_month).status_code == 400


def test_invalid_directional_inputs():
    """Schema rejects invalid directional arrival rates or initial queues."""
    from backend.api.main import IntegratedPredictionInput

    # Negative queue
    bad_queue = {
        **SAMPLE_WEATHER,
        "initial_queues": {"north": -5, "south": 10, "east": 10, "west": 10},
        "arrival_rates": SAMPLE_RATES
    }
    assert client.post("/integrated-prediction", json=bad_queue).status_code == 400

    # Non-numeric arrival rate via HTTP
    bad_str_rate = {
        **SAMPLE_WEATHER,
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": {"north": "invalid_rate", "south": 1.0, "east": 1.0, "west": 1.0}
    }
    assert client.post("/integrated-prediction", json=bad_str_rate).status_code == 400

    # Direct Pydantic validation of float('nan')
    with pytest.raises(ValueError, match="cannot be NaN or infinite"):
        IntegratedPredictionInput(
            **SAMPLE_WEATHER,
            initial_queues=SAMPLE_QUEUES,
            arrival_rates={"north": float("nan"), "south": 1.0, "east": 1.0, "west": 1.0}
        )


def test_optional_scenario_scaling_flag():
    """Transparent scenario scaling adjusts directional rates based on predicted traffic level."""
    payload_unscaled = {
        **SAMPLE_WEATHER,
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3,
        "random_seed": 42,
        "apply_ml_scenario_scaling": False
    }
    resp_unscaled = client.post("/integrated-prediction", json=payload_unscaled).json()

    payload_scaled = {
        **SAMPLE_WEATHER,
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3,
        "random_seed": 42,
        "apply_ml_scenario_scaling": True
    }
    resp_scaled = client.post("/integrated-prediction", json=payload_scaled).json()

    assert resp_unscaled["scenario_metadata"]["applied"] is False
    assert resp_scaled["scenario_metadata"]["applied"] is True
    assert "factor" in resp_scaled["scenario_metadata"]


def test_paired_differences_and_confidence_interval():
    """Multi-run strategy comparator computes paired differences, sample std, and 95% CI."""
    result = compare_strategies_multi_run(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=4,
        runs=5,
        base_seed=42
    )

    sr = result["statistical_reliability"]
    assert "paired_difference_statistics" in sr

    pds = sr["paired_difference_statistics"]
    assert "mean_paired_difference" in pds
    assert "sample_std_paired_difference" in pds
    assert "standard_error" in pds
    assert "confidence_interval_95" in pds

    ci = pds["confidence_interval_95"]
    assert ci["confidence_level"] == 0.95
    assert ci["degrees_of_freedom"] == 4
    assert ci["lower"] is not None
    assert ci["upper"] is not None
    assert ci["upper"] >= ci["lower"]
    assert "distinction_note" in pds
    assert "crn_methodology_note" in pds

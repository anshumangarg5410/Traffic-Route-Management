import math
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.services.traffic_simulator import simulate_intersection

client = TestClient(app)

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


def test_deterministic_seeded_execution():
    """Identical seed and inputs must produce bit-for-bit identical results."""
    run1 = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=5,
        strategy="adaptive",
        random_seed=42
    )

    run2 = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=5,
        strategy="adaptive",
        random_seed=42
    )

    assert run1["final_queues"] == run2["final_queues"]
    assert len(run1["history"]) == len(run2["history"]) == 5

    for c1, c2 in zip(run1["history"], run2["history"]):
        assert c1["arrivals"] == c2["arrivals"]
        assert c1["green_times"] == c2["green_times"]
        assert c1["discharged"] == c2["discharged"]
        assert c1["queues_after"] == c2["queues_after"]


def test_different_seeds_produce_different_arrivals():
    """Different seeds must yield distinct stochastic arrival sequences."""
    run_a = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=5,
        strategy="adaptive",
        random_seed=101
    )

    run_b = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=5,
        strategy="adaptive",
        random_seed=202
    )

    arrivals_a = [c["arrivals"] for c in run_a["history"]]
    arrivals_b = [c["arrivals"] for c in run_b["history"]]
    assert arrivals_a != arrivals_b


def test_stochastic_unseeded_execution():
    """Omitting the random seed produces varying arrivals between runs."""
    results = [
        simulate_intersection(
            initial_queues=SAMPLE_QUEUES,
            arrival_rates=SAMPLE_RATES,
            cycles=4,
            random_seed=None
        )
        for _ in range(5)
    ]

    all_cycle1_arrivals = [r["history"][0]["arrivals"]["north"] for r in results]
    # In 5 runs with λ=24, Poisson counts should not all be identical
    assert len(set(all_cycle1_arrivals)) > 1


def test_poisson_arrival_statistical_mean():
    """Over many cycles, Poisson mean must converge to λ = rate * cycle_time_min."""
    rate_north = 15.0  # vehicles/min
    cycle_time_min = 2.0  # 120s / 60
    expected_lambda = rate_north * cycle_time_min  # 30.0

    rates = {"north": rate_north, "south": 5.0, "east": 5.0, "west": 5.0}
    queues = {"north": 50, "south": 20, "east": 20, "west": 20}

    res = simulate_intersection(
        initial_queues=queues,
        arrival_rates=rates,
        cycles=300,
        random_seed=12345
    )

    north_arrivals = [c["arrivals"]["north"] for c in res["history"]]
    sample_mean = float(np.mean(north_arrivals))

    # With 300 cycles, sample mean should be within 3 standard errors of λ
    # std = sqrt(30) ≈ 5.48, std_err = 5.48 / sqrt(300) ≈ 0.316
    assert abs(sample_mean - expected_lambda) < 1.0


def test_zero_arrival_rates():
    """When arrival rates are zero, arrivals in every cycle must be exactly 0."""
    zero_rates = {"north": 0.0, "south": 0, "east": 0.0, "west": 0}
    res = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=zero_rates,
        cycles=3,
        random_seed=42
    )

    for cycle in res["history"]:
        assert cycle["arrivals"] == {"north": 0, "south": 0, "east": 0, "west": 0}


def test_both_strategies_supported():
    """Simulation supports both 'fixed' and 'adaptive' signal strategies."""
    fixed_res = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=3,
        strategy="fixed",
        random_seed=77
    )
    assert fixed_res["strategy"] == "fixed"
    for c in fixed_res["history"]:
        assert c["green_times"] == {"north": 25, "south": 25, "east": 25, "west": 25}

    adaptive_res = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=3,
        strategy="adaptive",
        random_seed=77
    )
    assert adaptive_res["strategy"] == "adaptive"
    # Adaptive strategy should allocate varying green times based on queue demand
    first_cycle_green = adaptive_res["history"][0]["green_times"]
    assert first_cycle_green["north"] > first_cycle_green["west"]


def test_validation_nan_arrival_rate():
    """NaN arrival rates must be rejected with ValueError."""
    bad_rates = SAMPLE_RATES.copy()
    bad_rates["north"] = float("nan")

    with pytest.raises(ValueError, match="Invalid arrival rate for north"):
        simulate_intersection(
            initial_queues=SAMPLE_QUEUES,
            arrival_rates=bad_rates,
            cycles=3
        )


def test_validation_inf_arrival_rate():
    """Infinite arrival rates must be rejected with ValueError."""
    bad_rates = SAMPLE_RATES.copy()
    bad_rates["south"] = float("inf")

    with pytest.raises(ValueError, match="Invalid arrival rate for south"):
        simulate_intersection(
            initial_queues=SAMPLE_QUEUES,
            arrival_rates=bad_rates,
            cycles=3
        )

    bad_rates["south"] = -float("inf")
    with pytest.raises(ValueError, match="Invalid arrival rate for south"):
        simulate_intersection(
            initial_queues=SAMPLE_QUEUES,
            arrival_rates=bad_rates,
            cycles=3
        )


def test_validation_negative_arrival_rate():
    """Negative arrival rates must be rejected with ValueError."""
    bad_rates = SAMPLE_RATES.copy()
    bad_rates["east"] = -1.5

    with pytest.raises(ValueError, match="Invalid arrival rate for east"):
        simulate_intersection(
            initial_queues=SAMPLE_QUEUES,
            arrival_rates=bad_rates,
            cycles=3
        )


def test_validation_invalid_initial_queue():
    """Invalid initial queues (negative, float, bool) must be rejected."""
    bad_queues = SAMPLE_QUEUES.copy()
    bad_queues["north"] = -1
    with pytest.raises(ValueError, match="Invalid initial queue for north"):
        simulate_intersection(bad_queues, SAMPLE_RATES)

    bad_queues["north"] = 12.5  # float
    with pytest.raises(ValueError, match="Invalid initial queue for north"):
        simulate_intersection(bad_queues, SAMPLE_RATES)

    bad_queues["north"] = True  # bool
    with pytest.raises(ValueError, match="Invalid initial queue for north"):
        simulate_intersection(bad_queues, SAMPLE_RATES)


def test_validation_invalid_directions():
    """Missing or incorrect direction keys must raise ValueError."""
    incomplete_queues = {"north": 10, "south": 10, "east": 10}
    with pytest.raises(ValueError, match="Initial queues must contain all four directions"):
        simulate_intersection(incomplete_queues, SAMPLE_RATES)

    incomplete_rates = {"north": 1.0, "south": 1.0, "east": 1.0}
    with pytest.raises(ValueError, match="Arrival rates must contain all four directions"):
        simulate_intersection(SAMPLE_QUEUES, incomplete_rates)


def test_validation_invalid_cycles():
    """Cycles must be a positive integer."""
    with pytest.raises(ValueError, match="Cycles must be a positive integer"):
        simulate_intersection(SAMPLE_QUEUES, SAMPLE_RATES, cycles=0)

    with pytest.raises(ValueError, match="Cycles must be a positive integer"):
        simulate_intersection(SAMPLE_QUEUES, SAMPLE_RATES, cycles=-5)

    with pytest.raises(ValueError, match="Cycles must be a positive integer"):
        simulate_intersection(SAMPLE_QUEUES, SAMPLE_RATES, cycles=3.5)

    with pytest.raises(ValueError, match="Cycles must be a positive integer"):
        simulate_intersection(SAMPLE_QUEUES, SAMPLE_RATES, cycles=True)


def test_validation_invalid_strategy():
    """Invalid strategy name must be rejected."""
    with pytest.raises(ValueError, match="Strategy must be 'adaptive' or 'fixed'"):
        simulate_intersection(SAMPLE_QUEUES, SAMPLE_RATES, strategy="unknown")


def test_validation_invalid_random_seed():
    """Random seed must be a non-negative integer or None."""
    with pytest.raises(ValueError, match="Random seed must be non-negative"):
        simulate_intersection(SAMPLE_QUEUES, SAMPLE_RATES, random_seed=-10)

    with pytest.raises(ValueError, match="Random seed must be an integer or None"):
        simulate_intersection(SAMPLE_QUEUES, SAMPLE_RATES, random_seed="seed42")

    with pytest.raises(ValueError, match="Random seed must be an integer or None"):
        simulate_intersection(SAMPLE_QUEUES, SAMPLE_RATES, random_seed=True)


def test_api_simulate_endpoint_seeded():
    """FastAPI /simulate endpoint accepts random_seed and returns reproducible output."""
    payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3,
        "strategy": "adaptive",
        "random_seed": 42
    }

    response1 = client.post("/simulate", json=payload)
    assert response1.status_code == 200
    data1 = response1.json()

    response2 = client.post("/simulate", json=payload)
    assert response2.status_code == 200
    data2 = response2.json()

    assert data1["final_queues"] == data2["final_queues"]
    assert data1["history"] == data2["history"]
    assert data1["random_seed"] == 42


def test_api_simulate_endpoint_unseeded():
    """FastAPI /simulate endpoint works seamlessly when random_seed is omitted."""
    payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3
    }

    response = client.post("/simulate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["cycles_simulated"] == 3
    assert data["strategy"] == "adaptive"
    assert data["random_seed"] is None


def test_api_simulate_endpoint_validation_error():
    """FastAPI /simulate returns 400 Bad Request on domain validation failure."""
    bad_payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": {
            "north": -5.0,
            "south": 8.0,
            "east": 4.0,
            "west": 3.0
        },
        "cycles": 3
    }
    response = client.post("/simulate", json=bad_payload)
    assert response.status_code == 400
    assert "Invalid arrival rate for north" in response.json()["detail"]


def test_api_simulate_endpoint_rejects_boolean_seed():
    """FastAPI /simulate schema rejects boolean random_seed with 400 Bad Request."""
    payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3,
        "random_seed": True
    }
    response = client.post("/simulate", json=payload)
    assert response.status_code == 400
    assert "Random seed must be an integer or None" in response.json()["detail"]


def test_api_simulate_endpoint_rejects_boolean_arrival_rate():
    """FastAPI /simulate schema rejects boolean arrival rates with 400 Bad Request."""
    bad_rates = SAMPLE_RATES.copy()
    bad_rates["north"] = True
    payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": bad_rates,
        "cycles": 3
    }
    response = client.post("/simulate", json=payload)
    assert response.status_code == 400
    assert "Invalid arrival rate for north" in response.json()["detail"]


def test_compare_strategies_identical_arrivals_when_unseeded():
    """Even when random_seed is omitted, /compare-strategies synchronizes seeds."""
    payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 4
    }
    response = client.post("/compare-strategies", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "random_seed" in data["comparison"]
    assert isinstance(data["comparison"]["random_seed"], int)

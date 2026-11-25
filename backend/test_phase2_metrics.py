import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.services.simulation_metrics import calculate_simulation_metrics
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


def test_cycle_level_metrics_in_history():
    """Each simulation cycle history must contain all required cycle-level metrics."""
    result = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=3,
        random_seed=42
    )

    directions = ["north", "south", "east", "west"]

    for cycle_data in result["history"]:
        assert "queues_before" in cycle_data
        assert "arrivals" in cycle_data
        assert "queues_before_discharge" in cycle_data
        assert "green_times" in cycle_data
        assert "discharged" in cycle_data
        assert "queues_after" in cycle_data

        for d in directions:
            initial_q = cycle_data["queues_before"][d]
            arrived = cycle_data["arrivals"][d]
            waiting = cycle_data["queues_before_discharge"][d]
            discharged = cycle_data["discharged"][d]
            remaining = cycle_data["queues_after"][d]

            # Validation of cycle arithmetic
            assert waiting == initial_q + arrived
            assert remaining == waiting - discharged
            assert remaining >= 0


def test_overall_metrics_conservation_law():
    """Total remaining vehicles must strictly satisfy: initial + arrived - discharged."""
    result = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=5,
        random_seed=42
    )

    overall = result["metrics"]["overall"]
    directions = ["north", "south", "east", "west"]

    total_init = sum(SAMPLE_QUEUES.values())
    total_arr = sum(sum(c["arrivals"][d] for d in directions) for c in result["history"])
    total_disc = sum(sum(c["discharged"][d] for d in directions) for c in result["history"])
    total_final = sum(result["final_queues"].values())

    assert overall["total_initial_queue"] == total_init
    assert overall["total_arrivals"] == total_arr
    assert overall["total_discharged"] == total_disc
    assert overall["total_remaining"] == total_final
    # Conservation of vehicles
    assert overall["total_remaining"] == total_init + total_arr - total_disc


def test_direction_wise_metrics():
    """Direction-wise metrics accurately aggregate arrivals, discharge, green time, and queues."""
    result = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=4,
        random_seed=42
    )

    by_dir = result["metrics"]["by_direction"]

    for d in ["north", "south", "east", "west"]:
        dm = by_dir[d]
        assert dm["initial_queue"] == SAMPLE_QUEUES[d]
        assert dm["final_queue"] == result["final_queues"][d]

        expected_arr = sum(c["arrivals"][d] for c in result["history"])
        expected_disc = sum(c["discharged"][d] for c in result["history"])
        expected_green = sum(c["green_times"][d] for c in result["history"])

        assert dm["total_arrivals"] == expected_arr
        assert dm["total_discharged"] == expected_disc
        assert dm["total_green_time_seconds"] == expected_green
        assert dm["average_green_time_seconds"] == round(expected_green / 4, 2)

        # Final queue conservation per direction
        assert dm["final_queue"] == SAMPLE_QUEUES[d] + expected_arr - expected_disc


def test_queue_reduction_percentage_calculation():
    """Queue reduction percentage evaluates ((initial - final) / initial) * 100."""
    # When queues decrease:
    # High capacity, low arrivals
    low_rates = {"north": 1.0, "south": 1.0, "east": 1.0, "west": 1.0}
    result = simulate_intersection(
        initial_queues={"north": 30, "south": 30, "east": 30, "west": 30},
        arrival_rates=low_rates,
        cycles=5,
        random_seed=42
    )

    overall = result["metrics"]["overall"]
    initial_total = 120
    final_total = overall["total_remaining"]
    expected_pct = round(((initial_total - final_total) / initial_total) * 100.0, 2)
    assert overall["queue_reduction_percentage"] == expected_pct


def test_zero_initial_queues_and_zero_arrivals():
    """Zero initial queue and zero arrivals must not crash or trigger division by zero."""
    zero_queues = {"north": 0, "south": 0, "east": 0, "west": 0}
    zero_rates = {"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0}

    result = simulate_intersection(
        initial_queues=zero_queues,
        arrival_rates=zero_rates,
        cycles=3,
        random_seed=42
    )

    overall = result["metrics"]["overall"]
    assert overall["total_initial_queue"] == 0
    assert overall["total_arrivals"] == 0
    assert overall["total_discharged"] == 0
    assert overall["total_remaining"] == 0
    assert overall["queue_reduction_percentage"] == 0.0
    assert overall["estimated_average_waiting_time_seconds"] == 0.0

    for d in ["north", "south", "east", "west"]:
        dm = result["metrics"]["by_direction"][d]
        assert dm["queue_reduction_percentage"] == 0.0
        assert dm["estimated_average_waiting_time_seconds"] == 0.0


def test_waiting_time_formula_consistency():
    """Estimated waiting time correctly integrates cycle-average queue and total demand."""
    result = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=2,
        random_seed=42
    )

    overall = result["metrics"]["overall"]
    cycle_time = 120
    total_delay = 0.0

    for c in result["history"]:
        for d in ["north", "south", "east", "west"]:
            q_start = c["queues_before_discharge"][d]
            q_end = c["queues_after"][d]
            total_delay += ((q_start + q_end) / 2.0) * cycle_time

    total_demand = overall["total_initial_queue"] + overall["total_arrivals"]
    expected_wait = round(total_delay / total_demand, 2)
    assert overall["estimated_average_waiting_time_seconds"] == expected_wait


def test_metrics_module_validation_errors():
    """calculate_simulation_metrics rejects invalid inputs gracefully."""
    with pytest.raises(ValueError, match="Simulation history must be a non-empty list"):
        calculate_simulation_metrics(history=[], initial_queues=SAMPLE_QUEUES)

    with pytest.raises(ValueError, match="Initial queues must contain north, south, east, and west"):
        calculate_simulation_metrics(history=[{"cycle": 1}], initial_queues={"north": 5})

    with pytest.raises(ValueError, match="cycle_time must be a positive integer"):
        calculate_simulation_metrics(
            history=[{"cycle": 1}],
            initial_queues=SAMPLE_QUEUES,
            cycle_time=-10
        )


def test_api_simulate_endpoint_returns_metrics():
    """FastAPI /simulate includes full metrics layer without breaking backward compatibility."""
    payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3,
        "random_seed": 42
    }

    response = client.post("/simulate", json=payload)
    assert response.status_code == 200
    data = response.json()

    # Legacy contract preservation
    assert "cycles_simulated" in data
    assert "final_queues" in data
    assert "history" in data
    assert "strategy" in data
    assert "random_seed" in data

    # New metrics layer
    assert "metrics" in data
    assert "overall" in data["metrics"]
    assert "by_direction" in data["metrics"]
    assert "assumptions" in data["metrics"]

    overall = data["metrics"]["overall"]
    for key in [
        "total_initial_queue",
        "total_arrivals",
        "total_discharged",
        "total_remaining",
        "average_queue_length",
        "maximum_queue_length",
        "queue_reduction_percentage",
        "estimated_average_waiting_time_seconds"
    ]:
        assert key in overall

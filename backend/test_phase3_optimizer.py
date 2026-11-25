import random
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.services.signal_optimizer import (
    AVAILABLE_GREEN_TIME,
    CYCLE_TIME,
    CLEARANCE_TIME,
    MIN_GREEN,
    MAX_GREEN,
    calculate_relative_demands,
    optimize_signal,
)
from backend.services.traffic_simulator import simulate_intersection

client = TestClient(app)


def test_equal_traffic_across_all_directions():
    """Equal queues result in identical green times and equal relative demands."""
    counts = {"north": 25, "south": 25, "east": 25, "west": 25}
    result = optimize_signal(counts)

    assert result["green_times"] == {
        "north": 25,
        "south": 25,
        "east": 25,
        "west": 25
    }
    assert result["relative_demands"] == {
        "north": 0.25,
        "south": 0.25,
        "east": 0.25,
        "west": 0.25
    }
    assert result["total_green_time"] == AVAILABLE_GREEN_TIME


def test_one_direction_significantly_higher_demand():
    """Heavy direction receives maximum green (40s), others receive proportional shares."""
    counts = {"north": 100, "south": 10, "east": 10, "west": 10}
    result = optimize_signal(counts)

    assert result["green_times"]["north"] == MAX_GREEN  # 40s
    assert result["green_times"]["south"] == 20
    assert result["green_times"]["east"] == 20
    assert result["green_times"]["west"] == 20
    assert sum(result["green_times"].values()) == AVAILABLE_GREEN_TIME


def test_all_queues_zero():
    """Zero traffic scenario allocates fair equal green times without starving any approach."""
    counts = {"north": 0, "south": 0, "east": 0, "west": 0}
    result = optimize_signal(counts)

    assert result["green_times"] == {
        "north": 25,
        "south": 25,
        "east": 25,
        "west": 25
    }
    assert result["relative_demands"] == {
        "north": 0.25,
        "south": 0.25,
        "east": 0.25,
        "west": 0.25
    }
    assert result["total_green_time"] == AVAILABLE_GREEN_TIME


def test_one_direction_zero_traffic():
    """Direction with zero traffic receives at least minimum green time (no starvation)."""
    counts = {"north": 60, "south": 30, "east": 10, "west": 0}
    result = optimize_signal(counts)

    # West must receive at least MIN_GREEN (10s)
    assert result["green_times"]["west"] >= MIN_GREEN
    assert result["green_times"]["north"] > result["green_times"]["south"]
    assert result["green_times"]["south"] > result["green_times"]["east"]
    assert sum(result["green_times"].values()) == AVAILABLE_GREEN_TIME


def test_all_directions_very_high_traffic():
    """Uniformly high traffic allocates equal green times up to available budget."""
    counts = {"north": 500, "south": 500, "east": 500, "west": 500}
    result = optimize_signal(counts)

    assert result["green_times"] == {
        "north": 25,
        "south": 25,
        "east": 25,
        "west": 25
    }
    assert sum(result["green_times"].values()) == AVAILABLE_GREEN_TIME


def test_minimum_green_enforcement():
    """Every approach strictly receives at least MIN_GREEN (10s)."""
    test_cases = [
        {"north": 1000, "south": 1, "east": 0, "west": 0},
        {"north": 0, "south": 0, "east": 100, "west": 0},
        {"north": 80, "south": 80, "east": 0, "west": 0},
    ]

    for tc in test_cases:
        res = optimize_signal(tc)
        for direction, green in res["green_times"].items():
            assert green >= MIN_GREEN, f"{direction} got {green}s < {MIN_GREEN}s"


def test_maximum_green_enforcement():
    """No approach exceeds MAX_GREEN (40s), even under extreme queue asymmetry."""
    test_cases = [
        {"north": 10000, "south": 0, "east": 0, "west": 0},
        {"north": 100, "south": 100, "east": 0, "west": 0},
        {"north": 200, "south": 50, "east": 10, "west": 5},
    ]

    for tc in test_cases:
        res = optimize_signal(tc)
        for direction, green in res["green_times"].items():
            assert green <= MAX_GREEN, f"{direction} got {green}s > {MAX_GREEN}s"


def test_exact_total_green_conservation_fuzz():
    """Across 50 randomized queue distributions, sum of green times is strictly 100 seconds."""
    rng = random.Random(42)

    for _ in range(50):
        counts = {
            "north": rng.randint(0, 300),
            "south": rng.randint(0, 300),
            "east": rng.randint(0, 300),
            "west": rng.randint(0, 300)
        }
        res = optimize_signal(counts)
        greens = res["green_times"]
        total = sum(greens.values())

        assert total == AVAILABLE_GREEN_TIME, f"Expected 100s, got {total}s for counts {counts}"
        for d, g in greens.items():
            assert isinstance(g, int), f"{d} green {g} is not integer"
            assert MIN_GREEN <= g <= MAX_GREEN, f"{d} green {g} outside bounds [{MIN_GREEN}, {MAX_GREEN}]"


def test_relative_demands_property():
    """Relative demands sum to 1.0 and match queue proportions."""
    counts = {"north": 45, "south": 30, "east": 15, "west": 10}
    demands = calculate_relative_demands(counts)

    assert abs(sum(demands.values()) - 1.0) < 1e-6
    assert demands["north"] == 0.45
    assert demands["south"] == 0.30
    assert demands["east"] == 0.15
    assert demands["west"] == 0.10


def test_input_validation_errors():
    """Invalid traffic count structures or non-positive integers raise ValueError."""
    with pytest.raises(ValueError, match="must contain north, south, east and west"):
        optimize_signal({"north": 10, "south": 10})

    with pytest.raises(ValueError, match="Invalid vehicle count for north"):
        optimize_signal({"north": -5, "south": 10, "east": 10, "west": 10})

    with pytest.raises(ValueError, match="Invalid vehicle count for south"):
        optimize_signal({"north": 10, "south": True, "east": 10, "west": 10})

    with pytest.raises(ValueError, match="Invalid vehicle count for east"):
        optimize_signal({"north": 10, "south": 10, "east": 12.5, "west": 10})


def test_api_optimize_signal_endpoint():
    """FastAPI /optimize-signal endpoint works with improved optimizer and validates inputs."""
    # Valid payload
    payload = {"north": 45, "south": 30, "east": 15, "west": 10}
    response = client.post("/optimize-signal", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["green_times"] == {"north": 37, "south": 28, "east": 19, "west": 16}
    assert data["total_green_time"] == 100
    assert data["cycle_time"] == 120
    assert data["clearance_time"] == 20
    assert "relative_demands" in data
    assert "intersection_model" in data

    # Boolean count rejection
    bad_payload = {"north": True, "south": 30, "east": 15, "west": 10}
    bad_resp = client.post("/optimize-signal", json=bad_payload)
    assert bad_resp.status_code == 400

    # Negative count rejection
    neg_payload = {"north": -10, "south": 30, "east": 15, "west": 10}
    neg_resp = client.post("/optimize-signal", json=neg_payload)
    assert neg_resp.status_code == 400


def test_simulation_integration_with_improved_optimizer():
    """Simulator uses improved optimizer dynamically across cycles and metrics reflect results."""
    init_q = {"north": 45, "south": 30, "east": 15, "west": 10}
    rates = {"north": 12.0, "south": 8.0, "east": 4.0, "west": 3.0}

    sim_res = simulate_intersection(
        initial_queues=init_q,
        arrival_rates=rates,
        cycles=5,
        strategy="adaptive",
        random_seed=42
    )

    for cycle in sim_res["history"]:
        greens = cycle["green_times"]
        assert sum(greens.values()) == AVAILABLE_GREEN_TIME
        for d, g in greens.items():
            assert MIN_GREEN <= g <= MAX_GREEN

    # Verify simulation metrics conservation
    metrics = sim_res["metrics"]["overall"]
    assert metrics["total_remaining"] == (
        metrics["total_initial_queue"]
        + metrics["total_arrivals"]
        - metrics["total_discharged"]
    )

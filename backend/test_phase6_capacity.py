import math
from math import floor
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.services.traffic_simulator import simulate_intersection
from backend.services.simulation_metrics import calculate_simulation_metrics
from backend.services.strategy_comparator import compare_strategies_multi_run

client = TestClient(app)

SAMPLE_QUEUES = {"north": 40, "south": 30, "east": 20, "west": 10}
SAMPLE_RATES = {"north": 12.0, "south": 8.0, "east": 6.0, "west": 4.0}
DIRECTIONS = ["north", "south", "east", "west"]


def test_theoretical_discharge_capacity_formula():
    """Theoretical capacity strictly satisfies C_d = s_d * L_d * (g_d / 3600)."""
    # 1 cycle, fixed strategy (25s each), s = 1800, L = 1, l_s = 2.0s -> g_eff = 23.0s
    # C_d = 1800 * 1 * (23.0 / 3600) = 11.5 vehicles
    result = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=1,
        strategy="fixed",
        random_seed=42,
        lanes={"north": 1, "south": 1, "east": 1, "west": 1},
        saturation_flow_rates={"north": 1800.0, "south": 1800.0, "east": 1800.0, "west": 1800.0},
        startup_lost_times={"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}
    )

    cycle_1 = result["history"][0]
    for d in DIRECTIONS:
        assert cycle_1["green_times"][d] == 25
        assert cycle_1["effective_green_times"][d] == 23.0
        assert cycle_1["theoretical_capacities"][d] == 11.5
        assert cycle_1["discharge_capacities"][d] == 11  # floor(11.5)


def test_multiple_lanes_scales_capacity_proportionally():
    """Increasing lane count scales theoretical capacity proportionally."""
    res_1_lane = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=1,
        strategy="fixed",
        lanes={"north": 1, "south": 1, "east": 1, "west": 1},
        saturation_flow_rates={"north": 1800.0, "south": 1800.0, "east": 1800.0, "west": 1800.0},
        startup_lost_times={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0}
    )

    res_3_lanes = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=1,
        strategy="fixed",
        lanes={"north": 3, "south": 3, "east": 3, "west": 3},
        saturation_flow_rates={"north": 1800.0, "south": 1800.0, "east": 1800.0, "west": 1800.0},
        startup_lost_times={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0}
    )

    c1 = res_1_lane["history"][0]["theoretical_capacities"]["north"]
    c3 = res_3_lanes["history"][0]["theoretical_capacities"]["north"]
    assert round(c3, 2) == round(3 * c1, 2)


def test_zero_green_time_or_zero_effective_green():
    """When startup lost time equals or exceeds nominal green, effective green and discharge are 0."""
    result = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=1,
        strategy="fixed",
        startup_lost_times={"north": 25.0, "south": 30.0, "east": 25.0, "west": 25.0}
    )

    cycle_1 = result["history"][0]
    assert cycle_1["effective_green_times"]["north"] == 0.0
    assert cycle_1["effective_green_times"]["south"] == 0.0
    assert cycle_1["theoretical_capacities"]["north"] == 0.0
    assert cycle_1["discharge_capacities"]["north"] == 0
    assert cycle_1["discharged"]["north"] == 0
    assert cycle_1["capacity_utilization_percentages"]["north"] == 0.0


def test_zero_saturation_flow():
    """When saturation flow rate is zero, theoretical capacity and discharge are zero."""
    result = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=1,
        saturation_flow_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0}
    )

    cycle_1 = result["history"][0]
    for d in DIRECTIONS:
        assert cycle_1["theoretical_capacities"][d] == 0.0
        assert cycle_1["discharge_capacities"][d] == 0
        assert cycle_1["discharged"][d] == 0
        assert cycle_1["capacity_utilization_percentages"][d] == 0.0


def test_discharge_never_exceeds_queue():
    """Discharged vehicles can never exceed the available queue."""
    # Queue is 5, but capacity is 50 (many lanes + high sat flow)
    result = simulate_intersection(
        initial_queues={"north": 5, "south": 3, "east": 2, "west": 1},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=1,
        lanes={"north": 4, "south": 4, "east": 4, "west": 4},
        saturation_flow_rates={"north": 2400.0, "south": 2400.0, "east": 2400.0, "west": 2400.0}
    )

    cycle_1 = result["history"][0]
    assert cycle_1["discharge_capacities"]["north"] > 5
    assert cycle_1["discharged"]["north"] == 5
    assert cycle_1["queues_after"]["north"] == 0


def test_discharge_never_exceeds_theoretical_capacity_and_floors():
    """Theoretical capacity is floored; discharged vehicles never exceed integer capacity."""
    # Large queue (100). Nominal green 25s, lost time 2.0s -> g_eff = 23s.
    # C_d = 1800 * 1 * (23 / 3600) = 11.5. Integer capacity floor(11.5) = 11.
    result = simulate_intersection(
        initial_queues={"north": 100, "south": 100, "east": 100, "west": 100},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=1,
        strategy="fixed",
        lanes={"north": 1, "south": 1, "east": 1, "west": 1},
        saturation_flow_rates={"north": 1800.0, "south": 1800.0, "east": 1800.0, "west": 1800.0},
        startup_lost_times={"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}
    )

    cycle_1 = result["history"][0]
    for d in DIRECTIONS:
        assert cycle_1["theoretical_capacities"][d] == 11.5
        assert cycle_1["discharge_capacities"][d] == 11
        assert cycle_1["discharged"][d] == 11
        assert cycle_1["discharged"][d] <= cycle_1["theoretical_capacities"][d]


def test_integer_vehicle_discharge_policy():
    """All discharged counts in history and metrics are non-negative integers."""
    result = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=3,
        random_seed=123
    )

    for c in result["history"]:
        for d in DIRECTIONS:
            disc = c["discharged"][d]
            assert isinstance(disc, int)
            assert not isinstance(disc, bool)
            assert disc >= 0

    assert isinstance(result["metrics"]["overall"]["total_discharged"], int)
    assert isinstance(result["metrics"]["overall"]["total_throughput"], int)


def test_vehicle_conservation_law_with_capacity():
    """Conservation law holds strictly: final_queue = initial_queue + arrived - discharged."""
    result = simulate_intersection(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=4,
        random_seed=999,
        lanes={"north": 2, "south": 1, "east": 1, "west": 2},
        saturation_flow_rates={"north": 1900.0, "south": 1800.0, "east": 1700.0, "west": 1900.0},
        startup_lost_times={"north": 2.5, "south": 2.0, "east": 1.5, "west": 2.0}
    )

    overall = result["metrics"]["overall"]
    assert overall["vehicle_conservation_verified"] is True
    expected_remaining = (
        overall["total_initial_queue"]
        + overall["total_arrivals"]
        - overall["total_discharged"]
    )
    assert overall["total_remaining"] == expected_remaining

    for d in DIRECTIONS:
        dm = result["metrics"]["by_direction"][d]
        assert dm["final_queue"] == dm["initial_queue"] + dm["total_arrivals"] - dm["total_discharged"]


def test_capacity_utilization_metrics():
    """Capacity utilization percentage is correctly calculated and bound."""
    result = simulate_intersection(
        initial_queues={"north": 10, "south": 0, "east": 100, "west": 0},
        arrival_rates={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0},
        cycles=1,
        strategy="fixed",
        lanes={"north": 1, "south": 1, "east": 1, "west": 1},
        saturation_flow_rates={"north": 1800.0, "south": 1800.0, "east": 1800.0, "west": 1800.0},
        startup_lost_times={"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0}
    )

    # Fixed 25s, l_s = 0 -> C_d = 1800 * (25 / 3600) = 12.5 veh, floor = 12
    # North: queue=10, disc=10 -> util = (10 / 12.5) * 100 = 80.0%
    # South: queue=0, disc=0 -> util = (0 / 12.5) * 100 = 0.0%
    # East: queue=100, disc=12 -> util = (12 / 12.5) * 100 = 96.0%
    by_dir = result["metrics"]["by_direction"]
    assert by_dir["north"]["capacity_utilization_percentage"] == 80.0
    assert by_dir["south"]["capacity_utilization_percentage"] == 0.0
    assert by_dir["east"]["capacity_utilization_percentage"] == 96.0


def test_multi_run_comparator_uses_identical_capacity_parameters():
    """Monte Carlo comparator evaluates fixed and adaptive under identical capacity configurations."""
    custom_lanes = {"north": 2, "south": 1, "east": 2, "west": 1}
    custom_sat = {"north": 1900.0, "south": 1800.0, "east": 1900.0, "west": 1800.0}
    custom_lost = {"north": 2.5, "south": 2.0, "east": 2.5, "west": 2.0}

    res = compare_strategies_multi_run(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=3,
        runs=3,
        base_seed=777,
        lanes=custom_lanes,
        saturation_flow_rates=custom_sat,
        startup_lost_times=custom_lost
    )

    assert "comparison" in res
    assert "statistical_reliability" in res
    assert "metrics" in res["comparison"]
    assert "capacity_utilization" in res["comparison"]["metrics"]
    assert res["configuration"]["lanes"] == custom_lanes
    assert res["configuration"]["saturation_flow_rates"] == custom_sat
    assert res["configuration"]["startup_lost_times"] == custom_lost


def test_capacity_validation_errors():
    """simulate_intersection rejects invalid lane counts, saturation flows, and lost times."""
    # Invalid lane counts (must be int >= 1)
    with pytest.raises(ValueError, match="must be an integer >= 1"):
        simulate_intersection(
            SAMPLE_QUEUES, SAMPLE_RATES, lanes={"north": 0, "south": 1, "east": 1, "west": 1}
        )

    with pytest.raises(ValueError, match="must be an integer >= 1"):
        simulate_intersection(
            SAMPLE_QUEUES, SAMPLE_RATES, lanes={"north": True, "south": 1, "east": 1, "west": 1}
        )

    with pytest.raises(ValueError, match="must be an integer >= 1"):
        simulate_intersection(
            SAMPLE_QUEUES, SAMPLE_RATES, lanes={"north": 1.5, "south": 1, "east": 1, "west": 1}
        )

    # Invalid saturation flow rates (must be number >= 0, not NaN/Inf)
    with pytest.raises(ValueError, match="must be a non-negative number"):
        simulate_intersection(
            SAMPLE_QUEUES, SAMPLE_RATES, saturation_flow_rates={"north": -100.0, "south": 1800.0, "east": 1800.0, "west": 1800.0}
        )

    with pytest.raises(ValueError, match="must be a non-negative number"):
        simulate_intersection(
            SAMPLE_QUEUES, SAMPLE_RATES, saturation_flow_rates={"north": float("nan"), "south": 1800.0, "east": 1800.0, "west": 1800.0}
        )

    # Invalid startup lost times (must be number >= 0, not NaN/Inf)
    with pytest.raises(ValueError, match="must be a non-negative number"):
        simulate_intersection(
            SAMPLE_QUEUES, SAMPLE_RATES, startup_lost_times={"north": -2.0, "south": 2.0, "east": 2.0, "west": 2.0}
        )


def test_api_endpoints_accept_capacity_parameters():
    """FastAPI endpoints (/simulate, /compare-strategies, /integrated-prediction) accept capacity params."""
    payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 2,
        "strategy": "adaptive",
        "random_seed": 42,
        "lanes": {"north": 2, "south": 1, "east": 1, "west": 1},
        "saturation_flow_rates": {"north": 1900.0, "south": 1800.0, "east": 1800.0, "west": 1800.0},
        "startup_lost_times": {"north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0}
    }

    # /simulate
    resp_sim = client.post("/simulate", json=payload)
    assert resp_sim.status_code == 200
    data_sim = resp_sim.json()
    assert data_sim["configuration"]["lanes"]["north"] == 2
    assert "overall_capacity_utilization_percentage" in data_sim["metrics"]["overall"]

    # /compare-strategies
    resp_comp = client.post("/compare-strategies", json={**payload, "runs": 3})
    assert resp_comp.status_code == 200
    data_comp = resp_comp.json()
    assert "capacity_utilization" in data_comp["comparison"]["metrics"]

    # /integrated-prediction
    integrated_payload = {
        "holiday": "None",
        "temp": 298.15,
        "rain_1h": 0.0,
        "snow_1h": 0.0,
        "clouds_all": 20,
        "weather_main": "Clear",
        "hour": 14,
        "day": 10,
        "month": 5,
        "day_of_week": 1,
        "is_weekend": 0,
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 2,
        "strategy": "adaptive",
        "random_seed": 42,
        "lanes": {"north": 2, "south": 1, "east": 1, "west": 1}
    }
    resp_int = client.post("/integrated-prediction", json=integrated_payload)
    assert resp_int.status_code == 200
    data_int = resp_int.json()
    assert data_int["simulation_results"]["configuration"]["lanes"]["north"] == 2

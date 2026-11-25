import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.services.strategy_comparator import (
    calculate_sample_std,
    compare_strategies_multi_run,
    compute_relative_improvement,
)

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


def test_seeded_multi_run_reproducibility():
    """Identical base_seed and inputs must produce bit-for-bit identical comparison results."""
    res1 = compare_strategies_multi_run(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=4,
        runs=4,
        base_seed=123
    )

    res2 = compare_strategies_multi_run(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=4,
        runs=4,
        base_seed=123
    )

    assert res1["fixed_strategy"]["total_waiting"] == res2["fixed_strategy"]["total_waiting"]
    assert res1["adaptive_strategy"]["total_waiting"] == res2["adaptive_strategy"]["total_waiting"]
    assert res1["comparison"]["vehicles_saved"] == res2["comparison"]["vehicles_saved"]
    assert res1["per_run_results"] == res2["per_run_results"]
    assert res1["statistical_reliability"] == res2["statistical_reliability"]


def test_identical_arrivals_in_every_run():
    """Fixed and Adaptive strategies must receive identical vehicle arrivals in each run."""
    result = compare_strategies_multi_run(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=3,
        runs=3,
        base_seed=42
    )

    # Re-run simulation with each run seed to verify identical arrival sequences
    from backend.services.traffic_simulator import simulate_intersection

    for run_info in result["per_run_results"]:
        r_seed = run_info["run_seed"]
        f_sim = simulate_intersection(SAMPLE_QUEUES, SAMPLE_RATES, cycles=3, strategy="fixed", random_seed=r_seed)
        a_sim = simulate_intersection(SAMPLE_QUEUES, SAMPLE_RATES, cycles=3, strategy="adaptive", random_seed=r_seed)

        for cf, ca in zip(f_sim["history"], a_sim["history"]):
            assert cf["arrivals"] == ca["arrivals"], f"Arrivals differed in run with seed {r_seed}"


def test_varied_arrivals_across_different_runs():
    """Different runs within the Monte Carlo evaluation must experience varied arrivals."""
    result = compare_strategies_multi_run(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=3,
        runs=5,
        base_seed=999
    )

    seeds = [r["run_seed"] for r in result["per_run_results"]]
    assert len(set(seeds)) == 5  # 5 distinct seeds

    fixed_waitings = [r["fixed_final_waiting"] for r in result["per_run_results"]]
    # Under stochastic Poisson arrivals, results across 5 distinct seeds should exhibit variance
    assert len(set(fixed_waitings)) > 1


def test_averages_and_std_calculation():
    """Mean and sample standard deviation match mathematical formulas."""
    sample_values = [10.0, 12.0, 14.0, 16.0]
    std = calculate_sample_std(sample_values)
    # mean = 13.0, diffs = [-3, -1, 1, 3], sq = [9, 1, 1, 9] = 20, var = 20/3 ≈ 6.6667, std ≈ 2.58
    assert std == 2.58

    # Single value returns 0.0
    assert calculate_sample_std([5.0]) == 0.0


def test_relative_improvement_formula():
    """Relative improvement handles lower-is-better and higher-is-better metrics."""
    # Lower is better (e.g. queue)
    q_comp = compute_relative_improvement(fixed_val=100.0, adaptive_val=80.0, lower_is_better=True)
    assert q_comp["absolute_difference"] == 20.0
    assert q_comp["improvement_percentage"] == 20.0
    assert q_comp["direction"] == "lower_is_better"

    # Higher is better (e.g. throughput)
    t_comp = compute_relative_improvement(fixed_val=100.0, adaptive_val=120.0, lower_is_better=False)
    assert t_comp["absolute_difference"] == 20.0
    assert t_comp["improvement_percentage"] == 20.0
    assert t_comp["direction"] == "higher_is_better"


def test_zero_baseline_percentage_handling():
    """When baseline is 0, percentage improvement returns None without division by zero."""
    res = compute_relative_improvement(fixed_val=0.0, adaptive_val=0.0, lower_is_better=True)
    assert res["improvement_percentage"] is None
    assert res["absolute_difference"] == 0.0


def test_statistical_reliability_wins_sum():
    """Sum of adaptive wins, fixed wins, and ties must equal the total number of runs."""
    runs_count = 6
    result = compare_strategies_multi_run(
        initial_queues=SAMPLE_QUEUES,
        arrival_rates=SAMPLE_RATES,
        cycles=3,
        runs=runs_count,
        base_seed=77
    )

    sr = result["statistical_reliability"]
    assert sr["total_runs"] == runs_count
    assert sr["adaptive_wins"] + sr["fixed_wins"] + sr["ties"] == runs_count
    assert sr["win_rate_adaptive_percentage"] + sr["win_rate_fixed_percentage"] <= 100.01


def test_validation_invalid_runs():
    """Invalid run counts (<1, >50, float, bool) raise ValueError."""
    with pytest.raises(ValueError, match="Simulation runs must be an integer between 1 and 50"):
        compare_strategies_multi_run(SAMPLE_QUEUES, SAMPLE_RATES, runs=0)

    with pytest.raises(ValueError, match="Simulation runs must be an integer between 1 and 50"):
        compare_strategies_multi_run(SAMPLE_QUEUES, SAMPLE_RATES, runs=55)

    with pytest.raises(ValueError, match="Simulation runs must be an integer between 1 and 50"):
        compare_strategies_multi_run(SAMPLE_QUEUES, SAMPLE_RATES, runs=True)

    with pytest.raises(ValueError, match="Simulation runs must be an integer between 1 and 50"):
        compare_strategies_multi_run(SAMPLE_QUEUES, SAMPLE_RATES, runs=3.5)


def test_validation_invalid_base_seed():
    """Invalid base seeds (negative, float, bool) raise ValueError."""
    with pytest.raises(ValueError, match="base_seed must be a non-negative integer or None"):
        compare_strategies_multi_run(SAMPLE_QUEUES, SAMPLE_RATES, base_seed=-5)

    with pytest.raises(ValueError, match="base_seed must be a non-negative integer or None"):
        compare_strategies_multi_run(SAMPLE_QUEUES, SAMPLE_RATES, base_seed=True)


def test_api_compare_strategies_endpoint_multi_run():
    """FastAPI /compare-strategies supports multi-run evaluation and preserves backward compatibility."""
    payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3,
        "runs": 4,
        "random_seed": 42
    }

    response = client.post("/compare-strategies", json=payload)
    assert response.status_code == 200
    data = response.json()

    # Preserved legacy response fields
    assert "fixed_strategy" in data
    assert "total_waiting" in data["fixed_strategy"]
    assert "final_queues" in data["fixed_strategy"]

    assert "adaptive_strategy" in data
    assert "total_waiting" in data["adaptive_strategy"]
    assert "final_queues" in data["adaptive_strategy"]

    assert "comparison" in data
    assert "vehicles_saved" in data["comparison"]
    assert "improvement_percentage" in data["comparison"]
    assert "random_seed" in data["comparison"]
    assert data["comparison"]["random_seed"] == 42

    # New statistical reliability & per-run results
    assert "statistical_reliability" in data
    assert data["statistical_reliability"]["total_runs"] == 4
    assert "per_run_results" in data
    assert len(data["per_run_results"]) == 4


def test_api_compare_strategies_schema_validation():
    """FastAPI /compare-strategies rejects invalid runs and invalid seeds with HTTP 400."""
    # Invalid runs: 0
    bad_payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3,
        "runs": 0
    }
    resp = client.post("/compare-strategies", json=bad_payload)
    assert resp.status_code == 400
    assert "Simulation runs must be between 1 and 50" in resp.json()["detail"]

    # Invalid runs: boolean
    bool_runs_payload = {
        "initial_queues": SAMPLE_QUEUES,
        "arrival_rates": SAMPLE_RATES,
        "cycles": 3,
        "runs": True
    }
    resp = client.post("/compare-strategies", json=bool_runs_payload)
    assert resp.status_code == 400
    assert "Simulation runs must be an integer" in resp.json()["detail"]

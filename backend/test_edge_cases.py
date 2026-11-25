"""
Simulation and Signal Timing Edge-Case Tests
============================================
"""

import pytest

from backend.services.signal_optimizer import (
    AVAILABLE_GREEN_TIME,
    CLEARANCE_TIME,
    CYCLE_TIME,
    DIRECTIONS,
    MAX_GREEN,
    MIN_GREEN,
    optimize_signal,
)
from backend.services.traffic_simulator import simulate_intersection


def test_simulation_zero_arrivals_drains_initial_queues():
    """Verify zero arrival rates drain queues without negative values and conserve vehicles."""
    initial = {"north": 12, "south": 8, "east": 5, "west": 0}
    arrivals = {"north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0}

    res = simulate_intersection(
        initial_queues=initial,
        arrival_rates=arrivals,
        cycles=5,
        strategy="adaptive",
        random_seed=42,
    )
    final_queues = res["final_queues"]
    for d in DIRECTIONS:
        assert final_queues[d] == 0

    for entry in res["history"]:
        for d in DIRECTIONS:
            assert entry["arrivals"][d] == 0
            assert entry["queues_after"][d] >= 0


def test_simulation_oversaturated_queues_and_conservation():
    """Verify oversaturated arrivals grow queues monotonically and obey vehicle conservation."""
    initial = {"north": 50, "south": 50, "east": 50, "west": 50}
    arrivals = {"north": 40.0, "south": 40.0, "east": 40.0, "west": 40.0}

    res = simulate_intersection(
        initial_queues=initial,
        arrival_rates=arrivals,
        cycles=6,
        strategy="fixed",
        random_seed=7,
    )

    total_initial = sum(initial.values())
    total_arrivals = sum(sum(c["arrivals"].values()) for c in res["history"])
    total_discharged = sum(sum(c["discharged"].values()) for c in res["history"])
    total_final = sum(res["final_queues"].values())

    assert total_initial + total_arrivals - total_discharged == total_final
    assert total_final > total_initial


def test_simulation_determinism_across_multiple_seeds():
    """Verify identical seeds produce identical results while distinct seeds vary stochastic arrivals."""
    initial = {"north": 10, "south": 12, "east": 8, "west": 14}
    arrivals = {"north": 6.5, "south": 7.0, "east": 5.5, "west": 8.0}

    run_a = simulate_intersection(initial, arrivals, cycles=8, strategy="adaptive", random_seed=101)
    run_b = simulate_intersection(initial, arrivals, cycles=8, strategy="adaptive", random_seed=101)
    run_c = simulate_intersection(initial, arrivals, cycles=8, strategy="adaptive", random_seed=202)

    assert run_a == run_b
    assert run_a["history"] != run_c["history"]


def test_signal_optimizer_extreme_ratios_and_constraints():
    """Verify extreme volume ratios respect MIN_GREEN/MAX_GREEN bounds and cycle consistency."""
    extreme = {"north": 10000, "south": 1, "east": 1, "west": 1}
    res = optimize_signal(extreme)
    greens = res["green_times"]

    assert res["cycle_time"] == CYCLE_TIME
    assert res["clearance_time"] == CLEARANCE_TIME
    assert sum(greens.values()) == AVAILABLE_GREEN_TIME
    assert greens["north"] == MAX_GREEN
    for d in DIRECTIONS:
        assert MIN_GREEN <= greens[d] <= MAX_GREEN


def test_signal_optimizer_zero_demand_and_invalid_inputs():
    """Verify zero demand yields equal 25s splits and invalid counts raise ValueError."""
    zero_res = optimize_signal({"north": 0, "south": 0, "east": 0, "west": 0})
    assert zero_res["green_times"] == {"north": 25, "south": 25, "east": 25, "west": 25}
    assert sum(zero_res["green_times"].values()) == AVAILABLE_GREEN_TIME

    for bad in (
        {"north": -1, "south": 5, "east": 5, "west": 5},
        {"north": True, "south": 5, "east": 5, "west": 5},
        {"north": 5, "south": 5, "east": 5},
    ):
        with pytest.raises(ValueError):
            optimize_signal(bad)

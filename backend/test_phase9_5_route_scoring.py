"""
Unit and Integration Test Suite for Route Scoring and Recommendation Engine
============================================================================

Phase 9.5: Intelligent Route Scoring and Recommendation Engine.

Verifies:
1. Correct min-max normalization (lower is better, neutral 1.0 for equal values).
2. Correct weighted score calculation matching formula: score = sum(w_i * norm_i).
3. Highest score receives rank 1 and is marked as recommended.
4. Lowest estimated duration wins when other metrics are equal.
5. Distance affects the ranking according to its weight.
6. Signal count affects the ranking according to its weight.
7. Intersection density affects the ranking according to its weight.
8. Equal metric values across all candidate routes avoid division-by-zero errors.
9. Invalid scoring weights are rejected (negative, non-sum-to-1, missing keys, NaN).
10. Missing metric handling falls back gracefully and sets degraded analysis status.
11. Degraded route analysis handled gracefully without crashing or unfair bonuses.
12. Tie-breaking logic: lowest duration first, then shortest distance, then original order.
13. Recommendation explanations match actual route metrics and comparative trade-offs.
14. Recommended route ID matches rank 1.
15. Single-route behavior (score=1.0, rank=1, single_route status).
16. FastAPI endpoint integration (/routing/routes) returns ranked recommendations.
17. Full regression preservation of Phase 9.2, 9.3, and 9.4 fields and contracts.
"""

from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.routing.config import (
    DEFAULT_SCORING_WEIGHTS,
    validate_scoring_weights,
    load_scoring_weights_from_env,
)
from backend.routing.models import (
    RouteResult,
    GeoJSONGeometry,
    RouteIntersectionAnalysis,
    RouteSignalDelaySummary,
    MatchedIntersection,
    SignalizedIntersectionDelay,
)
from backend.routing.route_scorer import (
    normalize_metric,
    score_and_rank_routes,
)

client = TestClient(app)


# =========================================================================
# Helper Fixtures
# =========================================================================

def _make_dummy_route(
    route_id: str = "route_1",
    distance_m: float = 10000.0,
    duration_s: float = 600.0,
    is_primary: bool = True,
    signal_count: int = 2,
    signal_delay_s: float = 40.0,
    total_intersections: int = 10,
    intersection_density: float = 1.0,
    include_analysis: bool = True,
    include_signal_delay: bool = True,
) -> RouteResult:
    """Construct a RouteResult with mock intersection and signal delay analysis."""
    distance_km = distance_m / 1000.0
    duration_min = duration_s / 60.0

    inter_analysis = None
    if include_analysis:
        inter_analysis = RouteIntersectionAnalysis(
            total_intersection_nodes=total_intersections,
            signalized_intersection_nodes=signal_count,
            unsignalized_intersection_nodes=max(0, total_intersections - signal_count),
            intersection_density_per_km=intersection_density,
            matched_intersections=[],
            analysis_status="success",
            analysis_warnings=[],
        )

    sig_summary = None
    if include_signal_delay:
        estimated_dur = duration_s + signal_delay_s
        sig_summary = RouteSignalDelaySummary(
            signal_count=signal_count,
            total_estimated_signal_delay_s=signal_delay_s,
            total_estimated_signal_delay_min=signal_delay_s / 60.0,
            average_delay_per_signal_s=(signal_delay_s / signal_count) if signal_count > 0 else 0.0,
            baseline_duration_s=duration_s,
            estimated_duration_s=estimated_dur,
            estimated_duration_min=estimated_dur / 60.0,
            delay_model="uniform_random_arrival",
            signal_delays=[],
            analysis_status="success" if signal_count > 0 else "no_signals_matched",
            analysis_warnings=[],
        )

    return RouteResult(
        route_id=route_id,
        is_primary=is_primary,
        distance_m=distance_m,
        distance_km=distance_km,
        duration_s=duration_s,
        duration_min=duration_min,
        geometry=GeoJSONGeometry(coordinates=[[76.768, 30.741], [76.817, 30.642]]),
        intersection_analysis=inter_analysis,
        signal_delay_summary=sig_summary,
    )


# =========================================================================
# 1. Normalization & Scoring Formula Tests
# =========================================================================

def test_1_min_max_normalization_lower_is_better():
    """
    Test 1: Verify min-max normalization where lower values map to 1.0 and higher to 0.0.
    """
    values = [100.0, 150.0, 200.0]
    norm = normalize_metric(values, lower_is_better=True)
    assert norm == [1.0, 0.5, 0.0]

    # Equal values -> neutral optimal 1.0 for all
    equal_vals = [50.0, 50.0, 50.0]
    assert normalize_metric(equal_vals, lower_is_better=True) == [1.0, 1.0, 1.0]

    # Single value -> neutral 1.0
    assert normalize_metric([42.0], lower_is_better=True) == [1.0]

    # Higher is better
    norm_hib = normalize_metric(values, lower_is_better=False)
    assert norm_hib == [0.0, 0.5, 1.0]


def test_2_weighted_score_calculation():
    """
    Test 2: Explicit manual verification of the weighted score formula:
        route_score = sum(weight * normalized_metric)
    """
    # 2 routes:
    # Route A: duration=600s, dist=10000m, signals=1, density=1.0
    # Route B: duration=900s, dist=15000m, signals=3, density=2.0
    # Route A has minimum on all metrics -> normalized = (1.0, 1.0, 1.0, 1.0)
    # Route B has maximum on all metrics -> normalized = (0.0, 0.0, 0.0, 0.0)
    r_a = _make_dummy_route("route_A", distance_m=10000.0, duration_s=600.0, signal_count=1, intersection_density=1.0)
    r_b = _make_dummy_route("route_B", distance_m=15000.0, duration_s=900.0, signal_count=3, intersection_density=2.0)

    weights = {"estimated_duration": 0.6, "distance": 0.2, "signal_count": 0.1, "intersection_density": 0.1}
    resp = score_and_rank_routes([r_a, r_b], weights=weights)

    score_a = resp.routes_ranked[0].score
    score_b = resp.routes_ranked[1].score

    # Expected: score_a = 0.6*1 + 0.2*1 + 0.1*1 + 0.1*1 = 1.0000
    # Expected: score_b = 0.6*0 + 0.2*0 + 0.1*0 + 0.1*0 = 0.0000
    assert abs(score_a - 1.0) < 1e-4
    assert abs(score_b - 0.0) < 1e-4


def test_3_highest_score_receives_rank_1():
    """
    Test 3: The candidate route with the highest score must receive rank 1.
    """
    r1 = _make_dummy_route("r1", distance_m=12000.0, duration_s=800.0, signal_count=4)
    r2 = _make_dummy_route("r2", distance_m=10000.0, duration_s=600.0, signal_count=1)

    resp = score_and_rank_routes([r1, r2])
    assert resp.routes_ranked[0].route_id == "r2"
    assert resp.routes_ranked[0].rank == 1
    assert resp.routes_ranked[0].is_recommended is True

    assert resp.routes_ranked[1].route_id == "r1"
    assert resp.routes_ranked[1].rank == 2
    assert resp.routes_ranked[1].is_recommended is False


def test_4_lowest_duration_wins_when_others_equal():
    """
    Test 4: When distance, signals, and density are identical, lower estimated duration wins.
    """
    r_fast = _make_dummy_route("fast", distance_m=10000.0, duration_s=600.0, signal_count=2, intersection_density=1.5)
    r_slow = _make_dummy_route("slow", distance_m=10000.0, duration_s=900.0, signal_count=2, intersection_density=1.5)

    resp = score_and_rank_routes([r_slow, r_fast])
    assert resp.recommended_route_id == "fast"
    assert resp.routes_ranked[0].rank == 1
    assert resp.routes_ranked[0].estimated_duration_s < resp.routes_ranked[1].estimated_duration_s


def test_5_distance_weight_impacts_ranking():
    """
    Test 5: Distance affects ranking according to its weight.
    """
    # Two routes with identical duration, signal count, and density, but different distances
    r_short = _make_dummy_route("short", distance_m=8000.0, duration_s=600.0, signal_count=2, intersection_density=1.0)
    r_long = _make_dummy_route("long", distance_m=12000.0, duration_s=600.0, signal_count=2, intersection_density=1.0)

    resp = score_and_rank_routes([r_long, r_short])
    assert resp.recommended_route_id == "short"
    assert resp.routes_ranked[0].distance_m == 8000.0


def test_6_signal_count_weight_impacts_ranking():
    """
    Test 6: Signal count affects ranking according to its weight.
    """
    # Identical duration, distance, and density, but one route has fewer traffic signals
    r_few = _make_dummy_route("few_signals", distance_m=10000.0, duration_s=600.0, signal_count=1, signal_delay_s=20.0)
    r_many = _make_dummy_route("many_signals", distance_m=10000.0, duration_s=600.0, signal_count=5, signal_delay_s=100.0)

    resp = score_and_rank_routes([r_many, r_few])
    assert resp.recommended_route_id == "few_signals"
    assert resp.routes_ranked[0].signal_count == 1


def test_7_density_weight_impacts_ranking():
    """
    Test 7: Intersection density affects ranking according to its weight.
    """
    # Identical duration, distance, signals, but one route has lower intersection density
    r_low_density = _make_dummy_route("low_den", distance_m=10000.0, duration_s=600.0, signal_count=2, intersection_density=0.8)
    r_high_density = _make_dummy_route("high_den", distance_m=10000.0, duration_s=600.0, signal_count=2, intersection_density=2.5)

    resp = score_and_rank_routes([r_high_density, r_low_density])
    assert resp.recommended_route_id == "low_den"
    assert resp.routes_ranked[0].intersection_density_per_km == 0.8


def test_8_equal_metrics_avoid_division_by_zero():
    """
    Test 8: When all candidate routes have identical metrics, no division-by-zero occurs.
    """
    r1 = _make_dummy_route("r1", distance_m=10000.0, duration_s=600.0, signal_count=2, intersection_density=1.2)
    r2 = _make_dummy_route("r2", distance_m=10000.0, duration_s=600.0, signal_count=2, intersection_density=1.2)

    resp = score_and_rank_routes([r1, r2])
    assert resp.analysis_status == "success"
    assert resp.routes_ranked[0].score == 1.0
    assert resp.routes_ranked[1].score == 1.0


def test_9_invalid_scoring_weights_rejected():
    """
    Test 9: Invalid weights are rejected with explicit ValueError.
    """
    # Negative weight
    with pytest.raises(ValueError) as exc1:
        validate_scoring_weights({
            "estimated_duration": -0.1,
            "distance": 0.5,
            "signal_count": 0.3,
            "intersection_density": 0.3,
        })
    assert "cannot be negative" in str(exc1.value).lower()

    # Sum != 1.0
    with pytest.raises(ValueError) as exc2:
        validate_scoring_weights({
            "estimated_duration": 0.5,
            "distance": 0.2,
            "signal_count": 0.1,
            "intersection_density": 0.1,
        })
    assert "must sum to 1.0" in str(exc2.value).lower()

    # Missing criterion
    with pytest.raises(ValueError) as exc3:
        validate_scoring_weights({
            "estimated_duration": 0.7,
            "distance": 0.3,
        })
    assert "missing required scoring weight criteria" in str(exc3.value).lower()

    # Non-numeric / NaN
    with pytest.raises(ValueError) as exc4:
        validate_scoring_weights({
            "estimated_duration": float("nan"),
            "distance": 0.2,
            "signal_count": 0.1,
            "intersection_density": 0.1,
        })
    assert "cannot be nan" in str(exc4.value).lower()


def test_10_missing_metric_handling_degraded_status():
    """
    Test 10: Missing signal delay summary causes graceful imputation and marks analysis status as degraded.
    """
    r1 = _make_dummy_route("r1", distance_m=10000.0, duration_s=600.0, include_signal_delay=True)
    r2 = _make_dummy_route("r2", distance_m=10000.0, duration_s=620.0, include_signal_delay=False)

    resp = score_and_rank_routes([r1, r2])
    assert resp.analysis_status == "degraded"
    assert any("signal delay" in w.lower() for w in resp.analysis_warnings)
    # The route missing signal delay has delay imputed equitably
    by_id = {r.route_id: r for r in resp.routes_ranked}
    assert by_id["r1"].estimated_duration_s == 640.0
    # r2 has 2 signals * 20.0s = 40.0s imputed delay -> 620 + 40 = 660.0s
    assert by_id["r2"].estimated_duration_s == 660.0
    # r1 (640s) wins rank 1 over r2 (660s)
    assert resp.routes_ranked[0].route_id == "r1"
    assert resp.routes_ranked[0].rank == 1


def test_11_degraded_route_analysis_handled_gracefully():
    """
    Test 11: Missing intersection analysis is handled without crashes and without unfair bonuses.
    """
    r1 = _make_dummy_route("r1", distance_m=10000.0, duration_s=600.0, signal_count=2, include_analysis=True)
    r2 = _make_dummy_route("r2", distance_m=10000.0, duration_s=600.0, include_analysis=False)

    resp = score_and_rank_routes([r1, r2])
    assert resp.analysis_status == "degraded"
    assert any("intersection analysis unavailable" in w.lower() for w in resp.analysis_warnings)


def test_12_tie_breaking_logic_duration_then_distance():
    """
    Test 12: Verify tie-breaking logic:
    1. Score
    2. Estimated journey duration
    3. Distance
    """
    # Two routes with identical scores:
    # Route 1: 600s duration, 10km distance
    # Route 2: 700s duration, 10km distance
    # Because duration is lower for Route 1, it must win the tie-break
    r1 = _make_dummy_route("r1", distance_m=10000.0, duration_s=600.0)
    r2 = _make_dummy_route("r2", distance_m=10000.0, duration_s=700.0)

    # Force identical scores by using weights with 0 on duration
    custom_weights = {
        "estimated_duration": 0.0,
        "distance": 0.5,
        "signal_count": 0.25,
        "intersection_density": 0.25,
    }
    resp = score_and_rank_routes([r2, r1], weights=custom_weights)
    # Both have identical score on distance, signals, density
    assert resp.routes_ranked[0].score == resp.routes_ranked[1].score
    # r1 must win due to tie-breaker on estimated journey duration
    assert resp.routes_ranked[0].route_id == "r1"


def test_13_recommendation_reasons_reflect_metrics():
    """
    Test 13: Recommendation reasons reflect actual route metrics and advantages.
    """
    r_fast = _make_dummy_route("fast", distance_m=12000.0, duration_s=500.0, signal_count=0)
    r_slow = _make_dummy_route("slow", distance_m=10000.0, duration_s=900.0, signal_count=4)

    resp = score_and_rank_routes([r_fast, r_slow])
    rec = resp.routes_ranked[0]
    assert rec.route_id == "fast"
    assert any("lowest estimated journey duration" in r.lower() for r in rec.recommendation_reasons)
    assert any("no mapped traffic signals" in r.lower() for r in rec.recommendation_reasons)

    alt = resp.routes_ranked[1]
    assert alt.route_id == "slow"
    assert any("higher estimated journey duration" in r.lower() for r in alt.recommendation_reasons)


def test_14_recommended_route_id_matches_rank_1():
    """
    Test 14: Recommended route ID must match rank 1.
    """
    r1 = _make_dummy_route("route_A", distance_m=10000.0, duration_s=600.0)
    r2 = _make_dummy_route("route_B", distance_m=12000.0, duration_s=800.0)

    resp = score_and_rank_routes([r1, r2])
    assert resp.recommended_route_id == "route_A"
    assert resp.recommended_route_id == resp.routes_ranked[0].route_id
    assert resp.routes_ranked[0].rank == 1
    assert resp.routes_ranked[0].is_recommended is True
    assert resp.routes_ranked[1].is_recommended is False


def test_15_single_route_behavior():
    """
    Test 15: Single candidate route is scored with 1.0, rank 1, and marked recommended.
    """
    r = _make_dummy_route("solo", distance_m=8500.0, duration_s=550.0)
    resp = score_and_rank_routes([r])

    assert resp.analysis_status == "single_route"
    assert resp.recommended_route_id == "solo"
    assert len(resp.routes_ranked) == 1
    assert resp.routes_ranked[0].rank == 1
    assert resp.routes_ranked[0].score == 1.0
    assert resp.routes_ranked[0].is_recommended is True
    assert any("only candidate route" in reason.lower() for reason in resp.routes_ranked[0].recommendation_reasons)


# =========================================================================
# API Integration & Contract Regression Tests
# =========================================================================

MOCK_OSRM_TWO_ROUTES_FOR_SCORING = {
    "code": "Ok",
    "routes": [
        {
            "distance": 8500.0,
            "duration": 650.0,
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [76.7681, 30.7415],
                    [76.7750, 30.7106],
                    [76.8173, 30.6425],
                ],
            },
            "legs": [{"summary": "Himalaya Marg", "steps": []}],
        },
        {
            "distance": 9200.0,
            "duration": 720.0,
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [76.7681, 30.7415],
                    [76.7900, 30.7000],
                    [76.8173, 30.6425],
                ],
            },
            "legs": [{"summary": "Dakshin Marg", "steps": []}],
        },
    ],
}


@patch("requests.get")
def test_16_api_endpoint_returns_ranked_recommendations(mock_get):
    """
    Test 16: POST /routing/routes returns candidate routes enriched with recommendation
    metadata, ranked order, scores, and reasons.
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_OSRM_TWO_ROUTES_FOR_SCORING
    mock_get.return_value = mock_resp

    payload = {
        "source": {"latitude": 30.7415, "longitude": 76.7681},
        "destination": {"latitude": 30.6425, "longitude": 76.8173},
        "alternatives": True,
    }
    response = client.post("/routing/routes", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["routes_count"] == 2
    assert "recommendation" in data
    rec = data["recommendation"]
    assert rec is not None
    assert "recommended_route_id" in rec
    assert "routes_ranked" in rec
    assert len(rec["routes_ranked"]) == 2
    assert rec["routes_ranked"][0]["rank"] == 1
    assert rec["routes_ranked"][0]["is_recommended"] is True
    assert rec["routes_ranked"][1]["rank"] == 2
    assert rec["routes_ranked"][1]["is_recommended"] is False

    # Check that individual RouteResult objects also have recommendation fields
    for r in data["routes"]:
        assert "rank" in r
        assert "score" in r
        assert "is_recommended" in r
        assert "recommendation_reasons" in r
        assert isinstance(r["recommendation_reasons"], list)


def test_17_backward_compatibility_existing_fields_intact():
    """
    Test 17: Verifies all Phase 9.2, 9.3, and 9.4 response fields and models
    remain intact and functional.
    """
    # 1. Provider status endpoint
    status_resp = client.get("/routing/provider/status")
    assert status_resp.status_code == 200
    status_data = status_resp.json()
    assert "geocoding_provider" in status_data
    assert "routing_provider" in status_data

    # 2. RouteResult model validation
    r = _make_dummy_route("test_route")
    assert r.route_id == "test_route"
    assert r.distance_m == 10000.0
    assert r.duration_s == 600.0
    assert r.intersection_analysis is not None
    assert r.signal_delay_summary is not None
    assert r.rank is None  # before scoring
    assert r.is_recommended is False

    # Score it
    score_and_rank_routes([r])
    assert r.rank == 1
    assert r.is_recommended is True
    assert r.score == 1.0


# =========================================================================
# 2. Detailed Engineering Audit Edge Case Tests (Phase 9.5 Audit)
# =========================================================================

def test_18_duration_comparability_prevents_unearned_zero_delay_bonus():
    """
    Audit Test 18: Verify that when Route A has analyzed signal delay and Route B
    has missing signal delay, Route B does NOT win due to an unearned 0-delay bonus.
    Delay is imputed for Route B so comparisons remain scientifically defensible.
    """
    # Route A: 600s baseline, 40s signal delay = 640s estimated duration (10 km)
    # Route B: 610s baseline, missing signal delay, 2 signals mapped in intersection analysis
    # Without imputation, Route B would use 610s baseline and falsely beat Route A (640s).
    # With imputation, Route B gets 2 * 20.0s = 40.0s delay -> 650s estimated duration.
    # Route A (640s) must win rank 1.
    r_a = _make_dummy_route("route_A", distance_m=10000.0, duration_s=600.0, signal_count=2, signal_delay_s=40.0)
    r_b = _make_dummy_route("route_B", distance_m=10000.0, duration_s=610.0, signal_count=2, include_signal_delay=False)

    resp = score_and_rank_routes([r_b, r_a])
    assert resp.analysis_status == "degraded"
    assert resp.recommended_route_id == "route_A"
    assert resp.routes_ranked[0].route_id == "route_A"
    assert resp.routes_ranked[0].rank == 1
    assert resp.routes_ranked[1].route_id == "route_B"
    assert resp.routes_ranked[1].rank == 2


def test_19_complete_missing_signal_and_intersection_metrics():
    """
    Audit Test 19: When ALL candidate routes lack intersection and signal delay analysis,
    metrics are neutralized (all routes receive normalized 1.0 on signal/density)
    and evaluation falls back cleanly to baseline duration and distance without errors.
    """
    r1 = _make_dummy_route("r1", distance_m=10000.0, duration_s=600.0, include_analysis=False, include_signal_delay=False)
    r2 = _make_dummy_route("r2", distance_m=12000.0, duration_s=700.0, include_analysis=False, include_signal_delay=False)

    resp = score_and_rank_routes([r1, r2])
    assert resp.analysis_status == "degraded"
    assert any("neutralized in evaluation" in w.lower() for w in resp.analysis_warnings)
    assert any("free-flow baseline only" in w.lower() for w in resp.analysis_warnings)
    # r1 wins on duration and distance
    assert resp.recommended_route_id == "r1"
    assert resp.routes_ranked[0].score > resp.routes_ranked[1].score


def test_20_no_false_signal_claim_when_analysis_missing():
    """
    Audit Test 20: When intersection analysis is missing for all routes, recommendation
    reasons MUST NOT falsely claim 'No mapped traffic signals encountered along this route.'
    """
    r1 = _make_dummy_route("r1", distance_m=10000.0, duration_s=600.0, include_analysis=False, include_signal_delay=False)
    r2 = _make_dummy_route("r2", distance_m=12000.0, duration_s=700.0, include_analysis=False, include_signal_delay=False)

    resp = score_and_rank_routes([r1, r2])
    rec = resp.routes_ranked[0]
    for reason in rec.recommendation_reasons:
        assert "no mapped traffic signals" not in reason.lower(), f"False claim detected: {reason}"


def test_21_input_validation_rejects_nan_and_inf():
    """
    Audit Test 21: Verify that routes with NaN or Infinite values in distance or duration
    are rejected with explicit ValueError.
    """
    # NaN distance
    r_nan_dist = _make_dummy_route("nan_dist")
    object.__setattr__(r_nan_dist, "distance_m", float("nan"))
    with pytest.raises(ValueError) as exc1:
        score_and_rank_routes([r_nan_dist])
    assert "invalid distance_m" in str(exc1.value).lower()

    # Inf duration
    r_inf_dur = _make_dummy_route("inf_dur")
    object.__setattr__(r_inf_dur, "duration_s", float("inf"))
    with pytest.raises(ValueError) as exc2:
        score_and_rank_routes([r_inf_dur])
    assert "invalid duration_s" in str(exc2.value).lower()


def test_22_input_validation_rejects_negative_and_zero_values():
    """
    Audit Test 22: Verify that routes with non-positive distance or duration are rejected.
    """
    # Negative distance
    r_neg_dist = _make_dummy_route("neg_dist")
    object.__setattr__(r_neg_dist, "distance_m", -500.0)
    with pytest.raises(ValueError) as exc1:
        score_and_rank_routes([r_neg_dist])
    assert "invalid distance_m" in str(exc1.value).lower()

    # Zero duration
    r_zero_dur = _make_dummy_route("zero_dur")
    object.__setattr__(r_zero_dur, "duration_s", 0.0)
    with pytest.raises(ValueError) as exc2:
        score_and_rank_routes([r_zero_dur])
    assert "invalid duration_s" in str(exc2.value).lower()


def test_23_empty_and_none_routes_handled():
    """
    Audit Test 23: Verify that passing empty list or None returns structured error response.
    """
    resp_empty = score_and_rank_routes([])
    assert resp_empty.analysis_status == "error"
    assert resp_empty.recommended_route_id is None
    assert len(resp_empty.routes_ranked) == 0

    resp_none = score_and_rank_routes(None)
    assert resp_none.analysis_status == "error"
    assert resp_none.recommended_route_id is None


def test_24_full_precision_ranking_prevents_false_ties():
    """
    Audit Test 24: Verify that full-precision ranking evaluates scores without premature
    six-decimal truncation, preventing false ties and rank inversions.
    """
    # Create two routes where Route A is slightly better by 1e-7 due to micro-distance difference
    # In a system rounding sort keys to 6 decimal places, both would round identically
    # and might fall back to secondary keys. Full precision must preserve Route A > Route B.
    r_a = _make_dummy_route("micro_A", distance_m=10000.0, duration_s=600.0)
    r_b = _make_dummy_route("micro_B", distance_m=10000.001, duration_s=600.0)

    resp = score_and_rank_routes([r_b, r_a])
    assert resp.routes_ranked[0].route_id == "micro_A"
    assert resp.routes_ranked[0].rank == 1
    assert resp.routes_ranked[1].route_id == "micro_B"
    assert resp.routes_ranked[1].rank == 2


def test_25_config_validation_rejects_unknown_criteria():
    """
    Audit Test 25: Verify that validate_scoring_weights rejects dictionaries containing
    unknown or unsupported criteria keys.
    """
    invalid_weights = {
        "estimated_duration": 0.5,
        "distance": 0.2,
        "signal_count": 0.1,
        "intersection_density": 0.1,
        "unsupported_metric": 0.1,
    }
    with pytest.raises(ValueError) as exc:
        validate_scoring_weights(invalid_weights)
    assert "unknown scoring weight criteria" in str(exc.value).lower()


def test_26_config_env_loading_and_fallback():
    """
    Audit Test 26: Verify load_scoring_weights_from_env loads valid configurations and
    safely rejects invalid environment variables.
    """
    import os
    from unittest.mock import patch

    # Valid env overrides that sum to 1.0
    with patch.dict(os.environ, {
        "ROUTE_SCORING_WEIGHT_DURATION": "0.70",
        "ROUTE_SCORING_WEIGHT_DISTANCE": "0.10",
        "ROUTE_SCORING_WEIGHT_SIGNALS": "0.10",
        "ROUTE_SCORING_WEIGHT_DENSITY": "0.10",
    }):
        w = load_scoring_weights_from_env()
        assert w["estimated_duration"] == 0.70
        assert w["distance"] == 0.10

    # Invalid env override: non-numeric string
    with patch.dict(os.environ, {"ROUTE_SCORING_WEIGHT_DURATION": "invalid_abc"}):
        with pytest.raises(ValueError) as exc:
            load_scoring_weights_from_env()
        assert "invalid non-numeric scoring weight" in str(exc.value).lower()


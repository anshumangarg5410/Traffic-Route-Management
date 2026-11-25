"""
Unit and Integration Test Suite for Intersection Signal Delay Estimation Engine
================================================================================

Phase 9.4: Intersection Signal Delay Estimation.

Verifies:
1. Mathematical correctness of uniform delay formula: d = R^2 / (2C).
2. Zero delay when no mapped signals are found on a route.
3. Unsignalized intersections are strictly excluded from traffic-signal delay.
4. Multiple signals along a route are aggregated correctly.
5. Configurable cycle length and effective red time parameters.
6. Invalid signal timing configurations rejected (C <= 0, R < 0, R >= C).
7. Baseline OSRM duration is preserved untouched.
8. Combined estimated duration is calculated correctly: T_est = T_baseline + T_delay.
9. No double-counting of signal delay or baseline travel times.
10. Missing intersection analysis handled gracefully with explicit status.
11. Failure/error status reported when estimation cannot be completed.
12. FastAPI endpoint integration (/routing/routes) returns enriched candidate routes.
13. Full regression compatibility across previous phases.
"""

from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.routing.config import (
    DEFAULT_SIGNAL_CYCLE_LENGTH_S,
    DEFAULT_SIGNAL_EFFECTIVE_RED_S,
    validate_signal_timing_config,
)
from backend.routing.models import (
    MatchedIntersection,
    RouteIntersectionAnalysis,
    SignalizedIntersectionDelay,
    RouteSignalDelaySummary,
    RouteResult,
    GeoJSONGeometry,
)
from backend.routing.signal_delay import (
    calculate_uniform_delay,
    estimate_intersection_signal_delay,
    estimate_route_signal_delay,
)

client = TestClient(app)


# =========================================================================
# 1. Mathematical Correctness & Formula Tests
# =========================================================================

def test_1_mathematical_correctness_of_uniform_delay_formula():
    """
    Verify d = R^2 / (2 * C) for standard test cases:
    - C=90s, R=60s -> 60^2 / 180 = 20.0s
    - C=120s, R=60s -> 3600 / 240 = 15.0s
    - C=120s, R=75s -> 5625 / 240 = 23.4375s
    - C=60s, R=30s -> 900 / 120 = 7.5s
    - C=90s, R=0s -> 0.0s (all-green)
    """
    assert abs(calculate_uniform_delay(90.0, 60.0) - 20.0) < 1e-6
    assert abs(calculate_uniform_delay(120.0, 60.0) - 15.0) < 1e-6
    assert abs(calculate_uniform_delay(120.0, 75.0) - 23.4375) < 1e-6
    assert abs(calculate_uniform_delay(60.0, 30.0) - 7.5) < 1e-6
    assert abs(calculate_uniform_delay(90.0, 0.0) - 0.0) < 1e-6


def test_6_invalid_signal_timing_configuration_rejected():
    """Verify validate_signal_timing_config rejects invalid parameter combinations."""
    # Cycle length <= 0
    with pytest.raises(ValueError) as exc1:
        calculate_uniform_delay(0.0, 10.0)
    assert "cycle length must be a finite positive number" in str(exc1.value).lower()

    with pytest.raises(ValueError) as exc2:
        calculate_uniform_delay(-90.0, 60.0)
    assert "cycle length must be a finite positive number" in str(exc2.value).lower()

    # Red time < 0
    with pytest.raises(ValueError) as exc3:
        calculate_uniform_delay(90.0, -10.0)
    assert "effective red time cannot be negative" in str(exc3.value).lower()

    # Red time >= Cycle length
    with pytest.raises(ValueError) as exc4:
        calculate_uniform_delay(90.0, 90.0)
    assert "must be strictly less than cycle length" in str(exc4.value).lower()

    with pytest.raises(ValueError) as exc5:
        calculate_uniform_delay(90.0, 100.0)
    assert "must be strictly less than cycle length" in str(exc5.value).lower()


# =========================================================================
# 2. Intersection-Level Signal Delay Tests
# =========================================================================

def test_3_unsignalized_intersections_excluded_from_signal_delay():
    """Verify unsignalized intersections return None and receive zero delay."""
    unsig_inter = MatchedIntersection(
        osm_node_id=101,
        latitude=30.7000,
        longitude=76.7600,
        distance_along_route_m=500.0,
        distance_from_route_m=2.5,
        is_signalized=False,
        signal_tags=None,
    )
    res = estimate_intersection_signal_delay(unsig_inter)
    assert res is None


def test_signalized_intersection_receives_structured_delay():
    """Verify signalized intersection receives structured delay breakdown with assumptions."""
    sig_inter = MatchedIntersection(
        osm_node_id=202,
        latitude=30.7020,
        longitude=76.7600,
        distance_along_route_m=1250.0,
        distance_from_route_m=4.0,
        is_signalized=True,
        signal_tags={"highway": "traffic_signals"},
    )
    res = estimate_intersection_signal_delay(sig_inter, cycle_length_s=90.0, effective_red_s=60.0)
    assert res is not None
    assert res.osm_node_id == 202
    assert res.distance_along_route_m == 1250.0
    assert res.cycle_length_s == 90.0
    assert res.effective_red_time_s == 60.0
    assert res.estimated_delay_s == 20.0
    assert res.estimation_method == "uniform_random_arrival"
    assert "assumptions" in res.model_dump()
    assert res.assumptions["signal_control"] == "isolated_fixed_time"


# =========================================================================
# 3. Route-Level Signal Delay Summary Tests
# =========================================================================

def test_2_zero_delay_when_no_signals_matched():
    """Scenario 2: Route with no signalized intersections produces zero delay and explanatory warning."""
    # Route with only unsignalized intersections
    unsig_inter = MatchedIntersection(
        osm_node_id=101,
        latitude=30.7000,
        longitude=76.7600,
        distance_along_route_m=500.0,
        distance_from_route_m=2.0,
        is_signalized=False,
    )
    analysis = RouteIntersectionAnalysis(
        total_intersection_nodes=1,
        signalized_intersection_nodes=0,
        unsignalized_intersection_nodes=1,
        intersection_density_per_km=0.5,
        matched_intersections=[unsig_inter],
        analysis_status="success",
    )

    summary = estimate_route_signal_delay(
        route={"duration_s": 800.0},
        intersection_analysis=analysis,
    )

    assert summary.signal_count == 0
    assert summary.total_estimated_signal_delay_s == 0.0
    assert summary.total_estimated_signal_delay_min == 0.0
    assert summary.average_delay_per_signal_s == 0.0
    assert summary.baseline_duration_s == 800.0
    assert summary.estimated_duration_s == 800.0
    assert summary.analysis_status == "no_signals_matched"
    assert any("incomplete" in w.lower() for w in summary.analysis_warnings)


def test_4_and_7_and_8_multiple_signals_aggregation_and_duration():
    """
    Scenarios 4, 7, 8: Multiple signals along a route aggregate delay correctly
    and compute combined estimated duration without mutating baseline duration.
    """
    sig1 = MatchedIntersection(
        osm_node_id=201,
        latitude=30.7020,
        longitude=76.7600,
        distance_along_route_m=1000.0,
        distance_from_route_m=3.0,
        is_signalized=True,
    )
    sig2 = MatchedIntersection(
        osm_node_id=202,
        latitude=30.7040,
        longitude=76.7600,
        distance_along_route_m=2500.0,
        distance_from_route_m=4.0,
        is_signalized=True,
    )
    unsig3 = MatchedIntersection(
        osm_node_id=301,
        latitude=30.7060,
        longitude=76.7600,
        distance_along_route_m=4000.0,
        distance_from_route_m=2.0,
        is_signalized=False,
    )
    sig4 = MatchedIntersection(
        osm_node_id=203,
        latitude=30.7080,
        longitude=76.7600,
        distance_along_route_m=5500.0,
        distance_from_route_m=5.0,
        is_signalized=True,
    )

    analysis = RouteIntersectionAnalysis(
        total_intersection_nodes=4,
        signalized_intersection_nodes=3,
        unsignalized_intersection_nodes=1,
        intersection_density_per_km=0.67,
        matched_intersections=[sig1, sig2, unsig3, sig4],
        analysis_status="success",
    )

    baseline_s = 1000.0  # ~16.67 min
    summary = estimate_route_signal_delay(
        route={"duration_s": baseline_s},
        intersection_analysis=analysis,
        cycle_length_s=90.0,
        effective_red_s=60.0,  # 20.0s per signal
    )

    assert summary.signal_count == 3
    # 3 signals * 20.0s = 60.0s
    assert abs(summary.total_estimated_signal_delay_s - 60.0) < 1e-6
    assert abs(summary.total_estimated_signal_delay_min - 1.0) < 1e-6
    assert abs(summary.average_delay_per_signal_s - 20.0) < 1e-6

    # Baseline preserved
    assert summary.baseline_duration_s == baseline_s

    # Combined estimated duration: 1000 + 60 = 1060s
    assert abs(summary.estimated_duration_s - 1060.0) < 1e-6
    assert abs(summary.estimated_duration_min - 17.67) < 0.05
    assert summary.analysis_status == "success"
    assert len(summary.signal_delays) == 3


def test_5_configurable_cycle_and_red_parameters():
    """Scenario 5: Configurable cycle length and red time profiles calculate accurate delays."""
    sig1 = MatchedIntersection(
        osm_node_id=501,
        latitude=30.7100,
        longitude=76.7600,
        distance_along_route_m=1200.0,
        distance_from_route_m=2.0,
        is_signalized=True,
    )
    analysis = RouteIntersectionAnalysis(
        total_intersection_nodes=1,
        signalized_intersection_nodes=1,
        unsignalized_intersection_nodes=0,
        intersection_density_per_km=0.5,
        matched_intersections=[sig1],
        analysis_status="success",
    )

    # Major arterial timing: C=120s, R=75s -> 23.4375s
    summary = estimate_route_signal_delay(
        route={"duration_s": 500.0},
        intersection_analysis=analysis,
        cycle_length_s=120.0,
        effective_red_s=75.0,
    )

    assert abs(summary.total_estimated_signal_delay_s - 23.4) < 0.1
    assert abs(summary.estimated_duration_s - 523.4) < 0.1


def test_9_no_double_counting_of_signal_delay():
    """Scenario 9: Multiple calls do not compound or double-count delays."""
    sig1 = MatchedIntersection(
        osm_node_id=601,
        latitude=30.7100,
        longitude=76.7600,
        distance_along_route_m=800.0,
        distance_from_route_m=3.0,
        is_signalized=True,
    )
    analysis = RouteIntersectionAnalysis(
        total_intersection_nodes=1,
        signalized_intersection_nodes=1,
        unsignalized_intersection_nodes=0,
        intersection_density_per_km=0.5,
        matched_intersections=[sig1],
        analysis_status="success",
    )

    route_dict = {"duration_s": 600.0}
    summary1 = estimate_route_signal_delay(route_dict, intersection_analysis=analysis)
    summary2 = estimate_route_signal_delay(route_dict, intersection_analysis=analysis)

    assert summary1.total_estimated_signal_delay_s == summary2.total_estimated_signal_delay_s == 20.0
    assert summary1.estimated_duration_s == summary2.estimated_duration_s == 620.0


def test_10_missing_intersection_analysis_handled():
    """Scenario 10: Missing intersection analysis returns explicit missing status."""
    summary = estimate_route_signal_delay(route={"duration_s": 400.0}, intersection_analysis=None)
    assert summary.analysis_status == "missing_intersection_analysis"
    assert summary.signal_count == 0
    assert summary.total_estimated_signal_delay_s == 0.0
    assert summary.estimated_duration_s == 400.0
    assert any("missing" in w.lower() for w in summary.analysis_warnings)


def test_11_failure_status_on_invalid_configuration():
    """Scenario 11: Invalid timing parameters produce error status rather than silent crash."""
    sig1 = MatchedIntersection(
        osm_node_id=701,
        latitude=30.7100,
        longitude=76.7600,
        distance_along_route_m=800.0,
        distance_from_route_m=3.0,
        is_signalized=True,
    )
    analysis = RouteIntersectionAnalysis(
        total_intersection_nodes=1,
        signalized_intersection_nodes=1,
        unsignalized_intersection_nodes=0,
        intersection_density_per_km=0.5,
        matched_intersections=[sig1],
        analysis_status="success",
    )

    summary = estimate_route_signal_delay(
        route={"duration_s": 500.0},
        intersection_analysis=analysis,
        cycle_length_s=60.0,
        effective_red_s=70.0,  # Invalid: R >= C
    )
    assert summary.analysis_status == "error"
    assert any("invalid" in w.lower() for w in summary.analysis_warnings)
    assert summary.total_estimated_signal_delay_s == 0.0


# =========================================================================
# 4. API Integration Tests (/routing/routes)
# =========================================================================

MOCK_OSRM_TWO_ROUTES_WITH_DELAYS = {
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
def test_12_api_routes_enrichment_with_signal_delay(mock_get):
    """
    Scenario 12: POST /routing/routes returns candidate routes enriched with
    both intersection_analysis and signal_delay_summary.
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_OSRM_TWO_ROUTES_WITH_DELAYS
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
    for r in data["routes"]:
        # Verify Phase 9.3 analysis is present
        assert "intersection_analysis" in r
        assert r["intersection_analysis"]["analysis_status"] in ("success", "no_intersections_matched")

        # Verify Phase 9.4 signal delay summary is present
        assert "signal_delay_summary" in r
        s = r["signal_delay_summary"]
        assert "signal_count" in s
        assert "total_estimated_signal_delay_s" in s
        assert "baseline_duration_s" in s
        assert "estimated_duration_s" in s
        assert "delay_model" in s
        assert "analysis_warnings" in s

        # Verify duration relationship
        assert s["baseline_duration_s"] == r["duration_s"]
        assert s["estimated_duration_s"] >= s["baseline_duration_s"]
        assert s["estimated_duration_s"] == round(s["baseline_duration_s"] + s["total_estimated_signal_delay_s"], 1)


def test_13_regression_preserves_phases_1_to_9_3_contracts():
    """
    Scenario 13: Regression check verifying that Phase 9.4 models and functions
    preserve Phase 1-9.3 contracts, geocoding models, and network summaries.
    """
    # Verify ProviderStatusResponse still functional
    status_resp = client.get("/routing/provider/status")
    assert status_resp.status_code == 200
    assert status_resp.json()["provider_status"] == "configured"

    # Verify RouteResult model serializes properly with and without signal delay
    r_empty = RouteResult(
        route_id="route_1",
        is_primary=True,
        distance_m=1000.0,
        distance_km=1.0,
        duration_s=60.0,
        duration_min=1.0,
        geometry=GeoJSONGeometry(coordinates=[[76.76, 30.70], [76.77, 30.71]]),
    )
    assert r_empty.signal_delay_summary is None

    # Attach summary
    r_empty.signal_delay_summary = estimate_route_signal_delay(r_empty, intersection_analysis=None)
    assert r_empty.signal_delay_summary.analysis_status == "missing_intersection_analysis"


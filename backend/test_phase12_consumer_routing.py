"""
Phase 12 — Consumer Route Planner & Departure-Time ML Context Tests
===================================================================
"""

from datetime import datetime
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api.main import app
from backend.routing.ml_context import (
    build_ml_feature_payload,
    predict_departure_traffic_context,
)
from backend.routing.models import (
    Coordinate,
    GeoJSONGeometry,
    RouteResult,
    RouteSearchResponse,
)

client = TestClient(app)


def _make_mock_routes_response():
    r1 = RouteResult(
        route_id="route_1",
        is_primary=True,
        distance_m=8400.0,
        distance_km=8.4,
        duration_s=720.0,
        duration_min=12.0,
        geometry=GeoJSONGeometry(
            type="LineString",
            coordinates=[[76.7794, 30.7333], [76.7179, 30.7046]],
        ),
        summary="Madhya Marg / Dakshin Marg",
    )
    r2 = RouteResult(
        route_id="route_2",
        is_primary=False,
        distance_m=9600.0,
        distance_km=9.6,
        duration_s=840.0,
        duration_min=14.0,
        geometry=GeoJSONGeometry(
            type="LineString",
            coordinates=[[76.7794, 30.7333], [76.7500, 30.7150], [76.7179, 30.7046]],
        ),
        summary="Vikas Marg",
    )
    return RouteSearchResponse(
        source=Coordinate(latitude=30.7333, longitude=76.7794),
        destination=Coordinate(latitude=30.7046, longitude=76.7179),
        routes_count=2,
        routes=[r1, r2],
        provider="OSRM",
    )


def test_build_ml_feature_payload_extracts_exact_11_features():
    dt = datetime(2026, 11, 25, 9, 30)  # Wednesday (weekday == 2)
    payload = build_ml_feature_payload(dt)
    expected_keys = {
        "holiday",
        "temp",
        "rain_1h",
        "snow_1h",
        "clouds_all",
        "weather_main",
        "hour",
        "day",
        "month",
        "day_of_week",
        "is_weekend",
    }
    assert set(payload.keys()) == expected_keys
    assert payload["hour"] == 9
    assert payload["day"] == 25
    assert payload["month"] == 11
    assert payload["day_of_week"] == 2
    assert payload["is_weekend"] == 0

    weekend_dt = datetime(2026, 11, 28, 14, 0)  # Saturday
    weekend_payload = build_ml_feature_payload(weekend_dt)
    assert weekend_payload["day_of_week"] == 5
    assert weekend_payload["is_weekend"] == 1


def test_predict_departure_traffic_context_returns_valid_prediction():
    dt = datetime(2026, 11, 25, 8, 30)
    ctx = predict_departure_traffic_context(dt)
    assert ctx.status == "available"
    assert ctx.predicted_traffic_level in {"Low", "Medium", "High"}
    assert ctx.departure_hour == 8
    assert ctx.is_weekend is False
    assert isinstance(ctx.confidence, dict)
    assert abs(sum(ctx.confidence.values()) - 1.0) < 0.01
    assert "Minnesota" in ctx.limitation_note


def test_predict_departure_traffic_context_graceful_degradation():
    with patch("backend.routing.ml_context.predict_traffic", side_effect=RuntimeError("model error")):
        ctx = predict_departure_traffic_context(datetime(2026, 11, 25, 9, 0))
    assert ctx.status == "unavailable"
    assert ctx.predicted_traffic_level is None
    assert ctx.error_message is not None


def test_post_routing_routes_with_departure_time_returns_ml_and_ranked_routes():
    mock_resp = _make_mock_routes_response()
    with (
        patch("backend.api.main.validate_and_snap_coordinate"),
        patch("backend.api.main.generate_routes", return_value=mock_resp),
        patch("backend.api.main.load_network_graph", return_value=None),
    ):
        res = client.post(
            "/routing/routes",
            json={
                "source": {"latitude": 30.7333, "longitude": 76.7794},
                "destination": {"latitude": 30.7046, "longitude": 76.7179},
                "alternatives": True,
                "departure_time": "2026-11-25T09:00:00",
            },
        )
    assert res.status_code == 200
    body = res.json()
    assert body["routes_count"] == 2
    assert body["recommendation"]["recommended_route_id"] == body["routes"][0]["route_id"]
    assert body["routes"][0]["is_recommended"] is True
    assert body["ml_traffic_prediction"]["status"] == "available"
    assert body["ml_traffic_prediction"]["departure_hour"] == 9


def test_post_routing_routes_survives_ml_inference_failure():
    mock_resp = _make_mock_routes_response()
    with (
        patch("backend.api.main.validate_and_snap_coordinate"),
        patch("backend.api.main.generate_routes", return_value=mock_resp),
        patch("backend.api.main.load_network_graph", return_value=None),
        patch("backend.routing.ml_context.predict_traffic", side_effect=RuntimeError("ML down")),
    ):
        res = client.post(
            "/routing/routes",
            json={
                "source": {"latitude": 30.7333, "longitude": 76.7794},
                "destination": {"latitude": 30.7046, "longitude": 76.7179},
                "alternatives": True,
                "departure_time": "2026-11-25T17:30:00",
            },
        )
    assert res.status_code == 200
    body = res.json()
    assert body["routes_count"] == 2
    assert body["ml_traffic_prediction"]["status"] == "unavailable"


def test_post_routing_routes_rejects_out_of_region_coordinates():
    res = client.post(
        "/routing/routes",
        json={
            "source": {"latitude": 28.6139, "longitude": 77.2090},  # Delhi
            "destination": {"latitude": 30.7046, "longitude": 76.7179},
            "alternatives": True,
        },
    )
    assert res.status_code == 400


def test_post_routing_routes_handles_osrm_provider_failure():
    with (
        patch("backend.api.main.validate_and_snap_coordinate"),
        patch("backend.api.main.generate_routes", side_effect=ConnectionError("OSRM unreachable")),
    ):
        res = client.post(
            "/routing/routes",
            json={
                "source": {"latitude": 30.7333, "longitude": 76.7794},
                "destination": {"latitude": 30.7046, "longitude": 76.7179},
                "alternatives": True,
            },
        )
    assert res.status_code == 502


def test_post_routing_routes_signal_timing_profile_and_graph_error_handling(caplog):
    mock_resp = _make_mock_routes_response()
    with (
        patch("backend.api.main.validate_and_snap_coordinate"),
        patch("backend.api.main.generate_routes", return_value=mock_resp),
        patch("backend.api.main.load_network_graph", side_effect=RuntimeError("graph missing")),
    ):
        res = client.post(
            "/routing/routes",
            json={
                "source": {"latitude": 30.7333, "longitude": 76.7794},
                "destination": {"latitude": 30.7046, "longitude": 76.7179},
                "alternatives": True,
                "signal_timing_profile": "major_arterial",
            },
        )
    assert res.status_code == 200
    assert "Road network graph could not be loaded (RuntimeError)" in caplog.text

    bad = client.post(
        "/routing/routes",
        json={
            "source": {"latitude": 30.7333, "longitude": 76.7794},
            "destination": {"latitude": 30.7046, "longitude": 76.7179},
            "signal_timing_profile": "unknown_profile",
        },
    )
    assert bad.status_code == 400

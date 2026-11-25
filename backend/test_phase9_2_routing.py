"""
Unit and Integration Test Suite for Geocoding and Alternative Route Generation
=============================================================================

Phase 9.2: Geocoding and Alternative Route Generation.

Tests verify (using offline mocks with ZERO live internet calls):
1. Geocoding Service:
   - Valid in-region query returns structured coordinates and address.
   - Out-of-region query is rejected with clear error.
   - Empty/whitespace query is rejected.
   - Zero results found returns appropriate error.
   - Provider timeouts raise TimeoutError / 504.
   - Provider HTTP failure raises ConnectionError / 502.
   - In-memory query caching avoids repeated requests.
2. Coordinate Validation and Snapping:
   - Coordinate bounding box validation.
   - Invalid latitude/longitude (NaN, infinite, out-of-range).
   - Coordinates too far from road network (> 3 km) are rejected.
3. Routing Provider (OSRM integration):
   - Single route response parsing (distance, duration, geometry, steps).
   - Multi-alternative routes parsing (route_1 primary, route_2 alternative).
   - Handling of missing optional step fields (modifier, instruction).
   - NoRoute error from provider returns 404.
   - Provider timeout raises TimeoutError / 504.
   - Provider HTTP 500 error raises ConnectionError / 502.
   - Malformed JSON handling.
4. FastAPI Endpoints:
   - POST /routing/geocode
   - POST /routing/routes
   - GET /routing/provider/status
"""

from unittest.mock import patch, MagicMock
import math
import pytest
import requests
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.routing.config import (
    WEST_LON,
    SOUTH_LAT,
    EAST_LON,
    NORTH_LAT,
    is_within_region,
)
from backend.routing.models import (
    Coordinate,
    GeocodeRequest,
    RouteSearchRequest,
    RouteSearchResponse,
)
from backend.routing.geocoding import NominatimGeocoder, geocode_location
from backend.routing.route_provider import OSRMRouteProvider, generate_routes
from backend.routing.coordinate_validator import validate_and_snap_coordinate

client = TestClient(app)


# =========================================================================
# 1. Geocoding Service Unit Tests
# =========================================================================

@patch("requests.get")
def test_geocoding_success_in_region(mock_get):
    """Verify successful geocoding inside Chandigarh Tricity."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = [
        {
            "place_id": 12345,
            "osm_type": "node",
            "osm_id": 98765,
            "lat": "30.7333",
            "lon": "76.7794",
            "display_name": "Sector 17, Chandigarh, 160017, India",
            "address": {"city": "Chandigarh", "state": "Chandigarh", "country": "India"},
            "boundingbox": ["30.72", "30.74", "76.76", "76.79"],
        }
    ]
    mock_get.return_value = mock_resp

    geocoder = NominatimGeocoder()
    res = geocoder.geocode("Sector 17, Chandigarh")

    assert res.latitude == 30.7333
    assert res.longitude == 76.7794
    assert res.is_inside_region is True
    assert "Sector 17" in res.display_name
    assert res.address["city"] == "Chandigarh"


@patch("requests.get")
def test_geocoding_rejects_out_of_region_result(mock_get):
    """Verify that results resolving outside the Tricity bounding box are rejected."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    # Location in New Delhi (outside Chandigarh Tricity)
    mock_resp.json.return_value = [
        {
            "lat": "28.6139",
            "lon": "77.2090",
            "display_name": "Connaught Place, New Delhi, India",
        }
    ]
    mock_get.return_value = mock_resp

    geocoder = NominatimGeocoder()
    with pytest.raises(ValueError) as exc:
        geocoder.geocode("Connaught Place")
    assert "outside the supported chandigarh tricity region" in str(exc.value).lower()


@patch("requests.get")
def test_geocoding_no_results(mock_get):
    """Verify that empty result list raises a clear ValueError."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = []
    mock_get.return_value = mock_resp

    geocoder = NominatimGeocoder()
    with pytest.raises(ValueError) as exc:
        geocoder.geocode("NonExistentPlaceXYZ987")
    assert "no geographic results found" in str(exc.value).lower()


def test_geocoding_empty_query_rejected():
    """Verify empty or whitespace query is rejected immediately."""
    geocoder = NominatimGeocoder()
    with pytest.raises(ValueError) as exc:
        geocoder.geocode("   ")
    assert "cannot be empty" in str(exc.value).lower()


@patch("requests.get")
def test_geocoding_timeout_handling(mock_get):
    """Verify timeout from provider raises TimeoutError."""
    mock_get.side_effect = requests.exceptions.Timeout("Connection timed out")

    geocoder = NominatimGeocoder()
    with pytest.raises(TimeoutError) as exc:
        geocoder.geocode("Sector 35, Chandigarh")
    assert "timed out" in str(exc.value).lower()


@patch("requests.get")
def test_geocoding_http_error_handling(mock_get):
    """Verify HTTP connection failure raises ConnectionError."""
    mock_get.side_effect = requests.exceptions.ConnectionError("Failed to connect")

    geocoder = NominatimGeocoder()
    with pytest.raises(ConnectionError) as exc:
        geocoder.geocode("Phase 7, Mohali")
    assert "request failed" in str(exc.value).lower()


@patch("requests.get")
def test_geocoding_caching_avoids_repeated_requests(mock_get):
    """Verify in-memory caching prevents duplicate requests for identical normalized queries."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = [
        {"lat": "30.7046", "lon": "76.7179", "display_name": "Phase 5, Mohali"}
    ]
    mock_get.return_value = mock_resp

    geocoder = NominatimGeocoder()
    r1 = geocoder.geocode("Phase 5, Mohali")
    r2 = geocoder.geocode("  phase 5,   mohali  ")

    assert r1.latitude == r2.latitude
    # Only 1 external request made despite 2 calls
    assert mock_get.call_count == 1


# =========================================================================
# 2. Coordinate Validation & Snapping Unit Tests
# =========================================================================

def test_coordinate_model_validation():
    """Verify latitude and longitude range and NaN/Inf validation."""
    c = Coordinate(latitude=30.7333, longitude=76.7794)
    assert c.latitude == 30.7333
    assert c.longitude == 76.7794

    with pytest.raises(ValueError):
        Coordinate(latitude=105.0, longitude=76.7794)  # Latitude > 90

    with pytest.raises(ValueError):
        Coordinate(latitude=30.7333, longitude=-200.0)  # Longitude < -180

    with pytest.raises(ValueError):
        Coordinate(latitude=float("nan"), longitude=76.7794)


def test_is_within_region_helper():
    """Verify regional boundary check for points inside vs outside."""
    # Chandigarh center (inside)
    assert is_within_region(30.7333, 76.7794) is True
    # Dera Bassi (inside)
    assert is_within_region(30.5833, 76.8444) is True
    # Kharar (inside)
    assert is_within_region(30.7499, 76.6411) is True
    # Shimla (outside north/east)
    assert is_within_region(31.1048, 77.1734) is False
    # Delhi (outside south)
    assert is_within_region(28.6139, 77.2090) is False


def test_validate_and_snap_rejects_out_of_region():
    """Verify coordinate validator rejects out-of-boundary coordinates."""
    out_coord = Coordinate(latitude=28.6139, longitude=77.2090)
    with pytest.raises(ValueError) as exc:
        validate_and_snap_coordinate(out_coord, label="Origin")
    assert "outside the supported" in str(exc.value).lower()


def test_validate_and_snap_success_near_road():
    """Verify coordinate validator succeeds for legitimate Tricity point."""
    chd_center = Coordinate(latitude=30.7333, longitude=76.7794)
    res = validate_and_snap_coordinate(chd_center, label="Chandigarh Center")
    assert res["is_valid"] is True
    assert res["distance_to_road_km"] < 1.0  # Within 1 km of central road


# =========================================================================
# 3. Routing Provider (OSRM) Unit Tests
# =========================================================================

MOCK_OSRM_SINGLE_ROUTE = {
    "code": "Ok",
    "routes": [
        {
            "distance": 12450.5,
            "duration": 960.2,
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [76.7794, 30.7333],
                    [76.7500, 30.7200],
                    [76.7179, 30.7046],
                ]
            },
            "legs": [
                {
                    "summary": "Madhya Marg, Himalaya Marg",
                    "distance": 12450.5,
                    "duration": 960.2,
                    "steps": [
                        {
                            "name": "Madhya Marg",
                            "distance": 450.0,
                            "duration": 35.0,
                            "mode": "driving",
                            "maneuver": {
                                "type": "depart",
                                "location": [76.7794, 30.7333]
                            }
                        },
                        {
                            "name": "Himalaya Marg",
                            "distance": 12000.5,
                            "duration": 925.2,
                            "mode": "driving",
                            "maneuver": {
                                "type": "turn",
                                "modifier": "left",
                                "location": [76.7500, 30.7200],
                                "instruction": "Turn left onto Himalaya Marg"
                            }
                        }
                    ]
                }
            ]
        }
    ]
}

MOCK_OSRM_MULTI_ROUTE = {
    "code": "Ok",
    "routes": [
        {
            "distance": 12450.0,
            "duration": 960.0,
            "geometry": {"type": "LineString", "coordinates": [[76.7794, 30.7333], [76.7179, 30.7046]]},
            "legs": [{"summary": "Via Madhya Marg", "steps": []}]
        },
        {
            "distance": 14100.0,
            "duration": 1120.0,
            "geometry": {"type": "LineString", "coordinates": [[76.7794, 30.7333], [76.7500, 30.7100], [76.7179, 30.7046]]},
            "legs": [{"summary": "Via Dakshin Marg", "steps": []}]
        }
    ]
}


@patch("requests.get")
def test_osrm_single_route_parsing(mock_get):
    """Verify single route parsing with steps, geometry, distance, and duration."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_OSRM_SINGLE_ROUTE
    mock_get.return_value = mock_resp

    provider = OSRMRouteProvider()
    src = Coordinate(latitude=30.7333, longitude=76.7794)
    dst = Coordinate(latitude=30.7046, longitude=76.7179)

    response = provider.find_routes(src, dst, alternatives=False)

    assert response.routes_count == 1
    assert len(response.routes) == 1

    r0 = response.routes[0]
    assert r0.route_id == "route_1"
    assert r0.is_primary is True
    assert r0.distance_m == 12450.5
    assert r0.distance_km == 12.45
    assert r0.duration_s == 960.2
    assert r0.duration_min == 16.0
    assert r0.geometry.type == "LineString"
    assert len(r0.geometry.coordinates) == 3
    assert len(r0.steps) == 2
    assert r0.steps[0].name == "Madhya Marg"
    assert r0.steps[1].maneuver.modifier == "left"


@patch("requests.get")
def test_osrm_multiple_alternatives_parsing(mock_get):
    """Verify multiple alternative route candidates with primary vs alternative flags."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_OSRM_MULTI_ROUTE
    mock_get.return_value = mock_resp

    provider = OSRMRouteProvider()
    src = Coordinate(latitude=30.7333, longitude=76.7794)
    dst = Coordinate(latitude=30.7046, longitude=76.7179)

    response = provider.find_routes(src, dst, alternatives=True)

    assert response.routes_count == 2
    assert response.routes[0].is_primary is True
    assert response.routes[0].route_id == "route_1"
    assert response.routes[1].is_primary is False
    assert response.routes[1].route_id == "route_2"
    assert response.routes[0].distance_km < response.routes[1].distance_km


@patch("requests.get")
def test_osrm_no_route_error_handling(mock_get):
    """Verify that OSRM NoRoute code raises a descriptive ValueError."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "code": "NoRoute",
        "message": "Impossible route between points"
    }
    mock_get.return_value = mock_resp

    provider = OSRMRouteProvider()
    src = Coordinate(latitude=30.7333, longitude=76.7794)
    dst = Coordinate(latitude=30.7046, longitude=76.7179)

    with pytest.raises(ValueError) as exc:
        provider.find_routes(src, dst)
    assert "no drivable route could be found" in str(exc.value).lower()


@patch("requests.get")
def test_osrm_timeout_handling(mock_get):
    """Verify timeout from OSRM raises TimeoutError."""
    mock_get.side_effect = requests.exceptions.Timeout("OSRM timed out")

    provider = OSRMRouteProvider()
    src = Coordinate(latitude=30.7333, longitude=76.7794)
    dst = Coordinate(latitude=30.7046, longitude=76.7179)

    with pytest.raises(TimeoutError) as exc:
        provider.find_routes(src, dst)
    assert "timed out" in str(exc.value).lower()


@patch("requests.get")
def test_osrm_http_error_handling(mock_get):
    """Verify HTTP connection error raises ConnectionError."""
    mock_get.side_effect = requests.exceptions.ConnectionError("Connection refused")

    provider = OSRMRouteProvider()
    src = Coordinate(latitude=30.7333, longitude=76.7794)
    dst = Coordinate(latitude=30.7046, longitude=76.7179)

    with pytest.raises(ConnectionError) as exc:
        provider.find_routes(src, dst)
    assert "request failed" in str(exc.value).lower()


@patch("requests.get")
def test_osrm_malformed_response_handling(mock_get):
    """Verify malformed JSON raises ValueError."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.side_effect = ValueError("Invalid JSON")
    mock_get.return_value = mock_resp

    provider = OSRMRouteProvider()
    src = Coordinate(latitude=30.7333, longitude=76.7794)
    dst = Coordinate(latitude=30.7046, longitude=76.7179)

    with pytest.raises(ValueError) as exc:
        provider.find_routes(src, dst)
    assert "invalid json" in str(exc.value).lower()


# =========================================================================
# 4. FastAPI Endpoints Integration Tests
# =========================================================================

@patch("requests.get")
def test_api_post_routing_geocode_success(mock_get):
    """Verify POST /routing/geocode returns 200 and structured geocoding schema."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = [
        {
            "lat": "30.7415",
            "lon": "76.7681",
            "display_name": "Sector 17 Plaza, Chandigarh, 160017, India",
            "address": {"city": "Chandigarh", "state": "Chandigarh"},
        }
    ]
    mock_get.return_value = mock_resp

    response = client.post("/routing/geocode", json={"query": "Sector 17 Plaza, Chandigarh"})
    assert response.status_code == 200
    data = response.json()
    assert data["latitude"] == 30.7415
    assert data["longitude"] == 76.7681
    assert data["is_inside_region"] is True
    assert "Sector 17 Plaza" in data["display_name"]


def test_api_post_routing_geocode_empty_query():
    """Verify POST /routing/geocode with empty query returns 400."""
    response = client.post("/routing/geocode", json={"query": "   "})
    assert response.status_code == 400


@patch("requests.get")
def test_api_post_routing_geocode_timeout(mock_get):
    """Verify POST /routing/geocode timeout returns 504 Gateway Timeout."""
    mock_get.side_effect = requests.exceptions.Timeout("Timeout")
    response = client.post("/routing/geocode", json={"query": "Panchkula Sector 5"})
    assert response.status_code == 504


@patch("requests.get")
def test_api_post_routing_routes_success(mock_get):
    """Verify POST /routing/routes returns 200 with candidates, geometry, and steps."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_OSRM_SINGLE_ROUTE
    mock_get.return_value = mock_resp

    payload = {
        "source": {"latitude": 30.7415, "longitude": 76.7681},
        "destination": {"latitude": 30.6425, "longitude": 76.8173},
        "alternatives": True,
    }
    response = client.post("/routing/routes", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["routes_count"] == 1
    assert len(data["routes"]) == 1
    r0 = data["routes"][0]
    assert r0["distance_km"] > 0
    assert r0["duration_min"] > 0
    assert r0["geometry"]["type"] == "LineString"
    assert "baseline_notice" in data


def test_api_post_routing_routes_out_of_region_rejected():
    """Verify POST /routing/routes rejects out-of-region coordinates with 400."""
    payload = {
        "source": {"latitude": 28.6139, "longitude": 77.2090},  # Delhi
        "destination": {"latitude": 30.6425, "longitude": 76.8173},
        "alternatives": True,
    }
    response = client.post("/routing/routes", json=payload)
    assert response.status_code == 400
    assert "outside the supported" in response.json()["detail"].lower()


@patch("requests.get")
def test_api_post_routing_routes_no_route(mock_get):
    """Verify POST /routing/routes returns 404 when no route exists."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"code": "NoRoute", "message": "Impossible route"}
    mock_get.return_value = mock_resp

    payload = {
        "source": {"latitude": 30.7415, "longitude": 76.7681},
        "destination": {"latitude": 30.6425, "longitude": 76.8173},
        "alternatives": False,
    }
    response = client.post("/routing/routes", json=payload)
    assert response.status_code == 404
    assert "no drivable route" in response.json()["detail"].lower()


def test_api_get_routing_provider_status():
    """Verify GET /routing/provider/status returns 200 without making external network calls."""
    response = client.get("/routing/provider/status")
    assert response.status_code == 200
    data = response.json()
    assert "geocoding_provider" in data
    assert "routing_provider" in data
    assert "provider_status" in data
    assert "regional_graph_available" in data
    assert data["regional_graph_available"] is True
    assert "regional_boundary" in data
    assert data["regional_boundary"]["west"] == WEST_LON


# =========================================================================
# 5. Phase 9.2.1 Audit & Correctness Regression Tests
# =========================================================================

@patch("requests.get")
def test_original_coordinates_preserved_and_passed_to_osrm(mock_get):
    """
    Verify that user original coordinates are passed directly to OSRM
    and are NOT overwritten by local road-graph node coordinates.
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_OSRM_SINGLE_ROUTE
    mock_get.return_value = mock_resp

    orig_source = {"latitude": 30.741523, "longitude": 76.768145}
    orig_dest = {"latitude": 30.642512, "longitude": 76.817389}

    payload = {
        "source": orig_source,
        "destination": orig_dest,
        "alternatives": False,
    }
    response = client.post("/routing/routes", json=payload)
    assert response.status_code == 200
    data = response.json()

    # Verify original coordinates preserved in API response contract
    assert data["source"]["latitude"] == orig_source["latitude"]
    assert data["source"]["longitude"] == orig_source["longitude"]
    assert data["destination"]["latitude"] == orig_dest["latitude"]
    assert data["destination"]["longitude"] == orig_dest["longitude"]

    # Verify original coordinates were passed to OSRM URL path in lon,lat;lon,lat order
    called_url = mock_get.call_args[0][0]
    expected_path_coords = f"{orig_source['longitude']},{orig_source['latitude']};{orig_dest['longitude']},{orig_dest['latitude']}"
    assert expected_path_coords in called_url


def test_local_snapping_does_not_mutate_coordinate_object():
    """Verify validate_and_snap_coordinate does not modify the input Coordinate."""
    coord = Coordinate(latitude=30.7415, longitude=76.7681)
    orig_lat = coord.latitude
    orig_lon = coord.longitude

    res = validate_and_snap_coordinate(coord, label="Test Location")
    assert res["is_valid"] is True
    assert coord.latitude == orig_lat
    assert coord.longitude == orig_lon


def test_snapping_distance_threshold_configurable_and_enforced():
    """Verify that coordinates beyond max_distance_km threshold are rejected."""
    from backend.routing.coordinate_validator import validate_and_snap_coordinate
    coord = Coordinate(latitude=30.7333, longitude=76.7794)

    # Legitimate point is ~7m from road, so passes with max_distance_km=2.0
    res = validate_and_snap_coordinate(coord, max_distance_km=2.0)
    assert res["is_valid"] is True

    # If an artificially strict threshold of 0.001 km (1 meter) is set, it rejects
    with pytest.raises(ValueError) as exc:
        validate_and_snap_coordinate(coord, max_distance_km=0.001)
    assert "too far" in str(exc.value).lower()


def test_spatial_index_3d_accuracy_and_invalidation():
    """
    Verify 3D Cartesian coordinates are used in spatial index and invalidation works.
    """
    from backend.routing.coordinate_validator import (
        _lat_lon_to_cartesian_unit,
        invalidate_spatial_index,
        get_spatial_index,
    )

    # 1. Verify 3D unit sphere conversion
    x, y, z = _lat_lon_to_cartesian_unit(30.7, 76.8)
    norm = math.sqrt(x*x + y*y + z*z)
    assert abs(norm - 1.0) < 1e-9

    # 2. Verify cache retrieval and invalidation
    tree, nodes, coords = get_spatial_index()
    assert tree is not None

    invalidate_spatial_index()
    from backend.routing import coordinate_validator
    assert coordinate_validator._SPATIAL_INDEX is None

    # Reloads lazily on next call
    tree2, _, _ = get_spatial_index()
    assert tree2 is not None


@patch("requests.get")
def test_concurrent_geocoding_thread_safety_and_deduplication(mock_get):
    """
    Verify that concurrent geocode requests in multiple threads are thread-safe,
    respect the 1 req/sec rate limit, and do not duplicate upstream requests for identical queries.
    """
    import threading
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = [
        {
            "display_name": "Sector 17, Chandigarh, 160017, India",
            "lat": "30.7415",
            "lon": "76.7681",
            "place_id": 12345,
        }
    ]
    mock_get.return_value = mock_resp

    geocoder = NominatimGeocoder(base_url="https://mock-nominatim.org")
    results = []
    errors = []

    def worker():
        try:
            res = geocoder.geocode("Sector 17, Chandigarh")
            results.append(res)
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(errors) == 0
    assert len(results) == 5
    # Because all 5 threads requested identical query, only 1 upstream request should be made!
    assert mock_get.call_count == 1


@patch("requests.get")
def test_osrm_nosegment_handling(mock_get):
    """Verify OSRM NoSegment error is handled with clear descriptive message."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"code": "NoSegment", "message": "Could not find a routable segment"}
    mock_get.return_value = mock_resp

    provider = OSRMRouteProvider(base_url="https://mock-osrm.org")
    src = Coordinate(latitude=30.7415, longitude=76.7681)
    dst = Coordinate(latitude=30.6425, longitude=76.8173)

    with pytest.raises(ValueError) as exc:
        provider.find_routes(src, dst)
    assert "could not snap to a routable road segment" in str(exc.value).lower()


@patch("requests.get")
def test_osrm_rejects_missing_or_non_positive_distance_duration(mock_get):
    """Verify that OSRM response with 0 or negative distance/duration is rejected."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "code": "Ok",
        "routes": [
            {
                "distance": 0.0,  # Invalid zero distance
                "duration": 500.0,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[76.7681, 30.7415], [76.8173, 30.6425]],
                },
                "legs": [],
            }
        ]
    }
    mock_get.return_value = mock_resp

    provider = OSRMRouteProvider(base_url="https://mock-osrm.org")
    src = Coordinate(latitude=30.7415, longitude=76.7681)
    dst = Coordinate(latitude=30.6425, longitude=76.8173)

    with pytest.raises(ValueError) as exc:
        provider.find_routes(src, dst)
    assert "distance" in str(exc.value).lower()


@patch("requests.get")
def test_osrm_rejects_missing_or_empty_geometry(mock_get):
    """Verify that route with missing or empty geometry coordinates is rejected."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "code": "Ok",
        "routes": [
            {
                "distance": 5000.0,
                "duration": 400.0,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [],  # Invalid empty coordinates
                },
                "legs": [],
            }
        ]
    }
    mock_get.return_value = mock_resp

    provider = OSRMRouteProvider(base_url="https://mock-osrm.org")
    src = Coordinate(latitude=30.7415, longitude=76.7681)
    dst = Coordinate(latitude=30.6425, longitude=76.8173)

    with pytest.raises(ValueError) as exc:
        provider.find_routes(src, dst)
    assert "geometry" in str(exc.value).lower() or "coordinates" in str(exc.value).lower()


def test_geojson_geometry_coordinate_validation():
    """Verify GeoJSONGeometry rejects invalid coordinate structures and ranges."""
    from backend.routing.models import GeoJSONGeometry

    # Must have >= 2 points
    with pytest.raises(ValueError):
        GeoJSONGeometry(coordinates=[[76.7681, 30.7415]])

    # Longitude out of range
    with pytest.raises(ValueError):
        GeoJSONGeometry(coordinates=[[195.0, 30.7415], [76.8173, 30.6425]])

    # Latitude out of range
    with pytest.raises(ValueError):
        GeoJSONGeometry(coordinates=[[76.7681, -95.0], [76.8173, 30.6425]])

    # Valid LineString coordinates
    geom = GeoJSONGeometry(coordinates=[[76.7681, 30.7415], [76.8173, 30.6425]])
    assert len(geom.coordinates) == 2


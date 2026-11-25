"""
Unit and Integration Test Suite for Route-Level Intersection & Traffic-Signal Analysis
======================================================================================

Phase 9.3: Route-Level Intersection and Traffic-Signal Analysis.

Verifies:
1. Route passing through a single unsignalized intersection.
2. Route passing through a single signalized intersection.
3. Route passing through multiple intersections in sequence.
4. Route passing through mixed signalized and unsignalized intersections.
5. Route passing near an intersection but outside the matching tolerance (rejection).
6. Duplicate/redundant route coordinates handling.
7. Repeated visits to the same node along a looping route.
8. Multiple directed edges representing reciprocal roads and multi-lane roadways.
9. Complex junctions represented by multiple OSM nodes.
10. Correct travel-order sorting by cumulative distance along route.
11. Accurate distance_along_route_m and distance_from_route_m calculations.
12. Empty, single-point, or invalid route geometry handling.
13. Route with no matching intersections.
14. Mathematical intersection count conservation: total = signalized + unsignalized.
15. Multiple candidate routes receiving independent analyses.
16. FastAPI endpoint integration (/routing/routes) returning enriched responses.
17. Performance benchmark on realistic route geometry.
"""

import math
import time
from unittest.mock import patch, MagicMock
import pytest
import networkx as nx
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.routing.config import (
    ROUTE_MATCHING_TOLERANCE_M,
    ROUTE_MATCHING_SAMPLE_STEP_M,
    ROUTE_LOOP_DEDUPLICATION_WINDOW_M,
)
from backend.routing.models import (
    Coordinate,
    GeoJSONGeometry,
    RouteResult,
    RouteSearchResponse,
    MatchedIntersection,
    RouteIntersectionAnalysis,
)
from backend.routing.route_analyzer import (
    _to_local_xy,
    _point_to_segment,
    deduplicate_node_passes,
    get_intersection_spatial_index,
    invalidate_intersection_index,
    analyze_route_intersections,
)
from backend.routing.road_network import load_network_graph, is_graph_available_locally

client = TestClient(app)


# =========================================================================
# Synthetic Graph Fixtures
# =========================================================================

@pytest.fixture
def synthetic_graph():
    """
    Construct a deterministic synthetic MultiDiGraph:
    - Node 1: (30.7000, 76.7600), physical degree 4 (unsignalized intersection)
    - Node 2: (30.7020, 76.7600), physical degree 4 (signalized intersection)
    - Node 3: (30.7040, 76.7600), physical degree 4 (unsignalized intersection)
    - Node 4: (30.7060, 76.7600), physical degree 2 (intermediate through node -> NOT an intersection)
    - Node 5: (30.7020, 76.7610), physical degree 3, but offset 80m East (outside 20m tolerance)
    """
    G = nx.MultiDiGraph()

    # Intersections along North-South axis
    G.add_node(1, y=30.7000, x=76.7600, highway=None)
    G.add_node(2, y=30.7020, x=76.7600, highway="traffic_signals")
    G.add_node(3, y=30.7040, x=76.7600, highway=None)
    G.add_node(4, y=30.7060, x=76.7600, highway=None)  # degree 2 through-node

    # Offset node outside tolerance
    G.add_node(5, y=30.7020, x=76.7610, highway=None)  # ~80m east

    # Outer branch nodes to give nodes 1, 2, 3, 5 physical degree >= 3
    G.add_node(11, y=30.7000, x=76.7580)
    G.add_node(12, y=30.7000, x=76.7620)
    G.add_node(21, y=30.7020, x=76.7580)
    G.add_node(22, y=30.7020, x=76.7590)
    G.add_node(31, y=30.7040, x=76.7580)
    G.add_node(32, y=30.7040, x=76.7620)
    G.add_node(51, y=30.7010, x=76.7610)
    G.add_node(52, y=30.7030, x=76.7610)

    # Main spine edges (reciprocal two-way street)
    for u, v in [(1, 2), (2, 3), (3, 4)]:
        G.add_edge(u, v, length=220.0)
        G.add_edge(v, u, length=220.0)

    # Cross street branches (giving physical degree >= 3)
    for u, v in [(1, 11), (11, 1), (1, 12), (12, 1)]:
        G.add_edge(u, v, length=150.0)
    for u, v in [(2, 21), (21, 2), (2, 22), (22, 2)]:
        G.add_edge(u, v, length=150.0)
    for u, v in [(3, 31), (31, 3), (3, 32), (32, 3)]:
        G.add_edge(u, v, length=150.0)
    for u, v in [(5, 51), (51, 5), (5, 52), (52, 5)]:
        G.add_edge(u, v, length=100.0)

    # Node 4 connects only to Node 3 and end node 41 (physical degree = 2)
    G.add_node(41, y=30.7080, x=76.7600)
    G.add_edge(4, 41, length=220.0)
    G.add_edge(41, 4, length=220.0)

    invalidate_intersection_index()
    return G


# =========================================================================
# Unit Tests: Geometry Math & Deduplication
# =========================================================================

def test_point_to_segment_exact_math():
    """Verify point-to-segment distance and progression factor t."""
    # Segment from (0, 0) to (100, 0)
    # Point perpendicular at (50, 10)
    dist, t = _point_to_segment(50.0, 10.0, 0.0, 0.0, 100.0, 0.0)
    assert abs(dist - 10.0) < 1e-6
    assert abs(t - 0.5) < 1e-6

    # Point beyond end at (120, 0)
    dist, t = _point_to_segment(120.0, 0.0, 0.0, 0.0, 100.0, 0.0)
    assert abs(dist - 20.0) < 1e-6
    assert abs(t - 1.0) < 1e-6

    # Degenerate zero-length segment
    dist, t = _point_to_segment(5.0, 5.0, 0.0, 0.0, 0.0, 0.0)
    assert abs(dist - math.hypot(5.0, 5.0)) < 1e-6
    assert t == 0.0


def test_deduplicate_node_passes_clusters_adjacent_segments():
    """Verify adjacent segment hits for same node are collapsed to closest point."""
    hits = [
        {"node_id": 101, "dist_along": 100.0, "dist_from": 8.0},
        {"node_id": 101, "dist_along": 115.0, "dist_from": 3.0},  # Closest
        {"node_id": 101, "dist_along": 125.0, "dist_from": 9.0},
    ]
    deduped = deduplicate_node_passes(hits, window_m=50.0)
    assert len(deduped) == 1
    assert deduped[0]["node_id"] == 101
    assert deduped[0]["dist_along"] == 115.0
    assert deduped[0]["dist_from"] == 3.0


def test_deduplicate_node_passes_preserves_loop_revisits():
    """Verify legitimate repeated visits on looping route separated by > window_m are preserved."""
    hits = [
        {"node_id": 101, "dist_along": 100.0, "dist_from": 4.0},
        {"node_id": 101, "dist_along": 110.0, "dist_from": 6.0},
        {"node_id": 102, "dist_along": 800.0, "dist_from": 5.0},
        {"node_id": 101, "dist_along": 2200.0, "dist_from": 2.0},  # Second pass on return
        {"node_id": 101, "dist_along": 2210.0, "dist_from": 7.0},
    ]
    deduped = deduplicate_node_passes(hits, window_m=50.0)
    assert len(deduped) == 3
    assert deduped[0]["node_id"] == 101 and deduped[0]["dist_along"] == 100.0
    assert deduped[1]["node_id"] == 102 and deduped[1]["dist_along"] == 800.0
    assert deduped[2]["node_id"] == 101 and deduped[2]["dist_along"] == 2200.0


# =========================================================================
# Route Intersection Analysis Scenarios (1–15)
# =========================================================================

def test_1_route_passing_through_one_unsignalized_intersection(synthetic_graph):
    """Scenario 1: Route passing through exactly one unsignalized intersection."""
    # Route around Node 1 only: from (30.6990, 76.7600) to (30.7010, 76.7600)
    coords = [[76.7600, 30.6990], [76.7600, 30.7010]]
    analysis = analyze_route_intersections(coords, G=synthetic_graph, tolerance_m=20.0)

    assert analysis.analysis_status == "success"
    assert analysis.total_intersection_nodes == 1
    assert analysis.signalized_intersection_nodes == 0
    assert analysis.unsignalized_intersection_nodes == 1
    assert len(analysis.matched_intersections) == 1
    assert analysis.matched_intersections[0].osm_node_id == 1
    assert analysis.matched_intersections[0].is_signalized is False


def test_2_route_passing_through_one_signalized_intersection(synthetic_graph):
    """Scenario 2: Route passing through exactly one signalized intersection."""
    # Route around Node 2 only: from (30.7015, 76.7600) to (30.7025, 76.7600)
    coords = [[76.7600, 30.7015], [76.7600, 30.7025]]
    analysis = analyze_route_intersections(coords, G=synthetic_graph, tolerance_m=20.0)

    assert analysis.analysis_status == "success"
    assert analysis.total_intersection_nodes == 1
    assert analysis.signalized_intersection_nodes == 1
    assert analysis.unsignalized_intersection_nodes == 0
    assert analysis.matched_intersections[0].osm_node_id == 2
    assert analysis.matched_intersections[0].is_signalized is True
    assert analysis.matched_intersections[0].signal_tags == {"highway": "traffic_signals"}


def test_3_and_4_route_passing_through_mixed_intersections(synthetic_graph):
    """Scenarios 3 & 4: Route traversing multiple intersections (both signalized & unsignalized)."""
    # Route traversing Node 1, Node 2, Node 3, and passing by through-node 4
    coords = [
        [76.7600, 30.6990],
        [76.7600, 30.7050],
    ]
    analysis = analyze_route_intersections(coords, G=synthetic_graph, tolerance_m=20.0)

    assert analysis.analysis_status == "success"
    # Matches Nodes 1, 2, 3 (Node 4 is degree 2, not an intersection; Node 5 is 80m away)
    assert analysis.total_intersection_nodes == 3
    assert analysis.signalized_intersection_nodes == 1  # Node 2
    assert analysis.unsignalized_intersection_nodes == 2  # Nodes 1 and 3

    matched_ids = [m.osm_node_id for m in analysis.matched_intersections]
    assert matched_ids == [1, 2, 3]


def test_5_route_near_intersection_outside_tolerance_rejected(synthetic_graph):
    """Scenario 5: Route that passes near an intersection but outside matching tolerance."""
    # Route parallel along lon 76.7610 (where Node 5 is), but let's test distance from Node 1 (80m west)
    # Route from (30.6990, 76.7610) to (30.7010, 76.7610): Node 1 is ~80m away
    coords = [[76.7610, 30.6990], [76.7610, 30.7010]]
    # Node 5 is at 30.7020, so not on this segment. Node 1 is at (30.7000, 76.7600), ~80m away.
    analysis = analyze_route_intersections(coords, G=synthetic_graph, tolerance_m=20.0)

    # Node 1 should NOT be matched because 80m > 20m tolerance
    matched_ids = [m.osm_node_id for m in analysis.matched_intersections]
    assert 1 not in matched_ids


def test_6_duplicate_redundant_route_coordinates(synthetic_graph):
    """Scenario 6: Route geometry containing consecutive duplicate identical coordinates."""
    coords = [
        [76.7600, 30.6990],
        [76.7600, 30.6990],  # Duplicate
        [76.7600, 30.7010],
        [76.7600, 30.7010],  # Duplicate
    ]
    analysis = analyze_route_intersections(coords, G=synthetic_graph, tolerance_m=20.0)
    assert analysis.analysis_status == "success"
    assert analysis.total_intersection_nodes == 1
    assert analysis.matched_intersections[0].osm_node_id == 1


def test_7_repeated_visits_along_looping_route(synthetic_graph):
    """Scenario 7: Repeated visits to the same intersection node along a looping route."""
    # Route starts south of Node 1, passes Node 1 and Node 2, loops east, returns through Node 2 and Node 1
    coords = [
        [76.7600, 30.6990],  # Start
        [76.7600, 30.7025],  # Traverses Node 1 and Node 2
        [76.7630, 30.7025],  # Loop east
        [76.7630, 30.7030],
        [76.7600, 30.7030],  # Return to spine north of Node 2
        [76.7600, 30.6990],  # Traverses Node 2 and Node 1 in reverse
    ]
    analysis = analyze_route_intersections(coords, G=synthetic_graph, tolerance_m=20.0)
    assert analysis.analysis_status == "success"

    matched_ids = [m.osm_node_id for m in analysis.matched_intersections]
    # Should observe Node 1, Node 2 on outbound, and Node 2, Node 1 on return
    assert matched_ids == [1, 2, 2, 1]
    assert analysis.total_intersection_nodes == 4


def test_8_multiple_directed_edges_representing_same_physical_node(synthetic_graph):
    """Scenario 8: Physical degree ignores reciprocal/parallel directed edges."""
    # Even though edges (1->2) and (2->1) exist, physical degree of node 1 is 3 (not 5 or 6)
    from backend.routing.junction_detector import get_physical_degree
    assert get_physical_degree(synthetic_graph, 1) == 3


def test_9_complex_junction_multiple_osm_nodes():
    """Scenario 9: Complex junction represented by 2 separate OSM carriageway nodes."""
    G = nx.MultiDiGraph()
    # Northbound carriageway node 200a, Southbound carriageway node 200b (separated by 12m)
    G.add_node(2001, y=30.7000, x=76.7600, highway=None)
    G.add_node(2002, y=30.7001, x=76.7600, highway=None)
    # Give them physical degree 3
    G.add_node(991, y=30.6990, x=76.7600)
    G.add_node(992, y=30.7010, x=76.7600)
    G.add_node(993, y=30.7000, x=76.7610)
    G.add_edge(2001, 991)
    G.add_edge(2001, 992)
    G.add_edge(2001, 993)
    G.add_edge(2002, 991)
    G.add_edge(2002, 992)
    G.add_edge(2002, 993)

    coords = [[76.7600, 30.6990], [76.7600, 30.7010]]
    analysis = analyze_route_intersections(coords, G=G, tolerance_m=20.0)

    # Both distinct topological OSM nodes are preserved for traceability
    matched_ids = [m.osm_node_id for m in analysis.matched_intersections]
    assert 2001 in matched_ids
    assert 2002 in matched_ids
    assert analysis.total_intersection_nodes == 2


def test_10_and_11_travel_order_sorting_and_cumulative_distance(synthetic_graph):
    """Scenarios 10 & 11: Matched intersections sorted by cumulative distance along route."""
    coords = [
        [76.7600, 30.6990],
        [76.7600, 30.7050],
    ]
    analysis = analyze_route_intersections(coords, G=synthetic_graph, tolerance_m=20.0)

    dists = [m.distance_along_route_m for m in analysis.matched_intersections]
    # Strictly increasing progression
    assert dists == sorted(dists)
    assert dists[0] < dists[1] < dists[2]

    # Verify distance_from_route_m is within tolerance
    for m in analysis.matched_intersections:
        assert 0.0 <= m.distance_from_route_m <= 20.0


def test_12_empty_or_invalid_route_geometry(synthetic_graph):
    """Scenario 12: Route with empty or single coordinate point returns explicit invalid status."""
    res_empty = analyze_route_intersections([], G=synthetic_graph)
    assert res_empty.analysis_status == "invalid_geometry"
    assert res_empty.total_intersection_nodes == 0

    res_single = analyze_route_intersections([[76.7600, 30.7000]], G=synthetic_graph)
    assert res_single.analysis_status == "invalid_geometry"
    assert res_single.total_intersection_nodes == 0


def test_13_no_matching_intersections(synthetic_graph):
    """Scenario 13: Route with no intersections within tolerance returns no_intersections_matched."""
    # Route far off in the west where no graph nodes exist
    coords = [[76.7100, 30.7000], [76.7100, 30.7050]]
    analysis = analyze_route_intersections(coords, G=synthetic_graph, tolerance_m=20.0)

    assert analysis.analysis_status == "no_intersections_matched"
    assert analysis.total_intersection_nodes == 0
    assert analysis.matched_intersections == []


def test_14_intersection_count_conservation(synthetic_graph):
    """Scenario 14: Conservation total_intersection_nodes = signalized + unsignalized."""
    coords = [[76.7600, 30.6990], [76.7600, 30.7050]]
    analysis = analyze_route_intersections(coords, G=synthetic_graph, tolerance_m=20.0)

    assert analysis.total_intersection_nodes == (
        analysis.signalized_intersection_nodes + analysis.unsignalized_intersection_nodes
    )


# =========================================================================
# Integration & Multi-Route API Tests
# =========================================================================

MOCK_OSRM_TWO_ROUTES = {
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
            "legs": [
                {
                    "summary": "Himalaya Marg",
                    "steps": [],
                }
            ],
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
            "legs": [
                {
                    "summary": "Dakshin Marg",
                    "steps": [],
                }
            ],
        },
    ],
}


@patch("requests.get")
def test_15_and_16_api_routes_enrichment_and_independent_analysis(mock_get):
    """
    Scenarios 15 & 16: POST /routing/routes returns all candidate routes enriched
    with independent intersection analyses while preserving geometry and metrics.
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_OSRM_TWO_ROUTES
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
    assert len(data["routes"]) == 2

    r0 = data["routes"][0]
    r1 = data["routes"][1]

    # Verify core fields preserved
    assert r0["route_id"] == "route_1"
    assert r0["is_primary"] is True
    assert r1["route_id"] == "route_2"
    assert r1["is_primary"] is False

    # Verify intersection analysis enriched on each route
    assert "intersection_analysis" in r0
    assert "intersection_analysis" in r1
    a0 = r0["intersection_analysis"]
    a1 = r1["intersection_analysis"]

    assert a0["total_intersection_nodes"] == a0["signalized_intersection_nodes"] + a0["unsignalized_intersection_nodes"]
    assert a1["total_intersection_nodes"] == a1["signalized_intersection_nodes"] + a1["unsignalized_intersection_nodes"]
    assert "analysis_status" in a0
    assert "analysis_warnings" in a0


def test_17_performance_on_realistic_route():
    """
    Scenario 17: Performance benchmark on realistic route geometry against the local road network.
    Verifies that spatial matching executes deterministically in sub-25ms per route.
    """
    if not is_graph_available_locally():
        pytest.skip("Local GraphML graph not available on disk.")

    G = load_network_graph()

    # Generate a realistic 12 km route through Chandigarh Tricity (100 coordinate points)
    lats = [30.7415 + (30.6425 - 30.7415) * (i / 99.0) for i in range(100)]
    lons = [76.7681 + (76.8173 - 76.7681) * (i / 99.0) for i in range(100)]
    coords = [[lon, lat] for lat, lon in zip(lats, lons)]

    # Warm-up / build index
    _ = analyze_route_intersections(coords, G=G)

    # Benchmark execution
    t0 = time.perf_counter()
    analysis = analyze_route_intersections(coords, route_distance_km=12.0, G=G)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    assert analysis.analysis_status in ("success", "no_intersections_matched")
    assert analysis.total_intersection_nodes == (
        analysis.signalized_intersection_nodes + analysis.unsignalized_intersection_nodes
    )
    # Sub-25ms requirement
    assert elapsed_ms < 25.0, f"Analysis took {elapsed_ms:.2f}ms, expected < 25ms"

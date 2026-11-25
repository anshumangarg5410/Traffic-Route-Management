"""
Unit and Integration Test Suite for Road Network Foundation & Data Quality Audit
================================================================================

Phase 9.1 & 9.1.1: Chandigarh Tricity Road Network Foundation and Data Quality Audit.

Tests verify (using synthetic offline fixtures with ZERO network calls):
1. Topology-aware intersection detection:
   - Distinguishes directed degree from physical road branches.
   - Avoids double-counting reciprocal edges (two-way roads).
   - Handles parallel edges between identical endpoints.
   - Excludes self-loops.
   - Distinguishes dead-ends, intermediate through nodes, and intersections.
2. Required synthetic topological scenarios:
   - Straight two-way road with intermediate nodes.
   - Three-way intersection (T-junction).
   - Four-way intersection.
   - One-way road.
   - Two parallel road segments.
   - Dead-end road.
   - Complex intersection with multiple edges and self-loop.
3. Separation of mapped traffic signals from topological junctions:
   - Signal on an intersection vs. mid-block pedestrian signal.
4. Physical road length deduplication:
   - Directed edge length vs. unique physical centerline length.
5. GraphML serialization and deserialization round-trip.
6. Target area geographic coverage validation.
7. FastAPI endpoints: GET /routing/network/status, GET /routing/network/summary, POST /routing/network/build.
"""

import os
import tempfile
import pytest
import networkx as nx
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.routing.config import TARGET_AREAS
from backend.routing.junction_detector import (
    get_undirected_neighbors,
    get_physical_degree,
    identify_intersections,
    identify_traffic_signals,
    classify_nodes,
    is_traffic_signal,
)
from backend.routing.network_validation import (
    validate_network_graph,
    calculate_road_lengths,
)
from backend.routing.road_network import (
    is_graph_available_locally,
    load_network_graph,
    get_network_status,
    get_network_summary,
    save_network_metadata,
)

client = TestClient(app)


@pytest.fixture
def sample_synthetic_graph() -> nx.MultiDiGraph:
    """
    Creates a small, deterministic synthetic road network covering representative
    coordinates of Chandigarh, Mohali, Panchkula, Zirakpur, Kharar, New Chandigarh, and Dera Bassi.
    Requires ZERO network calls.
    """
    G = nx.MultiDiGraph(crs="EPSG:4326")

    # Nodes corresponding to key Tricity locations
    nodes_data = {
        101: {"x": 76.7794, "y": 30.7333, "highway": "traffic_signals"},  # Chandigarh center (signalized 4-way)
        102: {"x": 76.7179, "y": 30.7046},  # Mohali (unsignalized 3-way)
        103: {"x": 76.8606, "y": 30.6942, "highway": "traffic_signals"},  # Panchkula (signalized 3-way)
        104: {"x": 76.8173, "y": 30.6425},  # Zirakpur (3-way junction: connects 101, 103, 107)
        105: {"x": 76.6411, "y": 30.7499},  # Kharar (3-way junction)
        106: {"x": 76.7150, "y": 30.8050},  # New Chandigarh (corridor transition / dead-end spur)
        107: {"x": 76.8444, "y": 30.5833},  # Dera Bassi (terminal node)
        108: {"x": 76.7500, "y": 30.7200, "highway": "traffic_signals"},  # Mid-block pedestrian signal
    }

    for nid, attrs in nodes_data.items():
        G.add_node(nid, **attrs)

    # Directed edges connecting the nodes
    edges_data = [
        # Chandigarh <-> Mohali (Two-way, osmid 1001)
        (101, 102, {"osmid": 1001, "length": 6500.0, "highway": "primary", "oneway": False}),
        (102, 101, {"osmid": 1001, "length": 6500.0, "highway": "primary", "oneway": False}),
        # Chandigarh <-> Panchkula (Two-way, osmid 1002)
        (101, 103, {"osmid": 1002, "length": 8200.0, "highway": "trunk", "oneway": False}),
        (103, 101, {"osmid": 1002, "length": 8200.0, "highway": "trunk", "oneway": False}),
        # Chandigarh <-> Zirakpur (One-way, osmid 1003)
        (101, 104, {"osmid": 1003, "length": 11000.0, "highway": "primary", "oneway": True}),
        # Panchkula <-> Zirakpur bypass (Two-way, osmid 1004)
        (103, 104, {"osmid": 1004, "length": 5000.0, "highway": "trunk", "oneway": False}),
        (104, 103, {"osmid": 1004, "length": 5000.0, "highway": "trunk", "oneway": False}),
        # Panchkula <-> New Chandigarh bypass connector (Two-way, osmid 1010)
        (103, 106, {"osmid": 1010, "length": 7000.0, "highway": "trunk", "oneway": False}),
        (106, 103, {"osmid": 1010, "length": 7000.0, "highway": "trunk", "oneway": False}),
        # Mohali <-> Kharar (Two-way, osmid 1005)
        (102, 105, {"osmid": 1005, "length": 7800.0, "highway": "trunk", "oneway": False}),
        (105, 102, {"osmid": 1005, "length": 7800.0, "highway": "trunk", "oneway": False}),
        # Chandigarh <-> Kharar (Two-way, osmid 1011)
        (101, 105, {"osmid": 1011, "length": 8000.0, "highway": "trunk", "oneway": False}),
        (105, 101, {"osmid": 1011, "length": 8000.0, "highway": "trunk", "oneway": False}),
        # Chandigarh <-> New Chandigarh (Two-way, osmid 1006)
        (101, 106, {"osmid": 1006, "length": 9500.0, "highway": "secondary", "oneway": False}),
        (106, 101, {"osmid": 1006, "length": 9500.0, "highway": "secondary", "oneway": False}),
        # Zirakpur <-> Dera Bassi (One-way, osmid 1007)
        (104, 107, {"osmid": 1007, "length": 7200.0, "highway": "trunk", "oneway": True}),
        # Mid-block pedestrian signal link (One-way through node 108)
        (101, 108, {"osmid": 1008, "length": 300.0, "highway": "residential", "oneway": True}),
        (108, 102, {"osmid": 1009, "length": 6200.0, "highway": "residential", "oneway": True}),
    ]

    for u, v, attrs in edges_data:
        G.add_edge(u, v, **attrs)

    return G


# =========================================================================
# Phase 9.1.1: Core Topology-Aware Intersection Detector Unit Tests
# =========================================================================

def test_straight_two_way_road_intermediate_nodes():
    """
    Test 1: Straight two-way road with intermediate nodes.
    A <==> B <==> C
    Node B has in_degree=2, out_degree=2, total directed degree=4.
    Verify that node B is classified as an INTERMEDIATE through node (physical_degree=2),
    and NOT an intersection, despite having directed degree 4.
    """
    G = nx.MultiDiGraph()
    G.add_node("A", x=76.70, y=30.70)
    G.add_node("B", x=76.71, y=30.70)
    G.add_node("C", x=76.72, y=30.70)

    # Reciprocal two-way edges
    G.add_edge("A", "B", length=100.0, oneway=False)
    G.add_edge("B", "A", length=100.0, oneway=False)
    G.add_edge("B", "C", length=100.0, oneway=False)
    G.add_edge("C", "B", length=100.0, oneway=False)

    # Directed degrees
    assert G.in_degree("B") == 2
    assert G.out_degree("B") == 2
    assert G.degree("B") == 4  # Directed degree is 4!

    # Physical topology
    assert get_undirected_neighbors(G, "B") == {"A", "C"}
    assert get_physical_degree(G, "B") == 2

    # Node classification
    res = classify_nodes(G)
    assert res["topological_intersections_count"] == 0  # Zero intersections!
    assert res["intermediate_nodes_count"] == 1  # Node B
    assert res["dead_end_nodes_count"] == 2  # Nodes A and C


def test_three_way_intersection():
    """
    Test 2: Three-way intersection (T-junction or Y-junction).
    Center node T connects to branches N1, N2, N3.
    Verify physical_degree == 3, classified as an intersection.
    """
    G = nx.MultiDiGraph()
    G.add_node("T", x=76.75, y=30.75)
    for i in range(1, 4):
        G.add_node(f"N{i}", x=76.75 + i * 0.01, y=30.75)
        G.add_edge("T", f"N{i}", length=150.0, oneway=False)
        G.add_edge(f"N{i}", "T", length=150.0, oneway=False)

    assert get_physical_degree(G, "T") == 3
    intersections = identify_intersections(G, min_streets=3)
    assert len(intersections) == 1
    assert intersections[0]["node_id"] == "T"
    assert intersections[0]["physical_degree"] == 3


def test_four_way_intersection():
    """
    Test 3: Four-way intersection (crossroad).
    Center node X connects to 4 approaches (North, South, East, West).
    Verify physical_degree == 4, classified as an intersection.
    """
    G = nx.MultiDiGraph()
    G.add_node("Center", x=76.77, y=30.73)
    for direction, (dx, dy) in [("N", (0, 0.01)), ("S", (0, -0.01)), ("E", (0.01, 0)), ("W", (-0.01, 0))]:
        G.add_node(direction, x=76.77 + dx, y=30.73 + dy)
        G.add_edge("Center", direction, length=200.0, oneway=False)
        G.add_edge(direction, "Center", length=200.0, oneway=False)

    assert get_physical_degree(G, "Center") == 4
    res = classify_nodes(G)
    assert res["topological_intersections_count"] == 1
    assert res["dead_end_nodes_count"] == 4


def test_one_way_road():
    """
    Test 4: One-way road: A -> B -> C.
    Verify intermediate node B has in_degree=1, out_degree=1, physical_degree=2.
    Verify B is classified as an intermediate through node, NOT an intersection.
    """
    G = nx.MultiDiGraph()
    G.add_node("A", x=76.70, y=30.70)
    G.add_node("B", x=76.71, y=30.70)
    G.add_node("C", x=76.72, y=30.70)
    G.add_edge("A", "B", length=120.0, oneway=True)
    G.add_edge("B", "C", length=120.0, oneway=True)

    assert get_physical_degree(G, "B") == 2
    res = classify_nodes(G)
    assert res["topological_intersections_count"] == 0
    assert res["intermediate_nodes_count"] == 1
    assert res["dead_end_nodes_count"] == 2  # A is source, C is sink


def test_two_parallel_road_segments():
    """
    Test 5: Two parallel road segments between nodes A and B.
    E.g. A and B connected by dual carriageway / divided lanes (k=0 and k=1).
    Verify that parallel edges between the same two nodes DO NOT inflate physical degree.
    """
    G = nx.MultiDiGraph()
    G.add_node("A", x=76.70, y=30.70)
    G.add_node("B", x=76.71, y=30.70)

    # 3 directed edges between A and B
    G.add_edge("A", "B", key=0, length=100.0)
    G.add_edge("A", "B", key=1, length=100.0)
    G.add_edge("B", "A", key=0, length=100.0)

    assert G.degree("A") == 3
    assert G.degree("B") == 3

    # Physical neighbors: only 1 distinct neighbor!
    assert get_undirected_neighbors(G, "A") == {"B"}
    assert get_physical_degree(G, "A") == 1
    assert get_physical_degree(G, "B") == 1

    res = classify_nodes(G)
    assert res["topological_intersections_count"] == 0  # No intersection
    assert res["dead_end_nodes_count"] == 2


def test_dead_end_road():
    """
    Test 6: Dead-end road (cul-de-sac).
    Main road M connects to cul-de-sac terminal node D.
    Verify D has physical_degree == 1 (dead end).
    """
    G = nx.MultiDiGraph()
    G.add_node("M", x=76.70, y=30.70)
    G.add_node("D", x=76.70, y=30.71)
    G.add_edge("M", "D", length=80.0, oneway=False)
    G.add_edge("D", "M", length=80.0, oneway=False)

    assert get_physical_degree(G, "D") == 1
    res = classify_nodes(G)
    assert res["dead_end_nodes_count"] == 2  # Both M and D in this 2-node graph
    assert res["topological_intersections_count"] == 0


def test_complex_intersection_with_multiple_edges():
    """
    Test 7: Complex intersection with multiple edges, parallel lanes, and a self-loop.
    Center node J connects to 4 directions:
    - Direction 1: parallel lanes (2 edges)
    - Direction 2: reciprocal two-way (2 edges)
    - Direction 3: one-way inbound (1 edge)
    - Direction 4: one-way outbound (1 edge)
    - Self-loop on J (J -> J)
    Total directed edges on J = 7.
    Verify physical_degree == 4 (self-loop discarded, parallel edges collapsed).
    """
    G = nx.MultiDiGraph()
    G.add_node("J", x=76.75, y=30.75)
    for i in range(1, 5):
        G.add_node(f"D{i}", x=76.75 + i * 0.01, y=30.75)

    # Direction 1: parallel lanes
    G.add_edge("J", "D1", key=0, length=100.0)
    G.add_edge("J", "D1", key=1, length=100.0)

    # Direction 2: reciprocal
    G.add_edge("J", "D2", key=0, length=100.0)
    G.add_edge("D2", "J", key=0, length=100.0)

    # Direction 3: inbound
    G.add_edge("D3", "J", key=0, length=100.0)

    # Direction 4: outbound
    G.add_edge("J", "D4", key=0, length=100.0)

    # Self-loop
    G.add_edge("J", "J", key=0, length=20.0)

    assert get_physical_degree(G, "J") == 4
    intersections = identify_intersections(G, min_streets=3)
    assert len(intersections) == 1
    assert intersections[0]["node_id"] == "J"
    assert intersections[0]["physical_degree"] == 4


def test_traffic_signal_independent_of_intersection():
    """
    Verify that mapped traffic signals are counted independently of intersection status.
    - Signal 1: on a 4-way intersection (signalized intersection).
    - Signal 2: on a 2-leg through road (mid-block pedestrian crossing).
    - Intersection 3: 3-way junction without a signal (unsignalized intersection).
    """
    G = nx.MultiDiGraph()
    # Signalized 4-way intersection (Node 1)
    G.add_node(1, x=76.70, y=30.70, highway="traffic_signals")
    for i in [11, 12, 13, 14]:
        G.add_node(i, x=76.70, y=30.70)
        G.add_edge(1, i, length=50.0)
        G.add_edge(i, 1, length=50.0)

    # Mid-block pedestrian signal on straight through road (Node 2)
    G.add_node(2, x=76.75, y=30.75, highway="traffic_signals")
    G.add_node(21, x=76.74, y=30.75)
    G.add_node(22, x=76.76, y=30.75)
    G.add_edge(21, 2, length=100.0)
    G.add_edge(2, 22, length=100.0)

    # Unsignalized 3-way intersection (Node 3)
    G.add_node(3, x=76.80, y=30.80)
    for i in [31, 32, 33]:
        G.add_node(i, x=76.80, y=30.80)
        G.add_edge(3, i, length=70.0)
        G.add_edge(i, 3, length=70.0)

    res = classify_nodes(G)
    assert res["traffic_signals_count"] == 2
    assert res["topological_intersections_count"] == 2  # Nodes 1 and 3
    assert res["signalized_intersections_count"] == 1  # Node 1
    assert res["unsignalized_intersections_count"] == 1  # Node 3
    assert res["midblock_signals_count"] == 1  # Node 2 (physical_degree=2 with signal)


# =========================================================================
# Phase 9.1.1: Physical Road Length Deduplication Tests
# =========================================================================

def test_physical_road_length_deduplication():
    """
    Verify that calculate_road_lengths separates directed edge length from
    unique physical road length.
    - Two-way road of 1000m has 2 directed edges of 1000m each -> directed: 2.0 km, physical: 1.0 km.
    - One-way road of 500m has 1 directed edge of 500m -> directed: 0.5 km, physical: 0.5 km.
    Total directed: 2.5 km. Total unique physical: 1.5 km.
    """
    G = nx.MultiDiGraph()
    G.add_node(1, x=76.70, y=30.70)
    G.add_node(2, x=76.71, y=30.70)
    G.add_node(3, x=76.72, y=30.70)

    # Two-way road (1 <-> 2), 1000m
    G.add_edge(1, 2, osmid=501, length=1000.0, oneway=False)
    G.add_edge(2, 1, osmid=501, length=1000.0, oneway=False)

    # One-way road (2 -> 3), 500m
    G.add_edge(2, 3, osmid=502, length=500.0, oneway=True)

    lengths = calculate_road_lengths(G)
    assert lengths["directed_edge_length_km"] == 2.5
    assert lengths["total_road_length_km"] == 2.5
    assert lengths["estimated_unique_physical_road_length_km"] == 1.5
    assert lengths["reciprocal_pairs_count"] == 1
    assert lengths["unpaired_directed_edges_count"] == 1
    assert lengths["total_directed_edges_count"] == 3


# =========================================================================
# Existing Integration Tests with Audited Fixtures
# =========================================================================

def test_is_traffic_signal():
    """Verify traffic signal tag parser handles strings, lists, and missing tags."""
    assert is_traffic_signal({"highway": "traffic_signals"}) is True
    assert is_traffic_signal({"highway": ["traffic_signals", "crossing"]}) is True
    assert is_traffic_signal({"highway": "crossing"}) is False
    assert is_traffic_signal({}) is False


def test_intersection_and_signal_identification(sample_synthetic_graph):
    """Verify topological intersections and mapped traffic signals are separated."""
    signals = identify_traffic_signals(sample_synthetic_graph)
    signal_ids = {s["node_id"] for s in signals}
    assert signal_ids == {101, 103, 108}

    intersections = identify_intersections(sample_synthetic_graph, min_streets=3)
    intersection_ids = {i["node_id"] for i in intersections}
    assert 101 in intersection_ids  # 4-way signalized
    assert 102 in intersection_ids  # 3-way unsignalized
    assert 103 in intersection_ids  # 3-way signalized
    assert 104 in intersection_ids  # 3-way unsignalized
    assert 105 not in intersection_ids  # degree 2 corridor
    assert 106 not in intersection_ids  # degree 2 corridor
    assert 107 not in intersection_ids  # degree 1 dead end terminal
    assert 108 not in intersection_ids  # degree 2 mid-block signal


def test_node_classification(sample_synthetic_graph):
    """Verify comprehensive node classification separates signals from junctions."""
    classified = classify_nodes(sample_synthetic_graph)

    assert classified["total_nodes"] == 8
    assert classified["traffic_signals_count"] == 3
    assert classified["topological_intersections_count"] == 4  # Nodes 101, 102, 103, 104
    assert classified["signalized_intersections_count"] == 2  # Nodes 101 and 103
    assert classified["unsignalized_intersections_count"] == 2  # Nodes 102 and 104
    assert classified["midblock_signals_count"] == 1  # Node 108
    assert classified["dead_end_nodes_count"] == 1  # Node 107
    assert classified["intermediate_nodes_count"] == 3  # Nodes 105, 106, 108
    assert classified["ambiguous_nodes_count"] == 0


def test_graph_validation_success_on_valid_synthetic_graph(sample_synthetic_graph):
    """Verify validation passes on a valid graph and includes both length metrics."""
    report = validate_network_graph(sample_synthetic_graph, target_areas=TARGET_AREAS, max_area_distance_km=5.0)

    assert report["is_valid"] is True
    assert report["node_count"] == 8
    assert report["edge_count"] == 18
    assert report["errors"] == []
    assert report["edge_metrics"]["negative_length_edges"] == 0
    assert report["edge_metrics"]["invalid_length_edges"] == 0
    assert report["edge_metrics"]["directed_edge_length_km"] > 0
    assert report["edge_metrics"]["estimated_unique_physical_road_length_km"] > 0
    assert (
        report["edge_metrics"]["estimated_unique_physical_road_length_km"]
        < report["edge_metrics"]["directed_edge_length_km"]
    )
    assert report["target_area_coverage"]["all_targets_covered"] is True


def test_graph_validation_detects_empty_graph():
    """Verify validation fails when graph contains zero nodes."""
    empty_graph = nx.MultiDiGraph()
    report = validate_network_graph(empty_graph)
    assert report["is_valid"] is False
    assert any("0 nodes" in err for err in report["errors"])


def test_graph_validation_detects_invalid_edge_lengths(sample_synthetic_graph):
    """Verify validation flags negative and NaN edge lengths."""
    bad_graph = sample_synthetic_graph.copy()
    bad_graph.add_edge(101, 105, length=-500.0, highway="secondary")
    bad_graph.add_edge(102, 106, length=float("nan"), highway="secondary")

    report = validate_network_graph(bad_graph)
    assert report["is_valid"] is False
    assert any("negative lengths" in err for err in report["errors"])
    assert any("NaN, infinite" in err for err in report["errors"])


def test_graph_validation_detects_invalid_coordinates(sample_synthetic_graph):
    """Verify validation flags missing or out-of-range coordinates."""
    bad_coords_graph = sample_synthetic_graph.copy()
    bad_coords_graph.nodes[101]["y"] = 999.0

    report = validate_network_graph(bad_coords_graph)
    assert report["is_valid"] is False
    assert any("invalid geographic coordinates" in err for err in report["errors"])


def test_graphml_save_and_load_roundtrip(sample_synthetic_graph):
    """Verify GraphML save and load preserves nodes, edges, coordinates, and tags."""
    import osmnx as ox

    with tempfile.TemporaryDirectory() as td:
        graphml_file = os.path.join(td, "test_tricity.graphml")
        ox.save_graphml(sample_synthetic_graph, graphml_file)

        assert os.path.exists(graphml_file)
        assert os.path.getsize(graphml_file) > 0

        loaded_G = ox.load_graphml(graphml_file)
        assert len(loaded_G.nodes) == len(sample_synthetic_graph.nodes)
        assert len(loaded_G.edges) == len(sample_synthetic_graph.edges)
        assert loaded_G.nodes[101]["highway"] == "traffic_signals"


def test_load_network_graph_missing_raises_error():
    """Verify attempting to load a non-existent graph file raises FileNotFoundError."""
    with pytest.raises(FileNotFoundError) as exc_info:
        load_network_graph(graph_path="/non/existent/path/graph.graphml", reload=True)
    assert "not found" in str(exc_info.value).lower()


def test_api_routing_network_status_endpoint():
    """Verify GET /routing/network/status returns valid JSON and never triggers download."""
    response = client.get("/routing/network/status")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "available_locally" in data


def test_api_routing_network_summary_endpoint():
    """Verify GET /routing/network/summary returns structured summary with audited fields."""
    response = client.get("/routing/network/summary")
    assert response.status_code in (200, 404)
    data = response.json()
    assert "status" in data
    assert "available_locally" in data
    if data.get("available_locally"):
        assert "directed_edge_length_km" in data
        assert "estimated_unique_physical_road_length_km" in data
        assert "intersection_count" in data
        assert "dead_end_count" in data
        assert "mapped_traffic_signal_count" in data
        assert "weakly_connected_component_count" in data


def test_api_routing_network_build_avoids_accidental_download():
    """
    Verify POST /routing/network/build with force=False returns existing status
    if the graph already exists, avoiding repeated external network requests.
    """
    response = client.post("/routing/network/build", json={"force": False})
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["action"] == "already_built"

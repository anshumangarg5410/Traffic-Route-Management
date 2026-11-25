"""
Junction and Traffic Signal Detector
====================================

Phase 9.1 & 9.1.1: Topology-Aware Physical Intersection and Mapped Signal Detection.

Differentiates:
1. Physical connectivity from directed graph degree representation:
   - Evaluates physical connectivity using distinct undirected neighbor nodes.
   - Avoids double-counting reciprocal edges (u -> v and v -> u) on two-way streets.
   - Avoids inflating junction degree from multiple parallel edges between the same nodes.
   - Discards self-loops (u -> u).
2. Topological road categories:
   - Dead-ends / cul-de-sacs (physical degree = 1).
   - Ordinary intermediate / through nodes (physical degree = 2).
   - Topological intersections (physical degree >= 3): 3-way, 4-way, 5-way+ junctions.
   - Isolated nodes (physical degree = 0).
3. Mapped traffic signals:
   - Nodes explicitly carrying OpenStreetMap highway=traffic_signals tag.
   - Evaluated strictly independently from topological intersection classification.
"""

from typing import Dict, Any, List, Set
import networkx as nx


def is_traffic_signal(node_attrs: Dict[str, Any]) -> bool:
    """
    Check if a node has the OpenStreetMap highway=traffic_signals tag.
    Handles string, list (from merged ways/nodes), and missing values.
    """
    hw = node_attrs.get("highway")
    if hw is None:
        return False
    if isinstance(hw, str):
        return hw == "traffic_signals"
    if isinstance(hw, (list, set, tuple)):
        return "traffic_signals" in hw
    return False


def get_node_coordinates(node_id: Any, node_attrs: Dict[str, Any]) -> tuple[float, float]:
    """Extract (lat, lon) from node attributes (y=lat, x=lon in OSMnx)."""
    lat = float(node_attrs.get("y", 0.0))
    lon = float(node_attrs.get("x", 0.0))
    return lat, lon


def get_undirected_neighbors(G: nx.MultiDiGraph, node: Any) -> Set[Any]:
    """
    Get the set of distinct physical neighbor nodes connected to `node` in either direction.
    
    Distinguishes physical connectivity from directed representation:
    - Avoids double-counting reciprocal edges (u -> v and v -> u).
    - Avoids inflating branch count from parallel edges (multiple ways between u and v).
    - Discards self-loops (u -> u).
    """
    neighbors = set()
    if G.has_node(node):
        neighbors.update(G.successors(node))
        neighbors.update(G.predecessors(node))
    neighbors.discard(node)  # Exclude self-loops
    return neighbors


def get_physical_degree(G: nx.MultiDiGraph, node: Any) -> int:
    """
    Calculate the physical degree (number of distinct connected physical road legs)
    for a node in a directed MultiDiGraph.
    """
    return len(get_undirected_neighbors(G, node))


def identify_traffic_signals(G: nx.MultiDiGraph) -> List[Dict[str, Any]]:
    """
    Extract all nodes explicitly tagged as highway=traffic_signals in OpenStreetMap.
    Evaluates physical degree and intersection classification independently of the signal tag.
    """
    signals = []
    for node, data in G.nodes(data=True):
        if is_traffic_signal(data):
            lat, lon = get_node_coordinates(node, data)
            physical_degree = get_physical_degree(G, node)
            signals.append({
                "node_id": node,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "physical_degree": physical_degree,
                "street_count": physical_degree,  # Backwards compatibility
                "is_intersection": physical_degree >= 3,
                "highway": data.get("highway"),
                "ref": data.get("ref"),
            })
    return signals


def identify_intersections(G: nx.MultiDiGraph, min_streets: int = 3) -> List[Dict[str, Any]]:
    """
    Extract all topological road intersections from the graph based on physical topology.
    A node is considered an intersection if it connects to `min_streets` or more
    distinct physical street legs.
    """
    intersections = []
    for node, data in G.nodes(data=True):
        physical_degree = get_physical_degree(G, node)

        if physical_degree >= min_streets:
            lat, lon = get_node_coordinates(node, data)
            intersections.append({
                "node_id": node,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "physical_degree": physical_degree,
                "street_count": physical_degree,  # Backwards compatibility
                "directed_in_degree": G.in_degree(node) if G.has_node(node) else 0,
                "directed_out_degree": G.out_degree(node) if G.has_node(node) else 0,
                "has_traffic_signal": is_traffic_signal(data),
            })
    return intersections


def classify_nodes(G: nx.MultiDiGraph) -> Dict[str, Any]:
    """
    Perform a complete topological and semantic classification of all nodes in G:
    - Confirmed mapped traffic signals
    - Topological intersections (physical degree >= 3)
    - Signalized intersections (intersection + signal)
    - Unsignalized intersections (intersection without signal)
    - Mid-block signals (signals at nodes with physical degree < 3)
    - Dead-end / terminal nodes (physical degree == 1)
    - Intermediate / through nodes (physical degree == 2)
    - Isolated nodes (physical degree == 0)
    - Ambiguous / missing coordinate nodes
    """
    total_nodes = len(G.nodes)
    if total_nodes == 0:
        return {
            "total_nodes": 0,
            "traffic_signals_count": 0,
            "topological_intersections_count": 0,
            "signalized_intersections_count": 0,
            "unsignalized_intersections_count": 0,
            "midblock_signals_count": 0,
            "dead_end_nodes_count": 0,
            "intermediate_nodes_count": 0,
            "isolated_nodes_count": 0,
            "ambiguous_nodes_count": 0,
            "sample_signals": [],
            "sample_intersections": [],
        }

    signals_count = 0
    intersections_count = 0
    signalized_intersections = 0
    unsignalized_intersections = 0
    midblock_signals = 0
    dead_ends = 0
    intermediate = 0
    isolated = 0
    ambiguous = 0

    sample_signals = []
    sample_intersections = []

    for node, data in G.nodes(data=True):
        lat = data.get("y")
        lon = data.get("x")
        if lat is None or lon is None:
            ambiguous += 1
            continue

        physical_degree = get_physical_degree(G, node)
        has_signal = is_traffic_signal(data)
        is_junction = physical_degree >= 3

        if has_signal:
            signals_count += 1
            if len(sample_signals) < 10:
                sample_signals.append({
                    "node_id": node,
                    "lat": round(float(lat), 6),
                    "lon": round(float(lon), 6),
                    "physical_degree": physical_degree,
                    "street_count": physical_degree,
                    "is_intersection": is_junction,
                })

        if is_junction:
            intersections_count += 1
            if has_signal:
                signalized_intersections += 1
            else:
                unsignalized_intersections += 1

            if len(sample_intersections) < 10:
                sample_intersections.append({
                    "node_id": node,
                    "lat": round(float(lat), 6),
                    "lon": round(float(lon), 6),
                    "physical_degree": physical_degree,
                    "street_count": physical_degree,
                    "has_signal": has_signal,
                })
        else:
            if has_signal:
                midblock_signals += 1

            if physical_degree == 0:
                isolated += 1
            elif physical_degree == 1:
                dead_ends += 1
            elif physical_degree == 2:
                intermediate += 1

    return {
        "total_nodes": total_nodes,
        "traffic_signals_count": signals_count,
        "topological_intersections_count": intersections_count,
        "signalized_intersections_count": signalized_intersections,
        "unsignalized_intersections_count": unsignalized_intersections,
        "midblock_signals_count": midblock_signals,
        "dead_end_nodes_count": dead_ends,
        "intermediate_nodes_count": intermediate,
        "isolated_nodes_count": isolated,
        "ambiguous_nodes_count": ambiguous,
        "sample_signals": sample_signals,
        "sample_intersections": sample_intersections,
    }

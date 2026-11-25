"""
Route-Level Intersection and Traffic-Signal Analysis Service
===========================================================

Phase 9.3: Route-Level Intersection and Traffic-Signal Analysis.

Accepts candidate driving route geometries, matches them against the local
Chandigarh Tricity OpenStreetMap road network, and enriches each route with:
1. Total matched topological intersection nodes (physical degree >= 3).
2. OSM-mapped traffic-signal nodes (highway=traffic_signals).
3. Unsignalized intersection nodes.
4. Intersection density per kilometer.
5. Ordered sequence of matched intersections sorted by cumulative distance along route.
6. Traceable OSM node IDs, coordinates, and perpendicular distance from route.
7. Deduplication of adjacent segment matches while preserving distinct passes along looping routes.
"""

from typing import Dict, Any, List, Optional, Tuple, Union
import math
import networkx as nx
from scipy.spatial import cKDTree

from backend.routing.config import (
    ROUTE_MATCHING_TOLERANCE_M,
    ROUTE_MATCHING_SAMPLE_STEP_M,
    ROUTE_LOOP_DEDUPLICATION_WINDOW_M,
)
from backend.routing.junction_detector import get_physical_degree, is_traffic_signal
from backend.routing.models import (
    GeoJSONGeometry,
    RouteResult,
    MatchedIntersection,
    RouteIntersectionAnalysis,
)
from backend.routing.road_network import load_network_graph, is_graph_available_locally

# Earth radius and regional projection origin for high-precision local metric conversion
R_EARTH = 6371000.0  # meters
REF_LAT = 30.70
REF_LON = 76.76
COS_REF_LAT = math.cos(math.radians(REF_LAT))

# Cached spatial index for topological intersections
_INTERSECTION_INDEX: Optional[cKDTree] = None
_INTERSECTION_NODE_IDS: Optional[List[Any]] = None
_INTERSECTION_NODE_LATS: Optional[List[float]] = None
_INTERSECTION_NODE_LONS: Optional[List[float]] = None
_INTERSECTION_NODE_IS_SIGNAL: Optional[List[bool]] = None
_INTERSECTION_NODE_TAGS: Optional[List[Dict[str, Any]]] = None
_INTERSECTION_GRAPH_ID: Optional[int] = None


def _to_local_xy(lat: float, lon: float) -> Tuple[float, float]:
    """
    Project (lat, lon) in decimal degrees to local Cartesian (x, y) coordinates in meters.
    Over a 35 km x 35 km city region, projection scale distortion is < 0.05%, making
    point-to-segment Euclidean distance calculations exact to within centimeters.
    """
    x = math.radians(lon - REF_LON) * R_EARTH * COS_REF_LAT
    y = math.radians(lat - REF_LAT) * R_EARTH
    return x, y


def _point_to_segment(
    px: float, py: float,
    x1: float, y1: float,
    x2: float, y2: float
) -> Tuple[float, float]:
    """
    Compute perpendicular distance from point (px, py) to line segment (x1, y1)-(x2, y2),
    and normalized progression factor t in [0.0, 1.0].
    """
    dx = x2 - x1
    dy = y2 - y1
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq <= 1e-12:
        return math.hypot(px - x1, py - y1), 0.0

    t = ((px - x1) * dx + (py - y1) * dy) / seg_len_sq
    t_clamped = max(0.0, min(1.0, t))
    proj_x = x1 + t_clamped * dx
    proj_y = y1 + t_clamped * dy
    dist = math.hypot(px - proj_x, py - proj_y)
    return dist, t_clamped


def invalidate_intersection_index() -> None:
    """Clear the cached intersection spatial index."""
    global _INTERSECTION_INDEX, _INTERSECTION_NODE_IDS, _INTERSECTION_NODE_LATS, _INTERSECTION_NODE_LONS
    global _INTERSECTION_NODE_IS_SIGNAL, _INTERSECTION_NODE_TAGS, _INTERSECTION_GRAPH_ID

    _INTERSECTION_INDEX = None
    _INTERSECTION_NODE_IDS = None
    _INTERSECTION_NODE_LATS = None
    _INTERSECTION_NODE_LONS = None
    _INTERSECTION_NODE_IS_SIGNAL = None
    _INTERSECTION_NODE_TAGS = None
    _INTERSECTION_GRAPH_ID = None


def get_intersection_spatial_index(
    G: nx.MultiDiGraph,
) -> Tuple[cKDTree, List[Any], List[float], List[float], List[bool], List[Dict[str, Any]]]:
    """
    Build or retrieve the cached in-memory 2D cKDTree spatial index of topological
    intersection nodes (physical degree >= 3) in G.
    """
    global _INTERSECTION_INDEX, _INTERSECTION_NODE_IDS, _INTERSECTION_NODE_LATS, _INTERSECTION_NODE_LONS
    global _INTERSECTION_NODE_IS_SIGNAL, _INTERSECTION_NODE_TAGS, _INTERSECTION_GRAPH_ID

    if _INTERSECTION_INDEX is not None and _INTERSECTION_GRAPH_ID == id(G):
        return (
            _INTERSECTION_INDEX,
            _INTERSECTION_NODE_IDS,
            _INTERSECTION_NODE_LATS,
            _INTERSECTION_NODE_LONS,
            _INTERSECTION_NODE_IS_SIGNAL,
            _INTERSECTION_NODE_TAGS,
        )

    node_ids = []
    lats = []
    lons = []
    is_signal = []
    tags = []
    coords_xy = []

    for n, d in G.nodes(data=True):
        y = d.get("y")
        x = d.get("x")
        if y is None or x is None:
            continue

        # Topology-aware physical intersection check (physical degree >= 3)
        if get_physical_degree(G, n) >= 3:
            lat = float(y)
            lon = float(x)
            xm, ym = _to_local_xy(lat, lon)
            has_sig = is_traffic_signal(d)

            node_ids.append(n)
            lats.append(lat)
            lons.append(lon)
            is_signal.append(has_sig)
            tags.append({k: v for k, v in d.items() if k not in ("x", "y")})
            coords_xy.append((xm, ym))

    if not coords_xy:
        # Fallback empty index if graph has no intersection nodes
        tree = cKDTree([(0.0, 0.0)])
    else:
        tree = cKDTree(coords_xy)

    _INTERSECTION_INDEX = tree
    _INTERSECTION_NODE_IDS = node_ids
    _INTERSECTION_NODE_LATS = lats
    _INTERSECTION_NODE_LONS = lons
    _INTERSECTION_NODE_IS_SIGNAL = is_signal
    _INTERSECTION_NODE_TAGS = tags
    _INTERSECTION_GRAPH_ID = id(G)

    return tree, node_ids, lats, lons, is_signal, tags


def deduplicate_node_passes(
    hits: List[Dict[str, Any]],
    window_m: float = ROUTE_LOOP_DEDUPLICATION_WINDOW_M,
) -> List[Dict[str, Any]]:
    """
    Deduplicate multiple segment hits for the same node within window_m of cumulative
    progression (e.g. entering and leaving an intersection across adjacent segments),
    while preserving distinct visits along looping routes separated by > window_m.
    """
    if not hits:
        return []

    hits_by_node: Dict[Any, List[Dict[str, Any]]] = {}
    for h in hits:
        hits_by_node.setdefault(h["node_id"], []).append(h)

    final_passes = []
    for node_id, node_hits in hits_by_node.items():
        # Sort by distance along route
        node_hits.sort(key=lambda x: x["dist_along"])

        # Cluster hits that belong to the same crossing
        clusters: List[List[Dict[str, Any]]] = []
        current_cluster = [node_hits[0]]
        for h in node_hits[1:]:
            if h["dist_along"] - current_cluster[-1]["dist_along"] <= window_m:
                current_cluster.append(h)
            else:
                clusters.append(current_cluster)
                current_cluster = [h]
        if current_cluster:
            clusters.append(current_cluster)

        # For each cluster (distinct traversal), pick the point of closest approach
        for c in clusters:
            best_hit = min(c, key=lambda x: x["dist_from"])
            final_passes.append(best_hit)

    # Sort all preserved passes in travel order along route
    final_passes.sort(key=lambda x: x["dist_along"])
    return final_passes


def analyze_route_intersections(
    route: Union[RouteResult, GeoJSONGeometry, List[List[float]]],
    route_distance_km: Optional[float] = None,
    G: Optional[nx.MultiDiGraph] = None,
    tolerance_m: float = ROUTE_MATCHING_TOLERANCE_M,
    sample_step_m: float = ROUTE_MATCHING_SAMPLE_STEP_M,
    loop_dedup_window_m: float = ROUTE_LOOP_DEDUPLICATION_WINDOW_M,
) -> RouteIntersectionAnalysis:
    """
    Analyze a candidate driving route's GeoJSON geometry against the local OSM road network.
    
    Identifies:
    - Topological intersection nodes (physical degree >= 3)
    - OSM-mapped traffic signals (highway=traffic_signals)
    - Unsignalized intersections
    - Cumulative distance along the route for each intersection
    - Distance from route polyline
    - Travel-ordered list of matched junctions
    """
    # 1. Extract coordinates and distance
    if isinstance(route, RouteResult):
        coords = route.geometry.coordinates
        dist_km = route.distance_km
    elif isinstance(route, GeoJSONGeometry):
        coords = route.coordinates
        dist_km = route_distance_km
    elif isinstance(route, list):
        coords = route
        dist_km = route_distance_km
    else:
        coords = []
        dist_km = route_distance_km

    # Validate route geometry
    if not isinstance(coords, list) or len(coords) < 2:
        return RouteIntersectionAnalysis(
            total_intersection_nodes=0,
            signalized_intersection_nodes=0,
            unsignalized_intersection_nodes=0,
            intersection_density_per_km=0.0,
            matched_intersections=[],
            analysis_status="invalid_geometry",
            analysis_warnings=["Route geometry must contain at least 2 coordinate points."],
        )

    # 2. Acquire road network graph
    active_graph = G
    if active_graph is None:
        if not is_graph_available_locally():
            return RouteIntersectionAnalysis(
                total_intersection_nodes=0,
                signalized_intersection_nodes=0,
                unsignalized_intersection_nodes=0,
                intersection_density_per_km=0.0,
                matched_intersections=[],
                analysis_status="graph_unavailable",
                analysis_warnings=["Local road network graph is not available on disk. Route analysis could not be performed."],
            )
        try:
            active_graph = load_network_graph()
        except Exception as e:
            return RouteIntersectionAnalysis(
                total_intersection_nodes=0,
                signalized_intersection_nodes=0,
                unsignalized_intersection_nodes=0,
                intersection_density_per_km=0.0,
                matched_intersections=[],
                analysis_status="graph_unavailable",
                analysis_warnings=[f"Failed to load road network graph: {str(e)}"],
            )

    # 3. Retrieve or build spatial index of intersection nodes
    try:
        tree, node_ids, node_lats, node_lons, is_signal, node_tags = get_intersection_spatial_index(active_graph)
    except Exception as e:
        return RouteIntersectionAnalysis(
            total_intersection_nodes=0,
            signalized_intersection_nodes=0,
            unsignalized_intersection_nodes=0,
            intersection_density_per_km=0.0,
            matched_intersections=[],
            analysis_status="error",
            analysis_warnings=[f"Failed to build intersection index: {str(e)}"],
        )

    if not node_ids:
        return RouteIntersectionAnalysis(
            total_intersection_nodes=0,
            signalized_intersection_nodes=0,
            unsignalized_intersection_nodes=0,
            intersection_density_per_km=0.0,
            matched_intersections=[],
            analysis_status="no_intersections_matched",
            analysis_warnings=["Graph contains no topological intersections."],
        )

    # 4. Project route polyline to local Cartesian meters
    xy_points: List[Tuple[float, float]] = []
    for pt in coords:
        try:
            lon, lat = float(pt[0]), float(pt[1])
            xy_points.append(_to_local_xy(lat, lon))
        except (ValueError, TypeError, IndexError):
            continue

    if len(xy_points) < 2:
        return RouteIntersectionAnalysis(
            total_intersection_nodes=0,
            signalized_intersection_nodes=0,
            unsignalized_intersection_nodes=0,
            intersection_density_per_km=0.0,
            matched_intersections=[],
            analysis_status="invalid_geometry",
            analysis_warnings=["Route geometry has fewer than 2 valid numeric coordinate points."],
        )

    # Calculate segment lengths and cumulative progression
    seg_lengths = []
    cum_dists = [0.0]
    for i in range(len(xy_points) - 1):
        x1, y1 = xy_points[i]
        x2, y2 = xy_points[i + 1]
        L = math.hypot(x2 - x1, y2 - y1)
        seg_lengths.append(L)
        cum_dists.append(cum_dists[-1] + L)

    total_polyline_m = cum_dists[-1]

    # 5. Candidate node retrieval via densified sample queries
    sample_pts: List[Tuple[float, float]] = []
    for i in range(len(xy_points) - 1):
        x1, y1 = xy_points[i]
        x2, y2 = xy_points[i + 1]
        L = seg_lengths[i]
        steps = max(1, int(math.ceil(L / sample_step_m)))
        for s in range(steps):
            t = s / steps
            sample_pts.append((x1 + t * (x2 - x1), y1 + t * (y2 - y1)))
    sample_pts.append(xy_points[-1])

    query_radius = tolerance_m + 5.0
    candidate_indices = set()
    for sub in tree.query_ball_point(sample_pts, r=query_radius):
        candidate_indices.update(sub)

    if not candidate_indices:
        effective_km = dist_km if (dist_km and dist_km > 0) else (total_polyline_m / 1000.0)
        return RouteIntersectionAnalysis(
            total_intersection_nodes=0,
            signalized_intersection_nodes=0,
            unsignalized_intersection_nodes=0,
            intersection_density_per_km=0.0,
            matched_intersections=[],
            analysis_status="no_intersections_matched",
            analysis_warnings=[],
        )

    # 6. Point-to-segment distance matching for candidate nodes
    raw_hits: List[Dict[str, Any]] = []

    for c_idx in candidate_indices:
        if c_idx >= len(node_ids):
            continue
        nx_val, ny_val = tree.data[c_idx]

        for i in range(len(xy_points) - 1):
            x1, y1 = xy_points[i]
            x2, y2 = xy_points[i + 1]

            # Fast bounding-box check
            if (nx_val < min(x1, x2) - tolerance_m or nx_val > max(x1, x2) + tolerance_m or
                ny_val < min(y1, y2) - tolerance_m or ny_val > max(y1, y2) + tolerance_m):
                continue

            dist, t_clamped = _point_to_segment(nx_val, ny_val, x1, y1, x2, y2)
            if dist <= tolerance_m:
                dist_along = cum_dists[i] + t_clamped * seg_lengths[i]
                raw_hits.append({
                    "node_idx": c_idx,
                    "node_id": node_ids[c_idx],
                    "lat": node_lats[c_idx],
                    "lon": node_lons[c_idx],
                    "is_signal": is_signal[c_idx],
                    "tags": node_tags[c_idx],
                    "dist_along": dist_along,
                    "dist_from": dist,
                })

    # 7. Deduplicate adjacent segment hits while preserving distinct passes along loops
    deduped_hits = deduplicate_node_passes(raw_hits, window_m=loop_dedup_window_m)

    matched: List[MatchedIntersection] = []
    for item in deduped_hits:
        matched.append(
            MatchedIntersection(
                osm_node_id=item["node_id"],
                latitude=round(item["lat"], 6),
                longitude=round(item["lon"], 6),
                distance_along_route_m=round(item["dist_along"], 1),
                distance_from_route_m=round(item["dist_from"], 1),
                is_signalized=item["is_signal"],
                signal_tags=item["tags"] if item["is_signal"] else None,
            )
        )

    signalized_count = sum(1 for m in matched if m.is_signalized)
    unsignalized_count = len(matched) - signalized_count
    total_count = len(matched)

    effective_km = dist_km if (dist_km and dist_km > 0) else (total_polyline_m / 1000.0)
    density_per_km = round(total_count / effective_km, 2) if effective_km > 0 else 0.0

    warnings = [
        "Intersection counts reflect OpenStreetMap topological nodes (physical degree >= 3) and may exceed physical junction counts on divided roads and complex multi-arm intersections.",
        "Signal counts reflect OpenStreetMap nodes tagged with highway=traffic_signals and do not represent a complete field census of physical traffic signals.",
    ]

    status = "success" if total_count > 0 else "no_intersections_matched"

    return RouteIntersectionAnalysis(
        total_intersection_nodes=total_count,
        signalized_intersection_nodes=signalized_count,
        unsignalized_intersection_nodes=unsignalized_count,
        intersection_density_per_km=density_per_km,
        matched_intersections=matched,
        analysis_status=status,
        analysis_warnings=warnings,
    )

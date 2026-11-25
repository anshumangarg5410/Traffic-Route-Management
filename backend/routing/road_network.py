"""
Road Network Service
====================

Phase 9.1: Regional Road Network Extraction, Persistence, and Inspection.

Handles:
1. Downloading driving road network from OpenStreetMap via OSMnx using the Tricity bounding box.
2. Saving and loading the MultiDiGraph locally in GraphML format.
3. Caching the loaded graph in memory to avoid repeated disk reads.
4. Generating and persisting network metadata JSON with extraction stats and validation results.
5. Providing API-ready status and summary information without triggering unintended downloads.
"""

from datetime import datetime, timezone
import json
import os
import time
from typing import Dict, Any, Optional
import networkx as nx
import osmnx as ox

from backend.routing.config import (
    TRICITY_BBOX,
    DATA_DIR,
    GRAPHML_PATH,
    METADATA_PATH,
    NETWORK_TYPE,
    SIMPLIFY,
    RETAIN_ALL,
    OVERPASS_TIMEOUT,
    NORTH_LAT,
    SOUTH_LAT,
    WEST_LON,
    EAST_LON,
)
from backend.routing.network_validation import validate_network_graph

# Global in-memory cache for loaded road network graph
_CACHED_GRAPH: Optional[nx.MultiDiGraph] = None


def is_graph_available_locally(graph_path: str = GRAPHML_PATH) -> bool:
    """Check if the GraphML file exists and is non-empty on disk."""
    return os.path.exists(graph_path) and os.path.getsize(graph_path) > 0


def load_network_metadata(metadata_path: str = METADATA_PATH) -> Optional[Dict[str, Any]]:
    """Load the metadata JSON file if it exists."""
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None


def save_network_metadata(metadata: Dict[str, Any], metadata_path: str = METADATA_PATH) -> None:
    """Save metadata dictionary to JSON."""
    os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)


def get_network_status() -> Dict[str, Any]:
    """
    Check the local availability and summary status of the road network graph.
    This function strictly operates on local disk state and NEVER triggers a download.
    """
    is_available = is_graph_available_locally(GRAPHML_PATH)
    metadata = load_network_metadata(METADATA_PATH)

    if not is_available or metadata is None:
        return {
            "status": "not_built",
            "available_locally": False,
            "message": "Chandigarh Tricity road network has not been downloaded or built locally yet.",
            "storage_path": GRAPHML_PATH,
            "metadata_path": METADATA_PATH,
            "geographic_boundary": {
                "north": NORTH_LAT,
                "south": SOUTH_LAT,
                "west": WEST_LON,
                "east": EAST_LON,
                "bbox_format": "(left, bottom, right, top)",
                "bbox": TRICITY_BBOX,
            },
        }

    return {
        "status": "ready",
        "available_locally": True,
        "storage_path": GRAPHML_PATH,
        "file_size_mb": round(os.path.getsize(GRAPHML_PATH) / (1024 * 1024), 2),
        "metadata": metadata,
    }


def load_network_graph(graph_path: str = GRAPHML_PATH, reload: bool = False) -> nx.MultiDiGraph:
    """
    Load the persistent Chandigarh Tricity road network from disk.
    Caches the loaded graph in memory for fast subsequent access.
    Raises FileNotFoundError if the graph has not been built locally.
    """
    global _CACHED_GRAPH
    if _CACHED_GRAPH is not None and not reload:
        return _CACHED_GRAPH

    if reload:
        try:
            from backend.routing.coordinate_validator import invalidate_spatial_index
            invalidate_spatial_index()
        except ImportError:
            pass
        try:
            from backend.routing.route_analyzer import invalidate_intersection_index
            invalidate_intersection_index()
        except ImportError:
            pass

    if not is_graph_available_locally(graph_path):
        raise FileNotFoundError(
            f"Road network graph not found at '{graph_path}'. "
            f"Build the network first via the POST /routing/network/build endpoint or build_network()."
        )

    G = ox.load_graphml(graph_path)
    _CACHED_GRAPH = G
    return G


def build_network(
    bbox: tuple[float, float, float, float] = TRICITY_BBOX,
    force: bool = False,
    clear_quadrant_cache: bool = False,
    graph_path: str = GRAPHML_PATH,
    metadata_path: str = METADATA_PATH,
) -> Dict[str, Any]:
    """
    Download, process, validate, and persist the driving road network from OpenStreetMap.
    If already available locally and `force` is False, returns existing status without downloading.
    """
    global _CACHED_GRAPH

    if not force and is_graph_available_locally(graph_path):
        existing_status = get_network_status()
        return {
            "success": True,
            "action": "already_built",
            "message": "Graph already exists locally. Use force=True to re-download.",
            "data": existing_status,
        }

    os.makedirs(DATA_DIR, exist_ok=True)
    cache_dir = os.path.join(DATA_DIR, "quadrants_cache")
    os.makedirs(cache_dir, exist_ok=True)

    if clear_quadrant_cache:
        for f in os.listdir(cache_dir):
            if f.endswith(".graphml"):
                try:
                    os.remove(os.path.join(cache_dir, f))
                except Exception:
                    pass

    # Configure OSMnx settings
    ox.settings.requests_timeout = OVERPASS_TIMEOUT
    ox.settings.http_user_agent = "ITMS_Chandigarh_Traffic_Research/1.0 (contact@itms-project.org)"
    ox.settings.useful_tags_node = list(set(ox.settings.useful_tags_node + ["highway", "junction", "ref"]))
    ox.settings.useful_tags_way = list(
        set(
            ox.settings.useful_tags_way
            + ["highway", "oneway", "lanes", "maxspeed", "name", "access", "junction", "bridge", "tunnel"]
        )
    )

    overpass_endpoints = [
        "https://ovp.dresel.systems/api-as",
        "https://ovp.dresel.systems/api",
        "https://overpass-api.de/api",
    ]

    extraction_time_utc = datetime.now(timezone.utc).isoformat()

    # Partition bounding box into 4 overlapping quadrants to prevent Overpass API
    # 502/timeouts on a single monolithic 1,100+ km² query.
    # An overlap of ~1.1 km (0.01 deg lat, 0.01 deg lon) ensures boundary roads connect seamlessly.
    w, s, e, n = bbox
    mid_lat = (n + s) / 2.0
    mid_lon = (e + w) / 2.0
    overlap_lat = 0.01
    overlap_lon = 0.01

    quadrant_specs = [
        ("nw", "Northwest (Kharar, New Chandigarh, North Mohali)",
         (w, mid_lat - overlap_lat, mid_lon + overlap_lon, n)),
        ("ne", "Northeast (Chandigarh, Panchkula North)",
         (mid_lon - overlap_lon, mid_lat - overlap_lat, e, n)),
        ("sw", "Southwest (South Mohali, Aerocity, Landran)",
         (w, s, mid_lon + overlap_lon, mid_lat + overlap_lat)),
        ("se", "Southeast (Zirakpur, Dera Bassi, Panchkula South)",
         (mid_lon - overlap_lon, s, e, mid_lat + overlap_lat)),
    ]

    G: Optional[nx.MultiDiGraph] = None
    extraction_errors = []

    for q_code, q_name, q_bbox in quadrant_specs:
        q_cache_file = os.path.join(cache_dir, f"quadrant_{q_code}.graphml")
        quadrant_g = None

        if os.path.exists(q_cache_file) and not clear_quadrant_cache:
            try:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Loading cached {q_name} from {q_cache_file}...", flush=True)
                quadrant_g = ox.load_graphml(q_cache_file)
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Loaded {q_name}: {len(quadrant_g.nodes)} nodes, {len(quadrant_g.edges)} edges", flush=True)
            except Exception as e:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed loading cached {q_cache_file}: {e}, will re-download.", flush=True)
                quadrant_g = None

        if quadrant_g is None:
            for attempt, endpoint in enumerate(overpass_endpoints, start=1):
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Downloading {q_name} from {endpoint} (attempt {attempt}/{len(overpass_endpoints)})...", flush=True)
                ox.settings.overpass_url = endpoint
                try:
                    quadrant_g = ox.graph_from_bbox(
                        bbox=q_bbox,
                        network_type=NETWORK_TYPE,
                        simplify=SIMPLIFY,
                        retain_all=RETAIN_ALL,
                    )
                    ox.save_graphml(quadrant_g, q_cache_file)
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Successfully saved {q_name} to cache ({len(quadrant_g.nodes)} nodes, {len(quadrant_g.edges)} edges)", flush=True)
                    break
                except Exception as err:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Attempt {attempt} for {q_name} on {endpoint} failed: {err}", flush=True)
                    if attempt < len(overpass_endpoints):
                        wait_sec = attempt * 4
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Waiting {wait_sec}s before trying next endpoint...", flush=True)
                        time.sleep(wait_sec)
                    else:
                        extraction_errors.append(f"{q_name}: {str(err)}")

        if quadrant_g is not None:
            if G is None:
                G = quadrant_g
            else:
                G = nx.compose(G, quadrant_g)

    if G is None or len(G.nodes) == 0:
        err_msg = "; ".join(extraction_errors) if extraction_errors else "No data received."
        raise RuntimeError(f"Failed to extract road network from OpenStreetMap Overpass API: {err_msg}")

    # Perform thorough validation audit
    validation_report = validate_network_graph(G)

    # Save to GraphML
    ox.save_graphml(G, graph_path)
    _CACHED_GRAPH = G

    # Prepare metadata document
    metadata = {
        "extraction_date_utc": extraction_time_utc,
        "region_name": "Chandigarh Tricity and Surrounds",
        "target_areas_included": [
            "Chandigarh",
            "Mohali (SAS Nagar)",
            "Panchkula",
            "Zirakpur",
            "Kharar",
            "New Chandigarh (Mullanpur)",
            "Dera Bassi",
        ],
        "bounding_box_configured": {
            "west": bbox[0],
            "south": bbox[1],
            "east": bbox[2],
            "north": bbox[3],
        },
        "bounding_box_actual": validation_report.get("bounding_box_actual"),
        "osmnx_version": getattr(ox, "__version__", "unknown"),
        "networkx_version": getattr(nx, "__version__", "unknown"),
        "network_type": NETWORK_TYPE,
        "simplified": SIMPLIFY,
        "retain_all": RETAIN_ALL,
        "graph_statistics": {
            "node_count": validation_report["node_count"],
            "directed_edge_count": validation_report["edge_count"],
            "edge_count": validation_report["edge_count"],
            "directed_edge_length_km": validation_report["edge_metrics"]["directed_edge_length_km"],
            "total_road_length_km": validation_report["edge_metrics"]["total_road_length_km"],
            "estimated_unique_physical_road_length_km": validation_report["edge_metrics"]["estimated_unique_physical_road_length_km"],
            "weakly_connected_component_count": validation_report["connected_components"]["weakly_connected_components"],
            "weakly_connected_components": validation_report["connected_components"]["weakly_connected_components"],
            "largest_component_percentage": validation_report["connected_components"]["largest_wcc_percentage"],
            "largest_wcc_percentage": validation_report["connected_components"]["largest_wcc_percentage"],
            "intersection_count": validation_report["junction_and_signal_metrics"]["topological_intersections_count"],
            "topological_intersections": validation_report["junction_and_signal_metrics"][
                "topological_intersections_count"
            ],
            "dead_end_count": validation_report["junction_and_signal_metrics"]["dead_end_nodes_count"],
            "intermediate_node_count": validation_report["junction_and_signal_metrics"]["intermediate_nodes_count"],
            "isolated_node_count": validation_report["junction_and_signal_metrics"].get("isolated_nodes_count", 0),
            "mapped_traffic_signal_count": validation_report["junction_and_signal_metrics"]["traffic_signals_count"],
            "mapped_traffic_signals": validation_report["junction_and_signal_metrics"]["traffic_signals_count"],
            "signalized_intersections": validation_report["junction_and_signal_metrics"][
                "signalized_intersections_count"
            ],
            "unsignalized_intersections": validation_report["junction_and_signal_metrics"][
                "unsignalized_intersections_count"
            ],
        },
        "validation_report": validation_report,
    }

    save_network_metadata(metadata, metadata_path)

    return {
        "success": True,
        "action": "downloaded_and_built",
        "message": "Road network successfully extracted, validated, and persisted.",
        "storage_path": graph_path,
        "metadata_path": metadata_path,
        "graph_statistics": metadata["graph_statistics"],
        "is_valid": validation_report["is_valid"],
        "errors": validation_report["errors"],
        "warnings": validation_report["warnings"],
    }


def refresh_network_metadata(
    graph_path: str = GRAPHML_PATH,
    metadata_path: str = METADATA_PATH,
) -> Dict[str, Any]:
    """
    Re-run topological, geometric, and dimensional validation on the locally
    saved GraphML file without re-downloading from OpenStreetMap, and update
    the metadata JSON file on disk.
    """
    G = load_network_graph(graph_path=graph_path, reload=True)
    validation_report = validate_network_graph(G)

    existing_metadata = load_network_metadata(metadata_path) or {}
    extraction_date = existing_metadata.get(
        "extraction_date_utc", datetime.now(timezone.utc).isoformat()
    )

    metadata = {
        "extraction_date_utc": extraction_date,
        "audit_date_utc": datetime.now(timezone.utc).isoformat(),
        "region_name": "Chandigarh Tricity and Surrounds",
        "target_areas_included": [
            "Chandigarh",
            "Mohali (SAS Nagar)",
            "Panchkula",
            "Zirakpur",
            "Kharar",
            "New Chandigarh (Mullanpur)",
            "Dera Bassi",
        ],
        "bounding_box_configured": existing_metadata.get("bounding_box_configured", {
            "west": WEST_LON,
            "south": SOUTH_LAT,
            "east": EAST_LON,
            "north": NORTH_LAT,
        }),
        "bounding_box_actual": validation_report.get("bounding_box_actual"),
        "osmnx_version": getattr(ox, "__version__", "unknown"),
        "networkx_version": getattr(nx, "__version__", "unknown"),
        "network_type": NETWORK_TYPE,
        "simplified": SIMPLIFY,
        "retain_all": RETAIN_ALL,
        "graph_statistics": {
            "node_count": validation_report["node_count"],
            "directed_edge_count": validation_report["edge_count"],
            "edge_count": validation_report["edge_count"],
            "directed_edge_length_km": validation_report["edge_metrics"]["directed_edge_length_km"],
            "total_road_length_km": validation_report["edge_metrics"]["total_road_length_km"],
            "estimated_unique_physical_road_length_km": validation_report["edge_metrics"]["estimated_unique_physical_road_length_km"],
            "weakly_connected_component_count": validation_report["connected_components"]["weakly_connected_components"],
            "weakly_connected_components": validation_report["connected_components"]["weakly_connected_components"],
            "largest_component_percentage": validation_report["connected_components"]["largest_wcc_percentage"],
            "largest_wcc_percentage": validation_report["connected_components"]["largest_wcc_percentage"],
            "intersection_count": validation_report["junction_and_signal_metrics"]["topological_intersections_count"],
            "topological_intersections": validation_report["junction_and_signal_metrics"][
                "topological_intersections_count"
            ],
            "dead_end_count": validation_report["junction_and_signal_metrics"]["dead_end_nodes_count"],
            "intermediate_node_count": validation_report["junction_and_signal_metrics"]["intermediate_nodes_count"],
            "isolated_node_count": validation_report["junction_and_signal_metrics"].get("isolated_nodes_count", 0),
            "mapped_traffic_signal_count": validation_report["junction_and_signal_metrics"]["traffic_signals_count"],
            "mapped_traffic_signals": validation_report["junction_and_signal_metrics"]["traffic_signals_count"],
            "signalized_intersections": validation_report["junction_and_signal_metrics"][
                "signalized_intersections_count"
            ],
            "unsignalized_intersections": validation_report["junction_and_signal_metrics"][
                "unsignalized_intersections_count"
            ],
        },
        "validation_report": validation_report,
    }

    save_network_metadata(metadata, metadata_path)
    return metadata


def get_network_summary() -> Dict[str, Any]:
    """
    Return high-level structural and semantic summary of the road network:
    node count, edge count, connected components, road classifications,
    intersection counts, mapped traffic signals, and target area coverage.
    """
    metadata = load_network_metadata(METADATA_PATH)
    if metadata is not None and "validation_report" in metadata:
        vr = metadata["validation_report"]
        em = vr["edge_metrics"]
        jsm = vr["junction_and_signal_metrics"]
        cc = vr["connected_components"]
        return {
            "status": "ready",
            "available_locally": True,
            "extraction_date_utc": metadata.get("extraction_date_utc"),
            "audit_date_utc": metadata.get("audit_date_utc"),
            "node_count": vr["node_count"],
            "directed_edge_count": vr["edge_count"],
            "edge_count": vr["edge_count"],
            "directed_edge_length_km": em.get("directed_edge_length_km", em["total_road_length_km"]),
            "total_road_length_km": em["total_road_length_km"],
            "estimated_unique_physical_road_length_km": em.get("estimated_unique_physical_road_length_km"),
            "weakly_connected_component_count": cc["weakly_connected_components"],
            "largest_component_percentage": cc["largest_wcc_percentage"],
            "intersection_count": jsm["topological_intersections_count"],
            "dead_end_count": jsm["dead_end_nodes_count"],
            "intermediate_node_count": jsm["intermediate_nodes_count"],
            "isolated_node_count": jsm.get("isolated_nodes_count", 0),
            "mapped_traffic_signal_count": jsm["traffic_signals_count"],
            "signalized_intersection_count": jsm["signalized_intersections_count"],
            "unsignalized_intersection_count": jsm["unsignalized_intersections_count"],
            "connected_components": cc,
            "road_classifications": vr["road_classifications"],
            "junction_and_signal_metrics": jsm,
            "target_area_coverage": vr["target_area_coverage"],
            "is_valid": vr["is_valid"],
            "errors": vr["errors"],
            "warnings": vr["warnings"],
        }

    # If metadata is missing but graph is present, compute on the fly
    if is_graph_available_locally(GRAPHML_PATH):
        G = load_network_graph()
        vr = validate_network_graph(G)
        em = vr["edge_metrics"]
        jsm = vr["junction_and_signal_metrics"]
        cc = vr["connected_components"]
        return {
            "status": "ready",
            "available_locally": True,
            "node_count": vr["node_count"],
            "directed_edge_count": vr["edge_count"],
            "edge_count": vr["edge_count"],
            "directed_edge_length_km": em.get("directed_edge_length_km", em["total_road_length_km"]),
            "total_road_length_km": em["total_road_length_km"],
            "estimated_unique_physical_road_length_km": em.get("estimated_unique_physical_road_length_km"),
            "weakly_connected_component_count": cc["weakly_connected_components"],
            "largest_component_percentage": cc["largest_wcc_percentage"],
            "intersection_count": jsm["topological_intersections_count"],
            "dead_end_count": jsm["dead_end_nodes_count"],
            "intermediate_node_count": jsm["intermediate_nodes_count"],
            "isolated_node_count": jsm.get("isolated_nodes_count", 0),
            "mapped_traffic_signal_count": jsm["traffic_signals_count"],
            "signalized_intersection_count": jsm["signalized_intersections_count"],
            "unsignalized_intersection_count": jsm["unsignalized_intersections_count"],
            "connected_components": cc,
            "road_classifications": vr["road_classifications"],
            "junction_and_signal_metrics": jsm,
            "target_area_coverage": vr["target_area_coverage"],
            "is_valid": vr["is_valid"],
            "errors": vr["errors"],
            "warnings": vr["warnings"],
        }

    return {
        "status": "not_built",
        "available_locally": False,
        "message": "Road network graph has not been built yet.",
    }

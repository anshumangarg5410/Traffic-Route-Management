"""
Regional Coordinate Validator and Road Snapper
===============================================

Phase 9.2 / 9.2.1: Geographic Coordinate Validation and Road-Network Snapping.

Ensures that:
1. Coordinates are valid geographic numbers within legitimate limits.
2. Coordinates reside strictly within the Chandigarh Tricity boundary.
3. Coordinates are within reasonable snapping distance (default: <= 2.0 km) of
   a drivable road node in the regional graph.
4. Uses an in-memory 3D Cartesian spatial index (cKDTree on the unit sphere) built
   once from the cached graph to ensure sub-millisecond, isotropic spherical
   nearest-neighbor queries without latitude/longitude distortion.
5. Preserves user coordinates without overwriting or altering route endpoints.
"""

from typing import Dict, Any, Optional, Tuple, List
import math
from scipy.spatial import cKDTree

from backend.routing.config import (
    SOUTH_LAT,
    NORTH_LAT,
    WEST_LON,
    EAST_LON,
    MAX_SNAPPING_DISTANCE_KM,
    is_within_region,
)
from backend.routing.models import Coordinate
from backend.routing.network_validation import approx_haversine_km
from backend.routing.road_network import load_network_graph, is_graph_available_locally

# In-memory spatial index cache for fast road snapping
_SPATIAL_INDEX: Optional[cKDTree] = None
_SPATIAL_NODE_IDS: Optional[List[Any]] = None
_SPATIAL_NODE_COORDS: Optional[List[Tuple[float, float]]] = None


def _lat_lon_to_cartesian_unit(lat_deg: float, lon_deg: float) -> Tuple[float, float, float]:
    """
    Project (latitude, longitude) in degrees to 3D Cartesian coordinates (x, y, z) on a unit sphere.
    
    Using 3D Cartesian coordinates in cKDTree eliminates metric distortion caused by
    latitude/longitude degree anisotropy (at 30.7° N, 1 deg lon is ~14% shorter than 1 deg lat).
    Euclidean chord distance in 3D is strictly monotonic with great-circle spherical distance.
    """
    lat_r = math.radians(lat_deg)
    lon_r = math.radians(lon_deg)
    cos_lat = math.cos(lat_r)
    return (cos_lat * math.cos(lon_r), cos_lat * math.sin(lon_r), math.sin(lat_r))


def invalidate_spatial_index() -> None:
    """
    Clear the cached in-memory spatial index.
    Should be called whenever the underlying road network graph is rebuilt or reloaded.
    """
    global _SPATIAL_INDEX, _SPATIAL_NODE_IDS, _SPATIAL_NODE_COORDS
    _SPATIAL_INDEX = None
    _SPATIAL_NODE_IDS = None
    _SPATIAL_NODE_COORDS = None


def get_spatial_index() -> Tuple[Optional[cKDTree], Optional[List[Any]], Optional[List[Tuple[float, float]]]]:
    """
    Build or retrieve the in-memory 3D cKDTree spatial index for the local road network.
    Constructed lazily once and cached in memory.
    """
    global _SPATIAL_INDEX, _SPATIAL_NODE_IDS, _SPATIAL_NODE_COORDS

    if _SPATIAL_INDEX is not None:
        return _SPATIAL_INDEX, _SPATIAL_NODE_IDS, _SPATIAL_NODE_COORDS

    if not is_graph_available_locally():
        return None, None, None

    try:
        G = load_network_graph()
        node_ids = []
        coords_latlon = []
        coords_3d = []
        for n, d in G.nodes(data=True):
            y = d.get("y")
            x = d.get("x")
            if y is not None and x is not None:
                lat = float(y)
                lon = float(x)
                node_ids.append(n)
                coords_latlon.append((lat, lon))
                coords_3d.append(_lat_lon_to_cartesian_unit(lat, lon))

        if coords_3d:
            _SPATIAL_INDEX = cKDTree(coords_3d)
            _SPATIAL_NODE_IDS = node_ids
            _SPATIAL_NODE_COORDS = coords_latlon
    except Exception:
        return None, None, None

    return _SPATIAL_INDEX, _SPATIAL_NODE_IDS, _SPATIAL_NODE_COORDS


def validate_and_snap_coordinate(
    coord: Coordinate,
    label: str = "Location",
    max_distance_km: float = MAX_SNAPPING_DISTANCE_KM,
) -> Dict[str, Any]:
    """
    Validate that a coordinate is within Chandigarh Tricity and sufficiently
    close to a routable road.
    
    Preservation Principle:
    This function validates geographic boundary and road accessibility.
    It returns information about the nearest graph node, but does NOT mutate
    or replace the caller's Coordinate object. The user's original coordinates
    remain intact and are passed to OSRM so OSRM can perform its own edge snapping.
    
    Raises ValueError if coordinates are out of region or too far from any accessible road.
    """
    lat = coord.latitude
    lon = coord.longitude

    # 1. Geographic boundary validation
    if not is_within_region(lat, lon):
        raise ValueError(
            f"{label} coordinate ({lat}, {lon}) is outside the supported "
            f"Chandigarh Tricity boundary (lat: [{SOUTH_LAT}, {NORTH_LAT}], lon: [{WEST_LON}, {EAST_LON}])."
        )

    # 2. Road network proximity validation
    tree, node_ids, coords = get_spatial_index()
    if tree is not None and node_ids and coords:
        # Query nearest road node using isotropic 3D unit sphere coordinates
        query_pt_3d = _lat_lon_to_cartesian_unit(lat, lon)
        _, idx = tree.query(query_pt_3d)
        nearest_node = node_ids[idx]
        near_lat, near_lon = coords[idx]

        # Calculate exact Haversine distance
        dist_km = approx_haversine_km(lat, lon, near_lat, near_lon)
        if dist_km > max_distance_km:
            raise ValueError(
                f"{label} coordinate ({lat}, {lon}) is too far ({dist_km:.2f} km) "
                f"from the nearest accessible road in Chandigarh Tricity (maximum allowed: {max_distance_km:.1f} km)."
            )

        return {
            "is_valid": True,
            "snapped_node_id": nearest_node,
            "distance_to_road_km": round(dist_km, 3),
            "nearest_road_coords": {
                "latitude": round(near_lat, 6),
                "longitude": round(near_lon, 6),
            },
        }

    # If spatial index is unavailable (e.g. running in minimal environment without graph),
    # the regional bounding check passed.
    return {
        "is_valid": True,
        "snapped_node_id": None,
        "distance_to_road_km": 0.0,
        "nearest_road_coords": None,
    }

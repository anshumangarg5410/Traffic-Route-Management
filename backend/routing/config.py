"""
Geographic Boundary and Road Network Configuration
==================================================

Phase 9.1: Chandigarh Tricity Road Network Foundation.

Defines:
- Geographic bounding box covering all 7 target areas and connecting corridors.
- Representative coordinates for target areas for coverage validation.
- File system storage paths for the persistent GraphML graph and metadata.
- OSMnx extraction settings.
"""

import math
import os
from typing import Dict, Any, Tuple

# Base storage paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data", "road_network")
GRAPHML_FILENAME = "chandigarh_tricity.graphml"
METADATA_FILENAME = "network_metadata.json"

GRAPHML_PATH = os.path.join(DATA_DIR, GRAPHML_FILENAME)
METADATA_PATH = os.path.join(DATA_DIR, METADATA_FILENAME)

# Geographic Bounding Box for Chandigarh Tricity Region
# Coordinates selected to encompass:
# 1. Chandigarh (Central urban grid)
# 2. Mohali / SAS Nagar (Southwest IT and residential sectors 53-115)
# 3. Panchkula (Southeast planned sectors 1-32 and MDC)
# 4. Zirakpur (Connecting junction corridor on NH-152 / NH-7)
# 5. Kharar (Northwest urban cluster on NH-5 / NH-205)
# 6. New Chandigarh / Mullanpur (Northern master-planned extension)
# 7. Dera Bassi (Southern industrial gateway on NH-152)
#
# Boundaries (in degrees):
# North: 30.8500 (Captures New Chandigarh, EcoCity, Medicity)
# South: 30.5400 (Captures southern Dera Bassi, Barwala connector)
# West:  76.5900 (Captures Kharar bypass, Landran junction)
# East:  76.9300 (Captures Panchkula eastern boundary, Ramgarh, NH-7)

NORTH_LAT = 30.8500
SOUTH_LAT = 30.5400
WEST_LON = 76.5900
EAST_LON = 76.9300

# OSMnx 2.x bbox format: (left, bottom, right, top) = (min_lon, min_lat, max_lon, max_lat)
TRICITY_BBOX: Tuple[float, float, float, float] = (WEST_LON, SOUTH_LAT, EAST_LON, NORTH_LAT)

# Target areas with representative coordinates (used for geographic validation)
TARGET_AREAS: Dict[str, Dict[str, Any]] = {
    "chandigarh": {
        "name": "Chandigarh",
        "lat": 30.7333,
        "lon": 76.7794,
        "description": "Union Territory capital & central planned grid",
    },
    "mohali": {
        "name": "Mohali (SAS Nagar)",
        "lat": 30.7046,
        "lon": 76.7179,
        "description": "Major urban center & IT corridor southwest of Chandigarh",
    },
    "panchkula": {
        "name": "Panchkula",
        "lat": 30.6942,
        "lon": 76.8606,
        "description": "Planned city southeast of Chandigarh at the Shivalik foothills",
    },
    "zirakpur": {
        "name": "Zirakpur",
        "lat": 30.6425,
        "lon": 76.8173,
        "description": "Key transportation hub & arterial corridor south of Chandigarh",
    },
    "kharar": {
        "name": "Kharar",
        "lat": 30.7499,
        "lon": 76.6411,
        "description": "High-growth residential & educational hub northwest of Mohali on NH-5",
    },
    "new_chandigarh": {
        "name": "New Chandigarh (Mullanpur)",
        "lat": 30.8050,
        "lon": 76.7150,
        "description": "Planned eco-city & medicity development north of Chandigarh",
    },
    "dera_bassi": {
        "name": "Dera Bassi",
        "lat": 30.5833,
        "lon": 76.8444,
        "description": "Industrial & logistics center on NH-152 southeast of Zirakpur",
    },
}

# Network extraction parameters
NETWORK_TYPE = "drive"
SIMPLIFY = True
RETAIN_ALL = True  # Retain disconnected components for inspection
TRUNCATE_BY_EDGE = False
OVERPASS_TIMEOUT = 300  # seconds

# Geocoding Provider Configuration (Phase 9.2)
GEOCODING_PROVIDER = os.getenv("GEOCODING_PROVIDER", "nominatim")
NOMINATIM_BASE_URL = os.getenv("NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org").rstrip("/")
NOMINATIM_USER_AGENT = os.getenv(
    "NOMINATIM_USER_AGENT",
    "ITMS_Chandigarh_Traffic_Research/1.0 (contact@itms-project.org)"
)
NOMINATIM_TIMEOUT = float(os.getenv("NOMINATIM_TIMEOUT", "10.0"))
GEOCODING_CACHE_SIZE = int(os.getenv("GEOCODING_CACHE_SIZE", "500"))

# Routing Provider Configuration (Phase 9.2)
ROUTING_PROVIDER = os.getenv("ROUTING_PROVIDER", "osrm")
OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "https://router.project-osrm.org").rstrip("/")
OSRM_TIMEOUT = float(os.getenv("OSRM_TIMEOUT", "10.0"))

# Geographic Validation & Road Snapping Constraints
# Calibrated to 2.0 km based on Tricity spatial analysis: covers all urban landmarks,
# lake promenades (Sukhna 538m), airport grounds (773m), and large educational campuses (PU 331m),
# while cleanly rejecting distant non-road wilderness (>2.0 km) in Shivalik hills / rural tracts.
MAX_SNAPPING_DISTANCE_KM = float(os.getenv("MAX_SNAPPING_DISTANCE_KM", "2.0"))

# Route-Level Intersection & Traffic-Signal Analysis (Phase 9.3)
# 20.0m tolerance captures roadway lane offset (typically 5-15m from intersection center node on
# multi-lane dual-carriageway corridors) and polyline discretization while excluding parallel service roads.
ROUTE_MATCHING_TOLERANCE_M = float(os.getenv("ROUTE_MATCHING_TOLERANCE_M", "20.0"))
# Polyline candidate densification step size in meters
ROUTE_MATCHING_SAMPLE_STEP_M = float(os.getenv("ROUTE_MATCHING_SAMPLE_STEP_M", "15.0"))
# Distance along route in meters to cluster adjacent segment hits while preserving distinct passes along loops
ROUTE_LOOP_DEDUPLICATION_WINDOW_M = float(os.getenv("ROUTE_LOOP_DEDUPLICATION_WINDOW_M", "50.0"))

# Intersection Signal Delay Estimation Engine (Phase 9.4)
# Assumed baseline timing profile for uncalibrated regional signals:
# Cycle length C = 90.0s, effective red R = 60.0s -> uniform delay d = R^2 / (2C) = 3600 / 180 = 20.0s
DEFAULT_SIGNAL_CYCLE_LENGTH_S = float(os.getenv("DEFAULT_SIGNAL_CYCLE_LENGTH_S", "90.0"))
DEFAULT_SIGNAL_EFFECTIVE_RED_S = float(os.getenv("DEFAULT_SIGNAL_EFFECTIVE_RED_S", "60.0"))
SIGNAL_DELAY_MODEL = os.getenv("SIGNAL_DELAY_MODEL", "uniform_random_arrival")

# Configurable Signal Timing Profiles
SIGNAL_TIMING_PROFILES = {
    "default": {
        "cycle_length_s": 90.0,
        "effective_red_s": 60.0,
        "description": "Standard isolated urban signal baseline (90s cycle, 60s effective red)",
    },
    "major_arterial": {
        "cycle_length_s": 120.0,
        "effective_red_s": 75.0,
        "description": "Major arterial split-phase timing (120s cycle, 75s effective red)",
    },
    "minor_collector": {
        "cycle_length_s": 60.0,
        "effective_red_s": 35.0,
        "description": "Minor collector two-phase timing (60s cycle, 35s effective red)",
    },
}


def validate_signal_timing_config(cycle_length_s: float, effective_red_s: float) -> None:
    """
    Validate that signal timing parameters are mathematically permissible:
    1. Cycle length must be positive (C > 0).
    2. Effective red time must be non-negative (R >= 0).
    3. Effective red time must be strictly less than cycle length (R < C).
    """
    if math.isnan(cycle_length_s) or math.isinf(cycle_length_s) or cycle_length_s <= 0.0:
        raise ValueError(f"Signal cycle length must be a finite positive number in seconds (got {cycle_length_s}).")
    if math.isnan(effective_red_s) or math.isinf(effective_red_s) or effective_red_s < 0.0:
        raise ValueError(f"Effective red time cannot be negative (got {effective_red_s}s).")
    if effective_red_s >= cycle_length_s:
        raise ValueError(
            f"Effective red time ({effective_red_s}s) must be strictly less than cycle length ({cycle_length_s}s)."
        )



# Route Scoring and Recommendation Configuration (Phase 9.5)
# Initial suggested weights:
# - Estimated journey duration: 60% (primary objective)
# - Route distance: 20%
# - Mapped signalized intersection count: 10%
# - Intersection density: 10%
DEFAULT_SCORING_WEIGHT_DURATION = 0.60
DEFAULT_SCORING_WEIGHT_DISTANCE = 0.20
DEFAULT_SCORING_WEIGHT_SIGNALS = 0.10
DEFAULT_SCORING_WEIGHT_DENSITY = 0.10

def validate_scoring_weights(weights: Dict[str, float]) -> None:
    """
    Validate that route scoring weights satisfy mathematical and domain constraints:
    1. weights must be a dictionary.
    2. Must include all required criteria ('estimated_duration', 'distance', 'signal_count', 'intersection_density').
    3. Must not contain unknown/unsupported criteria.
    4. Each weight must be a finite, non-negative number.
    5. Sum of weights must equal 1.0 within floating-point tolerance (1e-5).
    """
    if not isinstance(weights, dict):
        raise ValueError(f"Scoring weights must be a dictionary, got {type(weights).__name__}.")

    required_keys = {"estimated_duration", "distance", "signal_count", "intersection_density"}
    missing = required_keys - set(weights.keys())
    if missing:
        raise ValueError(f"Missing required scoring weight criteria: {sorted(list(missing))}.")

    extra = set(weights.keys()) - required_keys
    if extra:
        raise ValueError(f"Unknown scoring weight criteria: {sorted(list(extra))}.")

    total_weight = 0.0
    for key in required_keys:
        w = weights[key]
        if not isinstance(w, (int, float)) or isinstance(w, bool):
            raise ValueError(f"Scoring weight for '{key}' must be numeric (got {type(w).__name__}).")
        if math.isnan(w) or math.isinf(w):
            raise ValueError(f"Scoring weight for '{key}' cannot be NaN or infinite.")
        if w < 0.0:
            raise ValueError(f"Scoring weight for '{key}' cannot be negative (got {w}).")
        total_weight += float(w)

    if not math.isclose(total_weight, 1.0, abs_tol=1e-5):
        raise ValueError(f"Scoring weights must sum to 1.0 (got {round(total_weight, 5)}).")


def load_scoring_weights_from_env() -> Dict[str, float]:
    """
    Safely load scoring weights from environment variables with fallback to 
    verified standard defaults (0.60, 0.20, 0.10, 0.10).
    """
    env_dur = os.getenv("ROUTE_SCORING_WEIGHT_DURATION")
    env_dist = os.getenv("ROUTE_SCORING_WEIGHT_DISTANCE")
    env_sig = os.getenv("ROUTE_SCORING_WEIGHT_SIGNALS")
    env_den = os.getenv("ROUTE_SCORING_WEIGHT_DENSITY")

    if env_dur is None and env_dist is None and env_sig is None and env_den is None:
        return {
            "estimated_duration": DEFAULT_SCORING_WEIGHT_DURATION,
            "distance": DEFAULT_SCORING_WEIGHT_DISTANCE,
            "signal_count": DEFAULT_SCORING_WEIGHT_SIGNALS,
            "intersection_density": DEFAULT_SCORING_WEIGHT_DENSITY,
        }

    try:
        w_dur = float(env_dur) if env_dur is not None else DEFAULT_SCORING_WEIGHT_DURATION
        w_dist = float(env_dist) if env_dist is not None else DEFAULT_SCORING_WEIGHT_DISTANCE
        w_sig = float(env_sig) if env_sig is not None else DEFAULT_SCORING_WEIGHT_SIGNALS
        w_den = float(env_den) if env_den is not None else DEFAULT_SCORING_WEIGHT_DENSITY
    except (ValueError, TypeError) as e:
        raise ValueError(f"Invalid non-numeric scoring weight in environment: {e}")

    weights = {
        "estimated_duration": w_dur,
        "distance": w_dist,
        "signal_count": w_sig,
        "intersection_density": w_den,
    }
    validate_scoring_weights(weights)
    return weights


DEFAULT_SCORING_WEIGHTS: Dict[str, float] = load_scoring_weights_from_env()



def is_within_region(lat: float, lon: float) -> bool:
    """
    Check if a (lat, lon) coordinate is within the Chandigarh Tricity geographic bounding box.
    """
    return (SOUTH_LAT <= lat <= NORTH_LAT) and (WEST_LON <= lon <= EAST_LON)


"""
Routing and Road Network Package
================================

Phase 9.1 & 9.2: Chandigarh Tricity Road Network, Geocoding, and Alternative Route Generation.
"""

from backend.routing.config import (
    TRICITY_BBOX,
    TARGET_AREAS,
    GRAPHML_PATH,
    METADATA_PATH,
    NORTH_LAT,
    SOUTH_LAT,
    WEST_LON,
    EAST_LON,
    GEOCODING_PROVIDER,
    NOMINATIM_BASE_URL,
    ROUTING_PROVIDER,
    OSRM_BASE_URL,
    is_within_region,
)
from backend.routing.models import (
    Coordinate,
    GeocodeRequest,
    GeocodeResult,
    RouteSearchRequest,
    RouteManeuver,
    RouteStep,
    GeoJSONGeometry,
    RouteResult,
    RouteSearchResponse,
    ProviderStatusResponse,
    MatchedIntersection,
    RouteIntersectionAnalysis,
    SignalizedIntersectionDelay,
    RouteSignalDelaySummary,
)
from backend.routing.geocoding import (
    BaseGeocoder,
    NominatimGeocoder,
    get_geocoder,
    geocode_location,
)
from backend.routing.route_provider import (
    BaseRouteProvider,
    OSRMRouteProvider,
    get_route_provider,
    generate_routes,
)
from backend.routing.coordinate_validator import (
    validate_and_snap_coordinate,
    get_spatial_index,
)
from backend.routing.route_analyzer import (
    analyze_route_intersections,
    get_intersection_spatial_index,
    invalidate_intersection_index,
)
from backend.routing.signal_delay import (
    calculate_uniform_delay,
    estimate_intersection_signal_delay,
    estimate_route_signal_delay,
)
from backend.routing.route_scorer import (
    normalize_metric,
    score_and_rank_routes,
)
from backend.routing.config import (
    DEFAULT_SCORING_WEIGHTS,
    validate_scoring_weights,
)
from backend.routing.models import (
    ScoredRouteSummary,
    RouteRecommendationResponse,
)

__all__ = [
    "TRICITY_BBOX",
    "TARGET_AREAS",
    "GRAPHML_PATH",
    "METADATA_PATH",
    "NORTH_LAT",
    "SOUTH_LAT",
    "WEST_LON",
    "EAST_LON",
    "GEOCODING_PROVIDER",
    "NOMINATIM_BASE_URL",
    "ROUTING_PROVIDER",
    "OSRM_BASE_URL",
    "is_within_region",
    "Coordinate",
    "GeocodeRequest",
    "GeocodeResult",
    "RouteSearchRequest",
    "RouteManeuver",
    "RouteStep",
    "GeoJSONGeometry",
    "RouteResult",
    "RouteSearchResponse",
    "ProviderStatusResponse",
    "MatchedIntersection",
    "RouteIntersectionAnalysis",
    "SignalizedIntersectionDelay",
    "RouteSignalDelaySummary",
    "BaseGeocoder",
    "NominatimGeocoder",
    "get_geocoder",
    "geocode_location",
    "BaseRouteProvider",
    "OSRMRouteProvider",
    "get_route_provider",
    "generate_routes",
    "validate_and_snap_coordinate",
    "get_spatial_index",
    "analyze_route_intersections",
    "get_intersection_spatial_index",
    "invalidate_intersection_index",
    "calculate_uniform_delay",
    "estimate_intersection_signal_delay",
    "estimate_route_signal_delay",
    "DEFAULT_SCORING_WEIGHTS",
    "validate_scoring_weights",
    "ScoredRouteSummary",
    "RouteRecommendationResponse",
    "normalize_metric",
    "score_and_rank_routes",
]

"""
Pydantic Request and Response Models for Geocoding and Routing
==============================================================

Phase 9.2: Geocoding and Alternative Route Generation.

Defines schemas for:
- Geographic coordinates.
- Geocoding requests and results.
- Driving route search requests and candidate alternative routes.
- GeoJSON geometries and turn-by-turn navigation steps.
- Provider status inspection.
"""

from datetime import datetime
import math
from typing import Dict, Any, List, Optional, Union
from pydantic import BaseModel, Field, field_validator


class Coordinate(BaseModel):
    """Geographic coordinate representation."""
    latitude: float = Field(..., description="Latitude in decimal degrees (-90.0 to 90.0)")
    longitude: float = Field(..., description="Longitude in decimal degrees (-180.0 to 180.0)")

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, v: float) -> float:
        if math.isnan(v) or math.isinf(v):
            raise ValueError("Latitude cannot be NaN or infinite.")
        if v < -90.0 or v > 90.0:
            raise ValueError(f"Latitude must be between -90.0 and 90.0 degrees (got {v}).")
        return round(float(v), 6)

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, v: float) -> float:
        if math.isnan(v) or math.isinf(v):
            raise ValueError("Longitude cannot be NaN or infinite.")
        if v < -180.0 or v > 180.0:
            raise ValueError(f"Longitude must be between -180.0 and 180.0 degrees (got {v}).")
        return round(float(v), 6)


class GeocodeRequest(BaseModel):
    """Natural-language location search request."""
    query: str = Field(..., min_length=2, max_length=250, description="Location search text or address")

    @field_validator("query")
    @classmethod
    def validate_query(cls, v: str) -> str:
        cleaned = v.strip()
        if len(cleaned) < 2:
            raise ValueError("Location query must be at least 2 characters long.")
        return cleaned


class GeocodeResult(BaseModel):
    """Structured geocoding response."""
    query: str
    display_name: str
    latitude: float
    longitude: float
    is_inside_region: bool
    address: Optional[Dict[str, Any]] = None
    place_id: Optional[Any] = None
    osm_type: Optional[str] = None
    osm_id: Optional[Any] = None
    bounding_box: Optional[List[float]] = None


class RouteSearchRequest(BaseModel):
    """Point-to-point driving route search request."""
    source: Coordinate
    destination: Coordinate
    alternatives: bool = Field(default=True, description="Request alternative candidate routes if available")
    departure_time: Optional[datetime] = Field(
        default=None,
        description="Optional departure date and time for ML temporal traffic prediction"
    )


class MLTrafficContext(BaseModel):
    """ML-predicted temporal traffic volume context for the selected departure time."""
    status: str = Field(..., description="'available' when ML inference succeeded, 'unavailable' on fallback")
    predicted_traffic_level: Optional[str] = Field(default=None, description="Predicted traffic volume tier: Low, Medium, or High")
    confidence: Optional[Dict[str, float]] = Field(default=None, description="Class probability distribution from the Random Forest model")
    departure_time_iso: str = Field(..., description="Departure timestamp used for temporal feature extraction")
    departure_hour: int = Field(..., description="Hour of day (0-23) used for prediction")
    is_weekend: bool = Field(..., description="Whether the departure date falls on a weekend")
    model_dataset: str = Field(..., description="Dataset used to train the ML model")
    nominal_conditions: Dict[str, Any] = Field(default_factory=dict, description="Nominal weather and holiday assumptions applied")
    provenance_note: str = Field(..., description="Explanation of how the ML prediction was produced")
    limitation_note: str = Field(..., description="Transparent limitation regarding dataset scope")
    error_message: Optional[str] = Field(default=None, description="User-safe error notice when ML inference is unavailable")


class RouteManeuver(BaseModel):
    """Maneuver details for a single turn-by-turn navigation step."""
    type: str = Field(..., description="Maneuver action (turn, new name, depart, arrive, etc.)")
    modifier: Optional[str] = Field(default=None, description="Maneuver direction modifier (left, right, slight left, etc.)")
    location: List[float] = Field(..., description="[longitude, latitude] coordinate where maneuver occurs")
    instruction: Optional[str] = Field(default=None, description="Human-readable turn instruction")


class RouteStep(BaseModel):
    """Single turn-by-turn navigation step along a route."""
    name: str = Field(default="", description="Road or street name for this segment")
    distance_m: float = Field(..., description="Segment distance in meters")
    distance_km: float = Field(..., description="Segment distance in kilometers")
    duration_s: float = Field(..., description="Baseline estimated segment travel time in seconds")
    duration_min: float = Field(..., description="Baseline estimated segment travel time in minutes")
    maneuver: Optional[RouteManeuver] = None
    mode: Optional[str] = Field(default="driving", description="Mode of travel")


class GeoJSONGeometry(BaseModel):
    """GeoJSON LineString geometry representation."""
    type: str = Field(default="LineString", description="GeoJSON type")
    coordinates: List[List[float]] = Field(..., description="List of [lon, lat] coordinates representing the path")

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, coords: List[List[float]]) -> List[List[float]]:
        if not isinstance(coords, list) or len(coords) < 2:
            raise ValueError("Route geometry coordinates must be a list containing at least 2 coordinate pairs [start, end].")
        for idx, pt in enumerate(coords):
            if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                raise ValueError(f"Coordinate at index {idx} must be a 2-element list [lon, lat].")
            lon, lat = pt[0], pt[1]
            if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
                raise ValueError(f"Coordinate values at index {idx} must be numeric [lon, lat].")
            if math.isnan(lon) or math.isinf(lon) or math.isnan(lat) or math.isinf(lat):
                raise ValueError(f"Coordinate at index {idx} contains NaN or infinite values.")
            if lon < -180.0 or lon > 180.0:
                raise ValueError(f"Longitude at index {idx} must be between -180.0 and 180.0 (got {lon}).")
            if lat < -90.0 or lat > 90.0:
                raise ValueError(f"Latitude at index {idx} must be between -90.0 and 90.0 (got {lat}).")
        return coords


class MatchedIntersection(BaseModel):
    """An intersection or traffic-signal node matched along a driving route."""
    osm_node_id: Union[int, str] = Field(..., description="OpenStreetMap node ID of the intersection")
    latitude: float = Field(..., description="Latitude of the intersection node")
    longitude: float = Field(..., description="Longitude of the intersection node")
    distance_along_route_m: float = Field(..., description="Cumulative distance from the route start in meters")
    distance_from_route_m: float = Field(..., description="Perpendicular/closest distance from the route polyline in meters")
    is_signalized: bool = Field(..., description="True if node is tagged with highway=traffic_signals in OpenStreetMap")
    signal_tags: Optional[Dict[str, Any]] = Field(default=None, description="OpenStreetMap signal attributes if signalized")


class RouteIntersectionAnalysis(BaseModel):
    """Enriched route-level intersection and traffic-signal analysis."""
    total_intersection_nodes: int = Field(..., description="Total topological intersection nodes matched along route")
    signalized_intersection_nodes: int = Field(..., description="Total OSM-mapped traffic-signal nodes matched along route")
    unsignalized_intersection_nodes: int = Field(..., description="Total unsignalized intersection nodes matched along route")
    intersection_density_per_km: float = Field(..., description="Topological intersections per kilometer of route")
    matched_intersections: List[MatchedIntersection] = Field(default_factory=list, description="Ordered list of matched intersections in travel order")
    analysis_status: str = Field(default="success", description="Status of route analysis (success, no_intersections_matched, graph_unavailable, invalid_geometry)")
    analysis_warnings: List[str] = Field(default_factory=list, description="Methodological notes and warnings regarding OSM topology and signal completeness")

    @field_validator("total_intersection_nodes")
    @classmethod
    def validate_conservation(cls, v: int, info) -> int:
        return v


class SignalizedIntersectionDelay(BaseModel):
    """Delay estimation details for a single matched signalized intersection."""
    osm_node_id: Union[int, str] = Field(..., description="OpenStreetMap node ID of the signalized intersection")
    distance_along_route_m: float = Field(..., description="Cumulative distance from route start in meters")
    cycle_length_s: float = Field(..., description="Assumed signal cycle length in seconds")
    effective_red_time_s: float = Field(..., description="Assumed effective red time in seconds")
    estimated_delay_s: float = Field(..., description="Estimated uniform average vehicle delay in seconds")
    estimation_method: str = Field(default="uniform_random_arrival", description="Delay calculation methodology")
    confidence_level: str = Field(default="low_uncalibrated_heuristic", description="Confidence tier of the timing assumption")
    assumptions: Dict[str, Any] = Field(default_factory=dict, description="Underlying engineering assumptions")


class RouteSignalDelaySummary(BaseModel):
    """Summary of estimated traffic-signal delays for a route."""
    signal_count: int = Field(..., description="Total number of signalized intersections encountered along the route")
    total_estimated_signal_delay_s: float = Field(..., description="Sum of estimated signal delays along the route in seconds")
    total_estimated_signal_delay_min: float = Field(..., description="Sum of estimated signal delays along the route in minutes")
    average_delay_per_signal_s: float = Field(..., description="Average estimated delay per signalized intersection in seconds")
    baseline_duration_s: float = Field(..., description="OSRM free-flow baseline transit duration in seconds")
    estimated_duration_s: float = Field(..., description="Combined estimated route travel duration (baseline + signal delay) in seconds")
    estimated_duration_min: float = Field(..., description="Combined estimated route travel duration in minutes")
    delay_model: str = Field(default="uniform_random_arrival", description="Delay estimation formula/model name")
    signal_delays: List[SignalizedIntersectionDelay] = Field(default_factory=list, description="Per-signal delay breakdown in travel order")
    analysis_status: str = Field(default="success", description="Status of delay estimation (success, no_signals_matched, missing_intersection_analysis, error)")
    analysis_warnings: List[str] = Field(default_factory=list, description="Assumptions and methodological warnings")


class ScoredRouteSummary(BaseModel):
    """Detailed multi-criteria evaluation score and metrics for a candidate route."""
    route_id: str = Field(..., description="Unique route identifier")
    rank: int = Field(..., description="Overall rank position (1 is best/recommended)")
    score: float = Field(..., description="Weighted composite evaluation score between 0.0 and 1.0 (higher is better)")
    estimated_duration_s: float = Field(..., description="Estimated travel duration in seconds (baseline + signal delay)")
    estimated_duration_min: float = Field(..., description="Estimated travel duration in minutes")
    baseline_duration_s: float = Field(..., description="OSRM baseline duration in seconds")
    distance_m: float = Field(..., description="Total route distance in meters")
    distance_km: float = Field(..., description="Total route distance in kilometers")
    signal_count: int = Field(..., description="Number of mapped traffic signals encountered")
    total_estimated_signal_delay_s: float = Field(..., description="Sum of estimated signal delays along route in seconds")
    intersection_count: int = Field(..., description="Total topological intersection nodes matched along route")
    intersection_density_per_km: float = Field(..., description="Topological intersections per kilometer of route")
    is_recommended: bool = Field(default=False, description="True if this candidate route is the top-ranked recommended route")
    recommendation_reasons: List[str] = Field(default_factory=list, description="Data-driven reasons explaining score and rank")
    metric_normalized_scores: Optional[Dict[str, float]] = Field(default=None, description="Normalized score per criterion (0.0 to 1.0, where 1.0 is best)")


class RouteRecommendationResponse(BaseModel):
    """Overall route scoring and recommendation breakdown across all candidate alternatives."""
    recommended_route_id: Optional[str] = Field(default=None, description="route_id of the top-ranked route (rank 1)")
    ranking_method: str = Field(default="weighted_multicriteria", description="Evaluation and scoring methodology")
    scoring_weights: Dict[str, float] = Field(..., description="Normalized metric weights used for scoring")
    routes_ranked: List[ScoredRouteSummary] = Field(default_factory=list, description="All candidate routes ranked in preference order (rank 1 to N)")
    recommendation_summary: str = Field(..., description="Human-readable summary of the recommendation outcome")
    analysis_status: str = Field(default="success", description="Status of scoring (success, single_route, degraded, error)")
    analysis_warnings: List[str] = Field(default_factory=list, description="Warnings regarding assumptions or missing metrics")


class RouteResult(BaseModel):
    """Candidate driving route with metrics, GeoJSON geometry, and navigation steps."""
    route_id: str = Field(..., description="Unique route identifier (route_1, route_2, etc.)")
    is_primary: bool = Field(..., description="True if primary/recommended by router; False if alternative")
    distance_m: float = Field(..., description="Total route distance in meters")
    distance_km: float = Field(..., description="Total route distance in kilometers")
    duration_s: float = Field(..., description="Baseline travel time in seconds based on nominal speeds")
    duration_min: float = Field(..., description="Baseline travel time in minutes based on nominal speeds")
    geometry: GeoJSONGeometry
    steps: List[RouteStep] = Field(default_factory=list)
    summary: Optional[str] = Field(default=None, description="Major road summary names along route")
    intersection_analysis: Optional[RouteIntersectionAnalysis] = Field(
        default=None,
        description="Enriched intersection and traffic-signal analysis along route"
    )
    signal_delay_summary: Optional[RouteSignalDelaySummary] = Field(
        default=None,
        description="Estimated traffic signal delays and combined route duration"
    )
    rank: Optional[int] = Field(
        default=None,
        description="Overall ranking position among candidate alternatives (1 is best/recommended)"
    )
    score: Optional[float] = Field(
        default=None,
        description="Weighted composite evaluation score between 0.0 and 1.0 (higher is better)"
    )
    is_recommended: bool = Field(
        default=False,
        description="True if this candidate route is the top-ranked recommended route"
    )
    recommendation_reasons: List[str] = Field(
        default_factory=list,
        description="Data-driven explanations highlighting key advantages or trade-offs"
    )
    score_details: Optional["ScoredRouteSummary"] = Field(
        default=None,
        description="Detailed scoring metrics and normalized evaluation components"
    )

    @field_validator("distance_m")
    @classmethod
    def validate_distance_m(cls, v: float) -> float:
        if math.isnan(v) or math.isinf(v) or v <= 0.0:
            raise ValueError(f"Route distance_m must be a finite positive number (got {v}).")
        return v

    @field_validator("duration_s")
    @classmethod
    def validate_duration_s(cls, v: float) -> float:
        if math.isnan(v) or math.isinf(v) or v <= 0.0:
            raise ValueError(f"Route duration_s must be a finite positive number (got {v}).")
        return v


class RouteSearchResponse(BaseModel):
    """Consolidated response returning all candidate driving routes."""
    source: Coordinate
    destination: Coordinate
    routes_count: int
    routes: List[RouteResult]
    provider: str = Field(..., description="Routing engine provider name (e.g. OSRM)")
    baseline_notice: str = Field(
        default="Route duration is a baseline free-flow routing estimate from the provider, not real-time or congestion-predicted traffic delay.",
        description="Disclaimer clarifying that route durations are baseline engineering estimates"
    )
    recommendation: Optional[RouteRecommendationResponse] = Field(
        default=None,
        description="Intelligent route ranking and recommendation summary"
    )
    ml_traffic_prediction: Optional[MLTrafficContext] = Field(
        default=None,
        description="ML-predicted temporal traffic context for the selected departure time"
    )


class ProviderStatusResponse(BaseModel):
    """Configuration and availability status of geocoding and routing services."""
    geocoding_provider: str
    geocoding_base_url: str
    routing_provider: str
    routing_base_url: str
    provider_status: str
    regional_graph_available: bool
    regional_boundary: Dict[str, Any]

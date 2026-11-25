import logging
import math
from typing import Any, Dict, List, Optional
import numpy as np

from fastapi import FastAPI, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator, model_validator

from backend.services.signal_optimizer import optimize_signal
from backend.services.prediction import predict_traffic
from backend.services.traffic_simulator import simulate_intersection, DIRECTIONS
from backend.services.strategy_comparator import compare_strategies_multi_run
from backend.services.simulation_validator import run_all_validation_scenarios
from backend.services.sensitivity_analyzer import run_parameter_sensitivity_sweep, validate_parameter_values_for_type
from backend.services.workflow_orchestrator import run_unified_workflow
from backend.routing.road_network import (
    get_network_status,
    get_network_summary,
    build_network,
    is_graph_available_locally,
)
from backend.routing.config import (
    GEOCODING_PROVIDER,
    NOMINATIM_BASE_URL,
    ROUTING_PROVIDER,
    OSRM_BASE_URL,
    SIGNAL_TIMING_PROFILES,
    WEST_LON,
    SOUTH_LAT,
    EAST_LON,
    NORTH_LAT,
    TRICITY_BBOX,
)
from backend.routing.models import (
    GeocodeRequest,
    GeocodeResult,
    RouteSearchRequest,
    RouteSearchResponse,
    ProviderStatusResponse,
)
from backend.routing.geocoding import geocode_location
from backend.routing.route_provider import generate_routes
from backend.routing.coordinate_validator import validate_and_snap_coordinate
from backend.routing.route_analyzer import analyze_route_intersections
from backend.routing.signal_delay import estimate_route_signal_delay
from backend.routing.route_scorer import score_and_rank_routes
from backend.routing.ml_context import predict_departure_traffic_context
from backend.routing.road_network import load_network_graph
from fastapi.middleware.cors import CORSMiddleware
from backend.auth import auth_router
from backend.auth.config import ALLOWED_ORIGINS
from backend.user import user_router
from backend.admin import admin_router

app = FastAPI(
    title="Intelligent Traffic Management System",
    description="ML-powered traffic prediction, simulation, and validation API",
    version="1.0.0"
)

# Security: Wildcard '*' cannot be combined with allow_credentials=True
if "*" in ALLOWED_ORIGINS:
    raise RuntimeError("Security Violation: Wildcard '*' cannot be combined with allow_credentials=True in CORS.")

@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(
        status_code=400,
        content={"detail": str(exc)}
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    first_msg = errors[0]["msg"] if errors else "Validation error"
    if first_msg.startswith("Value error, "):
        first_msg = first_msg[len("Value error, "):]
    return JSONResponse(
        status_code=400,
        content={"detail": first_msg}
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth", tags=["Authentication"])
app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authentication"], include_in_schema=False)
app.include_router(user_router, prefix="/api/v1/user", tags=["User Workspace"])
app.include_router(user_router, prefix="/user", tags=["User Workspace"], include_in_schema=False)
app.include_router(admin_router, prefix="/api/v1/admin", tags=["Admin Control Center"])
app.include_router(admin_router, prefix="/admin", tags=["Admin Control Center"], include_in_schema=False)


class TrafficInput(BaseModel):
    holiday: str
    temp: float
    rain_1h: float
    snow_1h: float
    clouds_all: int
    weather_main: str
    hour: int
    day: int
    month: int
    day_of_week: int
    is_weekend: int

    @field_validator("temp")
    @classmethod
    def validate_temp_range(cls, v: float) -> float:
        if math.isnan(v) or math.isinf(v) or v < 180.0 or v > 340.0:
            raise ValueError("Temperature must be a finite Kelvin value between 180.0 and 340.0.")
        return v

    @field_validator("rain_1h", "snow_1h")
    @classmethod
    def validate_precip(cls, v: float, info) -> float:
        if math.isnan(v) or math.isinf(v) or v < 0.0:
            raise ValueError(f"{info.field_name} cannot be negative, NaN, or infinite.")
        return v

    @field_validator("clouds_all")
    @classmethod
    def validate_clouds(cls, v: int) -> int:
        if v < 0 or v > 100:
            raise ValueError("clouds_all must be between 0 and 100.")
        return v

    @field_validator("hour")
    @classmethod
    def validate_hour_range(cls, v: int) -> int:
        if v < 0 or v > 23:
            raise ValueError("hour must be between 0 and 23.")
        return v

    @field_validator("day")
    @classmethod
    def validate_day_range(cls, v: int) -> int:
        if v < 1 or v > 31:
            raise ValueError("day must be between 1 and 31.")
        return v

    @field_validator("month")
    @classmethod
    def validate_month_range(cls, v: int) -> int:
        if v < 1 or v > 12:
            raise ValueError("month must be between 1 and 12.")
        return v

    @field_validator("day_of_week")
    @classmethod
    def validate_dow_range(cls, v: int) -> int:
        if v < 0 or v > 6:
            raise ValueError("day_of_week must be between 0 and 6.")
        return v

    @field_validator("is_weekend")
    @classmethod
    def validate_weekend_flag(cls, v: int) -> int:
        if v not in (0, 1):
            raise ValueError("is_weekend must be 0 or 1.")
        return v


class TrafficCounts(BaseModel):
    north: int
    south: int
    east: int
    west: int

    @field_validator("north", "south", "east", "west", mode="before")
    @classmethod
    def validate_count(cls, v, info):
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError(f"Vehicle count for {info.field_name} must be an integer.")
        if v < 0:
            raise ValueError(f"Vehicle count for {info.field_name} cannot be negative.")
        return v


def _validate_lanes_dict(v):
    if v is None:
        return v
    if not isinstance(v, dict):
        raise ValueError("lanes must be a dictionary.")
    for direction, count in v.items():
        if isinstance(count, bool) or not isinstance(count, int):
            raise ValueError(f"Invalid lane count for {direction}: must be an integer.")
        if count < 1:
            raise ValueError(f"Invalid lane count for {direction}: must be at least 1.")
    return v


def _validate_sat_rates_dict(v):
    if v is None:
        return v
    if not isinstance(v, dict):
        raise ValueError("saturation_flow_rates must be a dictionary.")
    for direction, rate in v.items():
        if isinstance(rate, bool) or not isinstance(rate, (int, float)):
            raise ValueError(f"Invalid saturation flow rate for {direction}: must be a numeric value.")
        if math.isnan(rate) or math.isinf(rate):
            raise ValueError(f"Invalid saturation flow rate for {direction}: cannot be NaN or infinite.")
        if rate < 0:
            raise ValueError(f"Invalid saturation flow rate for {direction}: cannot be negative.")
    return v


def _validate_lost_times_dict(v):
    if v is None:
        return v
    if not isinstance(v, dict):
        raise ValueError("startup_lost_times must be a dictionary.")
    for direction, lost in v.items():
        if isinstance(lost, bool) or not isinstance(lost, (int, float)):
            raise ValueError(f"Invalid startup lost time for {direction}: must be a numeric value.")
        if math.isnan(lost) or math.isinf(lost):
            raise ValueError(f"Invalid startup lost time for {direction}: cannot be NaN or infinite.")
        if lost < 0:
            raise ValueError(f"Invalid startup lost time for {direction}: cannot be negative.")
    return v


def _validate_discharge_policy(v):
    if v is not None:
        if v not in ("independent_floor", "fractional_carryover"):
            raise ValueError("discharge_policy must be 'independent_floor' or 'fractional_carryover'.")
    return v if v is not None else "independent_floor"


class SimulationInput(BaseModel):
    initial_queues: dict[str, int]
    arrival_rates: dict[str, float]  # Directional Poisson arrival rates (vehicles/minute)
    cycles: int = 5
    strategy: str = "adaptive"
    random_seed: Optional[int] = None
    runs: int = 5
    lanes: Optional[dict[str, int]] = None
    saturation_flow_rates: Optional[dict[str, float]] = None
    startup_lost_times: Optional[dict[str, float]] = None
    discharge_policy: Optional[str] = "independent_floor"

    @field_validator("runs", mode="before")
    @classmethod
    def validate_runs(cls, v):
        if v is not None:
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValueError("Simulation runs must be an integer.")
            if v < 1 or v > 50:
                raise ValueError("Simulation runs must be between 1 and 50.")
        return v if v is not None else 5

    @field_validator("random_seed", mode="before")
    @classmethod
    def validate_random_seed(cls, v):
        if v is not None:
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValueError("Random seed must be an integer or None.")
            if v < 0:
                raise ValueError("Random seed must be non-negative.")
        return v

    @field_validator("arrival_rates", mode="before")
    @classmethod
    def validate_arrival_rates(cls, v):
        if not isinstance(v, dict):
            raise ValueError("arrival_rates must be a dictionary.")
        for direction, rate in v.items():
            if isinstance(rate, bool) or not isinstance(rate, (int, float)):
                raise ValueError(f"Invalid arrival rate for {direction}: must be a numeric value.")
            if math.isnan(rate) or math.isinf(rate):
                raise ValueError(f"Invalid arrival rate for {direction}: cannot be NaN or infinite.")
            if rate < 0:
                raise ValueError(f"Invalid arrival rate for {direction}: cannot be negative.")
        return v

    @field_validator("initial_queues", mode="before")
    @classmethod
    def validate_initial_queues(cls, v):
        if not isinstance(v, dict):
            raise ValueError("initial_queues must be a dictionary.")
        for direction, queue in v.items():
            if isinstance(queue, bool) or not isinstance(queue, int):
                raise ValueError(f"Invalid initial queue for {direction}: must be an integer.")
            if queue < 0:
                raise ValueError(f"Invalid initial queue for {direction}: cannot be negative.")
        return v

    @field_validator("lanes", mode="before")
    @classmethod
    def validate_lanes(cls, v):
        return _validate_lanes_dict(v)

    @field_validator("saturation_flow_rates", mode="before")
    @classmethod
    def validate_sat_rates(cls, v):
        return _validate_sat_rates_dict(v)

    @field_validator("startup_lost_times", mode="before")
    @classmethod
    def validate_lost_times(cls, v):
        return _validate_lost_times_dict(v)

    @field_validator("discharge_policy", mode="before")
    @classmethod
    def validate_policy(cls, v):
        return _validate_discharge_policy(v)


class IntegratedPredictionInput(BaseModel):
    # Weather and time features for ML model
    holiday: str = "None"
    temp: float
    rain_1h: float = 0.0
    snow_1h: float = 0.0
    clouds_all: int = 20
    weather_main: str = "Clear"
    hour: int
    day: int
    month: int
    day_of_week: int
    is_weekend: int

    # Directional traffic simulation inputs
    initial_queues: dict[str, int]
    arrival_rates: dict[str, float]  # Directional Poisson arrival rates (vehicles/minute)
    cycles: int = 5
    strategy: str = "adaptive"
    random_seed: Optional[int] = None
    apply_ml_scenario_scaling: bool = False
    lanes: Optional[dict[str, int]] = None
    saturation_flow_rates: Optional[dict[str, float]] = None
    startup_lost_times: Optional[dict[str, float]] = None
    discharge_policy: Optional[str] = "independent_floor"

    @field_validator("temp", mode="before")
    @classmethod
    def validate_temp(cls, v):
        if not isinstance(v, (int, float)) or isinstance(v, bool) or math.isnan(v) or math.isinf(v) or v <= 0:
            raise ValueError("Temperature must be a positive number in Kelvin.")
        return float(v)

    @field_validator("hour", mode="before")
    @classmethod
    def validate_hour(cls, v):
        if isinstance(v, bool) or not isinstance(v, int) or v < 0 or v > 23:
            raise ValueError("Hour must be an integer between 0 and 23.")
        return v

    @field_validator("day", mode="before")
    @classmethod
    def validate_day(cls, v):
        if isinstance(v, bool) or not isinstance(v, int) or v < 1 or v > 31:
            raise ValueError("Day must be an integer between 1 and 31.")
        return v

    @field_validator("month", mode="before")
    @classmethod
    def validate_month(cls, v):
        if isinstance(v, bool) or not isinstance(v, int) or v < 1 or v > 12:
            raise ValueError("Month must be an integer between 1 and 12.")
        return v

    @field_validator("day_of_week", mode="before")
    @classmethod
    def validate_dow(cls, v):
        if isinstance(v, bool) or not isinstance(v, int) or v < 0 or v > 6:
            raise ValueError("day_of_week must be an integer between 0 and 6.")
        return v

    @field_validator("is_weekend", mode="before")
    @classmethod
    def validate_weekend(cls, v):
        if isinstance(v, bool) or v not in (0, 1):
            raise ValueError("is_weekend must be 0 or 1.")
        return v

    @field_validator("random_seed", mode="before")
    @classmethod
    def validate_random_seed(cls, v):
        if v is not None:
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValueError("Random seed must be an integer or None.")
            if v < 0:
                raise ValueError("Random seed must be non-negative.")
        return v

    @field_validator("arrival_rates", mode="before")
    @classmethod
    def validate_arrival_rates(cls, v):
        if not isinstance(v, dict):
            raise ValueError("arrival_rates must be a dictionary.")
        for direction, rate in v.items():
            if isinstance(rate, bool) or not isinstance(rate, (int, float)):
                raise ValueError(f"Invalid arrival rate for {direction}: must be a numeric value.")
            if math.isnan(rate) or math.isinf(rate):
                raise ValueError(f"Invalid arrival rate for {direction}: cannot be NaN or infinite.")
            if rate < 0:
                raise ValueError(f"Invalid arrival rate for {direction}: cannot be negative.")
        return v

    @field_validator("initial_queues", mode="before")
    @classmethod
    def validate_initial_queues(cls, v):
        if not isinstance(v, dict):
            raise ValueError("initial_queues must be a dictionary.")
        for direction, queue in v.items():
            if isinstance(queue, bool) or not isinstance(queue, int):
                raise ValueError(f"Invalid initial queue for {direction}: must be an integer.")
            if queue < 0:
                raise ValueError(f"Invalid initial queue for {direction}: cannot be negative.")
        return v

    @field_validator("lanes", mode="before")
    @classmethod
    def validate_lanes(cls, v):
        return _validate_lanes_dict(v)

    @field_validator("saturation_flow_rates", mode="before")
    @classmethod
    def validate_sat_rates(cls, v):
        return _validate_sat_rates_dict(v)

    @field_validator("startup_lost_times", mode="before")
    @classmethod
    def validate_lost_times(cls, v):
        return _validate_lost_times_dict(v)

    @field_validator("discharge_policy", mode="before")
    @classmethod
    def validate_policy(cls, v):
        return _validate_discharge_policy(v)


class UnifiedWorkflowInput(BaseModel):
    # Regional weather and temporal features
    holiday: str = "None"
    temp: float
    rain_1h: float = 0.0
    snow_1h: float = 0.0
    clouds_all: int = 20
    weather_main: str = "Clear"
    hour: int
    day: int
    month: int
    day_of_week: int
    is_weekend: int

    # Directional traffic inputs
    initial_queues: dict[str, int]
    arrival_rates: dict[str, float]  # Directional Poisson arrival rates (vehicles/minute)

    # Intersection geometry & capacity
    lanes: Optional[dict[str, int]] = None
    saturation_flow_rates: Optional[dict[str, float]] = None
    startup_lost_times: Optional[dict[str, float]] = None
    discharge_policy: Optional[str] = "independent_floor"

    # Simulation & comparison settings
    cycles: int = 5
    runs: int = 5
    random_seed: Optional[int] = None
    apply_ml_scenario_scaling: bool = False

    @field_validator("temp", mode="before")
    @classmethod
    def validate_temp(cls, v):
        if not isinstance(v, (int, float)) or isinstance(v, bool) or math.isnan(v) or math.isinf(v) or v <= 0:
            raise ValueError("Temperature must be a positive number in Kelvin.")
        return float(v)

    @field_validator("hour", mode="before")
    @classmethod
    def validate_hour(cls, v):
        if isinstance(v, bool) or not isinstance(v, int) or v < 0 or v > 23:
            raise ValueError("Hour must be an integer between 0 and 23.")
        return v

    @field_validator("day", mode="before")
    @classmethod
    def validate_day(cls, v):
        if isinstance(v, bool) or not isinstance(v, int) or v < 1 or v > 31:
            raise ValueError("Day must be an integer between 1 and 31.")
        return v

    @field_validator("month", mode="before")
    @classmethod
    def validate_month(cls, v):
        if isinstance(v, bool) or not isinstance(v, int) or v < 1 or v > 12:
            raise ValueError("Month must be an integer between 1 and 12.")
        return v

    @field_validator("day_of_week", mode="before")
    @classmethod
    def validate_dow(cls, v):
        if isinstance(v, bool) or not isinstance(v, int) or v < 0 or v > 6:
            raise ValueError("day_of_week must be an integer between 0 and 6.")
        return v

    @field_validator("is_weekend", mode="before")
    @classmethod
    def validate_weekend(cls, v):
        if isinstance(v, bool) or v not in (0, 1):
            raise ValueError("is_weekend must be 0 or 1.")
        return v

    @field_validator("cycles", mode="before")
    @classmethod
    def validate_cycles(cls, v):
        if isinstance(v, bool) or not isinstance(v, int) or v < 1 or v > 50:
            raise ValueError("cycles must be an integer between 1 and 50.")
        return v

    @field_validator("runs", mode="before")
    @classmethod
    def validate_runs(cls, v):
        if v is not None:
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValueError("Simulation runs must be an integer.")
            if v < 1 or v > 50:
                raise ValueError("Simulation runs must be between 1 and 50.")
        return v if v is not None else 5

    @field_validator("random_seed", mode="before")
    @classmethod
    def validate_random_seed(cls, v):
        if v is not None:
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValueError("Random seed must be an integer or None.")
            if v < 0:
                raise ValueError("Random seed must be non-negative.")
        return v

    @field_validator("arrival_rates", mode="before")
    @classmethod
    def validate_arrival_rates(cls, v):
        if not isinstance(v, dict):
            raise ValueError("arrival_rates must be a dictionary.")
        if set(v.keys()) != set(DIRECTIONS):
            raise ValueError("arrival_rates dictionary must contain north, south, east, and west.")
        for direction, rate in v.items():
            if isinstance(rate, bool) or not isinstance(rate, (int, float)):
                raise ValueError(f"Invalid arrival rate for {direction}: must be a numeric value.")
            if math.isnan(rate) or math.isinf(rate):
                raise ValueError(f"Invalid arrival rate for {direction}: cannot be NaN or infinite.")
            if rate < 0:
                raise ValueError(f"Invalid arrival rate for {direction}: cannot be negative.")
        return v

    @field_validator("initial_queues", mode="before")
    @classmethod
    def validate_initial_queues(cls, v):
        if not isinstance(v, dict):
            raise ValueError("initial_queues must be a dictionary.")
        if set(v.keys()) != set(DIRECTIONS):
            raise ValueError("initial_queues dictionary must contain north, south, east, and west.")
        for direction, queue in v.items():
            if isinstance(queue, bool) or not isinstance(queue, int):
                raise ValueError(f"Invalid initial queue for {direction}: must be an integer.")
            if queue < 0:
                raise ValueError(f"Invalid initial queue for {direction}: cannot be negative.")
        return v

    @field_validator("lanes", mode="before")
    @classmethod
    def validate_lanes(cls, v):
        return _validate_lanes_dict(v)

    @field_validator("saturation_flow_rates", mode="before")
    @classmethod
    def validate_sat_rates(cls, v):
        return _validate_sat_rates_dict(v)

    @field_validator("startup_lost_times", mode="before")
    @classmethod
    def validate_lost_times(cls, v):
        return _validate_lost_times_dict(v)

    @field_validator("discharge_policy", mode="before")
    @classmethod
    def validate_policy(cls, v):
        return _validate_discharge_policy(v)


class SensitivityInput(BaseModel):
    parameter_name: str
    parameter_values: Optional[List[Any]] = None
    target_direction: Optional[str] = None
    compare_both_strategies: bool = True
    baseline_override: Optional[Dict[str, Any]] = None
    runs: int = 30

    @field_validator("runs", mode="before")
    @classmethod
    def validate_runs(cls, v):
        if v is not None:
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValueError("Monte Carlo runs must be an integer.")
            if v < 2 or v > 100:
                raise ValueError("Monte Carlo runs must be between 2 and 100.")
        return v if v is not None else 30

    @field_validator("parameter_name")
    @classmethod
    def validate_param_name(cls, v):
        supported = ["arrival_rate", "initial_queue", "lanes", "saturation_flow_rate", "startup_lost_time", "cycles", "strategy"]
        if v not in supported:
            raise ValueError(f"Unsupported parameter '{v}'. Supported: {supported}")
        return v

    @field_validator("target_direction")
    @classmethod
    def validate_target_direction(cls, v):
        if v is not None and v not in DIRECTIONS:
            raise ValueError(f"target_direction must be one of {DIRECTIONS} or None.")
        return v

    @field_validator("parameter_values", mode="before")
    @classmethod
    def validate_param_values(cls, v):
        if v is not None:
            if not isinstance(v, list):
                raise ValueError("parameter_values must be a list.")
            if len(v) == 0:
                raise ValueError("parameter_values cannot be empty.")
            if len(v) > 20:
                raise ValueError("parameter_values cannot exceed 20 values per request.")
            for val in v:
                if isinstance(val, bool):
                    raise ValueError(f"Invalid parameter value {val}: booleans are not allowed.")
                if isinstance(val, (int, float)):
                    if math.isnan(val) or math.isinf(val):
                        raise ValueError(f"Invalid parameter value {val}: cannot be NaN or infinite.")
                    if val < 0:
                        raise ValueError(f"Invalid parameter value {val}: cannot be negative.")
                elif isinstance(val, str):
                    if val not in ("fixed", "adaptive"):
                        raise ValueError(f"Invalid parameter string value: {val}")
                else:
                    raise ValueError(f"Invalid parameter value type: {type(val)}")
        return v

    @model_validator(mode="after")
    def validate_specific_parameter_values(self):
        if self.parameter_values is not None:
            validate_parameter_values_for_type(self.parameter_name, self.parameter_values)
        return self


@app.get("/", tags=["System"], summary="API root status")
def home():
    """Return a basic welcome message confirming the API is running."""
    return {
        "message": "Traffic Management API is running!"
    }


@app.get("/health", tags=["System"], summary="Service health check")
def health_check():
    """Return service health status and API version metadata."""
    return {
        "status": "healthy",
        "service": "Intelligent Traffic Management System",
        "version": "1.0.0"
    }


@app.post("/predict", tags=["Traffic ML"], summary="Predict traffic congestion level")
def predict(input_data: TrafficInput):
    """Classify traffic congestion level from weather and time-of-day features."""
    try:
        result = predict_traffic(input_data.model_dump())
        return result
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Traffic prediction service is temporarily unavailable.",
        )


@app.post("/optimize-signal", tags=["Signal Control"], summary="Compute Webster signal timings")
def optimize_traffic_signal(traffic: TrafficCounts):
    """Calculate optimal cycle length and directional green splits from intersection counts."""
    result = optimize_signal(traffic.model_dump())
    return result


@app.post("/simulate", tags=["Simulation"], summary="Run single intersection simulation")
def simulate_traffic(input_data: SimulationInput):
    """Simulate intersection queues and delays for a single fixed or adaptive run."""
    result = simulate_intersection(
        initial_queues=input_data.initial_queues,
        arrival_rates=input_data.arrival_rates,
        cycles=input_data.cycles,
        strategy=input_data.strategy,
        random_seed=input_data.random_seed,
        lanes=input_data.lanes,
        saturation_flow_rates=input_data.saturation_flow_rates,
        startup_lost_times=input_data.startup_lost_times,
        discharge_policy=input_data.discharge_policy or "independent_floor"
    )
    return result


@app.post("/compare-strategies", tags=["Simulation"], summary="Compare fixed vs adaptive strategies")
def compare_strategies(input_data: SimulationInput):
    """Run paired Monte Carlo simulations comparing fixed and adaptive signal strategies."""
    result = compare_strategies_multi_run(
        initial_queues=input_data.initial_queues,
        arrival_rates=input_data.arrival_rates,
        cycles=input_data.cycles,
        runs=input_data.runs,
        base_seed=input_data.random_seed,
        lanes=input_data.lanes,
        saturation_flow_rates=input_data.saturation_flow_rates,
        startup_lost_times=input_data.startup_lost_times,
        discharge_policy=input_data.discharge_policy or "independent_floor"
    )
    return result


@app.post("/integrated-prediction", tags=["Workflow"], summary="Run integrated ML and signal prediction")
def integrated_prediction(input_data: IntegratedPredictionInput):
    """Combine ML traffic classification with directional signal timing optimization."""
    # 1. Run ML prediction pipeline for overall traffic category
    ml_features = {
        "holiday": input_data.holiday,
        "temp": input_data.temp,
        "rain_1h": input_data.rain_1h,
        "snow_1h": input_data.snow_1h,
        "clouds_all": input_data.clouds_all,
        "weather_main": input_data.weather_main,
        "hour": input_data.hour,
        "day": input_data.day,
        "month": input_data.month,
        "day_of_week": input_data.day_of_week,
        "is_weekend": input_data.is_weekend
    }
    prediction_result = predict_traffic(ml_features)

    # 2. Determine effective directional arrival rates
    rates_used = input_data.arrival_rates.copy()
    scenario_info = {
        "applied": False,
        "factor": 1.0,
        "note": "Directional arrival rates used exactly as supplied by the user."
    }

    if input_data.apply_ml_scenario_scaling:
        pred_level = prediction_result.get("predicted_traffic_level", "Medium")
        factor_map = {"Low": 0.85, "Medium": 1.0, "High": 1.25}
        factor = factor_map.get(pred_level, 1.0)
        rates_used = {d: round(rates_used[d] * factor, 2) for d in rates_used}
        scenario_info = {
            "applied": True,
            "factor": factor,
            "predicted_category": pred_level,
            "note": f"Optional scenario assumption: directional rates scaled by {factor}x based on predicted {pred_level} traffic level. This is a configurable scenario multiplier, not a direct learned directional output of the model."
        }

    # 3. Run traffic simulator using directional rates and capacity constraints
    sim_result = simulate_intersection(
        initial_queues=input_data.initial_queues,
        arrival_rates=rates_used,
        cycles=input_data.cycles,
        strategy=input_data.strategy,
        random_seed=input_data.random_seed,
        lanes=input_data.lanes,
        saturation_flow_rates=input_data.saturation_flow_rates,
        startup_lost_times=input_data.startup_lost_times,
        discharge_policy=input_data.discharge_policy or "independent_floor"
    )

    return {
        "ml_context": {
            "predicted_traffic_level": prediction_result["predicted_traffic_level"],
            "confidence": prediction_result["confidence"],
            "thresholds": prediction_result["thresholds"],
            "model_metadata": {
                "model": "Random Forest Classifier",
                "dataset": "UCI Metro Interstate Traffic Volume Dataset",
                "scope": "Macro-level highway corridor classification (Low / Medium / High)",
                "limitation": "The ML model does not predict directional vehicle counts. Directional demands are explicitly modeled in the simulation engine."
            }
        },
        "simulation_results": sim_result,
        "scenario_metadata": scenario_info
    }


@app.post("/unified-workflow", tags=["Workflow"], summary="Run unified end-to-end workflow")
def unified_workflow_endpoint(input_data: UnifiedWorkflowInput):
    """
    Unified end-to-end traffic management workflow:
    1. Regional ML traffic classification.
    2. Directional intersection configuration.
    3. Baseline signal timing optimization.
    4. Adaptive traffic simulation (single-run visualization realization).
    5. Paired fixed vs adaptive Monte Carlo strategy comparison.
    6. Consolidated metrics, documentation, and model assumptions.
    """
    regional_features = {
        "holiday": input_data.holiday,
        "temp": input_data.temp,
        "rain_1h": input_data.rain_1h,
        "snow_1h": input_data.snow_1h,
        "clouds_all": input_data.clouds_all,
        "weather_main": input_data.weather_main,
        "hour": input_data.hour,
        "day": input_data.day,
        "month": input_data.month,
        "day_of_week": input_data.day_of_week,
        "is_weekend": input_data.is_weekend,
    }

    return run_unified_workflow(
        regional_features=regional_features,
        initial_queues=input_data.initial_queues,
        arrival_rates=input_data.arrival_rates,
        lanes=input_data.lanes,
        saturation_flow_rates=input_data.saturation_flow_rates,
        startup_lost_times=input_data.startup_lost_times,
        discharge_policy=input_data.discharge_policy or "independent_floor",
        cycles=input_data.cycles,
        runs=input_data.runs,
        random_seed=input_data.random_seed,
        apply_ml_scenario_scaling=input_data.apply_ml_scenario_scaling,
    )


@app.get("/validation-scenarios", tags=["Validation"], summary="Run validation scenarios")
def get_validation_scenarios():
    """Run all deterministic validation scenarios and return audit report."""
    return run_all_validation_scenarios()


@app.post("/sensitivity-analysis", tags=["Validation"], summary="Run parameter sensitivity sweep")
def post_sensitivity_analysis(input_data: SensitivityInput):
    """Run controlled one-at-a-time (OAT) parameter sensitivity sweep."""
    return run_parameter_sensitivity_sweep(
        parameter_name=input_data.parameter_name,
        parameter_values=input_data.parameter_values,
        target_direction=input_data.target_direction,
        baseline_override=input_data.baseline_override,
        compare_both_strategies=input_data.compare_both_strategies,
        runs=input_data.runs
    )


class NetworkBuildInput(BaseModel):
    force: bool = False


@app.get("/routing/network/status", tags=["Routing"], summary="Check road network availability")
def get_routing_network_status():
    """
    Check if the Chandigarh Tricity road network graph is available locally.
    Returns extraction metadata and graph statistics without triggering a download.
    """
    return get_network_status()


@app.post("/routing/network/build", tags=["Routing"], summary="Build local road network graph")
def post_routing_network_build(input_data: Optional[NetworkBuildInput] = None):
    """
    Explicitly initiate extraction and local persistence of the Chandigarh Tricity road network.
    Avoids accidental repeated downloads when force=False.
    """
    force = input_data.force if input_data else False
    try:
        result = build_network(force=force)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build road network: {str(e)}")


@app.get("/routing/network/summary", tags=["Routing"], summary="Get road network graph summary")
def get_routing_network_summary():
    """
    Return node count, edge count, connected components, road classifications,
    intersection count, and mapped traffic-signal count.
    """
    summary = get_network_summary()
    if not summary.get("available_locally"):
        return JSONResponse(
            status_code=404,
            content=summary
        )
    return summary


@app.post("/routing/geocode", response_model=GeocodeResult, tags=["Routing"], summary="Geocode a Tricity location")
def post_routing_geocode(request: GeocodeRequest):
    """
    Geocode a natural-language location query into geographic coordinates
    within the supported Chandigarh Tricity region.
    """
    try:
        result = geocode_location(request.query)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except ConnectionError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/routing/routes", response_model=RouteSearchResponse, tags=["Routing"], summary="Search and rank driving routes")
def post_routing_routes(request: RouteSearchRequest):
    """
    Generate driving route options (primary and candidate alternatives) between
    validated source and destination coordinates in Chandigarh Tricity.
    """
    # 1. Validate and snap source and destination coordinates
    try:
        validate_and_snap_coordinate(request.source, label="Source")
        validate_and_snap_coordinate(request.destination, label="Destination")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 2. Call routing provider to generate routes
    try:
        routes_response = generate_routes(
            source=request.source,
            destination=request.destination,
            alternatives=request.alternatives,
        )

        # 3. Enrich each candidate route with intersection and signal analysis
        G = None
        try:
            G = load_network_graph()
        except Exception as exc:
            logging.getLogger("itms.routing").warning(
                "Road network graph could not be loaded (%s); continuing with degraded analysis.",
                type(exc).__name__,
            )

        timing_cfg = SIGNAL_TIMING_PROFILES.get(
            request.signal_timing_profile or "default",
            SIGNAL_TIMING_PROFILES["default"],
        )

        for r in routes_response.routes:
            r.intersection_analysis = analyze_route_intersections(
                route=r,
                G=G,
            )
            r.signal_delay_summary = estimate_route_signal_delay(
                route=r,
                intersection_analysis=r.intersection_analysis,
                cycle_length_s=timing_cfg["cycle_length_s"],
                effective_red_s=timing_cfg["effective_red_s"],
            )

        # 4. Score and rank candidate routes to identify the recommended option
        routes_response.recommendation = score_and_rank_routes(
            routes=routes_response.routes,
        )

        # 5. Attach departure-time ML traffic context (gracefully degrades if unavailable)
        routes_response.ml_traffic_prediction = predict_departure_traffic_context(
            departure_time=request.departure_time,
        )

        return routes_response
    except ValueError as e:
        # NoRoute or other route finding issue
        raise HTTPException(status_code=404, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except ConnectionError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/routing/provider/status", response_model=ProviderStatusResponse, tags=["Routing"], summary="Check geocoding and routing provider status")
def get_routing_provider_status():
    """
    Inspect the configuration and readiness status of geocoding and routing providers
    without making external network requests.
    """
    return ProviderStatusResponse(
        geocoding_provider=GEOCODING_PROVIDER,
        geocoding_base_url=NOMINATIM_BASE_URL,
        routing_provider=ROUTING_PROVIDER,
        routing_base_url=OSRM_BASE_URL,
        provider_status="configured",
        regional_graph_available=is_graph_available_locally(),
        regional_boundary={
            "west": WEST_LON,
            "south": SOUTH_LAT,
            "east": EAST_LON,
            "north": NORTH_LAT,
            "bbox_format": "(left, bottom, right, top)",
            "bbox": TRICITY_BBOX,
        },
    )


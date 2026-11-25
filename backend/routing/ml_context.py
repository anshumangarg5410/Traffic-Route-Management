"""
Departure-Time ML Traffic Context Service
=========================================

Bridges the existing UCI Metro Interstate Traffic Volume Random Forest model
(`backend.services.prediction.predict_traffic`) with the route-planning API
using only the 11 features supported by the trained pipeline.

Scientific Integrity Notes:
- Uses only the 11 trained features: holiday, temp, rain_1h, snow_1h,
  clouds_all, weather_main, hour, day, month, day_of_week, is_weekend.
- Does NOT pass route-specific attributes (distance, signals, geometry) into
  the ML model because they are not part of its training schema.
- Does NOT fabricate live Chandigarh traffic observations or invent
  duration-reduction multipliers from ML output.
- Fails gracefully: if ML inference raises an error, returns status="unavailable"
  so route generation and multi-criteria scoring still succeed.
"""

from datetime import datetime
from typing import Optional

from backend.routing.models import MLTrafficContext
from backend.services.prediction import predict_traffic

MODEL_DATASET_LABEL = "UCI Metro Interstate Traffic Volume (Minnesota)"

NOMINAL_CONDITIONS = {
    "holiday": "None",
    "weather_main": "Clear",
    "temperature_c": 20.0,
    "rain_1h_mm": 0.0,
    "snow_1h_mm": 0.0,
    "clouds_percent": 20,
}

PROVENANCE_NOTE = (
    "Traffic level is predicted by a Random Forest classifier trained on the "
    "UCI Metro Interstate Traffic Volume dataset using your selected departure "
    "date and time under nominal weather assumptions."
)

LIMITATION_NOTE = (
    "This model was trained on historical Minnesota highway data, not live "
    "Chandigarh Tricity sensors. It provides temporal congestion context rather "
    "than road-segment live traffic or modified OSRM travel-time reductions."
)


def build_ml_feature_payload(departure_dt: datetime) -> dict:
    """Construct the exact 11-feature dictionary expected by traffic_model.pkl."""
    day_of_week = departure_dt.weekday()
    return {
        "holiday": "None",
        "temp": 293.15,  # 20.0 C in Kelvin (dataset temperature unit)
        "rain_1h": 0.0,
        "snow_1h": 0.0,
        "clouds_all": 20,
        "weather_main": "Clear",
        "hour": departure_dt.hour,
        "day": departure_dt.day,
        "month": departure_dt.month,
        "day_of_week": day_of_week,
        "is_weekend": 1 if day_of_week >= 5 else 0,
    }


def predict_departure_traffic_context(
    departure_time: Optional[datetime] = None,
) -> MLTrafficContext:
    """
    Generate an ML traffic-level prediction for the requested departure time.
    Always returns an MLTrafficContext; degrades to status='unavailable' on error.
    """
    effective_dt = departure_time if departure_time is not None else datetime.now()
    is_weekend = effective_dt.weekday() >= 5
    departure_iso = effective_dt.isoformat(timespec="minutes")

    try:
        features = build_ml_feature_payload(effective_dt)
        result = predict_traffic(features)
        return MLTrafficContext(
            status="available",
            predicted_traffic_level=result.get("predicted_traffic_level"),
            confidence=result.get("confidence"),
            departure_time_iso=departure_iso,
            departure_hour=effective_dt.hour,
            is_weekend=is_weekend,
            model_dataset=MODEL_DATASET_LABEL,
            nominal_conditions=NOMINAL_CONDITIONS,
            provenance_note=PROVENANCE_NOTE,
            limitation_note=LIMITATION_NOTE,
        )
    except Exception:
        return MLTrafficContext(
            status="unavailable",
            predicted_traffic_level=None,
            confidence=None,
            departure_time_iso=departure_iso,
            departure_hour=effective_dt.hour,
            is_weekend=is_weekend,
            model_dataset=MODEL_DATASET_LABEL,
            nominal_conditions=NOMINAL_CONDITIONS,
            provenance_note=PROVENANCE_NOTE,
            limitation_note=LIMITATION_NOTE,
            error_message="ML traffic prediction is temporarily unavailable; showing OSRM baseline and signal-based route rankings.",
        )

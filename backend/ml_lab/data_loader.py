"""
Shared Dataset Loader for ML Laboratory Experiments
===================================================

Loads a reproducible sample from the preprocessed UCI Metro Interstate Traffic
Volume dataset (backend/data/processed/traffic_cleaned.csv) with caching so
interactive experiments execute quickly.
"""

from functools import lru_cache
from pathlib import Path
import pandas as pd

DATASET_PATH = Path("backend/data/processed/traffic_cleaned.csv")

NUMERIC_FEATURES = [
    "temp",
    "rain_1h",
    "snow_1h",
    "clouds_all",
    "hour",
    "day",
    "month",
    "day_of_week",
    "is_weekend",
]

ALL_MODEL_FEATURES = [
    "holiday",
    "temp",
    "rain_1h",
    "snow_1h",
    "clouds_all",
    "weather_main",
    "hour",
    "day",
    "month",
    "day_of_week",
    "is_weekend",
]


@lru_cache(maxsize=2)
def load_lab_dataset(sample_size: int = 2500) -> pd.DataFrame:
    """Load and deterministically sample the preprocessed traffic dataset."""
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Preprocessed dataset not found at {DATASET_PATH}")

    df = pd.read_csv(DATASET_PATH)
    if "date_time" in df.columns:
        df["date_time"] = pd.to_datetime(df["date_time"])
        df = df.sort_values("date_time").reset_index(drop=True)

    if sample_size and len(df) > sample_size:
        df = df.sample(n=sample_size, random_state=42).sort_index().reset_index(drop=True)
    return df


def label_traffic_volumes(
    train_volumes: pd.Series,
    all_volumes: pd.Series,
) -> tuple[pd.Series, float, float]:
    """Derive Low/Medium/High labels using train-only quantiles to avoid leakage."""
    low_t = float(train_volumes.quantile(0.33))
    high_t = float(train_volumes.quantile(0.66))

    def _classify(vol: float) -> str:
        if vol <= low_t:
            return "Low"
        if vol <= high_t:
            return "Medium"
        return "High"

    return all_volumes.apply(_classify), low_t, high_t

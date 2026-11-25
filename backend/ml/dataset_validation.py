"""
Dataset Validation and Statistics Utility
=========================================

Validates raw and preprocessed UCI Metro Interstate Traffic Volume datasets
and computes reproducible dataset summary statistics.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Sequence
import pandas as pd

REQUIRED_RAW_COLUMNS = (
    "holiday",
    "temp",
    "rain_1h",
    "snow_1h",
    "clouds_all",
    "weather_main",
    "date_time",
    "traffic_volume",
)

REQUIRED_PROCESSED_COLUMNS = REQUIRED_RAW_COLUMNS + (
    "hour",
    "day",
    "month",
    "day_of_week",
    "is_weekend",
)

FEATURE_RANGES = {
    "temp": (150.0, 350.0),          # Kelvin (allows 0 sentinel in raw data before cleaning)
    "rain_1h": (0.0, 200.0),         # mm/hour
    "snow_1h": (0.0, 100.0),         # mm/hour
    "clouds_all": (0.0, 100.0),      # percentage
    "traffic_volume": (0.0, 20000.0),
    "hour": (0, 23),
    "day": (1, 31),
    "month": (1, 12),
    "day_of_week": (0, 6),
    "is_weekend": (0, 1),
}


class DatasetValidationError(ValueError):
    """Raised when a traffic dataset fails schema or value validation."""


@dataclass
class DatasetValidationReport:
    """Structured result from validating a traffic dataset."""

    valid: bool
    row_count: int
    missing_columns: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def _check_required_columns(df: pd.DataFrame, required: Sequence[str]) -> List[str]:
    return [col for col in required if col not in df.columns]


def _check_numeric_range(
    df: pd.DataFrame,
    column: str,
    min_val: float,
    max_val: float,
    allow_nulls: bool = False,
) -> List[str]:
    errors: List[str] = []
    if column not in df.columns:
        return errors

    series = pd.to_numeric(df[column], errors="coerce")
    non_numeric_count = int(series.isna().sum() - df[column].isna().sum())
    if non_numeric_count > 0:
        errors.append(f"Column '{column}' contains {non_numeric_count} non-numeric value(s).")

    null_count = int(df[column].isna().sum())
    if not allow_nulls and null_count > 0:
        errors.append(f"Column '{column}' contains {null_count} missing value(s).")

    valid_vals = series.dropna()
    below = int((valid_vals < min_val).sum())
    above = int((valid_vals > max_val).sum())
    if below > 0 or above > 0:
        errors.append(
            f"Column '{column}' has out-of-range values outside [{min_val}, {max_val}] "
            f"(below: {below}, above: {above})."
        )
    return errors


def validate_raw_dataset(df: pd.DataFrame, raise_on_error: bool = True) -> DatasetValidationReport:
    """Validate raw traffic dataset schema, timestamps, and reasonable bounds."""
    if df is None or not isinstance(df, pd.DataFrame):
        raise DatasetValidationError("Dataset must be a pandas DataFrame.")

    if df.empty:
        report = DatasetValidationReport(valid=False, row_count=0, errors=["Dataset is empty."])
        if raise_on_error:
            raise DatasetValidationError(report.errors[0])
        return report

    missing_cols = _check_required_columns(df, REQUIRED_RAW_COLUMNS)
    errors: List[str] = []
    warnings: List[str] = []

    if missing_cols:
        errors.append(f"Missing required columns: {', '.join(missing_cols)}")
        report = DatasetValidationReport(
            valid=False,
            row_count=len(df),
            missing_columns=missing_cols,
            errors=errors,
        )
        if raise_on_error:
            raise DatasetValidationError(errors[0])
        return report

    parsed_dates = pd.to_datetime(df["date_time"], errors="coerce")
    invalid_dates = int(parsed_dates.isna().sum())
    if invalid_dates > 0:
        errors.append(f"Column 'date_time' contains {invalid_dates} invalid timestamp(s).")

    if df["holiday"].isna().any():
        warnings.append("Column 'holiday' contains missing values that will be filled with 'None'.")

    if df["weather_main"].isna().any():
        errors.append("Column 'weather_main' contains missing values.")

    # Raw dataset uses 0 Kelvin as a sentinel for missing temperature readings
    temp_series = pd.to_numeric(df["temp"], errors="coerce")
    non_zero_temps = df[temp_series != 0]
    if not non_zero_temps.empty:
        errors.extend(_check_numeric_range(non_zero_temps, "temp", *FEATURE_RANGES["temp"], allow_nulls=False))
    if (temp_series <= 0).any():
        warnings.append("Column 'temp' contains non-positive sentinel values (<= 0 K) that require cleaning.")

    errors.extend(_check_numeric_range(df, "rain_1h", 0.0, 10000.0, allow_nulls=False))
    errors.extend(_check_numeric_range(df, "snow_1h", *FEATURE_RANGES["snow_1h"], allow_nulls=False))
    errors.extend(_check_numeric_range(df, "clouds_all", *FEATURE_RANGES["clouds_all"], allow_nulls=False))
    errors.extend(_check_numeric_range(df, "traffic_volume", *FEATURE_RANGES["traffic_volume"], allow_nulls=False))

    report = DatasetValidationReport(
        valid=len(errors) == 0,
        row_count=len(df),
        missing_columns=missing_cols,
        errors=errors,
        warnings=warnings,
    )
    if not report.valid and raise_on_error:
        raise DatasetValidationError("; ".join(errors))
    return report


def validate_processed_dataset(df: pd.DataFrame, raise_on_error: bool = True) -> DatasetValidationReport:
    """Validate preprocessed traffic dataset before model training or evaluation."""
    if df is None or not isinstance(df, pd.DataFrame):
        raise DatasetValidationError("Dataset must be a pandas DataFrame.")

    if df.empty:
        report = DatasetValidationReport(valid=False, row_count=0, errors=["Processed dataset is empty."])
        if raise_on_error:
            raise DatasetValidationError(report.errors[0])
        return report

    missing_cols = _check_required_columns(df, REQUIRED_PROCESSED_COLUMNS)
    errors: List[str] = []
    warnings: List[str] = []

    if missing_cols:
        errors.append(f"Missing required processed columns: {', '.join(missing_cols)}")
        report = DatasetValidationReport(
            valid=False,
            row_count=len(df),
            missing_columns=missing_cols,
            errors=errors,
        )
        if raise_on_error:
            raise DatasetValidationError(errors[0])
        return report

    parsed_dates = pd.to_datetime(df["date_time"], errors="coerce")
    invalid_dates = int(parsed_dates.isna().sum())
    if invalid_dates > 0:
        errors.append(f"Column 'date_time' contains {invalid_dates} invalid timestamp(s).")

    # temp and rain_1h may contain NaNs from cleaning invalid readings (handled by SimpleImputer)
    errors.extend(_check_numeric_range(df, "temp", *FEATURE_RANGES["temp"], allow_nulls=True))
    errors.extend(_check_numeric_range(df, "rain_1h", *FEATURE_RANGES["rain_1h"], allow_nulls=True))
    errors.extend(_check_numeric_range(df, "snow_1h", *FEATURE_RANGES["snow_1h"], allow_nulls=False))
    errors.extend(_check_numeric_range(df, "clouds_all", *FEATURE_RANGES["clouds_all"], allow_nulls=False))
    errors.extend(_check_numeric_range(df, "traffic_volume", *FEATURE_RANGES["traffic_volume"], allow_nulls=False))

    for time_col in ("hour", "day", "month", "day_of_week", "is_weekend"):
        errors.extend(_check_numeric_range(df, time_col, *FEATURE_RANGES[time_col], allow_nulls=False))

    report = DatasetValidationReport(
        valid=len(errors) == 0,
        row_count=len(df),
        missing_columns=missing_cols,
        errors=errors,
        warnings=warnings,
    )
    if not report.valid and raise_on_error:
        raise DatasetValidationError("; ".join(errors))
    return report


def compute_dataset_statistics(df: pd.DataFrame) -> Dict[str, Any]:
    """Compute summary statistics (shape, missingness, duplicates, numeric bounds) for a dataset."""
    if df is None or not isinstance(df, pd.DataFrame):
        raise DatasetValidationError("Dataset must be a pandas DataFrame.")

    missing_counts = {col: int(count) for col, count in df.isna().sum().items()}
    numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
    numeric_summary: Dict[str, Dict[str, float]] = {}

    for col in numeric_cols:
        series = df[col].dropna()
        if not series.empty:
            numeric_summary[col] = {
                "min": round(float(series.min()), 4),
                "max": round(float(series.max()), 4),
                "mean": round(float(series.mean()), 4),
                "median": round(float(series.median()), 4),
            }

    date_range = None
    if "date_time" in df.columns and not df.empty:
        parsed = pd.to_datetime(df["date_time"], errors="coerce").dropna()
        if not parsed.empty:
            date_range = {
                "start": parsed.min().isoformat(),
                "end": parsed.max().isoformat(),
            }

    return {
        "row_count": int(len(df)),
        "column_count": int(len(df.columns)),
        "columns": df.columns.tolist(),
        "duplicate_rows": int(df.duplicated().sum()),
        "missing_values": missing_counts,
        "numeric_summary": numeric_summary,
        "date_range": date_range,
    }

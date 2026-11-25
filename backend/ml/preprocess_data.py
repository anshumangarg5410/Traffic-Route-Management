"""
Traffic Dataset Preprocessing CLI
=================================

Cleans raw UCI Metro Interstate Traffic Volume data, validates schema and feature
ranges, extracts calendar/time features, and writes the processed CSV.
"""

import argparse
import os
import sys
from typing import Optional
import pandas as pd

from backend.ml.dataset_validation import (
    DatasetValidationError,
    compute_dataset_statistics,
    validate_processed_dataset,
    validate_raw_dataset,
)

DEFAULT_RAW_PATH = "backend/data/raw/traffic_volume.csv"
DEFAULT_OUTPUT_PATH = "backend/data/processed/traffic_cleaned.csv"


def load_raw_dataset(input_path: str) -> pd.DataFrame:
    """Load raw CSV dataset with explicit file and parsing error handling."""
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Raw dataset file not found: {input_path}")
    if os.path.getsize(input_path) == 0:
        raise DatasetValidationError(f"Raw dataset file is empty: {input_path}")

    try:
        return pd.read_csv(input_path)
    except pd.errors.EmptyDataError as exc:
        raise DatasetValidationError(f"Raw dataset file contains no rows: {input_path}") from exc
    except Exception as exc:
        raise RuntimeError(f"Failed to read raw dataset '{input_path}': {exc}") from exc


def preprocess_traffic_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Validate, clean, and enrich a raw traffic dataframe with time features."""
    validate_raw_dataset(df, raise_on_error=True)

    cleaned = df.copy()
    cleaned["holiday"] = cleaned["holiday"].fillna("None")
    cleaned = cleaned.drop_duplicates().reset_index(drop=True)
    cleaned["date_time"] = pd.to_datetime(cleaned["date_time"])

    # Replace invalid sentinel temperature (<= 0 K) and extreme rainfall (> 100 mm/h) with NaN
    cleaned.loc[cleaned["temp"] <= 0, "temp"] = None
    cleaned.loc[cleaned["rain_1h"] > 100, "rain_1h"] = None

    cleaned["hour"] = cleaned["date_time"].dt.hour
    cleaned["day"] = cleaned["date_time"].dt.day
    cleaned["month"] = cleaned["date_time"].dt.month
    cleaned["day_of_week"] = cleaned["date_time"].dt.dayofweek
    cleaned["is_weekend"] = (cleaned["day_of_week"] >= 5).astype(int)

    validate_processed_dataset(cleaned, raise_on_error=True)
    return cleaned


def run_preprocessing(
    input_path: str = DEFAULT_RAW_PATH,
    output_path: str = DEFAULT_OUTPUT_PATH,
    print_stats: bool = False,
) -> pd.DataFrame:
    """Load raw CSV, preprocess, validate, and save processed CSV."""
    raw_df = load_raw_dataset(input_path)
    before = len(raw_df)
    cleaned_df = preprocess_traffic_dataframe(raw_df)
    duplicates_removed = before - len(cleaned_df)

    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    cleaned_df.to_csv(output_path, index=False)

    print(f"Original shape: {raw_df.shape}")
    print(f"Exact duplicates removed: {duplicates_removed}")
    print(f"Preprocessing completed! Final shape: {cleaned_df.shape}")
    if print_stats:
        stats = compute_dataset_statistics(cleaned_df)
        print("Dataset statistics:", stats)
    return cleaned_df


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Preprocess raw traffic volume CSV dataset.")
    parser.add_argument("--input", default=DEFAULT_RAW_PATH, help="Path to raw CSV dataset")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_PATH, help="Path to write cleaned CSV")
    parser.add_argument("--stats", action="store_true", help="Print dataset summary statistics")
    args = parser.parse_args(argv)

    try:
        run_preprocessing(input_path=args.input, output_path=args.output, print_stats=args.stats)
        return 0
    except (FileNotFoundError, DatasetValidationError, RuntimeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

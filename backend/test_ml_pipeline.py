"""
ML Pipeline & Dataset Validation Tests
======================================
"""

import pandas as pd
import pytest

from backend.ml.dataset_validation import (
    DatasetValidationError,
    compute_dataset_statistics,
    validate_processed_dataset,
    validate_raw_dataset,
)


def _sample_raw_df() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "holiday": None,
                "temp": 288.28,
                "rain_1h": 0.0,
                "snow_1h": 0.0,
                "clouds_all": 40,
                "weather_main": "Clouds",
                "date_time": "2018-09-30 10:00:00",
                "traffic_volume": 3542,
            },
            {
                "holiday": "None",
                "temp": 0.0,  # raw sensor sentinel
                "rain_1h": 1.5,
                "snow_1h": 0.0,
                "clouds_all": 75,
                "weather_main": "Rain",
                "date_time": "2018-09-30 11:00:00",
                "traffic_volume": 4120,
            },
        ]
    )


def _sample_processed_df() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "holiday": "None",
                "temp": 288.28,
                "rain_1h": 0.0,
                "snow_1h": 0.0,
                "clouds_all": 40,
                "weather_main": "Clouds",
                "date_time": "2018-09-30 10:00:00",
                "traffic_volume": 3542,
                "hour": 10,
                "day": 30,
                "month": 9,
                "day_of_week": 6,
                "is_weekend": 1,
            },
            {
                "holiday": "None",
                "temp": 290.15,
                "rain_1h": 0.5,
                "snow_1h": 0.0,
                "clouds_all": 20,
                "weather_main": "Clear",
                "date_time": "2018-10-01 08:00:00",
                "traffic_volume": 5210,
                "hour": 8,
                "day": 1,
                "month": 10,
                "day_of_week": 0,
                "is_weekend": 0,
            },
        ]
    )


def test_validate_raw_dataset_accepts_valid_data_and_flags_warnings():
    df = _sample_raw_df()
    report = validate_raw_dataset(df)
    assert report.valid is True
    assert report.row_count == 2
    assert len(report.warnings) == 2


def test_validate_raw_dataset_rejects_missing_columns_and_bad_dates():
    df = _sample_raw_df().drop(columns=["weather_main"])
    with pytest.raises(DatasetValidationError, match="Missing required columns"):
        validate_raw_dataset(df)

    bad_date_df = _sample_raw_df()
    bad_date_df.loc[0, "date_time"] = "not-a-timestamp"
    with pytest.raises(DatasetValidationError, match="date_time"):
        validate_raw_dataset(bad_date_df)


def test_validate_processed_dataset_rejects_out_of_range_features():
    df = _sample_processed_df()
    assert validate_processed_dataset(df).valid is True

    bad_hour = df.copy()
    bad_hour.loc[0, "hour"] = 25
    with pytest.raises(DatasetValidationError, match="hour"):
        validate_processed_dataset(bad_hour)

    bad_vol = df.copy()
    bad_vol.loc[0, "traffic_volume"] = -10
    with pytest.raises(DatasetValidationError, match="traffic_volume"):
        validate_processed_dataset(bad_vol)


def test_compute_dataset_statistics_returns_expected_summary():
    df = _sample_processed_df()
    stats = compute_dataset_statistics(df)
    assert stats["row_count"] == 2
    assert stats["duplicate_rows"] == 0
    assert stats["numeric_summary"]["traffic_volume"]["min"] == 3542.0
    assert stats["numeric_summary"]["traffic_volume"]["max"] == 5210.0
    assert stats["date_range"]["start"].startswith("2018-09-30")


def test_preprocess_dataframe_and_cli_error_handling(tmp_path):
    from backend.ml.preprocess_data import main as preprocess_main, preprocess_traffic_dataframe

    raw = _sample_raw_df()
    # Add duplicate row to verify deduplication
    raw_with_dup = pd.concat([raw, raw.iloc[[0]]], ignore_index=True)
    cleaned = preprocess_traffic_dataframe(raw_with_dup)
    assert len(cleaned) == 2
    assert pd.isna(cleaned.loc[1, "temp"])
    assert cleaned.loc[0, "holiday"] == "None"
    assert set(["hour", "day", "month", "day_of_week", "is_weekend"]).issubset(cleaned.columns)

    # Missing file -> CLI returns non-zero exit code
    assert preprocess_main(["--input", str(tmp_path / "missing.csv")]) == 1

    # Empty file -> CLI returns non-zero exit code
    empty_file = tmp_path / "empty.csv"
    empty_file.write_text("", encoding="utf-8")
    assert preprocess_main(["--input", str(empty_file)]) == 1

    # Valid file -> CLI writes cleaned output and returns 0
    in_file = tmp_path / "raw.csv"
    out_file = tmp_path / "cleaned.csv"
    raw.to_csv(in_file, index=False)
    assert preprocess_main(["--input", str(in_file), "--output", str(out_file)]) == 0
    assert out_file.exists()

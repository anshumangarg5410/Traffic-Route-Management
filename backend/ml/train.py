"""
Traffic Level Classifier Training Script
========================================

Trains a RandomForestClassifier on preprocessed UCI Metro Interstate Traffic
Volume data, computes reproducible evaluation metrics, compares against any
existing active model artifact, and only overwrites the artifact if valid and
non-regressing.
"""

import argparse
import os
import sys
from typing import Any, Dict, Optional
import joblib
import pandas as pd

from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from backend.ml.dataset_validation import DatasetValidationError, validate_processed_dataset
from backend.ml.evaluate import compare_models, evaluate_classification_model

FEATURES = [
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

DEFAULT_DATA_PATH = "backend/data/processed/traffic_cleaned.csv"
DEFAULT_MODEL_PATH = "backend/models/traffic_model.pkl"


def train_and_evaluate(
    data_path: str = DEFAULT_DATA_PATH,
    model_path: str = DEFAULT_MODEL_PATH,
    force_promote: bool = False,
) -> Dict[str, Any]:
    """Train RandomForest model, evaluate, compare against active model, and conditionally save."""
    if not os.path.exists(data_path):
        raise FileNotFoundError(f"Processed dataset not found: {data_path}")

    df = pd.read_csv(data_path)
    validate_processed_dataset(df, raise_on_error=True)

    df["date_time"] = pd.to_datetime(df["date_time"])
    df = df.sort_values("date_time").reset_index(drop=True)

    X = df[FEATURES]
    y_volume = df["traffic_volume"]

    split_index = int(len(df) * 0.8)
    if split_index == 0 or split_index >= len(df):
        raise DatasetValidationError("Dataset is too small for chronological 80/20 split.")

    X_train = X.iloc[:split_index]
    X_test = X.iloc[split_index:]
    y_train_volume = y_volume.iloc[:split_index]
    y_test_volume = y_volume.iloc[split_index:]

    low_threshold = float(y_train_volume.quantile(0.33))
    high_threshold = float(y_train_volume.quantile(0.66))

    def classify_traffic(volume: float) -> str:
        if volume <= low_threshold:
            return "Low"
        if volume <= high_threshold:
            return "Medium"
        return "High"

    y_train = y_train_volume.apply(classify_traffic)
    y_test = y_test_volume.apply(classify_traffic)

    categorical_features = ["holiday", "weather_main"]
    numerical_features = [col for col in FEATURES if col not in categorical_features]

    numerical_pipeline = Pipeline([("imputer", SimpleImputer(strategy="median"))])
    categorical_pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore")),
        ]
    )

    preprocessor = ColumnTransformer(
        [
            ("numerical", numerical_pipeline, numerical_features),
            ("categorical", categorical_pipeline, categorical_features),
        ]
    )

    model = RandomForestClassifier(
        n_estimators=150,
        max_depth=20,
        min_samples_split=5,
        random_state=42,
        n_jobs=-1,
    )

    pipeline = Pipeline([("preprocessor", preprocessor), ("classifier", model)])
    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    candidate_metrics = evaluate_classification_model(y_test, y_pred)

    active_metrics = None
    if os.path.exists(model_path):
        try:
            existing = joblib.load(model_path)
            if isinstance(existing, dict):
                active_metrics = existing.get("metrics")
        except Exception:
            active_metrics = None

    comparison = compare_models(candidate_metrics, active_metrics)
    promoted = force_promote or comparison["should_promote"]

    if promoted:
        out_dir = os.path.dirname(model_path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        joblib.dump(
            {
                "pipeline": pipeline,
                "low_threshold": low_threshold,
                "high_threshold": high_threshold,
                "features": FEATURES,
                "metrics": candidate_metrics,
            },
            model_path,
        )

    return {
        "promoted": promoted,
        "comparison": comparison,
        "metrics": candidate_metrics,
        "low_threshold": low_threshold,
        "high_threshold": high_threshold,
    }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Train and evaluate traffic classification model.")
    parser.add_argument("--data", default=DEFAULT_DATA_PATH, help="Path to processed CSV dataset")
    parser.add_argument("--output", default=DEFAULT_MODEL_PATH, help="Path to save trained model artifact")
    parser.add_argument("--force", action="store_true", help="Promote candidate even if metrics regress")
    args = parser.parse_args(argv)

    try:
        result = train_and_evaluate(data_path=args.data, model_path=args.output, force_promote=args.force)
        print("Evaluation metrics:", result["metrics"])
        print("Comparison:", result["comparison"]["reason"])
        print("Model promoted:" if result["promoted"] else "Existing model preserved.")
        return 0 if result["promoted"] else 2
    except (FileNotFoundError, DatasetValidationError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

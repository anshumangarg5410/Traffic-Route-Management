"""
Model Evaluation and Candidate Comparison
=========================================

Provides reproducible multi-class evaluation metrics (accuracy, precision,
recall, F1-score, per-class metrics, confusion matrix), candidate-vs-active
comparison to prevent inferior model promotion, and a standalone evaluation CLI.
"""

import argparse
import json
import os
import sys
from typing import Any, Dict, Optional, Sequence
import joblib
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)

from backend.ml.dataset_validation import DatasetValidationError, validate_processed_dataset

TRAFFIC_LABELS = ("Low", "Medium", "High")


def evaluate_classification_model(
    y_true: Sequence[str],
    y_pred: Sequence[str],
    labels: Sequence[str] = TRAFFIC_LABELS,
) -> Dict[str, Any]:
    """Compute reproducible overall, per-class, and confusion matrix metrics."""
    label_list = list(labels)
    acc = float(accuracy_score(y_true, y_pred))

    macro_p, macro_r, macro_f1, _ = precision_recall_fscore_support(
        y_true, y_pred, labels=label_list, average="macro", zero_division=0
    )
    weighted_p, weighted_r, weighted_f1, _ = precision_recall_fscore_support(
        y_true, y_pred, labels=label_list, average="weighted", zero_division=0
    )
    class_p, class_r, class_f1, class_support = precision_recall_fscore_support(
        y_true, y_pred, labels=label_list, average=None, zero_division=0
    )
    cm = confusion_matrix(y_true, y_pred, labels=label_list)

    per_class = {
        label: {
            "precision": round(float(class_p[idx]), 4),
            "recall": round(float(class_r[idx]), 4),
            "f1_score": round(float(class_f1[idx]), 4),
            "support": int(class_support[idx]),
        }
        for idx, label in enumerate(label_list)
    }

    return {
        "labels": label_list,
        "accuracy": round(acc, 4),
        "macro_precision": round(float(macro_p), 4),
        "macro_recall": round(float(macro_r), 4),
        "macro_f1": round(float(macro_f1), 4),
        "weighted_precision": round(float(weighted_p), 4),
        "weighted_recall": round(float(weighted_r), 4),
        "weighted_f1": round(float(weighted_f1), 4),
        "per_class": per_class,
        "confusion_matrix": cm.tolist(),
    }


def compare_models(
    candidate_metrics: Dict[str, Any],
    active_metrics: Optional[Dict[str, Any]],
    min_f1_delta: float = 0.0,
) -> Dict[str, Any]:
    """
    Compare candidate model metrics against the currently active model.
    Prevents automatic promotion when candidate macro_f1 regresses below active macro_f1.
    """
    if not active_metrics:
        return {
            "should_promote": True,
            "reason": "No active baseline metrics found; promoting candidate model.",
            "f1_delta": 0.0,
            "accuracy_delta": 0.0,
        }

    cand_f1 = float(candidate_metrics.get("macro_f1", 0.0))
    act_f1 = float(active_metrics.get("macro_f1", 0.0))
    cand_acc = float(candidate_metrics.get("accuracy", 0.0))
    act_acc = float(active_metrics.get("accuracy", 0.0))

    f1_delta = round(cand_f1 - act_f1, 4)
    acc_delta = round(cand_acc - act_acc, 4)

    if f1_delta < min_f1_delta:
        return {
            "should_promote": False,
            "reason": (
                f"Candidate macro_f1 ({cand_f1:.4f}) is below active baseline "
                f"({act_f1:.4f}, delta={f1_delta:+.4f}). Existing model preserved."
            ),
            "f1_delta": f1_delta,
            "accuracy_delta": acc_delta,
        }

    return {
        "should_promote": True,
        "reason": (
            f"Candidate macro_f1 ({cand_f1:.4f}) meets or exceeds active baseline "
            f"({act_f1:.4f}, delta={f1_delta:+.4f})."
        ),
        "f1_delta": f1_delta,
        "accuracy_delta": acc_delta,
    }


def evaluate_saved_model(
    model_path: str = "backend/models/traffic_model.pkl",
    data_path: str = "backend/data/processed/traffic_cleaned.csv",
) -> Dict[str, Any]:
    """Load a saved model artifact and evaluate it on the chronological test split."""
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model artifact not found: {model_path}")
    if not os.path.exists(data_path):
        raise FileNotFoundError(f"Processed dataset not found: {data_path}")

    artifact = joblib.load(model_path)
    df = pd.read_csv(data_path)
    validate_processed_dataset(df, raise_on_error=True)

    df["date_time"] = pd.to_datetime(df["date_time"])
    df = df.sort_values("date_time").reset_index(drop=True)

    split_index = int(len(df) * 0.8)
    test_df = df.iloc[split_index:]
    if test_df.empty:
        raise DatasetValidationError("Chronological test split is empty.")

    features = artifact["features"]
    low_threshold = artifact["low_threshold"]
    high_threshold = artifact["high_threshold"]
    pipeline = artifact["pipeline"]

    def _classify(vol: float) -> str:
        if vol <= low_threshold:
            return "Low"
        if vol <= high_threshold:
            return "Medium"
        return "High"

    y_true = test_df["traffic_volume"].apply(_classify)
    y_pred = pipeline.predict(test_df[features])
    return evaluate_classification_model(y_true, y_pred)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate saved traffic classification model.")
    parser.add_argument("--model", default="backend/models/traffic_model.pkl", help="Model artifact path")
    parser.add_argument("--data", default="backend/data/processed/traffic_cleaned.csv", help="Processed CSV path")
    args = parser.parse_args(argv)

    try:
        report = evaluate_saved_model(model_path=args.model, data_path=args.data)
        print(json.dumps(report, indent=2))
        return 0
    except (FileNotFoundError, DatasetValidationError, KeyError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

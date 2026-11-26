"""
Supervised Learning & Model Evaluation Experiments
==================================================

Covers Syllabus Sections:
- A: Regression (Linear, Multiple Linear, Polynomial; MAE, MSE, RMSE, R^2)
- B: Classification (Logistic Regression, KNN, Decision Tree, Random Forest, Naive Bayes, SVM)
- C: Model Evaluation & Validation (Train-Test Split, K-Fold CV, Overfitting/Underfitting, Bias-Variance)
"""

from typing import Any, Dict, List
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    mean_absolute_error,
    mean_squared_error,
    precision_recall_fscore_support,
    r2_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, PolynomialFeatures, StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

from backend.ml_lab.data_loader import (
    ALL_MODEL_FEATURES,
    NUMERIC_FEATURES,
    label_traffic_volumes,
    load_lab_dataset,
)

CLASS_LABELS = ["Low", "Medium", "High"]


def _build_classification_preprocessor(dense_output: bool = False) -> ColumnTransformer:
    categorical_features = ["holiday", "weather_main"]
    numerical_features = [c for c in ALL_MODEL_FEATURES if c not in categorical_features]

    num_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])
    cat_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=not dense_output)),
    ])
    return ColumnTransformer([
        ("num", num_pipe, numerical_features),
        ("cat", cat_pipe, categorical_features),
    ])


def run_regression_experiment(
    algorithm: str = "linear",
    degree: int = 2,
    test_size: float = 0.2,
) -> Dict[str, Any]:
    """Run Linear, Multiple Linear, or Polynomial Regression on traffic_volume."""
    df = load_lab_dataset(2500)
    y = df["traffic_volume"].astype(float)

    if algorithm == "linear":
        feature_cols = ["hour"]
        X = df[feature_cols]
        model = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("reg", LinearRegression()),
        ])
        title = "Simple Linear Regression (Hour -> Traffic Volume)"
        explanation = (
            "Fits a single straight line between hour of day and traffic volume. "
            "Because traffic peaks twice daily (morning and evening rush), a single linear slope "
            "captures only the overall trend and has higher error than non-linear models."
        )
    elif algorithm == "multiple":
        feature_cols = NUMERIC_FEATURES
        X = df[feature_cols]
        model = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("reg", LinearRegression()),
        ])
        title = "Multiple Linear Regression (All Numeric Weather & Time Features)"
        explanation = (
            "Models traffic volume as a weighted linear combination of temperature, rain, snow, "
            "cloud cover, hour, day, month, day of week, and weekend indicator."
        )
    elif algorithm == "polynomial":
        deg = max(2, min(int(degree), 5))
        feature_cols = ["hour", "temp", "clouds_all"]
        X = df[feature_cols]
        model = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("poly", PolynomialFeatures(degree=deg, include_bias=False)),
            ("scaler", StandardScaler()),
            ("reg", LinearRegression()),
        ])
        title = f"Polynomial Regression (Degree {deg})"
        explanation = (
            f"Expands hour, temperature, and cloud cover into degree-{deg} polynomial interaction terms, "
            "allowing the linear regressor to fit curved rush-hour peaks."
        )
    else:
        raise ValueError(f"Unsupported regression algorithm: {algorithm}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=42
    )
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)

    mae = float(mean_absolute_error(y_test, y_pred))
    mse = float(mean_squared_error(y_test, y_pred))
    rmse = float(np.sqrt(mse))
    r2 = float(r2_score(y_test, y_pred))

    # Build 30 evenly spaced test samples for chart visualization
    sample_idx = np.linspace(0, len(y_test) - 1, min(30, len(y_test)), dtype=int)
    chart_points = [
        {
            "index": int(i + 1),
            "hour": int(X_test.iloc[idx]["hour"]) if "hour" in X_test.columns else int(i),
            "actual": round(float(y_test.iloc[idx]), 2),
            "predicted": round(float(y_pred[idx]), 2),
        }
        for i, idx in enumerate(sample_idx)
    ]

    return {
        "algorithm": algorithm,
        "title": title,
        "features_used": feature_cols,
        "train_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "metrics": {
            "mae": round(mae, 2),
            "mse": round(mse, 2),
            "rmse": round(rmse, 2),
            "r2_score": round(r2, 4),
        },
        "chart_points": chart_points,
        "explanation": explanation,
    }


def run_classification_experiment(
    algorithm: str = "random_forest",
    k: int = 5,
    max_depth: int = 10,
    test_size: float = 0.2,
) -> Dict[str, Any]:
    """Train and evaluate one of the 6 syllabus classifiers on Low/Medium/High traffic."""
    df = load_lab_dataset(2500)
    X = df[ALL_MODEL_FEATURES]
    y_vol = df["traffic_volume"]

    X_train, X_test, y_train_vol, y_test_vol = train_test_split(
        X, y_vol, test_size=test_size, random_state=42
    )
    y_train, low_t, high_t = label_traffic_volumes(y_train_vol, y_train_vol)
    y_test, _, _ = label_traffic_volumes(y_train_vol, y_test_vol)

    dense_needed = algorithm == "naive_bayes"
    preprocessor = _build_classification_preprocessor(dense_output=dense_needed)

    classifiers = {
        "logistic_regression": (
            LogisticRegression(max_iter=500, random_state=42),
            "Logistic Regression",
            "Linear probabilistic classifier using one-vs-rest / multinomial log-odds over scaled features.",
        ),
        "knn": (
            KNeighborsClassifier(n_neighbors=max(1, min(int(k), 25))),
            f"K-Nearest Neighbors (k={max(1, min(int(k), 25))})",
            "Non-parametric classifier assigning congestion class by majority vote of the closest training points.",
        ),
        "decision_tree": (
            DecisionTreeClassifier(max_depth=max(1, min(int(max_depth), 30)), random_state=42),
            f"Decision Tree (max_depth={max(1, min(int(max_depth), 30))})",
            "Rule-based tree splitting features by Gini impurity; interpretable but prone to overfitting at high depth.",
        ),
        "random_forest": (
            RandomForestClassifier(n_estimators=80, max_depth=14, random_state=42, n_jobs=-1),
            "Random Forest Classifier",
            "Ensemble of bootstrapped decision trees averaging predictions to reduce variance and improve accuracy.",
        ),
        "naive_bayes": (
            GaussianNB(),
            "Gaussian Naive Bayes",
            "Probabilistic Bayes classifier assuming conditional independence and Gaussian feature distributions.",
        ),
        "svm": (
            SVC(kernel="rbf", random_state=42),
            "Support Vector Machine (RBF Kernel)",
            "Finds maximum-margin hyperplanes in an RBF kernel space to separate congestion classes.",
        ),
    }

    if algorithm not in classifiers:
        raise ValueError(f"Unsupported classification algorithm: {algorithm}")

    clf, title, explanation = classifiers[algorithm]
    pipe = Pipeline([("preprocessor", preprocessor), ("classifier", clf)])
    pipe.fit(X_train, y_train)
    y_pred = pipe.predict(X_test)

    acc = float(accuracy_score(y_test, y_pred))
    p_macro, r_macro, f1_macro, _ = precision_recall_fscore_support(
        y_test, y_pred, labels=CLASS_LABELS, average="macro", zero_division=0
    )
    p_cls, r_cls, f1_cls, sup_cls = precision_recall_fscore_support(
        y_test, y_pred, labels=CLASS_LABELS, average=None, zero_division=0
    )
    cm = confusion_matrix(y_test, y_pred, labels=CLASS_LABELS)

    per_class = [
        {
            "label": label,
            "precision": round(float(p_cls[i]), 4),
            "recall": round(float(r_cls[i]), 4),
            "f1_score": round(float(f1_cls[i]), 4),
            "support": int(sup_cls[i]),
        }
        for i, label in enumerate(CLASS_LABELS)
    ]

    return {
        "algorithm": algorithm,
        "title": title,
        "labels": CLASS_LABELS,
        "thresholds": {"low_max": round(low_t, 1), "medium_max": round(high_t, 1)},
        "train_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "metrics": {
            "accuracy": round(acc, 4),
            "precision": round(float(p_macro), 4),
            "recall": round(float(r_macro), 4),
            "f1_score": round(float(f1_macro), 4),
        },
        "per_class": per_class,
        "confusion_matrix": cm.tolist(),
        "explanation": explanation,
    }


def run_evaluation_experiment(
    mode: str = "overfitting_underfitting",
    k_folds: int = 5,
) -> Dict[str, Any]:
    """Demonstrate Train-Test Split, K-Fold CV, Overfitting/Underfitting, and Bias-Variance."""
    df = load_lab_dataset(2000)
    X = df[ALL_MODEL_FEATURES]
    y_vol = df["traffic_volume"]

    X_train, X_test, y_train_vol, y_test_vol = train_test_split(
        X, y_vol, test_size=0.2, random_state=42
    )
    y_train, _, _ = label_traffic_volumes(y_train_vol, y_train_vol)
    y_test, _, _ = label_traffic_volumes(y_train_vol, y_test_vol)
    y_all, _, _ = label_traffic_volumes(y_vol, y_vol)

    if mode == "train_test_split":
        results = []
        for alg in ("logistic_regression", "decision_tree", "random_forest"):
            res = run_classification_experiment(algorithm=alg)
            results.append({
                "model": res["title"],
                "accuracy": res["metrics"]["accuracy"],
                "precision": res["metrics"]["precision"],
                "recall": res["metrics"]["recall"],
                "f1_score": res["metrics"]["f1_score"],
            })
        return {
            "mode": mode,
            "title": "Train-Test Split Model Comparison (80/20 Split)",
            "series": results,
            "explanation": (
                "Evaluates Logistic Regression, Decision Tree, and Random Forest on an identical "
                "80/20 split using train-only preprocessing and quantile thresholds."
            ),
        }

    if mode == "cross_validation":
        folds = max(3, min(int(k_folds), 10))
        skf = StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)
        pipe = Pipeline([
            ("preprocessor", _build_classification_preprocessor()),
            ("classifier", RandomForestClassifier(n_estimators=60, max_depth=12, random_state=42, n_jobs=-1)),
        ])
        scores = cross_val_score(pipe, X, y_all, cv=skf, scoring="accuracy")
        fold_series = [
            {"fold": f"Fold {i + 1}", "accuracy": round(float(s), 4)}
            for i, s in enumerate(scores)
        ]
        return {
            "mode": mode,
            "title": f"{folds}-Fold Stratified Cross-Validation (Random Forest)",
            "k_folds": folds,
            "mean_accuracy": round(float(scores.mean()), 4),
            "std_accuracy": round(float(scores.std()), 4),
            "series": fold_series,
            "explanation": (
                f"Splits the dataset into {folds} stratified folds so every sample is tested once. "
                "Reporting mean +/- standard deviation gives a more reliable generalization estimate than one split."
            ),
        }

    if mode == "overfitting_underfitting":
        depths = [1, 2, 3, 5, 8, 12, 16, 22]
        series: List[Dict[str, Any]] = []
        for d in depths:
            pipe = Pipeline([
                ("preprocessor", _build_classification_preprocessor()),
                ("classifier", DecisionTreeClassifier(max_depth=d, random_state=42)),
            ])
            pipe.fit(X_train, y_train)
            train_acc = float(accuracy_score(y_train, pipe.predict(X_train)))
            test_acc = float(accuracy_score(y_test, pipe.predict(X_test)))
            series.append({
                "depth": d,
                "train_accuracy": round(train_acc, 4),
                "test_accuracy": round(test_acc, 4),
                "gap": round(train_acc - test_acc, 4),
            })
        return {
            "mode": mode,
            "title": "Overfitting vs Underfitting Across Decision Tree Depth",
            "series": series,
            "explanation": (
                "At shallow depths (1-2), both train and test accuracy are low (Underfitting / High Bias). "
                "Around depth 5-8, test accuracy peaks. Beyond depth 12+, training accuracy nears 1.0 while "
                "test accuracy drops or plateaus (Overfitting / High Variance)."
            ),
        }

    if mode == "bias_variance":
        configs = [
            ("High Bias (Tree depth=1)", DecisionTreeClassifier(max_depth=1, random_state=42)),
            ("Balanced (Random Forest depth=10)", RandomForestClassifier(n_estimators=60, max_depth=10, random_state=42, n_jobs=-1)),
            ("High Variance (Unpruned Tree)", DecisionTreeClassifier(max_depth=None, random_state=42)),
        ]
        skf = StratifiedKFold(n_splits=4, shuffle=True, random_state=42)
        series = []
        for label, clf in configs:
            pipe = Pipeline([("preprocessor", _build_classification_preprocessor()), ("classifier", clf)])
            pipe.fit(X_train, y_train)
            train_acc = float(accuracy_score(y_train, pipe.predict(X_train)))
            cv_scores = cross_val_score(pipe, X_train, y_train, cv=skf, scoring="accuracy")
            series.append({
                "regime": label,
                "train_accuracy": round(train_acc, 4),
                "cv_mean_accuracy": round(float(cv_scores.mean()), 4),
                "cv_std": round(float(cv_scores.std()), 4),
                "variance_gap": round(train_acc - float(cv_scores.mean()), 4),
            })
        return {
            "mode": mode,
            "title": "Bias-Variance Trade-off Demonstration",
            "series": series,
            "explanation": (
                "High-bias models underfit (low train & CV accuracy). High-variance models memorize training "
                "data (high train accuracy, large gap to CV accuracy). Ensembles like Random Forest balance both."
            ),
        }

    raise ValueError(f"Unsupported evaluation mode: {mode}")

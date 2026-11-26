"""
Tests for Machine Learning Laboratory Endpoints & Algorithms
============================================================
"""

from fastapi.testclient import TestClient
from backend.api.main import app

client = TestClient(app)


def test_ml_lab_regression_algorithms():
    for alg in ("linear", "multiple", "polynomial"):
        resp = client.post("/ml-lab/regression", json={"algorithm": alg, "degree": 2})
        assert resp.status_code == 200
        data = resp.json()
        assert set(data["metrics"].keys()) == {"mae", "mse", "rmse", "r2_score"}
        assert data["metrics"]["rmse"] >= 0
        assert len(data["chart_points"]) > 0


def test_ml_lab_classification_all_six_models():
    for alg in (
        "logistic_regression",
        "knn",
        "decision_tree",
        "random_forest",
        "naive_bayes",
        "svm",
    ):
        resp = client.post("/ml-lab/classification", json={"algorithm": alg, "k": 5, "max_depth": 8})
        assert resp.status_code == 200
        data = resp.json()
        assert 0.0 <= data["metrics"]["accuracy"] <= 1.0
        assert set(data["metrics"].keys()) == {"accuracy", "precision", "recall", "f1_score"}
        assert len(data["confusion_matrix"]) == 3
        assert len(data["per_class"]) == 3


def test_ml_lab_evaluation_modes():
    for mode in ("train_test_split", "cross_validation", "overfitting_underfitting", "bias_variance"):
        resp = client.post("/ml-lab/evaluation", json={"mode": mode, "k_folds": 4})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["series"]) > 0


def test_ml_lab_clustering_and_pca():
    for alg in ("kmeans", "hierarchical", "dbscan"):
        resp = client.post("/ml-lab/clustering", json={"algorithm": alg, "n_clusters": 3})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["cluster_profiles"]) >= 1
        assert len(data["scatter_points"]) > 0

    pca_resp = client.post("/ml-lab/pca", json={"n_components": 2})
    assert pca_resp.status_code == 200
    pca_data = pca_resp.json()
    assert len(pca_data["variance_summary"]) == 2
    assert 0.0 < pca_data["total_variance_explained"] <= 1.0
    assert len(pca_data["scatter_points"]) > 0


def test_ml_lab_association_recommendation_rl_and_ethics():
    for alg in ("apriori", "fpgrowth"):
        resp = client.post(
            "/ml-lab/association-rules",
            json={"algorithm": alg, "min_support": 0.12, "min_confidence": 0.55},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["itemset_count"] > 0
        assert len(data["rules"]) > 0

    rec_resp = client.post(
        "/ml-lab/recommendation",
        json={"preferred_time_slot": "morning_rush", "weather_condition": "Clear", "top_k": 5},
    )
    assert rec_resp.status_code == 200
    assert len(rec_resp.json()["recommendations"]) == 5

    rl_resp = client.post("/ml-lab/reinforcement-learning", json={"episodes": 20, "cycles_per_episode": 6})
    assert rl_resp.status_code == 200
    rl_data = rl_resp.json()
    assert len(rl_data["learning_curve"]) == 20
    assert len(rl_data["strategy_comparison"]) == 3

    ethics_resp = client.get("/ml-lab/ethics")
    assert ethics_resp.status_code == 200
    assert len(ethics_resp.json()["pillars"]) >= 4
    assert len(ethics_resp.json()["future_trends"]) >= 3

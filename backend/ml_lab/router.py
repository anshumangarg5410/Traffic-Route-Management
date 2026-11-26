"""
FastAPI Router for the ITMS Machine Learning Laboratory
=======================================================
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.ml_lab.patterns_and_rl import (
    get_ai_ethics_content,
    run_association_rules_experiment,
    run_recommendation_experiment,
    run_rl_signal_experiment,
)
from backend.ml_lab.supervised import (
    run_classification_experiment,
    run_evaluation_experiment,
    run_regression_experiment,
)
from backend.ml_lab.unsupervised import (
    run_clustering_experiment,
    run_pca_experiment,
)

ml_lab_router = APIRouter()


class RegressionRequest(BaseModel):
    algorithm: str = Field("linear", pattern="^(linear|multiple|polynomial)$")
    degree: int = Field(2, ge=2, le=5)
    test_size: float = Field(0.2, ge=0.1, le=0.4)


class ClassificationRequest(BaseModel):
    algorithm: str = Field(
        "random_forest",
        pattern="^(logistic_regression|knn|decision_tree|random_forest|naive_bayes|svm)$",
    )
    k: int = Field(5, ge=1, le=25)
    max_depth: int = Field(10, ge=1, le=30)
    test_size: float = Field(0.2, ge=0.1, le=0.4)


class EvaluationRequest(BaseModel):
    mode: str = Field(
        "overfitting_underfitting",
        pattern="^(train_test_split|cross_validation|overfitting_underfitting|bias_variance)$",
    )
    k_folds: int = Field(5, ge=3, le=10)


class ClusteringRequest(BaseModel):
    algorithm: str = Field("kmeans", pattern="^(kmeans|hierarchical|dbscan)$")
    n_clusters: int = Field(3, ge=2, le=7)
    eps: float = Field(0.85, ge=0.2, le=3.0)
    min_samples: int = Field(12, ge=3, le=50)


class AssociationRulesRequest(BaseModel):
    algorithm: str = Field("apriori", pattern="^(apriori|fpgrowth)$")
    min_support: float = Field(0.10, ge=0.03, le=0.5)
    min_confidence: float = Field(0.55, ge=0.2, le=0.95)


class RecommendationRequest(BaseModel):
    preferred_time_slot: str = Field(
        "morning_rush",
        pattern="^(morning_rush|midday|evening_rush|night)$",
    )
    weather_condition: str = Field("Clear", min_length=1, max_length=40)
    prefer_low_congestion: bool = True
    top_k: int = Field(5, ge=3, le=10)


class PCARequest(BaseModel):
    n_components: int = Field(2, ge=2, le=6)


class RLSignalRequest(BaseModel):
    episodes: int = Field(35, ge=10, le=80)
    cycles_per_episode: int = Field(8, ge=4, le=15)
    alpha: float = Field(0.2, ge=0.05, le=0.8)
    gamma: float = Field(0.9, ge=0.1, le=0.99)
    epsilon: float = Field(0.2, ge=0.05, le=0.5)


@ml_lab_router.post("/regression", summary="Run regression experiment")
def post_regression(req: RegressionRequest):
    try:
        return run_regression_experiment(
            algorithm=req.algorithm,
            degree=req.degree,
            test_size=req.test_size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@ml_lab_router.post("/classification", summary="Run classification experiment")
def post_classification(req: ClassificationRequest):
    try:
        return run_classification_experiment(
            algorithm=req.algorithm,
            k=req.k,
            max_depth=req.max_depth,
            test_size=req.test_size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@ml_lab_router.post("/evaluation", summary="Run model evaluation & validation experiment")
def post_evaluation(req: EvaluationRequest):
    try:
        return run_evaluation_experiment(mode=req.mode, k_folds=req.k_folds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@ml_lab_router.post("/clustering", summary="Run unsupervised clustering experiment")
def post_clustering(req: ClusteringRequest):
    try:
        return run_clustering_experiment(
            algorithm=req.algorithm,
            n_clusters=req.n_clusters,
            eps=req.eps,
            min_samples=req.min_samples,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@ml_lab_router.post("/association-rules", summary="Run Apriori or FP-Growth association rule mining")
def post_association_rules(req: AssociationRulesRequest):
    try:
        return run_association_rules_experiment(
            algorithm=req.algorithm,
            min_support=req.min_support,
            min_confidence=req.min_confidence,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@ml_lab_router.post("/recommendation", summary="Run content-based traffic window recommender")
def post_recommendation(req: RecommendationRequest):
    return run_recommendation_experiment(
        preferred_time_slot=req.preferred_time_slot,
        weather_condition=req.weather_condition,
        prefer_low_congestion=req.prefer_low_congestion,
        top_k=req.top_k,
    )


@ml_lab_router.post("/pca", summary="Run Principal Component Analysis (PCA)")
def post_pca(req: PCARequest):
    return run_pca_experiment(n_components=req.n_components)


@ml_lab_router.post("/reinforcement-learning", summary="Run Q-Learning traffic signal simulation")
def post_reinforcement_learning(req: RLSignalRequest):
    return run_rl_signal_experiment(
        episodes=req.episodes,
        cycles_per_episode=req.cycles_per_episode,
        alpha=req.alpha,
        gamma=req.gamma,
        epsilon=req.epsilon,
    )


@ml_lab_router.get("/ethics", summary="Get AI ethics and future trends content")
def get_ethics():
    return get_ai_ethics_content()

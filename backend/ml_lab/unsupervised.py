"""
Unsupervised Learning & Dimensionality Reduction Experiments
============================================================

Covers Syllabus Sections:
- D: Clustering (K-Means, Hierarchical Agglomerative, DBSCAN, Silhouette Score)
- G: Dimensionality Reduction (Principal Component Analysis - PCA)
"""

from typing import Any, Dict, List
import numpy as np
from sklearn.cluster import AgglomerativeClustering, DBSCAN, KMeans
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.metrics import silhouette_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from backend.ml_lab.data_loader import NUMERIC_FEATURES, label_traffic_volumes, load_lab_dataset

CLUSTER_FEATURES = ["hour", "temp", "clouds_all", "traffic_volume"]


def run_clustering_experiment(
    algorithm: str = "kmeans",
    n_clusters: int = 3,
    eps: float = 0.85,
    min_samples: int = 12,
) -> Dict[str, Any]:
    """Run K-Means, Hierarchical Clustering, or DBSCAN on standardized traffic patterns."""
    df = load_lab_dataset(1200).copy()

    imputer = SimpleImputer(strategy="median")
    scaler = StandardScaler()
    X_imputed = imputer.fit_transform(df[CLUSTER_FEATURES])
    X_scaled = scaler.fit_transform(X_imputed)

    k = max(2, min(int(n_clusters), 7))

    if algorithm == "kmeans":
        model = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = model.fit_predict(X_scaled)
        title = f"K-Means Clustering (k={k})"
        explanation = (
            "Partitions traffic observations into k centroid-based clusters by minimizing "
            "within-cluster squared Euclidean distance."
        )
    elif algorithm == "hierarchical":
        model = AgglomerativeClustering(n_clusters=k, linkage="ward")
        labels = model.fit_predict(X_scaled)
        title = f"Hierarchical Agglomerative Clustering (k={k}, Ward)"
        explanation = (
            "Bottom-up clustering that iteratively merges the closest pair of clusters "
            "using Ward variance minimization."
        )
    elif algorithm == "dbscan":
        eps_val = max(0.2, min(float(eps), 3.0))
        min_s = max(3, min(int(min_samples), 50))
        model = DBSCAN(eps=eps_val, min_samples=min_s)
        labels = model.fit_predict(X_scaled)
        title = f"DBSCAN Density Clustering (eps={eps_val}, min_samples={min_s})"
        explanation = (
            "Groups densely packed traffic states into arbitrary-shape clusters and marks "
            "sparse outliers as noise (cluster -1)."
        )
    else:
        raise ValueError(f"Unsupported clustering algorithm: {algorithm}")

    unique_labels = sorted(set(int(x) for x in labels))
    non_noise_mask = labels != -1
    non_noise_unique = set(int(x) for x in labels[non_noise_mask])

    sil_score = None
    if len(non_noise_unique) >= 2 and int(non_noise_mask.sum()) > len(non_noise_unique):
        sil_score = round(float(silhouette_score(X_scaled[non_noise_mask], labels[non_noise_mask])), 4)

    # 2D PCA projection for scatter plot
    pca = PCA(n_components=2, random_state=42)
    coords = pca.fit_transform(X_scaled)

    df["cluster"] = labels
    df["pc1"] = coords[:, 0]
    df["pc2"] = coords[:, 1]

    cluster_profiles: List[Dict[str, Any]] = []
    for cid in unique_labels:
        subset = df[df["cluster"] == cid]
        cluster_profiles.append({
            "cluster": "Noise (-1)" if cid == -1 else f"Cluster {cid}",
            "cluster_id": int(cid),
            "count": int(len(subset)),
            "avg_volume": round(float(subset["traffic_volume"].mean()), 1),
            "avg_hour": round(float(subset["hour"].mean()), 1),
            "avg_clouds": round(float(subset["clouds_all"].mean()), 1),
        })

    # Sample up to 240 points for responsive frontend scatter chart
    sample_df = df.iloc[np.linspace(0, len(df) - 1, min(240, len(df)), dtype=int)]
    scatter_points = [
        {
            "pc1": round(float(row["pc1"]), 3),
            "pc2": round(float(row["pc2"]), 3),
            "cluster": int(row["cluster"]),
            "hour": int(row["hour"]),
            "traffic_volume": int(row["traffic_volume"]),
        }
        for _, row in sample_df.iterrows()
    ]

    return {
        "algorithm": algorithm,
        "title": title,
        "features_used": CLUSTER_FEATURES,
        "sample_count": int(len(df)),
        "cluster_count": int(len(non_noise_unique)),
        "noise_count": int((labels == -1).sum()),
        "silhouette_score": sil_score,
        "cluster_profiles": cluster_profiles,
        "scatter_points": scatter_points,
        "explanation": explanation,
    }


def run_pca_experiment(n_components: int = 2) -> Dict[str, Any]:
    """Run PCA on standardized traffic features and return explained variance and 2D projection."""
    df = load_lab_dataset(1200).copy()
    pca_features = NUMERIC_FEATURES + ["traffic_volume"]

    k = max(2, min(int(n_components), len(pca_features)))
    pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("pca", PCA(n_components=k, random_state=42)),
    ])
    projected = pipe.fit_transform(df[pca_features])
    pca_model: PCA = pipe.named_steps["pca"]

    ratios = pca_model.explained_variance_ratio_
    cumulative = np.cumsum(ratios)

    variance_summary = [
        {
            "component": f"PC{i + 1}",
            "explained_variance": round(float(ratios[i]), 4),
            "cumulative_variance": round(float(cumulative[i]), 4),
        }
        for i in range(k)
    ]

    labels, _, _ = label_traffic_volumes(df["traffic_volume"], df["traffic_volume"])
    df["level"] = labels
    df["pc1"] = projected[:, 0]
    df["pc2"] = projected[:, 1]

    sample_df = df.iloc[np.linspace(0, len(df) - 1, min(240, len(df)), dtype=int)]
    scatter_points = [
        {
            "pc1": round(float(row["pc1"]), 3),
            "pc2": round(float(row["pc2"]), 3),
            "level": str(row["level"]),
            "hour": int(row["hour"]),
            "traffic_volume": int(row["traffic_volume"]),
        }
        for _, row in sample_df.iterrows()
    ]

    # Top feature loadings on PC1 & PC2
    loadings = [
        {
            "feature": feat,
            "pc1_loading": round(float(pca_model.components_[0, idx]), 4),
            "pc2_loading": round(float(pca_model.components_[1, idx]), 4),
        }
        for idx, feat in enumerate(pca_features)
    ]

    return {
        "title": f"Principal Component Analysis (n_components={k})",
        "features_used": pca_features,
        "total_variance_explained": round(float(cumulative[-1]), 4),
        "variance_summary": variance_summary,
        "loadings": loadings,
        "scatter_points": scatter_points,
        "explanation": (
            "Projects 10 correlated weather, calendar, and volume features onto orthogonal principal "
            "components ordered by variance captured, enabling 2D visualization of congestion regimes."
        ),
    }

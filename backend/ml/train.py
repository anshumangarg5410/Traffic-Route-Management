
import pandas as pd
import joblib
import os

from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix
)

# --------------------------------------------------
# 1. LOAD DATA
# --------------------------------------------------

df = pd.read_csv(
    "backend/data/processed/traffic_cleaned.csv"
)

df["date_time"] = pd.to_datetime(df["date_time"])

df = df.sort_values("date_time").reset_index(drop=True)

# --------------------------------------------------
# 2. DEFINE FEATURES AND TARGET
# --------------------------------------------------

features = [
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
    "is_weekend"
]

X = df[features]
y_volume = df["traffic_volume"]

# --------------------------------------------------
# 3. CHRONOLOGICAL SPLIT
# --------------------------------------------------

split_index = int(len(df) * 0.8)

X_train = X.iloc[:split_index]
X_test = X.iloc[split_index:]

y_train_volume = y_volume.iloc[:split_index]
y_test_volume = y_volume.iloc[split_index:]

# --------------------------------------------------
# 4. CREATE TARGET LABELS
# --------------------------------------------------

low_threshold = y_train_volume.quantile(0.33)
high_threshold = y_train_volume.quantile(0.66)

def classify_traffic(volume):
    if volume <= low_threshold:
        return "Low"
    elif volume <= high_threshold:
        return "Medium"
    return "High"

y_train = y_train_volume.apply(classify_traffic)
y_test = y_test_volume.apply(classify_traffic)

# --------------------------------------------------
# 5. IDENTIFY FEATURE TYPES
# --------------------------------------------------

categorical_features = [
    "holiday",
    "weather_main"
]

numerical_features = [
    col for col in features
    if col not in categorical_features
]

# --------------------------------------------------
# 6. PREPROCESSING
# --------------------------------------------------

numerical_pipeline = Pipeline([
    ("imputer", SimpleImputer(strategy="median"))
])

categorical_pipeline = Pipeline([
    ("imputer", SimpleImputer(strategy="most_frequent")),
    ("encoder", OneHotEncoder(handle_unknown="ignore"))
])

preprocessor = ColumnTransformer([
    ("numerical", numerical_pipeline, numerical_features),
    ("categorical", categorical_pipeline, categorical_features)
])

# --------------------------------------------------
# 7. RANDOM FOREST MODEL
# --------------------------------------------------

model = RandomForestClassifier(
    n_estimators=150,
    max_depth=20,
    min_samples_split=5,
    random_state=42,
    n_jobs=-1
)

# --------------------------------------------------
# 8. COMPLETE ML PIPELINE
# --------------------------------------------------

pipeline = Pipeline([
    ("preprocessor", preprocessor),
    ("classifier", model)
])

# --------------------------------------------------
# 9. TRAIN
# --------------------------------------------------

print("Training Random Forest model...")

pipeline.fit(X_train, y_train)

print("Training completed!")

# --------------------------------------------------
# 10. PREDICTION
# --------------------------------------------------

y_pred = pipeline.predict(X_test)

# --------------------------------------------------
# 11. EVALUATION
# --------------------------------------------------

print("\nAccuracy:")
print(accuracy_score(y_test, y_pred))

print("\nClassification Report:")
print(classification_report(y_test, y_pred))

print("\nConfusion Matrix:")
print(confusion_matrix(
    y_test,
    y_pred,
    labels=["Low", "Medium", "High"]
))

# --------------------------------------------------
# 12. SAVE MODEL
# --------------------------------------------------

os.makedirs("backend/models", exist_ok=True)

joblib.dump({
    "pipeline": pipeline,
    "low_threshold": low_threshold,
    "high_threshold": high_threshold,
    "features": features
}, "backend/models/traffic_model.pkl")

print("\nModel saved successfully!")

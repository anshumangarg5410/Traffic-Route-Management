
import joblib
import pandas as pd

MODEL_PATH = "backend/models/traffic_model.pkl"

# Load trained model
saved_data = joblib.load(MODEL_PATH)

pipeline = saved_data["pipeline"]
low_threshold = saved_data["low_threshold"]
high_threshold = saved_data["high_threshold"]
features = saved_data["features"]


def predict_traffic(input_data):

    # Convert input into DataFrame
    input_df = pd.DataFrame(
        [input_data],
        columns=features
    )

    # Predict traffic category
    prediction = pipeline.predict(input_df)[0]

    # Get prediction probabilities
    probabilities = pipeline.predict_proba(input_df)[0]

    classes = pipeline.classes_

    confidence = {
        str(label): round(float(prob), 4)
        for label, prob in zip(classes, probabilities)
    }

    return {
        "predicted_traffic_level": str(prediction),
        "confidence": confidence,
        "thresholds": {
            "low_max": float(low_threshold),
            "medium_max": float(high_threshold)
        }
    }

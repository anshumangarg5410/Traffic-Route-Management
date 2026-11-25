
try:
    from backend.services.prediction import predict_traffic
except ModuleNotFoundError:
    from services.prediction import predict_traffic

sample = {
    "holiday": "None",
    "temp": 290.0,
    "rain_1h": 0.0,
    "snow_1h": 0.0,
    "clouds_all": 20,
    "weather_main": "Clear",
    "hour": 18,
    "day": 23,
    "month": 11,
    "day_of_week": 0,
    "is_weekend": 0
}

result = predict_traffic(sample)

print("\nTraffic Prediction")
print("------------------")
print(result)


def test_predict_endpoint_validation_and_error_handling():
    from unittest.mock import patch
    from fastapi.testclient import TestClient
    from backend.api.main import app

    client = TestClient(app)

    ok = client.post("/predict", json=sample)
    assert ok.status_code == 200
    assert ok.json()["predicted_traffic_level"] in {"Low", "Medium", "High"}

    bad_hour = {**sample, "hour": 25}
    assert client.post("/predict", json=bad_hour).status_code == 400

    bad_rain = {**sample, "rain_1h": -1.0}
    assert client.post("/predict", json=bad_rain).status_code == 400

    with patch("backend.api.main.predict_traffic", side_effect=RuntimeError("model error")):
        err = client.post("/predict", json=sample)
    assert err.status_code == 503
    assert "unavailable" in err.json()["detail"].lower()

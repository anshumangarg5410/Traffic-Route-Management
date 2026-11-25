
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


def test_predict_boundary_and_invalid_inputs():
    """Verify valid boundary values succeed and out-of-range weather/time inputs return 400."""
    from fastapi.testclient import TestClient
    from backend.api.main import app

    client = TestClient(app)

    # Valid lower & upper boundaries
    low_boundary = {
        **sample,
        "temp": 180.0,
        "rain_1h": 0.0,
        "snow_1h": 0.0,
        "clouds_all": 0,
        "hour": 0,
        "day": 1,
        "month": 1,
        "day_of_week": 0,
        "is_weekend": 0,
    }
    assert client.post("/predict", json=low_boundary).status_code == 200

    high_boundary = {
        **sample,
        "temp": 340.0,
        "clouds_all": 100,
        "hour": 23,
        "day": 31,
        "month": 12,
        "day_of_week": 6,
        "is_weekend": 1,
    }
    assert client.post("/predict", json=high_boundary).status_code == 200

    invalid_cases = [
        {"temp": 179.9},
        {"temp": 340.1},
        {"snow_1h": -0.1},
        {"clouds_all": -1},
        {"clouds_all": 101},
        {"hour": -1},
        {"day": 0},
        {"day": 32},
        {"month": 0},
        {"month": 13},
        {"day_of_week": -1},
        {"day_of_week": 7},
        {"is_weekend": 2},
    ]
    for override in invalid_cases:
        resp = client.post("/predict", json={**sample, **override})
        assert resp.status_code == 400, f"Expected 400 for {override}, got {resp.status_code}"

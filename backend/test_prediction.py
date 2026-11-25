
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

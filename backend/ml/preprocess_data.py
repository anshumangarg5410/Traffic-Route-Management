
import pandas as pd
import os

# Load original dataset
df = pd.read_csv("backend/data/raw/traffic_volume.csv")

print("Original shape:", df.shape)

# 1. Handle missing holiday values
df["holiday"] = df["holiday"].fillna("None")

# 2. Remove exact duplicate rows
before = len(df)
df = df.drop_duplicates()
print("Exact duplicates removed:", before - len(df))

# 3. Convert timestamp into datetime
df["date_time"] = pd.to_datetime(df["date_time"])

# 4. Handle invalid temperature values
df.loc[df["temp"] <= 0, "temp"] = None

# 5. Handle extreme rainfall
df.loc[df["rain_1h"] > 100, "rain_1h"] = None

# 6. Extract time-based features
df["hour"] = df["date_time"].dt.hour
df["day"] = df["date_time"].dt.day
df["month"] = df["date_time"].dt.month
df["day_of_week"] = df["date_time"].dt.dayofweek
df["is_weekend"] = (
    df["day_of_week"] >= 5
).astype(int)

# 7. Save cleaned dataset
os.makedirs("backend/data/processed", exist_ok=True)

df.to_csv(
    "backend/data/processed/traffic_cleaned.csv",
    index=False
)

print("\nPreprocessing completed!")
print("Final shape:", df.shape)

print("\nMissing values:")
print(df.isnull().sum())

print("\nNew features:")
print(df.columns.tolist())

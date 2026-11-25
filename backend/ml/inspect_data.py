
import pandas as pd

df = pd.read_csv("backend/data/raw/traffic_volume.csv")

# 1. Inspect duplicate records
print("\n--- DUPLICATE RECORDS ---")
duplicates = df[df.duplicated(keep=False)]
print(duplicates.sort_values("date_time"))

# 2. Inspect extreme rainfall
print("\n--- EXTREME RAINFALL ---")
print(
    df[df["rain_1h"] > 100]
)

# 3. Inspect zero temperature
print("\n--- ZERO TEMPERATURE ---")
print(
    df[df["temp"] == 0]
)

# 4. Inspect holiday distribution
print("\n--- HOLIDAY DISTRIBUTION ---")
print(df["holiday"].value_counts(dropna=False))

# 5. Inspect traffic volume distribution
print("\n--- TRAFFIC VOLUME DISTRIBUTION ---")
print(df["traffic_volume"].describe())

# 6. Inspect timestamps
print("\n--- TIMESTAMP RANGE ---")
print("Start:", df["date_time"].min())
print("End:", df["date_time"].max())

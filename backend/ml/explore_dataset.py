
import pandas as pd

# Load dataset
df = pd.read_csv("backend/data/raw/traffic_volume.csv")

# 1. Dataset dimensions
print("\n--- DATASET SHAPE ---")
print(df.shape)

# 2. Column names
print("\n--- COLUMNS ---")
print(df.columns.tolist())

# 3. First five records
print("\n--- FIRST 5 ROWS ---")
print(df.head())

# 4. Data types and null values
print("\n--- DATASET INFO ---")
df.info()

# 5. Missing values
print("\n--- MISSING VALUES ---")
print(df.isnull().sum())

# 6. Statistical summary
print("\n--- STATISTICAL SUMMARY ---")
print(df.describe(include="all"))

# 7. Duplicate records
print("\n--- DUPLICATES ---")
print(df.duplicated().sum())

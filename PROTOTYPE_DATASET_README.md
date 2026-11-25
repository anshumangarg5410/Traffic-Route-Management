# Prototype Synthetic Dataset (`traffic_data.csv`)

## Origin & Purpose
- **Original Author:** Parth Sohal (`Parth-Sohal`, `sohalparth72@gmail.com`)
- **Source Commit:** `c36f14ec3e97583594f2590bf063296d744fb122` (`origin/prototype_ce_1`, September 9, 2026)
- **Purpose:** Early prototype synthetic dataset created during initial corridor modeling experiments for Chandigarh sector pairs.

## Synthetic Prototype Status
`traffic_data.csv` contains **3,024 data rows** (3,025 lines including header) with **0 missing values** and **0 duplicate rows**. It represents a synthetic combinatorial grid (`6 corridors × 7 days × 24 hours × 3 weather conditions = 3,024 rows`) and **does not represent live or observed Chandigarh traffic sensor data**.

## Column Descriptions
| Column | Type | Description |
|---|---|---|
| `road_id` | string | Synthetic Chandigarh sector corridor (`Sector43-Sector9`, `Sector17-Sector22`, `Sector22-Sector9`, `Sector35-Sector43`, `Sector17-Sector35`, `Sector17-Sector8`) |
| `distance_km` | integer | Nominal corridor distance in kilometers |
| `day` | string | Day of week (`Monday`–`Sunday`) |
| `hour` | integer | Hour of day (`0`–`23`) |
| `weather` | string | Simulated weather condition (`Clear`, `Rain`, `Fog`) |
| `traffic` | string | Traffic level label (`Low`, `Moderate`, `High`, `Very High`) |
| `speed_kmh` | float | Simulated average speed (km/h) |
| `travel_time_mins` | float | Simulated travel time (minutes) |

## Distinction from Production ML Dataset
- The active ML model (`backend/models/traffic_model.pkl`, trained via `backend/ml/train.py`) uses the **UCI Minnesota Metro Interstate Traffic Volume** dataset (`backend/data/raw/traffic_volume.csv` and `backend/data/processed/traffic_cleaned.csv`).
- `traffic_data.csv` is **not** merged with the UCI dataset and is **not** used in the active ML training or inference pipeline; it is preserved here as an archival prototype contribution.

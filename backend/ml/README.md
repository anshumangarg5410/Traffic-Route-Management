# ITMS Traffic Classification ML Pipeline

## 1. Dataset Provenance

The traffic classification model is trained on the **UCI Metro Interstate Traffic Volume** dataset (recorded on westbound Interstate 94 between Minneapolis and St. Paul, Minnesota, USA, from 2012 to 2018).

> **Important Scope Note:** This dataset reflects Minnesota interstate highway traffic patterns and is **not** calibrated for live Chandigarh Tricity urban intersection sensors. In ITMS, it serves as a reproducible baseline classifier for regional weather- and time-based congestion categories (`Low`, `Medium`, `High`).

## 2. Features

| Feature | Type | Description |
| :--- | :--- | :--- |
| `holiday` | Categorical | US national holiday name or `"None"` |
| `temp` | Numeric (Kelvin) | Ambient temperature; non-positive (`<= 0 K`) sentinel readings are replaced with `NaN` during preprocessing and imputed |
| `rain_1h` | Numeric (mm/h) | Rainfall volume in the last hour (`> 100 mm/h` outliers treated as `NaN`) |
| `snow_1h` | Numeric (mm/h) | Snowfall volume in the last hour |
| `clouds_all` | Numeric (0–100) | Cloud cover percentage |
| `weather_main` | Categorical | Short weather summary (`Clear`, `Clouds`, `Rain`, `Mist`, etc.) |
| `hour` | Integer (0–23) | Hour of day extracted from `date_time` |
| `day` | Integer (1–31) | Day of month |
| `month` | Integer (1–12) | Month of year |
| `day_of_week` | Integer (0–6) | Day of week (`0 = Monday` .. `6 = Sunday`) |
| `is_weekend` | Binary (0/1) | `1` if `day_of_week >= 5`, else `0` |

## 3. Preprocessing & Validation Workflow

1. **Schema & Bounds Validation (`backend/ml/dataset_validation.py`):**
   - `validate_raw_dataset(df)` checks required columns, parses `date_time`, flags missing/sentinel values, and validates numeric bounds.
   - `validate_processed_dataset(df)` validates derived calendar features and cleaned ranges before training or evaluation.
   - `compute_dataset_statistics(df)` summarizes row counts, duplicates, missingness, date bounds, and numeric min/max/mean/median values.
2. **Preprocessing CLI (`backend/ml/preprocess_data.py`):**
   ```bash
   python3 -m backend.ml.preprocess_data --input backend/data/raw/traffic_volume.csv --output backend/data/processed/traffic_cleaned.csv --stats
   ```
   Handles missing/empty/unreadable files cleanly and exits with non-zero status on validation failure.

## 4. Training, Evaluation & Model Promotion

1. **Chronological Split & Labeling (`backend/ml/train.py`):**
   - Data is sorted chronologically by `date_time` and split `80%` train / `20%` test to prevent temporal leakage.
   - Traffic volume thresholds (`low_threshold` at 33rd percentile, `high_threshold` at 66th percentile) are computed **only on the training split** and applied to both splits to form `Low`, `Medium`, and `High` labels.
   - A `scikit-learn` `Pipeline` (`SimpleImputer` + `OneHotEncoder(handle_unknown="ignore")` + `RandomForestClassifier(n_estimators=150, max_depth=20, min_samples_split=5, random_state=42)`) is fit on the training split.
2. **Reproducible Evaluation (`backend/ml/evaluate.py`):**
   - Computes `accuracy`, `macro_precision`, `macro_recall`, `macro_f1`, `weighted_f1`, per-class precision/recall/F1/support, and the 3x3 confusion matrix.
   - Standalone evaluation CLI:
     ```bash
     python3 -m backend.ml.evaluate --model backend/models/traffic_model.pkl --data backend/data/processed/traffic_cleaned.csv
     ```
3. **Candidate-vs-Active Comparison:**
   - Before overwriting `backend/models/traffic_model.pkl`, `compare_models()` checks that candidate `macro_f1` does not regress below the active model's stored `macro_f1`. Existing artifacts are preserved if validation or comparison fails (unless `--force` is passed).

## 5. Known Limitations

- **Geographic Domain Shift:** Trained on a single Minnesota interstate corridor rather than multi-corridor Chandigarh Tricity loop/camera telemetry.
- **Static Quantile Thresholds:** `Low`/`Medium`/`High` boundaries are derived from historical training percentiles rather than road-capacity-specific LOS standards.
- **No Incident/Event Context:** Predictions depend solely on calendar and weather features; live roadwork, accidents, or special local events are not modeled.

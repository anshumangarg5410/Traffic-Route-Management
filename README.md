# Intelligent Traffic Management System (ITMS)

An adaptive traffic signal optimization and macroscopic simulation platform integrating machine learning traffic classification, demand-aware signal timing, Highway Capacity Manual (HCM) lane-based capacity constraints, deterministic validation scenarios, and Monte Carlo parametric sensitivity analysis with Common Random Numbers (CRN).

---

## 1. System Architecture

The system consists of two primary tiers:
- **Backend**: Python 3.12, FastAPI, Scikit-learn Random Forest, NumPy, SciPy.
- **Frontend**: React 19, Vite, Tailwind CSS, Lucide icons, Recharts.

```
                          ┌────────────────────────┐
                          │     React Frontend     │
                          │ (Vite + Tailwind CSS)  │
                          └───────────┬────────────┘
                                      │ HTTP REST API
                                      ▼
                          ┌────────────────────────┐
                          │    FastAPI Backend     │
                          └───────────┬────────────┘
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│ Machine Learning │        │ Signal Optimizer │        │ Traffic Simulator│
│  Random Forest   │        │   Demand-Aware   │        │ Poisson Arrivals │
│ UCI Corridor Vol │        │  Water-Filling   │        │ Capacity Bounds  │
└──────────────────┘        └──────────────────┘        └──────────────────┘
                                                                   │
                                                                   ▼
                                                        ┌──────────────────┐
                                                        │ Metrics & Stats  │
                                                        │ Conservation Law │
                                                        │ Paired Monte C.  │
                                                        └─────────┬────────┘
                                                                  │
                                                                  ▼
                                                        ┌──────────────────┐
                                                        │ Validation &     │
                                                        │ Sensitivity MC   │
                                                        │ Policy Audits    │
                                                        └──────────────────┘
```

---

## 2. Phase 6 & Phase 7.1: Intersection Model & Capacity Constraints

### A. Intersection Geometry & Phase Model
- **Isolated Four-Approach Intersection**: North, South, East, and West approaches.
- **Cycle Timing**:
  - Total Cycle Duration: $C = 120\text{ seconds}$.
  - Clearance Interval: $I = 20\text{ seconds}$ (inter-stage yellow and all-red clearance).
  - Total Available Green: $G_{\text{total}} = 100\text{ seconds}$.
  - Minimum Green Time: $G_{\min} = 10\text{ seconds}$ per approach.
  - Maximum Green Time: $G_{\max} = 40\text{ seconds}$ per approach.

### B. Startup Lost Time & Effective Green Time
Nominal green time $G_d$ allocated to direction $d$ is reduced by startup lost time $l_s$ (default: $2.0\text{ seconds}$) due to driver reaction time and vehicle acceleration delay:
$$g_d = \max(0.0, G_d - l_s)$$

### C. Lane-Based Discharge Capacity Formulation
Following standard Highway Capacity Manual (HCM) formulations, theoretical discharge capacity $C_d$ for direction $d$ during a single cycle is:
$$C_d = s_d \times L_d \times \frac{g_d}{3600}$$
Where:
- $C_d$: Theoretical discharge capacity in vehicles.
- $s_d$: Saturation flow rate in vehicles / hour / lane (default illustrative parameter: $1800\text{ veh/hr/lane}$).
- $L_d$: Number of service lanes for direction $d$ ($L_d \ge 1$, default: $1$).
- $g_d$: Effective green time in seconds.

### D. Integer Discharge Policies & Carryover Boundary Fix (Phase 7.1)
The system supports two configurable integer discharge policies:

1. **Approach A: Independent Cycle Floor (`independent_floor`, Default)**:
   $$D_{d, c} = \min\left(Q_{\text{waiting}, d}, \lfloor C_{d, c} \rfloor\right)$$
   Fractional capacity $C_{d, c} - \lfloor C_{d, c} \rfloor$ is discarded independently each cycle.
2. **Approach B: Fractional Service Carryover (`fractional_carryover`)**:
   Accumulates fractional vehicle capacity across consecutive saturated cycles:
   $$\text{Available Capacity} = \text{carryover}_{d, c-1} + C_{d, c}$$
   $$\text{Integer Capacity} = \lfloor \text{Available Capacity} \rfloor$$
   $$D_{d, c} = \min\left(Q_{\text{waiting}, d}, \text{Integer Capacity}\right)$$
   
   **Phase 7.1 Boundary Condition Fix**:
   - Carryover credit survives **only** if the queue remains non-empty after discharge:
     $$\text{Remaining Queue} = Q_{\text{waiting}, d} - D_{d, c}$$
     $$\text{carryover}_{d, c} = \begin{cases} \text{Available Capacity} - \text{Integer Capacity} & \text{if Remaining Queue} > 0 \\ 0.0 & \text{if Remaining Queue} = 0 \end{cases}$$
   - **No fractional credit survives a fully cleared queue**: When an approach queue fully clears (e.g., initial queue 11 equals integer capacity 11), carryover immediately resets to $0.0$.
   - **Non-accumulating integer service**: Integer capacity is never banked or accumulated across idle or low-demand cycles.
   - **Strict fractional bound**: $0.0 \le \text{carryover} < 1.0$.

### E. Directional Arrival Rates & Stochastic Poisson Process
Directional arrival rates $\lambda_d$ are configured in **vehicles / minute**. Because signal cycle duration is $C = 120\text{ seconds}$ ($2.0\text{ minutes}$), the expected vehicle arrivals per cycle are calculated via exactly one dimensional conversion:
$$\lambda_{\text{cycle}, d} = \lambda_d \times \frac{C}{60.0} = \lambda_d \times 2.0\text{ vehicles / cycle}$$

For each simulated cycle and direction, discrete vehicle arrivals $\Delta A_d$ are sampled independently from a Poisson distribution:
$$\Delta A_d \sim \text{Poisson}(\lambda_{\text{cycle}, d})$$

### F. Capacity Utilization
For each cycle and in aggregate across all cycles:
$$\text{Capacity Utilization}_d = \begin{cases} \left(\frac{\text{Actual Discharged}_d}{C_d}\right) \times 100\% & \text{if } C_d > 0 \\ 0.0\% & \text{if } C_d = 0 \end{cases}$$

### G. Vehicle Conservation Law
Every simulation run verifies strict physical vehicle conservation:
$$Q_{\text{final}} = Q_{\text{initial}} + A_{\text{total}} - D_{\text{total}}$$

---

## 3. Phase 7, 7.1 & 7.1.1: Validation Framework & Monte Carlo Sensitivity Analysis

### A. Predefined Deterministic Scenarios (All 8 Scenarios)
The validation module (`simulation_validator.py`) programmatically executes eight controlled traffic scenarios and a discharge policy audit:
- **Scenario A (No Traffic)**: Verifies 0 arrivals, 0 discharge, 0 remaining, 0.0s delay, and absence of division-by-zero errors.
- **Scenario B (Balanced Demand)**: Explicitly verifies balanced directional demand across all approaches ($6.0\text{ veh/min}$ arrivals, $25\text{ veh}$ initial queues), equal nominal green allocation ($25\text{s}$ each), and conservation verification for both Adaptive and Fixed strategies without arbitrary performance thresholds.
- **Scenario C (Extreme Directional Asymmetry)**: Verifies adaptive optimization caps critical approach at $G_{\max} = 40\text{s}$ and minimizes starved approaches.
- **Scenario D (Capacity-Constrained Traffic)**: Verifies queue growth across **all four approaches** (North, South, East, West) when arrival demand strictly exceeds single-lane capacity. Under fractional carryover, individual cycles may legitimately discharge more than raw per-cycle theoretical capacity due to banked fractional headway, so it verifies cumulative invariants independently for all four directions: $\sum D \le \sum C_{\text{theoretical}}$ and $\sum D \le Q_{\text{initial}} + \sum A$, while confirming appropriate per-cycle bounds under independent-floor policy and mass conservation.
- **Scenario E (Queue Clearance)**: Verifies that a finite queue of 22 vehicles under 11 veh/cycle capacity clears in exactly 2 cycles.
- **Scenario F (Zero Effective Green)**: Verifies that startup lost time equal to nominal green yields 0.0s effective green and 0 discharge.
- **Scenario G (Variable Lane Configurations)**: Verifies multilane geometric capacity scaling (North: 3 lanes $\approx 34\text{ veh}$, South: 2 lanes $\approx 23\text{ veh}$, East/West: 1 lane $\approx 11\text{ veh}$) under saturated demand.
- **Scenario H (Vehicle Conservation Invariant)**: 10-cycle multi-approach stress test confirming mass conservation invariant $Q_{\text{final}} = Q_{\text{initial}} + A_{\text{total}} - D_{\text{total}}$ holds identically on every cycle and overall across both strategies.
- **Discharge Policy Audit**: Direct empirical comparison of Approach A (Independent Floor) versus Approach B (Fractional Carryover).

### B. Waiting-Time Delay Formulation
Approximates macroscopic cycle delay using a trapezoidal queue area model:
$$q_{\text{avg}} = \frac{q_{\text{before\_discharge}} + q_{\text{after}}}{2}$$
$$\text{Delay}_{\text{cycle}} = q_{\text{avg}} \times T_{\text{cycle}}$$
$$\text{Average Waiting Time} = \frac{\sum_{\text{cycles}} \text{Delay}_{\text{cycle}}}{Q_{\text{initial}} + A_{\text{total}}}$$
*Note*: This represents a cycle-level macroscopic proxy for strategy comparison, not continuous microscopic individual vehicle trajectory telemetry.

### C. Monte Carlo One-At-A-Time (OAT) Sensitivity Sweeps
The sensitivity engine (`sensitivity_analyzer.py`) evaluates model response across:
- Directional arrival rates ($2.0 \to 25.0\text{ veh/min}$)
- Initial queue sizes ($0 \to 100\text{ veh}$)
- Approach lane counts ($1 \to 4\text{ lanes}$)
- Saturation flow rates ($1200 \to 2400\text{ veh/hr/lane}$)
- Startup lost times ($0.0 \to 5.0\text{s}$)
- Cycle counts ($1 \to 10\text{ cycles}$)

#### Monte Carlo Replicates & Common Random Numbers (CRN)
- **Configurable Replicates**: $R$ runs (default: 30, minimum: 2, maximum: 100).
- **Paired Seeds**: For each replicate $r \in [0, R-1]$, a deterministic PRNG seed is derived from `base_seed` (default: 42).
- **Strategy Pairing**: Within each replicate, Fixed and Adaptive strategies receive the **identical** random seed, guaranteeing identical stochastic Poisson arrival streams.
- **Cross-Parameter Pairing**: The same sequence of replicate seeds is applied across all parameter values in the sweep.

#### Pointwise Statistical Calculations & 95% Confidence Intervals
For each metric $X = [x_1, \dots, x_R]$ evaluated at a specific parameter setting:
1. **Sample Mean**:
   $$\bar{x} = \frac{1}{R}\sum_{i=1}^R x_i$$
2. **Sample Standard Deviation** ($R \ge 2$, with Bessel's correction $ddof=1$):
   $$s = \sqrt{\frac{1}{R - 1}\sum_{i=1}^R (x_i - \bar{x})^2}$$
3. **Pointwise 95% Student's t Confidence Interval**:
   $$df = R - 1, \quad t_{\text{crit}} = t_{0.975, df}$$
   $$\text{Margin of Error } (ME) = t_{\text{crit}} \times \frac{s}{\sqrt{R}}$$
   $$\text{CI}_{95\%} = [\max(0.0, \bar{x} - ME), \bar{x} + ME]$$
   *(If $s = 0.0$ or $R < 2$, $ME = 0.0$ and $\text{CI} = [\bar{x}, \bar{x}]$).*

#### Pointwise Paired Strategy-Difference Statistics
For each Monte Carlo replicate $r$, the paired difference is calculated at the replicate level:
$$d_r = \text{Metric}_{\text{fixed}, r} - \text{Metric}_{\text{adaptive}, r}$$
- **Sign Convention**: $\text{Fixed} - \text{Adaptive}$. A positive difference ($\bar{d} > 0$) indicates that the Adaptive strategy outperformed the Fixed-time baseline by reducing remaining queue or average waiting delay.
- **Paired Mean Difference**:
  $$\bar{d} = \frac{1}{R}\sum_{r=1}^R d_r = \bar{x}_{\text{fixed}} - \bar{x}_{\text{adaptive}}$$
- **Paired Sample Standard Deviation**:
  $$s_d = \sqrt{\frac{1}{R - 1}\sum_{r=1}^R (d_r - \bar{d})^2}$$
- **Standard Error of the Mean Difference**:
  $$SE = \frac{s_d}{\sqrt{R}}$$
- **Pointwise 95% Student's t Confidence Interval for Paired Difference**:
  $$\text{CI}_{95\%} = [\bar{d} - t_{\text{crit}} \cdot SE, \; \bar{d} + t_{\text{crit}} \cdot SE]$$
  *(Calculated directly from replicate-level paired differences, capturing variance reduction from Common Random Numbers correlation).*

#### Scope and Interpretation of Pointwise Confidence Intervals
1. **Simulation Sampling Uncertainty**: The reported confidence intervals quantify stochastic simulation sampling variability arising from Poisson vehicle arrivals under the model's macroscopic fluid-queue assumptions.
2. **Pointwise vs. Simultaneous**: Intervals are evaluated independently point-by-point at each distinct parameter level. They are **not simultaneous confidence intervals or confidence bands** across all parameter values in a sweep (no family-wise error rate or Bonferroni/Scheffé multiple-comparison corrections are applied).
3. **Not Empirical Traffic Performance**: These intervals measure mathematical precision within the simulation environment and **do not establish or predict empirical real-world traffic performance or delay**.

---

## 4. API Endpoints & Computational Limits

| Endpoint | Method | Computational Limits | Description |
|---|---|---|---|
| `/` | GET | None | Health check |
| `/predict` | POST | None | ML macroscopic traffic volume classification |
| `/optimize-signal` | POST | None | Demand-aware green signal allocation |
| `/simulate` | POST | $1 \le \text{cycles} \le 100$ | Stochastic simulation with capacity constraints |
| `/compare-strategies` | POST | $1 \le \text{runs} \le 50$ | Monte Carlo paired comparison with CRN |
| `/integrated-prediction` | POST | None | Composite ML context + directional simulation |
| `/unified-workflow` | POST | $1 \le \text{cycles} \le 50, 1 \le \text{runs} \le 50$ | Unified end-to-end workflow (ML prediction, signal allocation, simulation, and paired comparison) |
| `/validation-scenarios` | GET | None | Executes all 8 deterministic validation scenarios and policy audit |
| `/sensitivity-analysis` | POST | $2 \le \text{runs} \le 100$, $\le 20$ values | Monte Carlo parameter sensitivity sweep |

### Computational Limits & Parameter-Specific Validation Enforced on `/sensitivity-analysis`
1. `parameter_values`: Maximum 20 values per request; non-empty list; numeric, finite, non-negative (or valid strategy strings); booleans rejected with HTTP 400.
2. `lanes`: Strictly positive integer ($1 \le \text{lanes} \le 8$).
3. `saturation_flow_rate`: Strictly positive finite numeric ($> 0.0\text{ veh/hr/lane}$).
4. `startup_lost_time`: Non-negative finite numeric ($\ge 0.0\text{s}$).
5. `arrival_rate`: Non-negative finite numeric ($\ge 0.0\text{ veh/min}$).
6. `initial_queue`: Non-negative integer ($\ge 0\text{ veh}$).
7. `cycles`: Strictly positive integer ($\ge 1\text{ cycles}$).
8. `runs`: Integer between 2 and 100 (default: 30); booleans rejected.
9. `target_direction`: Optional; restricted to `north`, `south`, `east`, `west`.

### Example Sensitivity API Request & Response

#### Request
```json
POST /sensitivity-analysis HTTP/1.1
Content-Type: application/json

{
  "parameter_name": "arrival_rate",
  "parameter_values": [4.0, 8.0, 12.0],
  "runs": 30,
  "compare_both_strategies": true
}
```

#### Response (Excerpt)
```json
{
  "parameter_name": "arrival_rate",
  "target_direction": "all_directions",
  "paired_seed": 42,
  "runs": 30,
  "sweep_count": 3,
  "results": [
    {
      "parameter_value": 4.0,
      "runs": 30,
      "adaptive": {
        "final_queue_mean": 8.43,
        "final_queue_std": 2.15,
        "final_queue_ci95": [7.63, 9.24],
        "final_queue": 8.43,
        "total_discharged_mean": 95.8,
        "total_discharged_std": 3.42,
        "average_waiting_time_mean": 24.12,
        "average_waiting_time_std": 1.84,
        "average_waiting_time_ci95": [23.43, 24.81],
        "average_waiting_time": 24.12,
        "capacity_utilization_mean": 68.4,
        "capacity_utilization_std": 2.1,
        "vehicle_conservation_verified": true
      },
      "fixed": {
        "final_queue_mean": 11.20,
        "final_queue_std": 2.87,
        "final_queue_ci95": [10.13, 12.27],
        "final_queue": 11.20,
        "average_waiting_time_mean": 28.65,
        "average_waiting_time_std": 2.10,
        "average_waiting_time_ci95": [27.87, 29.43],
        "vehicle_conservation_verified": true
      },
      "paired_differences": {
        "final_queue": {
          "mean_difference": 2.77,
          "std_difference": 1.45,
          "standard_error": 0.26,
          "ci_95": [2.23, 3.31],
          "margin_of_error": 0.54,
          "sign_convention": "fixed - adaptive (positive value indicates adaptive reduction in remaining queue)"
        },
        "average_waiting_time": {
          "mean_difference": 4.53,
          "std_difference": 1.12,
          "standard_error": 0.20,
          "ci_95": [4.11, 4.95],
          "margin_of_error": 0.42,
          "sign_convention": "fixed - adaptive (positive value indicates adaptive delay reduction in seconds)"
        }
      },
      "vehicles_saved_mean": 2.77,
      "delay_saved_seconds_mean": 4.53,
      "vehicles_saved": 2.77,
      "delay_saved_seconds": 4.53
    }
  ]
}
```

### Phase 8.3: Unified End-to-End Workflow (`POST /unified-workflow`)

The unified workflow endpoint combines regional ML classification, directional intersection configuration, baseline signal optimization, adaptive macroscopic simulation, and paired Monte Carlo comparison into a single structured API contract.

#### Workflow Orchestration Pipeline
```
[Client Request: Weather + Directional Queues + Rates + Geometry + Runs]
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
1. Regional ML Prediction                2. Explicit Directional Inputs
   (Random Forest Classifier)               (Preserved independently; optional
   -> Category & Probabilities               illustrative scenario scaling)
         │                                               │
         └───────────────────────┬───────────────────────┘
                                 │
                                 ▼
                     3. Signal Allocation Baseline
                        (optimize_signal at t=0)
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
4. Adaptive Simulation                   5. Paired Monte Carlo Comparison
   (Single-run realization                  (N trials under Common Random
   with explicit seed for                   Numbers; paired difference stats
   visualizer timeline)                     & Student's t 95% CIs)
         │                                               │
         └───────────────────────┬───────────────────────┘
                                 │
                                 ▼
               6. Consolidated Response Contract
                  (ml_prediction, directional_inputs,
                   signal_allocation, simulation_results,
                   strategy_comparison, model_assumptions)
```

#### Request Example
```json
POST /unified-workflow HTTP/1.1
Content-Type: application/json

{
  "holiday": "None",
  "temp": 293.15,
  "rain_1h": 0.0,
  "snow_1h": 0.0,
  "clouds_all": 20,
  "weather_main": "Clear",
  "hour": 17,
  "day": 23,
  "month": 11,
  "day_of_week": 0,
  "is_weekend": 0,
  "initial_queues": {
    "north": 35,
    "south": 25,
    "east": 15,
    "west": 10
  },
  "arrival_rates": {
    "north": 10.0,
    "south": 7.0,
    "east": 4.0,
    "west": 3.0
  },
  "lanes": {
    "north": 2,
    "south": 2,
    "east": 1,
    "west": 1
  },
  "saturation_flow_rates": {
    "north": 1800.0,
    "south": 1800.0,
    "east": 1800.0,
    "west": 1800.0
  },
  "startup_lost_times": {
    "north": 2.0,
    "south": 2.0,
    "east": 2.0,
    "west": 2.0
  },
  "discharge_policy": "independent_floor",
  "cycles": 4,
  "runs": 5,
  "random_seed": 42,
  "apply_ml_scenario_scaling": false
}
```

#### Response Structure (6 Separated Sections)
```json
{
  "ml_prediction": {
    "predicted_traffic_level": "High",
    "class_probabilities": { "Low": 0.12, "Medium": 0.28, "High": 0.60 },
    "classification_thresholds": { "low_max": 2000.0, "medium_max": 4500.0 },
    "model_metadata": { "model": "Random Forest Classifier", "dataset": "UCI Metro Interstate Traffic Volume Dataset" },
    "model_scope": "Regional freeway corridor classification. Does not model intersection turning movements.",
    "confidence_interpretation": "Class probabilities represent Random Forest tree voting fractions and should not be interpreted as calibrated posterior confidence."
  },
  "directional_inputs": {
    "initial_queues": { "north": 35, "south": 25, "east": 15, "west": 10 },
    "arrival_rates": { "north": 10.0, "south": 7.0, "east": 4.0, "west": 3.0 },
    "effective_arrival_rates": { "north": 10.0, "south": 7.0, "east": 4.0, "west": 3.0 },
    "lanes": { "north": 2, "south": 2, "east": 1, "west": 1 },
    "saturation_flow_rates": { "north": 1800.0, "south": 1800.0, "east": 1800.0, "west": 1800.0 },
    "startup_lost_times": { "north": 2.0, "south": 2.0, "east": 2.0, "west": 2.0 },
    "discharge_policy": "independent_floor",
    "scenario_scaling": {
      "applied": false,
      "multiplier": 1.0,
      "predicted_category": "High",
      "note": "Directional arrival rates used exactly as supplied by the user. Regional ML prediction is not coupled to directional queues."
    }
  },
  "signal_allocation": {
    "timing_source": "initial_queue_baseline",
    "description": "Signal timing allocation computed from initial queues at cycle 0. In adaptive simulation, green times are dynamically re-optimized each cycle based on evolving queues.",
    "green_times": { "north": 37, "south": 28, "east": 20, "west": 15 },
    "relative_demands": { "north": 0.4118, "south": 0.2941, "east": 0.1765, "west": 0.1176 },
    "cycle_time": 120,
    "clearance_time": 20,
    "total_green_time": 100,
    "min_green": 10,
    "max_green": 40
  },
  "simulation_results": {
    "strategy": "adaptive",
    "random_seed": 42,
    "cycles_simulated": 4,
    "final_queues": { "north": 4, "south": 3, "east": 1, "west": 0 },
    "history": [ "/* cycle-by-cycle discharge, capacity, queues */" ],
    "metrics": { "overall": "/* ... */", "by_direction": "/* ... */" },
    "vehicle_conservation": {
      "total_initial_queue": 85,
      "total_arrivals": 98,
      "total_discharged": 175,
      "total_remaining": 8,
      "is_conserved": true,
      "discrepancy": 0
    }
  },
  "strategy_comparison": {
    "monte_carlo_runs": 5,
    "base_seed": 42,
    "fixed_strategy": { "total_waiting": 45.2, "average_waiting_time": 32.1, "average_discharged": 142.0 },
    "adaptive_strategy": { "total_waiting": 12.4, "average_waiting_time": 22.4, "average_discharged": 172.5 },
    "comparison_summary": { "vehicles_saved": 32.8, "improvement_percentage": 72.57 },
    "paired_difference_statistics": {
      "metric": "vehicles_saved (fixed_waiting - adaptive_waiting)",
      "mean_paired_difference": 32.8,
      "sample_std_paired_difference": 4.12,
      "standard_error": 1.84,
      "confidence_interval_95": { "lower": 27.69, "upper": 37.91, "t_critical": 2.776 },
      "crn_methodology_note": "Common Random Numbers (CRN) synchronizes arrival streams to isolate control strategy effects from arrival stochasticity."
    },
    "win_tie_statistics": { "total_runs": 5, "adaptive_wins": 5, "fixed_wins": 0, "ties": 0, "win_rate_adaptive_percentage": 100.0, "win_rate_fixed_percentage": 0.0 },
    "simulation_distinction": "The single-run simulation results in 'simulation_results' represent one specific stochastic realization (seed: 42) for timeline visualization, whereas 'strategy_comparison' reports multi-run aggregate statistics across 5 Monte Carlo trials under Common Random Numbers."
  },
  "model_assumptions": {
    "regional_ml_scope": "Trained on UCI freeway volume data; provides macro-level corridor context, not local intersection turning movements.",
    "directional_input_independence": "Directional queues and arrival rates are independently supplied and never derived from regional ML classification.",
    "macroscopic_simulation": "Point-queue macroscopic fluid model; does not simulate vehicle car-following, lane changes, or spatial acceleration/deceleration.",
    "arrival_process": "Poisson arrivals with stationary mean rates per cycle.",
    "signal_control_phasing": "Isolated 4-approach split-phase sequence (North -> South -> East -> West) with 120s cycle and 20s total clearance time.",
    "capacity_and_discharge": "HCM-based saturation flow (default 1800 veh/hr/ln) and startup lost time (default 2.0s) with integer vehicle discharge.",
    "statistical_inference": "Confidence intervals are pointwise 95% Student's t intervals on paired differences under Common Random Numbers.",
    "calibration_status": "Illustrative research and demonstration platform; parameters are not field-calibrated against local intersection telemetry."
  }
}
```

#### Random Seed & Common Random Numbers (CRN) Separation
1. **Single-Run Visualization Realization**: The `simulation_results` object provides the specific cycle-by-cycle trajectory for the top-down visualizer and cycle timeline. Its seed is explicitly recorded in `simulation_results.random_seed`.
2. **Multi-Run Monte Carlo Distribution**: The `strategy_comparison` object aggregates $R$ trials initialized with deterministic paired seeds derived from the master `base_seed`. In each trial $r$, both Fixed and Adaptive simulators receive the exact same arrival stream.
3. **No Conflation**: Single-run metrics are never confused with Monte Carlo expected means.

#### Scenario Scaling vs. Learned Predictions
- **Decoupled Architecture**: Regional highway traffic volume from the Random Forest model is never mapped directly to local turning movements.
- **Optional Scenario Multiplier**: When `apply_ml_scenario_scaling` is enabled, directional arrival rates are scaled by an illustrative multiplier ($0.85\times$ for Low, $1.0\times$ for Medium, $1.25\times$ for High). The multiplier is clearly tagged as an illustrative scenario multiplier, preserving transparency.

---

## 5. Assumptions, Model Scope & Empirical Limitations

1. **Macroscopic Fluid-Queue Modeling**:
   - The simulation engine uses discrete-cycle macroscopic queue approximations with Poisson arrival processes.
   - It does **not** track microscopic vehicle car-following, gap acceptance, lane-changing physics, or individual vehicle trajectory telemetry.
2. **Not a Substitute for Microscopic Simulators**:
   - This tool does **not** replace calibrated microscopic simulation software such as **SUMO** (Simulation of Urban MObility) or **VISSIM**.
   - Defaults ($1800\text{ veh/hr/lane}$ saturation flow, $2.0\text{s}$ lost time) are standard illustrative engineering baselines, not field-calibrated local intersection parameters.
3. **Statistical Confidence Intervals vs. Empirical Accuracy**:
   - The reported intervals are **pointwise 95% Student's t confidence intervals** ($df = R - 1$) that quantify **stochastic simulation sampling uncertainty** under the mathematical assumptions of the Poisson arrival generator and macroscopic queue model.
   - They are evaluated independently at each parameter point and are **not simultaneous confidence intervals** across the parameter sweep (no family-wise error rate or multiple-testing corrections are applied).
   - They reflect mathematical simulation precision across random replicates and **must not be interpreted as empirical guarantees of real-world traffic prediction accuracy or field intersection performance**.
4. **ML Model Domain Scope**:
   - The Random Forest classifier predicts macroscopic freeway corridor volume categories (`Low`, `Medium`, `High`) based on weather and calendar features from the UCI Metro Interstate dataset.
   - It does **not** predict microscopic directional intersection turning movements. Directional queues and arrival rates are independently parameterized in the simulation engine.

---

## 6. Running the Application

### Backend
```bash
# Activate virtual environment
source .venv/bin/activate

# Run complete test suite (150 tests)
python3 -m pytest backend/ -v

# Run standalone component verifications
python3 -m backend.test_prediction
python3 -m backend.test_optimizer
python3 -m backend.test_simulator
python3 -m backend.test_comparison

# Start FastAPI server
uvicorn backend.api.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install

# Run ESLint (0 errors, 0 warnings)
npm run lint

# Production build
npm run build

# Start Vite development server
npm run dev
```

---

## 7. Phase 9.1: Chandigarh Tricity Road Network Foundation

Phase 9.1 establishes the geographic and topological road-network foundation covering the greater Chandigarh Tricity urban region and its connecting regional corridors.

### A. Geographic Scope & Target Coverage
The bounding box `(west: 76.5900, south: 30.5400, east: 76.9300, north: 30.8500)` encompasses approximately $1,120\text{ km}^2$ and guarantees coverage across seven key urban zones:
1. **Chandigarh**: Union Territory capital, central planned grid (Sectors 1–63).
2. **Mohali (SAS Nagar)**: Southwest commercial & IT corridor (Sectors 53–115).
3. **Panchkula**: Planned satellite city southeast of Chandigarh (Sectors 1–32 and MDC).
4. **Zirakpur**: Major inter-state highway junction connecting Chandigarh with Delhi and Patiala (NH-152 / NH-7).
5. **Kharar**: High-growth residential hub northwest of Mohali on NH-5 / NH-205.
6. **New Chandigarh (Mullanpur)**: Northern master-planned extension (EcoCity, Medicity).
7. **Dera Bassi**: Southern industrial and logistics gateway on NH-152.

All seven target areas are validated against the nearest graph node with an average proximity under 100 meters (maximum distance: 196 meters).

### B. Data Source & Attribution
- **Source**: OpenStreetMap contributors ([ODbL](https://www.openstreetmap.org/copyright)).
- **Extraction Tool**: OSMnx 2.1.0 and NetworkX 3.5.
- **Filter Type**: `network_type="drive"`, extracting all drivable public roads while omitting pedestrian footways, cycleways, and private tracks.
- **Partitioning & Redundancy**: Multi-quadrant extraction with overlapping boundary buffers and multi-mirror Overpass failover (`ovp.dresel.systems/api-as`, `ovp.dresel.systems/api`, `overpass-api.de/api`), completely avoiding server timeout constraints.

### C. Persistent Storage Architecture
Extracted graphs are validated and stored locally to eliminate runtime Overpass API dependencies:
- **GraphML Graph**: `backend/data/road_network/chandigarh_tricity.graphml` (49 MB).
- **Metadata Document**: `backend/data/road_network/network_metadata.json` (extraction timestamps, bounding box bounds, graph statistics, and target area coverage verification).
- **In-Memory Cache**: `load_network_graph()` caches the parsed `MultiDiGraph` in Python memory, preventing repeated disk parsing overhead.

### D. Network Topology & Graph Statistics (Phase 9.1.1 Audited)
- **Nodes**: 56,254
- **Directed Edges**: 144,015
- **Directed Edge Road Length**: 13,092.88 km (directional lane/roadway kilometers)
- **Estimated Unique Physical Road Length**: 7,290.71 km (deduplicated physical centerlines)
  - Reciprocal two-way centerlines: 5,802.17 km (67,317 paired reciprocal roadway segments)
  - Unpaired / one-way roadways: 1,488.55 km (9,381 directed edges, including dual-carriageway corridors)
- **Topological Intersections**: 45,148 (nodes connecting $\ge 3$ distinct physical branches; corrected from initial 46,051 after eliminating single-road transition misclassifications)
- **Dead-end Nodes**: 10,204 (nodes with physical degree 1, cul-de-sacs)
- **Intermediate Through Nodes**: 895 (nodes with physical degree 2 in simplified graph, representing corridor attribute/boundary transitions)
- **Isolated Nodes**: 7 (nodes with physical degree 0)
- **Mapped Traffic Signals**: 26 nodes carrying `highway=traffic_signals`
  - Signalized Intersections: 26 (all 26 mapped signals reside at intersections with $\ge 3$ physical legs)
  - Unsignalized Intersections: 45,122
  - Mid-block Pedestrian Signals: 0
- **Connected Components**: 88 weakly connected components
  - Giant Connected Component: **56,026 nodes (99.59%)**
  - 87 Small Disconnected Components: 228 nodes total (0.41%), comprising 68 isolated segments (size 2), 7 isolated nodes (size 1), and 12 small residential/boundary stubs (sizes 3–14) clipped at the western geographic bounding box boundary (76.59° W) or inside gated developments.

### E. Physical Road Topology vs. Directed Degree & OSM Tag Limitations
The system strictly distinguishes between directed graph representation, physical geometry, and OpenStreetMap crowd-sourced attributes:
1. **Topology-Aware Intersection Detection**:
   - Directed degree ($d_{\text{in}} + d_{\text{out}}$) on a two-way street equals 4 for an ordinary through-road node ($A \rightleftharpoons B \rightleftharpoons C$). Naive directed degree thresholds misclassify ordinary intermediate nodes as junctions.
   - Physical connectivity calculates $k_{\text{physical}}(u) = |(G.\text{successors}(u) \cup G.\text{predecessors}(u)) \setminus \{u\}|$, collapsing reciprocal edges and parallel lanes into distinct physical branches.
2. **Directed Length vs. Physical Length**:
   - `directed_edge_length_km` (13,092.88 km) sums all directed edges, reflecting directional roadway traversal capacity.
   - `estimated_unique_physical_road_length_km` (7,290.71 km) pairs reciprocal two-way edges using endpoint pairs, OSM way IDs, and length proximity.
   - *Limitation*: Divided dual-carriageway boulevards (such as Madhya Marg or Jan Marg) are mapped in OSM as two distinct one-way centerlines. Each directional roadway is counted in unique physical length.
3. **Crowd-Sourced Signal Limitations**:
   - The 26 mapped traffic signals represent nodes explicitly tagged with `highway=traffic_signals` in OpenStreetMap.
   - Many major junctions in Chandigarh are roundabouts (chowks) rather than signaled intersections, while secondary traffic lights may not be fully mapped in OSM. Absence of a `traffic_signals` tag does not prove an intersection is unsignalized in physical reality.

### F. Routing Network API Endpoints
Three endpoints manage and inspect the road network:
1. `GET /routing/network/status`:
   Safely queries local disk status without triggering downloads. Returns file size, availability, and boundary coordinates.
2. `POST /routing/network/build`:
   Explicitly triggers download, validation, and persistence. Supports `{"force": false}` (default) to safely avoid duplicate downloads when the graph already exists on disk.
3. `GET /routing/network/summary`:
   Returns structural network metrics, road type breakdowns (`residential`, `tertiary`, `secondary`, `trunk`, `primary`), intersection counts (`intersection_count`), dead ends (`dead_end_count`), mapped signals (`mapped_traffic_signal_count`), directed edge lengths (`directed_edge_length_km`), unique physical lengths (`estimated_unique_physical_road_length_km`), and target area coverage radii.

---

## 8. Phase 9.2: Geocoding & Alternative Route Generation

Phase 9.2 introduces regional geocoding, coordinate road-network snapping, and alternative driving-route generation for the Chandigarh Tricity region.

### A. Geocoding Service Architecture (`backend/routing/geocoding.py`)
- **Provider**: OpenStreetMap Nominatim API via `NominatimGeocoder` implementing `BaseGeocoder`.
- **Regional Bounding**: All queries are constrained to the Chandigarh Tricity bounding box `(76.5900, 30.5400, 76.9300, 30.8500)` using `viewbox=76.5900,30.8500,76.9300,30.5400&bounded=1`.
- **Secondary Filtering**: Coordinates returned by Nominatim are strictly verified against regional boundaries via `is_within_region()`. Any result falling outside the regional boundary is discarded.
- **In-Memory LRU Caching**: Normalized search queries are cached in memory (default capacity: 1,000 entries) to prevent redundant upstream requests and minimize latency.
- **Rate-Limiting & Compliance**: Strict rate-limit guard enforces a minimum 1.0-second delay between live upstream Nominatim requests in accordance with the OpenStreetMap Nominatim Usage Policy, sending an identifiable custom `User-Agent`.
- **Robust Error Handling**: Timeouts, HTTP errors, and malformed responses are captured and translated into standardized exceptions (`GeocodingTimeoutError`, `GeocodingServiceError`).

### B. Coordinate Validation & Road-Network Snapping (`backend/routing/coordinate_validator.py`)
- **Boundary Verification**: Coordinates must strictly fall within `(WEST_LON <= lon <= EAST_LON)` and `(SOUTH_LAT <= lat <= NORTH_LAT)`.
- **Coordinate Preservation Principle**: User coordinates are preserved and passed directly to OSRM. Local road network snapping functions purely as an in-region accessibility and proximity filter, preventing artificial route detours caused by discrete graph-node snapping.
- **Isotropic 3D Unit-Sphere Spatial Index**: Coordinates are snapped to the nearest road-network node using a `scipy.spatial.cKDTree` constructed over 3D Cartesian coordinates $(x, y, z)$ on the unit sphere, completely eliminating metric distortion caused by latitude/longitude degree anisotropy (at 30.7° N, 1° longitude is ~14% shorter than 1° latitude).
- **Sub-Millisecond Query Time**: Nearest-neighbor lookups execute in ~0.3 ms.
- **Snapping Distance Threshold**: Coordinates located farther than `MAX_SNAPPING_DISTANCE_KM` (default: 2.0 km) from the nearest drivable network node are rejected with an out-of-network error. This 2.0 km threshold accommodates all urban landmarks, lake promenades (Sukhna 538m), airport grounds (773m), and large campuses (PU 331m), while cleanly rejecting distant non-road wilderness (>2.0 km).

### C. Route Provider Integration (`backend/routing/route_provider.py`)
- **Provider**: Open Source Routing Machine (OSRM) driving profile (`/route/v1/driving/`) via `OSRMRouteProvider` implementing `BaseRouteProvider`.
- **Coordinate Formatting**: Converts input coordinates from internal `(latitude, longitude)` format to OSRM's required `{lon},{lat};{lon},{lat}` URL path format.
- **Alternative Routes**: Requests `alternatives=true` to obtain primary and candidate alternative routes across the Tricity corridor.
- **Turn-by-Turn Steps & Geometry**: Requests `steps=true`, `geometries=geojson`, and `overview=full` to receive complete GeoJSON `LineString` coordinates, turn maneuver instructions, street names, step durations, and step distances.
- **Robust Error & Geometry Validation**: Explicitly handles `NoRoute` and `NoSegment` provider error codes, validates that geometry coordinates contain at least 2 points `[lon, lat]` with valid bounds, and verifies positive, non-zero route distances and durations.
- **Route Normalization**:
  - `route_id`: Sequential index string (`route_0`, `route_1`, ...).
  - `is_primary`: First route returned by OSRM marked `True`, alternative candidates marked `False`.
  - `distance_meters` & `distance_km`: Extracted from OSRM summary.
  - `duration_seconds` & `duration_minutes`: Baseline free-flow transit durations.
  - `steps`: Parsed array of `RouteStep` objects containing street name, distance, duration, and maneuver details (type, modifier, bearing).

### D. Environment Configuration (`backend/routing/config.py`)
All parameters are configurable via environment variables:
| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `GEOCODING_PROVIDER` | `nominatim` | Geocoding engine provider |
| `NOMINATIM_BASE_URL` | `https://nominatim.openstreetmap.org` | Upstream Nominatim endpoint |
| `NOMINATIM_USER_AGENT` | `ITMS-Chandigarh-Tricity/1.0` | Custom User-Agent header |
| `NOMINATIM_TIMEOUT` | `5.0` | Geocoding HTTP timeout in seconds |
| `GEOCODING_CACHE_SIZE` | `1000` | In-memory LRU cache capacity |
| `ROUTING_PROVIDER` | `osrm` | Route search engine provider |
| `OSRM_BASE_URL` | `https://router.project-osrm.org` | Upstream OSRM endpoint |
| `OSRM_TIMEOUT` | `10.0` | Route calculation timeout in seconds |
| `MAX_SNAPPING_DISTANCE_KM` | `2.0` | Maximum allowable distance from network |

### E. Baseline Duration Notice & Limitations
> [!IMPORTANT]
> **OSRM Baseline Travel Times**: The travel durations returned by OSRM are baseline free-flow estimates based purely on OpenStreetMap posted roadway speed limits and functional road classifications. They do **not** reflect real-time traffic congestion, intersection signal delays, queue spillbacks, or ML-predicted traffic conditions.
>
> Phase 9.3 and subsequent phases will integrate these routes with our intersection junction detector, signal density metrics, ML traffic volume predictions, and microscopic queue delays to produce congestion-aware route rankings.

### F. Routing API Endpoints

#### 1. Geocode Location (`POST /routing/geocode`)
Translates text address queries into validated Tricity geographic coordinates.

**Request**:
```json
POST /routing/geocode HTTP/1.1
Content-Type: application/json

{
  "query": "Sector 17, Chandigarh",
  "limit": 5
}
```

**Response**:
```json
{
  "query": "Sector 17, Chandigarh",
  "results": [
    {
      "display_name": "Sector 17, Chandigarh, 160017, India",
      "coordinate": {
        "latitude": 30.7415,
        "longitude": 76.7681
      },
      "type": "residential",
      "place_id": 1234567,
      "boundingbox": ["30.7350", "30.7480", "76.7600", "76.7750"]
    }
  ],
  "count": 1
}
```

#### 2. Find Alternative Driving Routes (`POST /routing/routes`)
Calculates driving routes between validated source and destination coordinates with turn-by-turn steps and GeoJSON geometries.

**Request**:
```json
POST /routing/routes HTTP/1.1
Content-Type: application/json

{
  "source": {
    "latitude": 30.7415,
    "longitude": 76.7681
  },
  "destination": {
    "latitude": 30.6425,
    "longitude": 76.8173
  },
  "alternatives": true,
  "steps": true,
  "overview": "full"
}
```

**Response (Excerpt)**:
```json
{
  "source": { "latitude": 30.7415, "longitude": 76.7681 },
  "destination": { "latitude": 30.6425, "longitude": 76.8173 },
  "snapped_source": { "latitude": 30.74148, "longitude": 76.76812 },
  "snapped_destination": { "latitude": 30.64249, "longitude": 76.81728 },
  "routes": [
    {
      "route_id": "route_0",
      "is_primary": true,
      "summary": "Himalaya Marg, Ambala Chandigarh Expressway",
      "distance_meters": 14250.0,
      "distance_km": 14.25,
      "duration_seconds": 1240.0,
      "duration_minutes": 20.67,
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [76.76812, 30.74148],
          [76.77250, 30.73820],
          [76.81728, 30.64249]
        ]
      },
      "steps": [
        {
          "name": "Himalaya Marg",
          "distance_meters": 1200.0,
          "duration_seconds": 95.0,
          "maneuver": {
            "type": "depart",
            "modifier": null,
            "instruction": "Head southeast on Himalaya Marg"
          }
        }
      ]
    }
  ],
  "routes_count": 1,
  "provider": "osrm",
  "baseline_notice": "OSRM durations reflect nominal speed-limit travel times and do not include real-time traffic congestion, signal delays, or queue back-ups."
}
```

#### 3. Provider Status (`GET /routing/provider/status`)
Reports health, configuration, and connectivity for geocoding and routing services.

**Response**:
```json
{
  "geocoding": {
    "provider": "nominatim",
    "base_url": "https://nominatim.openstreetmap.org",
    "status": "configured",
    "cached_queries": 42
  },
  "routing": {
    "provider": "osrm",
    "base_url": "https://router.project-osrm.org",
    "status": "configured"
  },
  "region": {
    "bounding_box": {
      "west_lon": 76.59,
      "south_lat": 30.54,
      "east_lon": 76.93,
      "north_lat": 30.85
    },
    "max_snapping_distance_km": 2.0
  }
}
```

---

## 9. Phase 9.3: Route-Level Intersection & Traffic-Signal Analysis

Phase 9.3 analyzes every candidate route returned by the routing engine and enriches it with route-specific intersection counts, traffic-signal identification, intersection density, and a travel-ordered sequence of encountered junctions.

### A. Route Intersection Analysis Architecture (`backend/routing/route_analyzer.py`)
- **Topology-Aware Matching**: Evaluates local OpenStreetMap graph nodes using physical degree ($k_{\text{physical}} \ge 3$), strictly distinguishing real junctions from through-road nodes ($k = 2$) and dead ends ($k = 1$).
- **Local Cartesian Projection**: Projects geographic coordinates to metric $(X, Y)$ coordinates centered at $(30.70^\circ\text{N}, 76.76^\circ\text{E})$, achieving sub-centimeter point-to-segment distance accuracy across the $35\text{ km} \times 35\text{ km}$ Tricity region ($< 0.05\%$ scale distortion).
- **Sub-Millisecond Spatial Indexing**: Caches an in-memory 2D `scipy.spatial.cKDTree` across all 45,148 regional intersection nodes. Candidate intersection nodes are retrieved by querying densified route polyline samples ($15\text{m}$ step), keeping query times under $3\text{ ms}$ even for multi-kilometer routes with thousands of coordinates.
- **Accurate Point-to-Segment Projection**: Computes the exact perpendicular distance from candidate intersection nodes to each route polyline segment $(P_i, P_{i+1})$, calculating both the perpendicular offset (`distance_from_route_m`) and the cumulative progression along the route (`distance_along_route_m`).
- **Pass Deduplication & Loop Preservation**:
  - Traversal hits on adjacent segments (such as entering and leaving an intersection) are grouped within a $50\text{m}$ progression window and collapsed to the single point of closest approach (`min(distance_from_route_m)`).
  - Legitimate distinct visits along looping routes (separated by $> 50\text{m}$ cumulative distance) are preserved in their respective travel sequence.
- **Travel-Order Sequencing**: All matched junctions are returned strictly ordered by their cumulative progression along the driving route.

### B. Traffic-Signal Identification & Metric Conservation
- **OSM Tagged Signals**: Nodes carrying `highway=traffic_signals` are identified as signalized intersections.
- **Unsignalized Intersections**: Nodes with physical degree $\ge 3$ lacking the signal tag are classified as unsignalized.
- **Strict Conservation**: The counts strictly satisfy:
  $$\text{total\_intersection\_nodes} = \text{signalized\_intersection\_nodes} + \text{unsignalized\_intersection\_nodes}$$
- **Intersection Density**: Computed as $\frac{\text{total\_intersection\_nodes}}{\text{distance\_km}}$ (intersections per kilometer).

### C. Important Topological & Semantic Distinctions
> [!NOTE]
> **Topological Nodes vs. Physical Junctions**:
> A real-world multi-lane intersection or divided dual-carriageway boulevard (e.g. Madhya Marg, Himalaya Marg) is frequently represented in OpenStreetMap by multiple separate topological graph nodes (one node per directional carriageway crossing or slip road). The system reports **OSM topological intersection nodes** and preserves their unique `osm_node_id`s for full traceability, rather than merging nearby intersections with an arbitrary heuristic radius.
>
> **OSM-Mapped Signals vs. Field Reality**:
> Signal classifications reflect OpenStreetMap's crowd-sourced `highway=traffic_signals` attribute. The absence of a tag in OSM does not guarantee that a junction is unsignalized in physical reality (many junctions in Chandigarh are roundabouts or may not be fully mapped in OSM).

### D. Configuration Settings (`backend/routing/config.py`)
| Parameter | Default | Description |
| :--- | :--- | :--- |
| `ROUTE_MATCHING_TOLERANCE_M` | `20.0` | Maximum distance (meters) between route polyline and graph node to declare a match |
| `ROUTE_MATCHING_SAMPLE_STEP_M` | `15.0` | Step size (meters) for densifying route polyline when querying candidate index |
| `ROUTE_LOOP_DEDUPLICATION_WINDOW_M` | `50.0` | Window (meters) along route to collapse adjacent hits while preserving loops |

### E. Example Enriched Route Response (`POST /routing/routes`)
```json
{
  "source": { "latitude": 30.7415, "longitude": 76.7681 },
  "destination": { "latitude": 30.6425, "longitude": 76.8173 },
  "routes_count": 1,
  "provider": "osrm",
  "baseline_notice": "Route duration is a baseline free-flow routing estimate from the provider, not real-time or congestion-predicted traffic delay.",
  "routes": [
    {
      "route_id": "route_1",
      "is_primary": true,
      "distance_m": 14250.0,
      "distance_km": 14.25,
      "duration_s": 1240.0,
      "duration_min": 20.7,
      "summary": "Himalaya Marg, Ambala Chandigarh Expressway",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [76.7681, 30.7415],
          [76.7750, 30.7106],
          [76.8173, 30.6425]
        ]
      },
      "intersection_analysis": {
        "total_intersection_nodes": 18,
        "signalized_intersection_nodes": 2,
        "unsignalized_intersection_nodes": 16,
        "intersection_density_per_km": 1.26,
        "analysis_status": "success",
        "analysis_warnings": [
          "Intersection counts reflect OpenStreetMap topological nodes (physical degree >= 3) and may exceed physical junction counts on divided roads and complex multi-arm intersections.",
          "Signal counts reflect OpenStreetMap nodes tagged with highway=traffic_signals and do not represent a complete field census of physical traffic signals."
        ],
        "matched_intersections": [
          {
            "osm_node_id": 1424395831,
            "latitude": 30.71064,
            "longitude": 76.71290,
            "distance_along_route_m": 3420.5,
            "distance_from_route_m": 5.2,
            "is_signalized": true,
            "signal_tags": { "highway": "traffic_signals", "street_count": 4 }
          },
          {
            "osm_node_id": 1832757083,
            "latitude": 30.70907,
            "longitude": 76.69606,
            "distance_along_route_m": 4180.2,
            "distance_from_route_m": 7.8,
            "is_signalized": false,
            "signal_tags": null
          }
        ]
      }
    }
  ]
}
```

---

## 10. Phase 9.4: Intersection Signal Delay Estimation Engine

Phase 9.4 estimates the additional travel delay introduced by encountering traffic signals along candidate driving routes across Chandigarh Tricity. Because live signal-controller timing telemetry is not yet calibrated for regional intersections, the engine implements a transparent, configurable uniform random-arrival delay model.

### A. Mathematical Formulation

#### 1. Uniform Random-Arrival Delay (Webster's First Term Formulation)
Under the classical Webster traffic signal delay model, for light to moderate unsaturated arrivals with uniform arrival distributions, the expected uniform delay $d$ per vehicle arriving at an isolated fixed-time signalized intersection is given by:
$$d = \frac{R^2}{2C}$$

Where:
- $d$: Average uniform stopped delay in seconds per vehicle.
- $R$: Effective red time in seconds ($0 \le R < C$).
- $C$: Total signal cycle length in seconds ($C > 0$).

For default regional urban parameters ($C = 90.0\text{s}$, $R = 60.0\text{s}$):
$$d = \frac{60.0^2}{2 \times 90.0} = \frac{3600}{180} = 20.0\text{ seconds per signal}$$

#### 2. Route Aggregate Signal Delay
For a route encountering $N$ signalized intersections, the total estimated signal delay is:
$$T_{\text{signal\_delay}} = \sum_{i=1}^N d_i$$
$$T_{\text{signal\_delay, min}} = \frac{T_{\text{signal\_delay}}}{60.0}$$
$$\bar{d} = \begin{cases} \frac{T_{\text{signal\_delay}}}{N} & \text{if } N > 0 \\ 0.0 & \text{if } N = 0 \end{cases}$$

#### 3. Combined Route Travel Duration
The overall estimated route travel duration combines the free-flow OSRM baseline duration with the accumulated signal delay:
$$T_{\text{estimated}} = T_{\text{baseline}} + T_{\text{signal\_delay}}$$
$$T_{\text{estimated, min}} = \frac{T_{\text{estimated}}}{60.0}$$

### B. Signal Delay Architecture (`backend/routing/signal_delay.py`)

- **Dedicated Service Layer**: Independent pure Python service with zero side effects.
- **Selective Estimation**: Evaluates only confirmed signalized intersections (`is_signalized == True`). Unsignalized intersections ($k_{\text{physical}} \ge 3$, yield/stop conditions) contribute $0.0\text{s}$ delay to preserve model transparency.
- **Zero-Signal Handling**: When a route contains no mapped signal nodes, $T_{\text{signal\_delay}} = 0.0\text{s}$ and $T_{\text{estimated}} = T_{\text{baseline}}$ are preserved with an explicit `"no_signals_matched"` status and advisory warning.
- **Ordered Traversal Traceability**: Per-signal delay objects maintain strict ordering by cumulative progression (`distance_along_route_m`) along the route.

### C. Configuration & Timing Profiles (`backend/routing/config.py`)

| Parameter | Environment Variable | Default Value | Description |
| :--- | :--- | :--- | :--- |
| `DEFAULT_SIGNAL_CYCLE_LENGTH_S` | `SIGNAL_CYCLE_LENGTH_S` | `90.0` | Default cycle length in seconds |
| `DEFAULT_SIGNAL_EFFECTIVE_RED_S` | `SIGNAL_EFFECTIVE_RED_S` | `60.0` | Default effective red duration in seconds |
| `SIGNAL_DELAY_MODEL` | `SIGNAL_DELAY_MODEL` | `"uniform_random_arrival"` | Delay estimation formula |

#### Pre-Configured Signal Timing Profiles
- **`default`** (Urban Standard): $C = 90.0\text{s}, R = 60.0\text{s} \implies d = 20.00\text{s}$
- **`major_arterial`** (High-Volume Corridors): $C = 120.0\text{s}, R = 75.0\text{s} \implies d = 23.44\text{s}$
- **`minor_collector`** (Secondary Roads): $C = 60.0\text{s}, R = 35.0\text{s} \implies d = 10.21\text{s}$

#### Timing Parameter Invariants
Timing parameters are strictly verified prior to calculation:
1. $C > 0$ and is finite (strictly positive non-zero cycle duration).
2. $R \ge 0$ and is finite (non-negative effective red interval).
3. $R < C$ (effective red duration cannot equal or exceed total cycle length).

### D. Enriched API Response (`POST /routing/routes`)

Candidate routes in the routing API response include the comprehensive `signal_delay_summary` structure:

```json
{
  "route_id": "route_1",
  "is_primary": true,
  "distance_m": 14250.0,
  "distance_km": 14.25,
  "duration_s": 1240.0,
  "duration_min": 20.7,
  "summary": "Himalaya Marg, Ambala Chandigarh Expressway",
  "geometry": { "type": "LineString", "coordinates": [...] },
  "intersection_analysis": {
    "total_intersection_nodes": 18,
    "signalized_intersection_nodes": 2,
    "unsignalized_intersection_nodes": 16,
    "intersection_density_per_km": 1.26,
    "analysis_status": "success",
    "matched_intersections": [...]
  },
  "signal_delay_summary": {
    "signal_count": 2,
    "total_estimated_signal_delay_s": 40.0,
    "total_estimated_signal_delay_min": 0.67,
    "average_delay_per_signal_s": 20.0,
    "baseline_duration_s": 1240.0,
    "estimated_duration_s": 1280.0,
    "estimated_duration_min": 21.33,
    "delay_model": "uniform_random_arrival",
    "analysis_status": "success",
    "analysis_warnings": [
      "Estimated signal delay is based on an assumed uniform random-arrival model (Webster's first term) with cycle_length=90.0s and effective_red=60.0s. It represents an engineering baseline and not measured live controller telemetry.",
      "Signal count reflects OpenStreetMap nodes tagged with highway=traffic_signals. Physical signals missing from OpenStreetMap are not included in delay calculations."
    ],
    "signal_delays": [
      {
        "osm_node_id": 1424395831,
        "distance_along_route_m": 3420.5,
        "cycle_length_s": 90.0,
        "effective_red_time_s": 60.0,
        "estimated_delay_s": 20.0,
        "estimation_method": "uniform_random_arrival",
        "confidence_level": "low",
        "assumptions": [
          "Isolated fixed-time signal with uniform random vehicle arrivals.",
          "Effective red time: 60.0s, Cycle length: 90.0s.",
          "Illustrative engineering baseline; no live controller telemetry or queue spillback modeled."
        ]
      },
      {
        "osm_node_id": 2194829104,
        "distance_along_route_m": 8150.0,
        "cycle_length_s": 90.0,
        "effective_red_time_s": 60.0,
        "estimated_delay_s": 20.0,
        "estimation_method": "uniform_random_arrival",
        "confidence_level": "low",
        "assumptions": [
          "Isolated fixed-time signal with uniform random vehicle arrivals.",
          "Effective red time: 60.0s, Cycle length: 90.0s.",
          "Illustrative engineering baseline; no live controller telemetry or queue spillback modeled."
        ]
      }
    ]
  }
}
```

### E. Modeling Assumptions & Limitations

> [!IMPORTANT]
> **Engineering Baseline vs. Real-Time Telemetry**:
> - **No Live Controller Telemetry**: Regional traffic signal controllers in Chandigarh Tricity are not currently linked via live SCADA or adaptive controller telemetry. The delay estimates reflect an engineering model baseline for relative alternative route comparisons.
> - **Isolated Signal Assumption**: Each signal is treated as an isolated intersection. Progression benefits from signal coordination (green waves) along coordinated arterial corridors (e.g. Madhya Marg) are not currently modeled.
> - **Zero Spillback / Light-to-Moderate Traffic**: The uniform arrival formula assumes that queues discharge completely during the green interval. Oversaturated cycles, residual queuing, and queue spillback are outside the scope of Phase 9.4.
> - **OSM Signal Completeness**: Only nodes tagged `highway=traffic_signals` in OpenStreetMap are recognized as signalized. Physical signals omitted in OSM data are not included in delay totals.

---

## 11. Phase 9.5: Intelligent Route Scoring and Recommendation Engine

Phase 9.5 implements a multi-criteria route evaluation and recommendation service. It scores and ranks all candidate driving routes returned by the routing engine, recommending the most suitable route based on estimated travel time, route distance, signalized intersection exposure, and intersection density.

### A. Route Scoring Methodology & Objective

The primary objective is to **minimize overall journey duration** (combining OSRM baseline duration with estimated intersection signal delay) while simultaneously considering secondary spatial and navigational characteristics.

The engine uses a configurable weighted composite scoring model:
$$\text{Score}_i = \sum_{m} w_m \times \text{norm}_{i, m}$$

Where:
- $\text{Score}_i$: Composite route score $\in [0.0, 1.0]$. A higher score represents a superior route.
- $w_m$: Configurable weight assigned to criterion $m$ ($\sum w_m = 1.0$).
- $\text{norm}_{i, m}$: Min-max normalized value of metric $m$ for route $i$.

### B. Min-Max Normalization

Because lower values are preferable across all four evaluation criteria (shorter duration, shorter distance, fewer signals, lower intersection density), min-max normalization maps the minimum value among candidate routes to $1.0$ (best) and the maximum value to $0.0$ (worst):

$$\text{norm}_{i, m} = \frac{\max(m) - v_{i, m}}{\max(m) - \min(m)}$$

#### Neutral Score Invariant
When all candidate routes share identical values for a criterion (or when only a single candidate route exists, where $\max(m) = \min(m)$), the engine assigns a neutral optimal normalized score:
$$\text{norm}_{i, m} = 1.0$$
This guarantees that routes are never penalized for identical baseline characteristics and prevents division-by-zero errors.

### C. Configurable Scoring Weights (`backend/routing/config.py`)

| Evaluation Criterion | Config Key | Default Weight | Description |
| :--- | :--- | :---: | :--- |
| **Estimated Journey Duration** | `estimated_duration` | **60%** (0.60) | Primary objective: Baseline OSRM travel duration + estimated signal delay |
| **Route Distance** | `distance` | **20%** (0.20) | Secondary spatial efficiency: Total path distance in meters/km |
| **Mapped Signalized Intersections** | `signal_count` | **10%** (0.10) | Potential delay exposure: Number of OSM-tagged traffic signals encountered |
| **Intersection Density** | `intersection_density` | **10%** (0.10) | Navigational smoothness: Topological intersections per kilometer |

#### Weight Invariants Enforced
Weights are strictly validated prior to calculation via `validate_scoring_weights`:
1. Every weight must be a finite, non-negative number ($w_m \ge 0.0$).
2. The sum of all weights must equal $1.0$ within floating-point tolerance ($\sum w_m = 1.0 \pm 10^{-5}$).
3. All four required criteria must be explicitly present.

### D. Deterministic Ranking & Tie-Breaking

Routes are ordered deterministically according to a strict multi-tier hierarchy:
1. **Primary Key**: Composite score descending ($\text{Score}_i$, rounded to 6 decimal places).
2. **First Tie-Breaker**: Estimated journey duration ascending (lower duration preferred).
3. **Second Tie-Breaker**: Total route distance ascending (shorter distance preferred).
4. **Third Tie-Breaker**: Original candidate route sequence index.

The top-ranked route (`rank == 1`) is marked `is_recommended = True`, and its ID is exposed as `recommended_route_id`. All other routes receive `is_recommended = False`.

### E. Handling Missing or Degraded Data

The scoring engine implements explicit, transparent fallback mechanisms without silent zeroing:
- **Missing Signal Delay Summary**: If signal delay estimation is unavailable for a candidate route, the engine falls back to the baseline OSRM free-flow duration (`duration_s`), marks `analysis_status = "degraded"`, and logs an explicit advisory warning.
- **Missing Intersection Analysis**: If intersection topology analysis is unavailable for a candidate route, missing values (`signal_count`, `intersection_density`) are conservatively estimated from available alternatives so unanalyzed routes do not gain an unearned advantage. The status is marked as `"degraded"` with appropriate warnings.
- **Single Candidate Route**: If the provider returns only 1 route, the engine assigns `score = 1.0`, `rank = 1`, `is_recommended = True`, and marks `analysis_status = "single_route"`.

### F. Example Ranked Route Response (`POST /routing/routes`)

```json
{
  "source": { "latitude": 30.7415, "longitude": 76.7681 },
  "destination": { "latitude": 30.6425, "longitude": 76.8173 },
  "routes_count": 2,
  "provider": "osrm",
  "baseline_notice": "Route duration is a baseline free-flow routing estimate from the provider, not real-time or congestion-predicted traffic delay.",
  "recommendation": {
    "recommended_route_id": "route_1",
    "ranking_method": "weighted_multicriteria",
    "scoring_weights": {
      "estimated_duration": 0.6,
      "distance": 0.2,
      "signal_count": 0.1,
      "intersection_density": 0.1
    },
    "recommendation_summary": "Route 'route_1' is recommended with a score of 0.885 (Rank 1 of 2). It provides an estimated journey duration of 11.2 min across 8.5 km with 1 mapped traffic signal(s).",
    "analysis_status": "success",
    "analysis_warnings": [
      "Route recommendation is based on a multi-criteria model evaluating baseline OSRM duration, assumed uniform signal delay, distance, and intersection density. It does not represent live traffic navigation."
    ],
    "routes_ranked": [
      {
        "route_id": "route_1",
        "rank": 1,
        "score": 0.885,
        "estimated_duration_s": 670.0,
        "estimated_duration_min": 11.17,
        "baseline_duration_s": 650.0,
        "distance_m": 8500.0,
        "distance_km": 8.5,
        "signal_count": 1,
        "total_estimated_signal_delay_s": 20.0,
        "intersection_count": 12,
        "intersection_density_per_km": 1.41,
        "is_recommended": true,
        "recommendation_reasons": [
          "Lowest estimated journey duration (11.2 min, 1.7 min faster than next alternative).",
          "Shortest route distance (8.5 km, 0.7 km shorter than next alternative).",
          "Fewer mapped traffic signals (1 vs 3 on nearest alternative), reducing potential intersection stops."
        ]
      },
      {
        "route_id": "route_2",
        "rank": 2,
        "score": 0.215,
        "estimated_duration_s": 770.0,
        "estimated_duration_min": 12.83,
        "baseline_duration_s": 710.0,
        "distance_m": 9200.0,
        "distance_km": 9.2,
        "signal_count": 3,
        "total_estimated_signal_delay_s": 60.0,
        "intersection_count": 16,
        "intersection_density_per_km": 1.74,
        "is_recommended": false,
        "recommendation_reasons": [
          "Higher estimated journey duration (12.8 min, +1.7 min vs recommended).",
          "Longer route distance (9.2 km, +0.7 km vs recommended).",
          "More mapped traffic signals (3 vs 1), contributing 60.0s estimated signal delay."
        ]
      }
    ]
  },
  "routes": [
    {
      "route_id": "route_1",
      "is_primary": true,
      "rank": 1,
      "score": 0.885,
      "is_recommended": true,
      "recommendation_reasons": [
        "Lowest estimated journey duration (11.2 min, 1.7 min faster than next alternative).",
        "Shortest route distance (8.5 km, 0.7 km shorter than next alternative).",
        "Fewer mapped traffic signals (1 vs 3 on nearest alternative), reducing potential intersection stops."
      ],
      "distance_m": 8500.0,
      "distance_km": 8.5,
      "duration_s": 650.0,
      "duration_min": 10.83,
      "geometry": { "type": "LineString", "coordinates": [...] },
      "steps": [...],
      "intersection_analysis": { ... },
      "signal_delay_summary": { ... }
    }
  ]
}
```

### G. Limitations & Methodological Disclaimers

> [!IMPORTANT]
> **Model-Based Recommendation vs. Live Traffic Navigation**:
> - **Engineering Estimation**: Recommendations reflect a deterministic multi-criteria model based on nominal free-flow OSRM speeds and theoretical uniform random-arrival signal delays ($d = R^2 / 2C$). They do not incorporate live GPS probes, dynamic congestion feeds, or incident reports.
> - **OSM Signal Completeness**: Traffic signal counts reflect OpenStreetMap `highway=traffic_signals` tags. Unmapped physical traffic signals are not factored into signal counts or delay calculations.
> - **Regional ML Scope**: The existing Random Forest ML classifier categorizes freeway traffic volume classes from Minnesota interstate sensor data; it is not a local road-segment congestion predictor for Chandigarh Tricity corridors.

---

## 12. Phase 10.1: Interactive Map Foundation for Smart Route Planner

Phase 10.1 establishes the frontend interactive geographical map canvas for the consumer-facing Smart Route Planner in the Intelligent Traffic Management System (ITMS). It integrates Leaflet and React-Leaflet into the modern React 19 + Vite + Tailwind CSS v4 environment, configured specifically for the Chandigarh Tricity metropolitan road network.

### A. Geographical Scope & Spatial Constraints

The map is bounded to the regional extent of the locally stored Chandigarh Tricity road graph:

| Spatial Parameter | Value | Description |
| :--- | :--- | :--- |
| **Regional Center** | `[30.7333, 76.7794]` | Central coordinate anchored at Chandigarh Sector 17 |
| **Bounding Box** | `[[30.5400, 76.5900], [30.8500, 76.9300]]` | South: 30.5400°N, West: 76.5900°E, North: 30.8500°N, East: 76.9300°E |
| **Default Zoom** | `11` | Regional overview framing all seven municipal zones |
| **Zoom Range** | Min `9`, Max `18` | Restricted to prevent disorientation outside the regional study area |

#### Key Urban Centers Configured

| Zone | Center Coordinates | Default Zoom | Classification |
| :--- | :---: | :---: | :--- |
| **Chandigarh** | `[30.7333, 76.7794]` | 13 | Core Union Territory & Administrative Capital |
| **Mohali (SAS Nagar)** | `[30.7046, 76.7179]` | 13 | Major IT & Commercial Corridor (Punjab) |
| **Panchkula** | `[30.6942, 76.8606]` | 13 | Planned Urban District (Haryana) |
| **Zirakpur** | `[30.6425, 76.8173]` | 13 | High-Volume Transit Gateway (NH-152 / NH-7) |
| **Kharar** | `[30.7499, 76.6411]` | 13 | Rapid Growth Northwest Suburb |
| **New Chandigarh (Mullanpur)** | `[30.7933, 76.7327]` | 13 | Northern Emerging Residential & Sports Zone |
| **Dera Bassi** | `[30.5844, 76.8444]` | 13 | Southern Industrial Gateway |

---

### B. Map Architecture & Components

```
frontend/src/
├── components/routing/
│   ├── mapConstants.js      # Coordinates, bounds, landmark registries, tile providers, styling rules
│   ├── RouteMap.jsx         # Core Leaflet map canvas with imperative controls & event bridges
│   ├── MapControls.jsx      # Floating control bar (zoom, recenter, tile picker, landmark quick-jump)
│   └── MapLegend.jsx        # Collapsible visual legend card
├── pages/
│   └── SmartRoutePlanner.jsx# Split-screen responsive layout (metrics & control drawer + map viewport)
└── assets/
    ├── route-planner/       # Dedicated page illustrations & icons (Rules 19 & 20)
    └── README.md            # Asset catalog & folder documentation
```

#### 1. Core Map Canvas (`RouteMap.jsx`)
- **React 19 & Vite Safe Marker Icons**: Replaces Leaflet's legacy 2D sprite image files (which fail under Vite module bundler URL resolution) with crisp, vector `L.divIcon` badges rendered via inline SVG and Tailwind CSS colors.
- **ResizeObserver Invalidation**: Employs an internal `ResizeObserver` that automatically triggers `map.invalidateSize()` whenever parent drawer widths change or window resize occurs, eliminating blank/grey tile rendering artifacts.
- **Imperative Bridge (`MapImperativeBridge`)**: Exposes imperative map handles (`zoomIn`, `zoomOut`, `fitBounds`, `setView`, `invalidateSize`) upward via React `forwardRef` and `useImperativeHandle`.
- **Event Bridge (`MapEventsBridge`)**: Attaches map click listeners (`useMapEvents`) to capture coordinate clicks without interfering with marker interactions.
- **Prepared Phase 10.2 Slots**: Pre-wired to render GeoJSON candidate route polylines (`Polyline`), start/destination pins (`Marker`), and signalized intersection icons with recommended vs. alternative color styling.

#### 2. Floating Controls (`MapControls.jsx`)
- **Navigation Controls**: Zoom In, Zoom Out, Reset to Tricity bounds, and Recenter on Chandigarh.
- **Tile Provider Switcher**: Real-time layer switching between:
  1. *CartoDB Voyager* (default): Clean, high-contrast, modern navigation palette.
  2. *OpenStreetMap Standard*: Canonical geographic OSM layer.
  3. *CartoDB Dark Matter*: Dark matrix aesthetic harmonizing with the ITMS dark UI.
- **Urban Landmark Quick-Jump**: One-click dropdown to smoothly pan and zoom to any of the 7 municipal centers.
- **Boundary Overlay Toggle**: Ability to toggle the dashed geographic bounding box highlighting the study area.

#### 3. Visual Legend (`MapLegend.jsx`)
- Collapsible floating glassmorphic card explaining:
  - Cyan solid line: Recommended Route (Phase 10.2).
  - Slate dashed line: Alternative Route (Phase 10.2).
  - Amber badge: Mapped Traffic Signals.
  - Purple badge: Urban Municipal Hubs.
  - Dashed boundary: Chandigarh Tricity Regional Boundary.

#### 4. Smart Route Planner Page (`SmartRoutePlanner.jsx`)
- **Responsive Split Layout**: Two-column layout inspired by modern dispatch, logistics, and multi-criteria routing consoles.
- **Road Network Overview Card**: Displays live statistics of the underlying local graph:
  - **56,254 Nodes** & **144,015 Directed Edges**.
  - **13,093 km** Total Road Length.
  - **26 Mapped Traffic Signals** with $d = R^2 / 2C$ delay estimation.
- **Urban Hub Quick-Select**: Interactive pills to immediately focus the viewport on specific regional zones.
- **Phase 10.2 Pipeline Indicator**: Clear UI preview of upcoming geocoded point-to-point routing, alternative route scoring, and signal delay breakdowns.

---

### C. Application Routing & Navigation Integration

The Smart Route Planner is deeply integrated into the application's routing and navigation structure:
- **Routes**: `/routes` and `/route-planner` in `frontend/src/App.jsx`.
- **Navigation**: Dedicated `ROUTE INTELLIGENCE` section in `frontend/src/components/layout/Sidebar.jsx` with an active route indicator and Lucide `Route` icon.
- **Header**: Page header title and subtitle dynamically mapped in `frontend/src/components/layout/Header.jsx`.
- **Assets**: Organized under `frontend/src/assets/route-planner/` adhering to Rules 19 and 20.

---

### D. Verification & Test Status

1. **Frontend Linting**:
   - `npm run lint`: **0 errors, 0 warnings** across all files.
2. **Frontend Production Build**:
   - `npm run build`: **Built successfully** in ~320ms, producing optimized client bundle in `dist/`.
3. **Backend Regression Testing**:
   - `pytest backend/test_phase*.py`: **238 / 238 passed** across all Phase 1 through Phase 9.5 test suites with 0 regressions.
4. **Existing Pages**:
   - Dashboard (`/`), Prediction (`/prediction`), Signal Optimization (`/optimization`), Simulation (`/simulation`), Strategy Comparison (`/comparison`), Validation (`/validation`), and Sensitivity Analysis (`/sensitivity`) remain fully functional.

---

## 13. Phase 10.2: Source and Destination Search — Smart Route Planner

Phase 10.2 integrates interactive location search and point-to-point origin/destination selection into the Smart Route Planner. It connects the frontend directly to the existing FastAPI backend geocoding endpoint (`POST /routing/geocode`), renders interactive vector markers for Origin (A) and Destination (B), supports map-click placement, provides swap/clear controls, and enforces Chandigarh Tricity geographic boundaries.

### A. Geocoding API Contract (`POST /routing/geocode`)

The frontend utilizes the existing backend service without introducing external dependencies or altering API contracts:

- **Request Schema (`GeocodeRequest`)**:
  ```json
  {
    "query": "Sector 17, Chandigarh"
  }
  ```
- **Response Schema (`GeocodeResult`)**:
  ```json
  {
    "query": "Sector 17, Chandigarh",
    "display_name": "Sector 17, Chandigarh, 160017, India",
    "latitude": 30.7408,
    "longitude": 76.7825,
    "is_inside_region": true,
    "address": { ... },
    "place_id": 12345,
    "osm_type": "node",
    "osm_id": 98765,
    "bounding_box": [30.73, 30.75, 76.77, 76.79]
  }
  ```
- **Error Handling**:
  - `400 Bad Request`: Location query too short or not found within bounds.
  - `502 Bad Gateway`: Upstream geocoding connection failure.
  - `504 Gateway Timeout`: Upstream service timeout.
  - Friendly user messages without exposing backend implementation stack traces.

### B. Location Search Architecture (`LocationSearchInput.jsx`)

1. **Debounced Query Execution**:
   - Debounces input changes by 400ms to eliminate redundant network traffic.
   - Prevents stale responses using browser-native `AbortController`. In-flight requests are automatically aborted when the user continues typing or the component unmounts.
2. **Autocomplete Suggestions**:
   - High-confidence backend geocoded location with full address, sector name, and formatted coordinates.
   - Instant local landmark filtering from `TRICITY_LANDMARKS` for common hubs (e.g., Chandigarh Sector 17, Mohali IT Corridor, Panchkula).
3. **Empty & Error States**:
   - Distinct feedback for "No locations found" vs. "Location outside regional boundaries" vs. connectivity errors.
   - Shortcut button to fallback to direct map-click selection.

### C. Map Interaction & Marker Management (`RouteMap.jsx`)

1. **Dual Marker Rendering**:
   - **Origin (A)**: Emerald badge marker (`#10b981`) with label `A`.
   - **Destination (B)**: Rose badge marker (`#ef4444`) with label `B`.
   - Both markers remain visible on the map canvas simultaneously.
2. **Dynamic Camera Framing (`MapCameraController`)**:
   - Automatically computes `fitBounds([source, destination], { padding: [60, 60], maxZoom: 14 })` when both endpoints are present.
   - Pans to the updated coordinate when a single point is selected.
   - Avoids map reinitialization or fighting user manual panning when coordinates remain unchanged.
3. **Explicit Map-Click Selection Mode**:
   - Users can toggle "Pick on Map" for either Origin or Destination.
   - Map canvas shifts to `cursor-crosshair`.
   - Floating beacon banner indicates the active selection target with a "Cancel" action.
   - Enforces regional bounds validation (`isWithinTricityRegion`); clicks outside the region display a clear error message.

### D. Verification & Test Status

1. **Frontend Linting**:
   - `npm run lint`: **0 errors, 0 warnings**.
2. **Frontend Production Build**:
   - `npm run build`: **Built successfully** in 289ms, generating client bundle in `dist/`.
3. **Backend Regression Testing**:
   - `pytest backend/test_phase*.py`: **238 / 238 passed** across all backend test suites.
4. **Strict Scope Discipline**:
   - Route generation, polylines, alternative comparison, and signal delays are deferred to Phase 10.3.

---

## 14. Phase 10.3: Route Generation and Alternative Route Rendering

Phase 10.3 establishes the end-to-end connection between the Smart Route Planner location interface and the FastAPI routing engine (`POST /routing/routes`). It generates multi-candidate alternative driving routes between validated Origin (A) and Destination (B) endpoints and renders interactive, styled GeoJSON route polylines on the Leaflet map canvas.

### A. Routing API Integration (`POST /routing/routes`)

- **Endpoint**: `POST /routing/routes`
- **Request Payload (`RouteSearchRequest`)**:
  ```json
  {
    "source": {
      "latitude": 30.7408,
      "longitude": 76.7825
    },
    "destination": {
      "latitude": 30.7046,
      "longitude": 76.7179
    },
    "alternatives": true
  }
  ```
- **Response Schema (`RouteSearchResponse`)**:
  - `source`: Validated source coordinates.
  - `destination`: Validated destination coordinates.
  - `routes_count`: Total candidate routes returned.
  - `routes`: Array of `RouteResult` objects containing:
    - `route_id`: Unique route identifier (`route_1`, `route_2`, etc.).
    - `distance_km` & `distance_m`: Total road length.
    - `duration_min` & `duration_s`: Free-flow nominal duration.
    - `geometry`: GeoJSON `LineString` containing `[lon, lat]` coordinate points.
    - `summary`: Major corridor names (e.g., *"Madhya Marg"*).
    - `intersection_analysis`: Matched topological intersections & OSM traffic signals.
    - `signal_delay_summary`: Estimated signal delays and combined route duration.
    - `rank`: Multi-criteria rank position (Rank 1 is recommended).
    - `score`: Composite evaluation score $\in [0.0, 1.0]$.
    - `is_recommended`: Authoritative recommendation flag.
    - `recommendation_reasons`: Data-driven scoring explanations.
  - `recommendation`: `RouteRecommendationResponse` containing `recommended_route_id`, ranking method, scoring weights, and summary.

### B. GeoJSON to Leaflet Coordinate Transformation

- GeoJSON paths are specified under standard RFC 7946 coordinates as `[longitude, latitude]`.
- Leaflet polyline geometry strictly requires `[latitude, longitude]`.
- Transformation and validation pipeline:
  ```javascript
  const coords = (route.geometry?.coordinates || [])
    .filter(
      (pt) =>
        Array.isArray(pt) &&
        pt.length >= 2 &&
        typeof pt[0] === "number" &&
        typeof pt[1] === "number" &&
        !isNaN(pt[0]) &&
        !isNaN(pt[1])
    )
    .map(([lon, lat]) => [lat, lon]);
  ```
- Routes with fewer than 2 valid points or malformed geometries are safely skipped without interrupting map rendering.

### C. Visual Hierarchy & Polyline Styling

1. **Layer Ordering (Z-Index Protection)**:
   - Polylines are sorted before rendering:
     `Unselected Alternatives -> Recommended Route -> Selected Route`
   - Guarantees the currently active route is always drawn on top of other candidates.
2. **Dynamic Route Styles**:
   - **Recommended Route (Rank 1)**: Solid Emerald (`#10b981`), `weight: 6`, `opacity: 0.85`.
   - **User-Selected Route**: Thickened stroke (`weight: 8`, `opacity: 1.0`) in Emerald (if recommended) or Cyan (`#06b6d4`, if alternative).
   - **Alternative Options**: Dashed line (`dashArray: "6, 6"`, `weight: 5`, `opacity: 0.75`) colored with distinct hues from `ALTERNATIVE_ROUTE_COLORS` (`#6366f1`, `#8b5cf6`, `#f59e0b`, `#ec4899`).
3. **Interactive Route Selection**:
   - Clicking any polyline or route card triggers `onRouteSelect(route_id)`.
   - Popups on polylines display route name, recommendation badge, distance, estimated travel time, signal count, and a direct selection button.

### D. Camera Auto-Framing (`MapCameraController`)

- When routes are generated, `MapCameraController` computes the collective bounding box of all points across all candidate routes and executes `map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 })`.
- Selection changes between routes do not re-trigger camera fitting, preventing visual disorientation.
- Invalidation: Altering or clearing the Origin or Destination automatically removes outdated routes and resets camera framing.

### E. Verification & Test Status

1. **Frontend Linting**:
   - `npm run lint`: **0 errors, 0 warnings**.
2. **Frontend Production Build**:
   - `npm run build`: **Built successfully** in 334ms (`dist/` generated).
3. **Backend Regression Testing**:
   - `pytest backend/test_phase*.py`: **238 / 238 passed** in 6.68s with 0 regressions.
4. **Strict Scope Discipline**:
   - Full side-by-side comparison cards and detailed multi-criteria score explanation matrices belong to Phase 10.4.

---

## 15. Phase 10.4: Route Comparison and Recommendation Interface

Phase 10.4 introduces a multi-criteria route evaluation and recommendation interface for the Smart Route Planner. It provides comparative route inspection cards, an in-depth recommendation explanation panel breaking down scoring weights and narrative reasons, detailed signal delay and topological intersection telemetry, and synchronized selection state between frontend cards and Leaflet map polylines.

### A. Component Architecture

```text
frontend/src/components/routing/
├── RouteComparisonCard.jsx            # Multi-criteria route card comparing baseline vs. estimated durations, signals, and scores
├── RecommendationExplanationPanel.jsx # Deep-dive panel explaining the backend multi-criteria score and weight breakdown
├── RouteMetricsDetails.jsx            # Detailed intersection and signal delay telemetry for the selected route
├── LocationSearchInput.jsx            # Debounced geocoding search input (Phase 10.2)
├── RouteMap.jsx                       # Leaflet interactive map with synchronized polylines (Phases 10.1–10.3)
└── mapConstants.js                    # Regional bounds, landmarks, tile providers, and color palettes
```

### B. Displayed Metrics & Backend Response Mapping

| Displayed Metric | Source Field | Description |
| :--- | :--- | :--- |
| **Route Rank** | `route.rank` | Multi-criteria rank (Rank 1 is authoritative recommended route) |
| **Corridor Summary** | `route.summary` / `route.route_id` | Major arterial street names along the driving path |
| **Baseline Free-Flow** | `route.duration_min` / `route.duration_s` | Nominal OSRM free-flow travel duration without signal delay |
| **Est. Journey Duration** | `route.signal_delay_summary.estimated_duration_min` | Combined estimated duration: $\text{Baseline} + \text{Signal Delay}$ |
| **Estimated Signal Delay** | `route.signal_delay_summary.total_estimated_signal_delay_s` | Modeled uniform delay across encountered signalized intersections |
| **Route Distance** | `route.distance_km` / `route.distance_m` | Total driving distance in kilometers |
| **Composite Route Score** | `route.score` / `route.score_details.score` | Normalized weighted score $\in [0.0, 1.0]$ |
| **Mapped Traffic Signals** | `route.signal_delay_summary.signal_count` | Tagged `highway=traffic_signals` nodes matched along path |
| **Topological Intersections**| `route.intersection_analysis.total_intersection_nodes` | Physical degree $\ge 3$ junction nodes matched along path |
| **Intersection Density** | `route.intersection_analysis.intersection_density_per_km` | Topological intersections per kilometer of route |
| **Recommendation Status** | `route.is_recommended` | Authoritative recommendation flag |
| **Scoring Weights** | `recommendation.scoring_weights` | Multi-criteria weights: Duration (60%), Distance (20%), Signals (10%), Density (10%) |
| **Recommendation Reasons** | `route.recommendation_reasons` | Data-driven explanations generated by backend scoring engine |

### C. Selection Synchronization Design

- **Single Source of Truth**: State variable `selectedRouteId` governs active selection across both views.
- **Card-to-Map**: Clicking any `RouteComparisonCard` updates `selectedRouteId`, instantly applying the highlighted Cyan/Emerald active polyline style on the map canvas.
- **Map-to-Card**: Clicking any route polyline on the Leaflet map triggers `onRouteSelect(route_id)`, instantly synchronizing the comparison list and telemetry view.
- **Independence of Recommendation**: The recommended route preserves its Emerald "Recommended (Rank 1)" badge regardless of which alternative route is currently highlighted.
- **Endpoint Invalidation**: Modifying Origin or Destination immediately wipes active routes and resets comparison state.

### D. Modeling Assumptions & Limitations Transparency

- **Webster's Uniform Delay Approximation**: Transparently explains that signal delay is estimated via $d = R^2 / 2C$ with nominal 120s cycle and 60s red times.
- **OSM Incompleteness**: Explicitly notes that the 26 mapped traffic signals in the graph represent tagged OpenStreetMap signals, not the entirety of physical signal controllers in Chandigarh Tricity.
- **Non-Live Engineering Estimates**: Clearly clarifies that route durations are free-flow baseline estimates plus modeled signal delay, rather than live GPS probe speeds or dynamic incident feeds.
- **Missing Data Handling**: Unanalyzed or degraded metrics render as *"Unavailable"* rather than misleading zero values.

### E. Verification & Test Status

1. **Frontend Linting**:
   - `npm run lint`: **0 errors, 0 warnings**.
2. **Frontend Production Build**:
   - `npm run build`: **Built successfully** in 350ms (`dist/` generated).
3. **Backend Regression Testing**:
   - `pytest backend/test_phase*.py`: **238 / 238 passed** in 6.78s with 0 regressions.
4. **Existing Pages**:
   - All 7 analytics, simulation, and validation pages remain fully operational.








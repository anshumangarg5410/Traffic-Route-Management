"""
Association Rules, Recommendation, Reinforcement Learning & AI Ethics
===================================================================

Covers Syllabus Sections:
- E: Association Rule Learning (Frequent Itemset Mining, Apriori, FP-Growth)
- F: Recommendation Systems (Content-Based Departure Window & Route Condition Recommender)
- H: Reinforcement Learning (Q-Learning Traffic Signal Agent vs Fixed/Adaptive)
- I: AI Ethics and Future Trends
"""

from collections import defaultdict
from itertools import combinations
from typing import Any, Dict, FrozenSet, List, Tuple
import numpy as np

from backend.ml_lab.data_loader import label_traffic_volumes, load_lab_dataset
from backend.services.signal_optimizer import AVAILABLE_GREEN_TIME, DIRECTIONS, MAX_GREEN, MIN_GREEN
from backend.services.traffic_simulator import simulate_intersection


# ============================================================================
# E. Association Rule Learning (Apriori & FP-Growth)
# ============================================================================

def _build_traffic_transactions() -> List[FrozenSet[str]]:
    """Convert traffic observations into discrete categorical Market-Basket items."""
    df = load_lab_dataset(2000).copy()
    levels, _, _ = label_traffic_volumes(df["traffic_volume"], df["traffic_volume"])
    df["level"] = levels

    transactions: List[FrozenSet[str]] = []
    for _, row in df.iterrows():
        hour = int(row["hour"])
        if 7 <= hour <= 10:
            time_slot = "Time=MorningRush"
        elif 11 <= hour <= 15:
            time_slot = "Time=Midday"
        elif 16 <= hour <= 19:
            time_slot = "Time=EveningRush"
        else:
            time_slot = "Time=OffPeakNight"

        day_type = "Day=Weekend" if int(row["is_weekend"]) == 1 else "Day=Weekday"
        weather = f"Weather={str(row['weather_main'])}"
        clouds = "Clouds=High" if float(row["clouds_all"]) >= 60 else "Clouds=Low"
        volume = f"Congestion={str(row['level'])}"
        transactions.append(frozenset([time_slot, day_type, weather, clouds, volume]))
    return transactions


def _apriori_frequent_itemsets(
    transactions: List[FrozenSet[str]],
    min_support: float,
) -> Dict[FrozenSet[str], float]:
    n = len(transactions)
    item_counts: Dict[str, int] = defaultdict(int)
    for tx in transactions:
        for item in tx:
            item_counts[item] += 1

    freq: Dict[FrozenSet[str], float] = {
        frozenset([item]): count / n
        for item, count in item_counts.items()
        if (count / n) >= min_support
    }

    current_l = list(freq.keys())
    k = 2
    while current_l and k <= 4:
        candidates = set()
        for i in range(len(current_l)):
            for j in range(i + 1, len(current_l)):
                union = current_l[i] | current_l[j]
                if len(union) == k:
                    candidates.add(union)

        next_l: List[FrozenSet[str]] = []
        for cand in candidates:
            support = sum(1 for tx in transactions if cand.issubset(tx)) / n
            if support >= min_support:
                freq[cand] = support
                next_l.append(cand)
        current_l = next_l
        k += 1

    return freq


class _FPNode:
    def __init__(self, item: str | None, count: int, parent: "_FPNode | None"):
        self.item = item
        self.count = count
        self.parent = parent
        self.children: Dict[str, "_FPNode"] = {}
        self.next_link: "_FPNode | None" = None


def _build_fptree(
    weighted_txs: List[Tuple[List[str], int]],
    min_count: float,
):
    counts: Dict[str, int] = defaultdict(int)
    for items, w in weighted_txs:
        for item in items:
            counts[item] += w

    freq_items = {item: c for item, c in counts.items() if c >= min_count}
    if not freq_items:
        return None, {}

    header: Dict[str, List[Any]] = {item: [c, None] for item, c in freq_items.items()}
    root = _FPNode(None, 1, None)

    for items, w in weighted_txs:
        ordered = [it for it in sorted(items, key=lambda x: (-freq_items.get(x, 0), x)) if it in freq_items]
        curr = root
        for item in ordered:
            if item in curr.children:
                curr.children[item].count += w
            else:
                node = _FPNode(item, w, curr)
                curr.children[item] = node
                if header[item][1] is None:
                    header[item][1] = node
                else:
                    link = header[item][1]
                    while link.next_link is not None:
                        link = link.next_link
                    link.next_link = node
            curr = curr.children[item]

    return root, header


def _mine_fptree(header: Dict[str, List[Any]], min_count: float, prefix: FrozenSet[str], out: Dict[FrozenSet[str], int]):
    sorted_items = sorted(header.items(), key=lambda kv: (kv[1][0], kv[0]))
    for item, (support_count, node) in sorted_items:
        new_set = prefix | frozenset([item])
        out[new_set] = support_count

        cond_patterns: List[Tuple[List[str], int]] = []
        curr = node
        while curr is not None:
            path: List[str] = []
            parent = curr.parent
            while parent is not None and parent.item is not None:
                path.append(parent.item)
                parent = parent.parent
            if path:
                cond_patterns.append((path, curr.count))
            curr = curr.next_link

        _, cond_header = _build_fptree(cond_patterns, min_count)
        if cond_header:
            _mine_fptree(cond_header, min_count, new_set, out)


def _fpgrowth_frequent_itemsets(
    transactions: List[FrozenSet[str]],
    min_support: float,
) -> Dict[FrozenSet[str], float]:
    n = len(transactions)
    min_count = min_support * n
    weighted = [(list(tx), 1) for tx in transactions]
    _, header = _build_fptree(weighted, min_count)
    if not header:
        return {}
    counts: Dict[FrozenSet[str], int] = {}
    _mine_fptree(header, min_count, frozenset(), counts)
    return {k: v / n for k, v in counts.items() if len(k) <= 4}


def run_association_rules_experiment(
    algorithm: str = "apriori",
    min_support: float = 0.10,
    min_confidence: float = 0.55,
) -> Dict[str, Any]:
    """Run Apriori or FP-Growth Market-Basket analysis on discretized traffic patterns."""
    min_sup = max(0.03, min(float(min_support), 0.5))
    min_conf = max(0.2, min(float(min_confidence), 0.95))
    transactions = _build_traffic_transactions()

    if algorithm == "apriori":
        freq = _apriori_frequent_itemsets(transactions, min_sup)
        title = "Apriori Frequent Itemset & Rule Mining"
        explanation = (
            "Generates candidate itemsets level-by-level using the downward-closure property "
            "(all subsets of a frequent itemset must be frequent) to discover co-occurring traffic conditions."
        )
    elif algorithm == "fpgrowth":
        freq = _fpgrowth_frequent_itemsets(transactions, min_sup)
        title = "FP-Growth Frequent Pattern Tree Mining"
        explanation = (
            "Compresses traffic transactions into an FP-Tree prefix structure and mines conditional "
            "pattern bases without generating candidate itemsets."
        )
    else:
        raise ValueError(f"Unsupported association rule algorithm: {algorithm}")

    rules: List[Dict[str, Any]] = []
    for itemset, sup_ab in freq.items():
        if len(itemset) < 2:
            continue
        for r in range(1, len(itemset)):
            for ant_tuple in combinations(sorted(itemset), r):
                ant = frozenset(ant_tuple)
                cons = itemset - ant
                sup_a = freq.get(ant)
                sup_b = freq.get(cons)
                if not sup_a or not sup_b:
                    continue
                conf = sup_ab / sup_a
                if conf >= min_conf:
                    lift = conf / sup_b
                    rules.append({
                        "antecedent": ", ".join(sorted(ant)),
                        "consequent": ", ".join(sorted(cons)),
                        "support": round(float(sup_ab), 4),
                        "confidence": round(float(conf), 4),
                        "lift": round(float(lift), 3),
                    })

    rules.sort(key=lambda x: (-x["lift"], -x["confidence"], -x["support"]))
    top_itemsets = sorted(
        [{"items": ", ".join(sorted(k)), "length": len(k), "support": round(float(v), 4)} for k, v in freq.items()],
        key=lambda x: (-x["length"], -x["support"]),
    )[:15]

    return {
        "algorithm": algorithm,
        "title": title,
        "transaction_count": len(transactions),
        "itemset_count": len(freq),
        "rule_count": len(rules),
        "top_itemsets": top_itemsets,
        "rules": rules[:15],
        "explanation": explanation,
    }


# ============================================================================
# F. Content-Based Recommendation System
# ============================================================================

def run_recommendation_experiment(
    preferred_time_slot: str = "morning_rush",
    weather_condition: str = "Clear",
    prefer_low_congestion: bool = True,
    top_k: int = 5,
) -> Dict[str, Any]:
    """Content-based recommender suggesting optimal departure windows from traffic profiles."""
    df = load_lab_dataset(2500).copy()
    levels, _, _ = label_traffic_volumes(df["traffic_volume"], df["traffic_volume"])
    df["level"] = levels

    grouped = (
        df.groupby(["hour", "is_weekend", "weather_main"], as_index=False)
        .agg(
            avg_volume=("traffic_volume", "mean"),
            avg_clouds=("clouds_all", "mean"),
            samples=("traffic_volume", "count"),
        )
    )
    grouped = grouped[grouped["samples"] >= 3].reset_index(drop=True)

    slot_target_hours = {
        "morning_rush": 8.0,
        "midday": 13.0,
        "evening_rush": 17.5,
        "night": 22.0,
    }
    target_hour = slot_target_hours.get(preferred_time_slot, 9.0)
    target_vol = float(grouped["avg_volume"].min()) if prefer_low_congestion else float(grouped["avg_volume"].median())

    max_vol = max(float(grouped["avg_volume"].max()), 1.0)
    recommendations: List[Dict[str, Any]] = []

    for _, row in grouped.iterrows():
        hr = float(row["hour"])
        vol = float(row["avg_volume"])
        w_main = str(row["weather_main"])

        # Feature vector: [normalized_hour_proximity, weather_match, normalized_volume_match]
        hour_diff = min(abs(hr - target_hour), 24.0 - abs(hr - target_hour))
        hour_sim = 1.0 - (hour_diff / 12.0)
        weather_sim = 1.0 if w_main.lower() == weather_condition.lower() else 0.25
        vol_sim = 1.0 - abs(vol - target_vol) / max_vol

        cand_vec = np.array([hour_sim, weather_sim, vol_sim], dtype=float)
        user_vec = np.array([1.0, 1.0, 1.0], dtype=float)
        cos_sim = float(np.dot(cand_vec, user_vec) / (np.linalg.norm(cand_vec) * np.linalg.norm(user_vec)))

        day_label = "Weekend" if int(row["is_weekend"]) == 1 else "Weekday"
        congestion = "Low" if vol <= 2000 else ("Medium" if vol <= 4200 else "High")

        recommendations.append({
            "window": f"{int(hr):02d}:00 ({day_label})",
            "hour": int(hr),
            "day_type": day_label,
            "weather": w_main,
            "expected_volume": round(vol, 1),
            "congestion_level": congestion,
            "similarity_score": round(cos_sim, 4),
            "samples": int(row["samples"]),
        })

    recommendations.sort(key=lambda x: (-x["similarity_score"], x["expected_volume"]))
    k = max(3, min(int(top_k), 10))

    return {
        "title": "Content-Based Departure Window Recommender",
        "preferences": {
            "preferred_time_slot": preferred_time_slot,
            "weather_condition": weather_condition,
            "prefer_low_congestion": prefer_low_congestion,
        },
        "candidate_windows_evaluated": len(recommendations),
        "recommendations": recommendations[:k],
        "explanation": (
            "Represents each historical (hour, day_type, weather) travel window as a normalized "
            "feature vector and ranks candidates by cosine similarity to the user's preferred time, "
            "weather, and congestion profile."
        ),
    }


# ============================================================================
# H. Reinforcement Learning (Q-Learning Traffic Signal Control)
# ============================================================================

# Discrete green-split actions respecting MIN_GREEN=10, MAX_GREEN=40, sum=100
RL_ACTIONS: List[Dict[str, int]] = [
    {"north": 25, "south": 25, "east": 25, "west": 25},  # 0: Balanced
    {"north": 40, "south": 30, "east": 15, "west": 15},  # 1: Prioritize N/S
    {"north": 15, "south": 15, "east": 40, "west": 30},  # 2: Prioritize E/W
    {"north": 40, "south": 20, "east": 20, "west": 20},  # 3: Heavy North
    {"north": 20, "south": 20, "east": 20, "west": 40},  # 4: Heavy West
]


def _discretize_state(queues: Dict[str, int]) -> Tuple[int, int]:
    ns = queues["north"] + queues["south"]
    ew = queues["east"] + queues["west"]
    diff = ns - ew
    imbalance = 0 if diff > 10 else (2 if diff < -10 else 1)
    load = 0 if (ns + ew) < 30 else (1 if (ns + ew) < 80 else 2)
    return (imbalance, load)


def _step_signal_env(queues: Dict[str, int], green_times: Dict[str, int], arrivals: Dict[str, int]):
    next_q: Dict[str, int] = {}
    discharged_total = 0
    for d in DIRECTIONS:
        # 1800 veh/hr/lane = 0.5 veh/sec, 2s startup lost time
        eff_green = max(0.0, green_times[d] - 2.0)
        cap = int(eff_green * 0.5)
        waiting = queues[d] + arrivals[d]
        served = min(waiting, cap)
        discharged_total += served
        next_q[d] = waiting - served
    total_q = sum(next_q.values())
    reward = float(discharged_total - 0.5 * total_q)
    return next_q, reward, total_q


def run_rl_signal_experiment(
    episodes: int = 35,
    cycles_per_episode: int = 8,
    alpha: float = 0.2,
    gamma: float = 0.9,
    epsilon: float = 0.2,
) -> Dict[str, Any]:
    """Train a Q-Learning signal agent and compare it with fixed and adaptive baselines."""
    eps_count = max(10, min(int(episodes), 80))
    cyc_count = max(4, min(int(cycles_per_episode), 15))
    rng = np.random.default_rng(42)

    initial_queues = {"north": 18, "south": 12, "east": 8, "west": 16}
    arrival_rates = {"north": 11.0, "south": 8.0, "east": 5.0, "west": 10.0}

    q_table: Dict[Tuple[int, int], np.ndarray] = defaultdict(lambda: np.zeros(len(RL_ACTIONS)))
    learning_curve: List[Dict[str, Any]] = []

    for ep in range(1, eps_count + 1):
        queues = initial_queues.copy()
        ep_reward = 0.0
        ep_queues: List[int] = []

        for _ in range(cyc_count):
            state = _discretize_state(queues)
            if rng.random() < epsilon:
                action_idx = int(rng.integers(0, len(RL_ACTIONS)))
            else:
                action_idx = int(np.argmax(q_table[state]))

            arrivals = {d: int(rng.poisson(arrival_rates[d])) for d in DIRECTIONS}
            next_q, reward, total_q = _step_signal_env(queues, RL_ACTIONS[action_idx], arrivals)
            next_state = _discretize_state(next_q)

            best_next = float(np.max(q_table[next_state]))
            q_table[state][action_idx] += alpha * (reward + gamma * best_next - q_table[state][action_idx])

            queues = next_q
            ep_reward += reward
            ep_queues.append(total_q)

        learning_curve.append({
            "episode": ep,
            "total_reward": round(ep_reward, 2),
            "avg_queue": round(float(np.mean(ep_queues)), 2),
        })

    # Evaluate trained greedy Q-policy vs existing simulator's fixed & adaptive baselines
    eval_rng = np.random.default_rng(123)
    rl_queues = initial_queues.copy()
    rl_total_discharged = 0
    rl_end_queues: List[int] = []
    for _ in range(cyc_count):
        state = _discretize_state(rl_queues)
        act = int(np.argmax(q_table[state]))
        arrivals = {d: int(eval_rng.poisson(arrival_rates[d])) for d in DIRECTIONS}
        rl_queues, _, total_q = _step_signal_env(rl_queues, RL_ACTIONS[act], arrivals)
        rl_total_discharged += sum(arrivals.values())
        rl_end_queues.append(total_q)

    fixed_res = simulate_intersection(
        initial_queues=initial_queues,
        arrival_rates=arrival_rates,
        cycles=cyc_count,
        strategy="fixed",
        random_seed=123,
    )
    adaptive_res = simulate_intersection(
        initial_queues=initial_queues,
        arrival_rates=arrival_rates,
        cycles=cyc_count,
        strategy="adaptive",
        random_seed=123,
    )

    strategy_comparison = [
        {
            "strategy": "Fixed Timing (25s each)",
            "final_total_queue": sum(fixed_res["final_queues"].values()),
            "avg_queue": round(float(np.mean([sum(c["queues_after"].values()) for c in fixed_res["history"]])), 2),
        },
        {
            "strategy": "Webster Adaptive",
            "final_total_queue": sum(adaptive_res["final_queues"].values()),
            "avg_queue": round(float(np.mean([sum(c["queues_after"].values()) for c in adaptive_res["history"]])), 2),
        },
        {
            "strategy": "Q-Learning Agent",
            "final_total_queue": sum(rl_queues.values()),
            "avg_queue": round(float(np.mean(rl_end_queues)), 2),
        },
    ]

    return {
        "title": "Q-Learning Adaptive Traffic Signal Control",
        "rl_process": {
            "agent": "Tabular Q-Learning Signal Controller",
            "environment": "4-Approach Signalized Intersection (120s cycle, 10s-40s green bounds)",
            "state": "Discretized (NS vs EW queue imbalance, total intersection load)",
            "action": "5 legal green-time split profiles summing to 100s available green",
            "reward": "Vehicles discharged minus 0.5 * remaining total queue",
        },
        "hyperparameters": {
            "episodes": eps_count,
            "cycles_per_episode": cyc_count,
            "alpha": alpha,
            "gamma": gamma,
            "epsilon": epsilon,
        },
        "q_states_learned": len(q_table),
        "learning_curve": learning_curve,
        "strategy_comparison": strategy_comparison,
        "explanation": (
            "The Q-Learning agent explores green-time allocations over simulated episodes, updating "
            "Q(s, a) via Bellman temporal-difference updates. Its learned policy is compared against "
            "the existing fixed and Webster adaptive controllers."
        ),
    }


# ============================================================================
# I. AI Ethics and Future Trends
# ============================================================================

def get_ai_ethics_content() -> Dict[str, Any]:
    """Return structured educational material on AI ethics, limitations, and future trends."""
    return {
        "title": "AI Ethics, Limitations & Future Trends in Traffic ML",
        "pillars": [
            {
                "topic": "Dataset Bias & Geographic Domain Shift",
                "summary": (
                    "The ITMS congestion classifier is trained on the UCI Metro Interstate Traffic Volume "
                    "dataset from Minnesota (USA). Deploying a model trained on one region directly onto "
                    "Chandigarh Tricity urban intersections without local sensor calibration introduces "
                    "domain-shift bias."
                ),
            },
            {
                "topic": "Fairness in Signal Allocation",
                "summary": (
                    "Pure throughput-maximizing signal optimizers can starve minor side-street approaches. "
                    "ITMS enforces hard MIN_GREEN (10s) and MAX_GREEN (40s) safety bounds to guarantee "
                    "minimum service fairness for every direction."
                ),
            },
            {
                "topic": "Privacy & Telemetry Governance",
                "summary": (
                    "Intelligent traffic systems should aggregate anonymized loop/probe counts rather than "
                    "storing personally identifiable license plates or continuous individual GPS tracks."
                ),
            },
            {
                "topic": "Explainability & Transparency",
                "summary": (
                    "Black-box scores erode operator trust. ITMS surfaces confidence probabilities, feature "
                    "import/loadings, route-scoring breakdowns, and explicit dataset disclaimers."
                ),
            },
        ],
        "future_trends": [
            "Multi-Agent Reinforcement Learning (MARL) for corridor-wide green-wave coordination",
            "Vehicle-to-Infrastructure (V2X) connected intersection telemetry",
            "Federated Learning across municipal traffic controllers without centralizing raw video",
            "Edge AI inference on roadside units for sub-second incident detection",
        ],
    }


from backend.services.strategy_comparator import compare_strategies_multi_run

initial_queues = {
    "north": 45,
    "south": 30,
    "east": 15,
    "west": 10
}

arrival_rates = {
    "north": 12.0,
    "south": 8.0,
    "east": 4.0,
    "west": 3.0
}

result = compare_strategies_multi_run(
    initial_queues=initial_queues,
    arrival_rates=arrival_rates,
    cycles=5,
    runs=5,
    base_seed=42
)

print("\nMonte Carlo Strategy Comparison (5 Runs)")
print("========================================")
print(f"Fixed Avg Waiting:    {result['fixed_strategy']['total_waiting']} vehicles (std: {result['fixed_strategy']['std_final_waiting']})")
print(f"Adaptive Avg Waiting: {result['adaptive_strategy']['total_waiting']} vehicles (std: {result['adaptive_strategy']['std_final_waiting']})")
print(f"Vehicles Saved:       {result['comparison']['vehicles_saved']}")
print(f"Improvement:          {result['comparison']['improvement_percentage']}%")
print(f"Win Rate: Adaptive won {result['statistical_reliability']['adaptive_wins']}/{result['statistical_reliability']['total_runs']} runs")

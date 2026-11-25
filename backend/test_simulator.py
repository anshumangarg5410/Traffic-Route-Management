
from backend.services.traffic_simulator import simulate_intersection

initial_queues = {
    "north": 45,
    "south": 30,
    "east": 15,
    "west": 10
}

# New vehicles arriving per minute
arrival_rates = {
    "north": 12,
    "south": 8,
    "east": 4,
    "west": 3
}

result = simulate_intersection(
    initial_queues=initial_queues,
    arrival_rates=arrival_rates,
    cycles=5,
    random_seed=42
)

print("\nTraffic Simulation (Seeded: 42)")
print("-------------------------------")

for cycle_data in result["history"]:
    print(f"\nCycle {cycle_data['cycle']}")

    for direction in ["north", "south", "east", "west"]:
        print(
            f"{direction.upper()}: "
            f"Queue={cycle_data['queues_after'][direction]}, "
            f"Arrivals={cycle_data['arrivals'][direction]}, "
            f"Green={cycle_data['green_times'][direction]}s, "
            f"Discharged={cycle_data['discharged'][direction]}"
        )

print("\nFinal Queues:")
print(result["final_queues"])

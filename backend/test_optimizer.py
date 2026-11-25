
try:
    from backend.services.signal_optimizer import optimize_signal
except ModuleNotFoundError:
    from services.signal_optimizer import optimize_signal

traffic = {
    "north": 45,
    "south": 30,
    "east": 15,
    "west": 10
}

result = optimize_signal(traffic)

print("\nAdaptive Signal Optimization")
print("----------------------------")

for direction, vehicles in result["traffic_counts"].items():
    green = result["green_times"][direction]
    demand = result["relative_demands"][direction]

    print(
        f"{direction.upper()}: "
        f"{vehicles} vehicles (Demand: {demand * 100:.1f}%) -> {green} seconds green"
    )

print("\nTotal green time:", result["total_green_time"], "seconds")
print("Clearance time:", result["clearance_time"], "seconds")
print("Complete cycle:", result["cycle_time"], "seconds")
print("Phase model:", result["intersection_model"]["type"])

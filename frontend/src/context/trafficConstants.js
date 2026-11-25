export const DIRECTIONS = ["north", "south", "east", "west"];

export const DEFAULT_DIRECTIONAL_QUEUES = {
  north: 45,
  south: 30,
  east: 15,
  west: 10,
};

export const DEFAULT_ARRIVAL_RATES = {
  north: 12,
  south: 8,
  east: 4,
  west: 3,
};

export const DEFAULT_LANES = {
  north: 1,
  south: 1,
  east: 1,
  west: 1,
};

export const DEFAULT_SATURATION_FLOW_RATES = {
  north: 1800,
  south: 1800,
  east: 1800,
  west: 1800,
};

export const DEFAULT_STARTUP_LOST_TIMES = {
  north: 2.0,
  south: 2.0,
  east: 2.0,
  west: 2.0,
};

export const DEFAULT_SIMULATION_SETTINGS = {
  cycles: 5,
  runs: 5,
  strategy: "adaptive",
  randomSeed: "42",
  applyScaling: false,
};

export const DEFAULT_DISCHARGE_POLICY = "fractional_carryover";

export const DEFAULT_SCENARIO = {
  name: "Default Arterial Inflow",
  description: "Standard 4-approach arterial intersection with primary North/South commuter volume.",
  isPreset: true,
};

export const SCENARIO_PRESETS = [
  {
    id: "default",
    name: "Default Arterial Inflow",
    description: "Standard 4-approach arterial intersection with primary North/South commuter volume.",
    initialQueues: { north: 45, south: 30, east: 15, west: 10 },
    arrivalRates: { north: 12.0, south: 8.0, east: 4.0, west: 3.0 },
    lanes: { north: 1, south: 1, east: 1, west: 1 },
  },
  {
    id: "balanced",
    name: "Balanced Demand",
    description: "Equal moderate queues and inflow rates across all four approaches; serves as a symmetric baseline.",
    initialQueues: { north: 25, south: 25, east: 25, west: 25 },
    arrivalRates: { north: 6.0, south: 6.0, east: 6.0, west: 6.0 },
    lanes: { north: 1, south: 1, east: 1, west: 1 },
  },
  {
    id: "northbound_heavy",
    name: "Northbound Heavy Inflow",
    description: "High morning commuter rush from the North corridor with heavy arrival rates requiring green bias.",
    initialQueues: { north: 65, south: 25, east: 15, west: 10 },
    arrivalRates: { north: 16.0, south: 7.0, east: 4.0, west: 3.0 },
    lanes: { north: 2, south: 1, east: 1, west: 1 },
  },
  {
    id: "east_west_congestion",
    name: "East-West Cross Congestion",
    description: "Major crosstown commercial traffic along East-West arterial with secondary North-South feeder streets.",
    initialQueues: { north: 10, south: 12, east: 55, west: 50 },
    arrivalRates: { north: 3.0, south: 3.5, east: 14.0, west: 12.5 },
    lanes: { north: 1, south: 1, east: 2, west: 2 },
  },
  {
    id: "saturated",
    name: "High-Demand Saturated",
    description: "Near-capacity saturated queues and intense arrivals on all approaches testing discharge constraints.",
    initialQueues: { north: 60, south: 55, east: 50, west: 45 },
    arrivalRates: { north: 15.0, south: 14.0, east: 12.0, west: 11.0 },
    lanes: { north: 2, south: 2, east: 1, west: 1 },
  },
];

/**
 * Safely parse an optional random seed parameter preserving 0.
 * Returns non-negative integer or null.
 */
export function parseOptionalSeed(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str === "" || str === "null" || str === "undefined") return null;
  const num = Number(str);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useMemo, useCallback } from "react";
import {
  DIRECTIONS,
  DEFAULT_DIRECTIONAL_QUEUES,
  DEFAULT_ARRIVAL_RATES,
  DEFAULT_LANES,
  DEFAULT_SATURATION_FLOW_RATES,
  DEFAULT_STARTUP_LOST_TIMES,
  DEFAULT_SIMULATION_SETTINGS,
  DEFAULT_DISCHARGE_POLICY,
  DEFAULT_SCENARIO,
  SCENARIO_PRESETS,
  parseOptionalSeed,
} from "./trafficConstants";

export {
  DIRECTIONS,
  DEFAULT_DIRECTIONAL_QUEUES,
  DEFAULT_ARRIVAL_RATES,
  DEFAULT_LANES,
  DEFAULT_SATURATION_FLOW_RATES,
  DEFAULT_STARTUP_LOST_TIMES,
  DEFAULT_SIMULATION_SETTINGS,
  DEFAULT_DISCHARGE_POLICY,
  DEFAULT_SCENARIO,
  SCENARIO_PRESETS,
  parseOptionalSeed,
};

const TrafficContext = createContext(null);

export function TrafficProvider({ children }) {
  const [trafficConfig, setTrafficConfig] = useState({
    initialQueues: { ...DEFAULT_DIRECTIONAL_QUEUES },
    arrivalRates: { ...DEFAULT_ARRIVAL_RATES },
    lanes: { ...DEFAULT_LANES },
    saturationFlowRates: { ...DEFAULT_SATURATION_FLOW_RATES },
    startupLostTimes: { ...DEFAULT_STARTUP_LOST_TIMES },
    dischargePolicy: DEFAULT_DISCHARGE_POLICY,
    simulation: { ...DEFAULT_SIMULATION_SETTINGS },
    scenario: { ...DEFAULT_SCENARIO },
  });

  // Update initial queues (accepts either (direction, value) or (newQueuesObject))
  const updateDirectionalQueues = useCallback((arg1, arg2) => {
    setTrafficConfig((prev) => {
      if (typeof arg1 === "string") {
        return {
          ...prev,
          initialQueues: {
            ...prev.initialQueues,
            [arg1]: arg2,
          },
        };
      }
      if (typeof arg1 === "object" && arg1 !== null) {
        return {
          ...prev,
          initialQueues: {
            ...prev.initialQueues,
            ...arg1,
          },
        };
      }
      return prev;
    });
  }, []);

  // Update arrival rates (accepts either (direction, value) or (newRatesObject))
  const updateArrivalRates = useCallback((arg1, arg2) => {
    setTrafficConfig((prev) => {
      if (typeof arg1 === "string") {
        return {
          ...prev,
          arrivalRates: {
            ...prev.arrivalRates,
            [arg1]: arg2,
          },
        };
      }
      if (typeof arg1 === "object" && arg1 !== null) {
        return {
          ...prev,
          arrivalRates: {
            ...prev.arrivalRates,
            ...arg1,
          },
        };
      }
      return prev;
    });
  }, []);

  // Update intersection geometry (lanes, sat rates, lost times, discharge policy)
  const updateIntersectionGeometry = useCallback((geometryUpdates) => {
    setTrafficConfig((prev) => ({
      ...prev,
      lanes: geometryUpdates.lanes
        ? { ...prev.lanes, ...geometryUpdates.lanes }
        : prev.lanes,
      saturationFlowRates: geometryUpdates.saturationFlowRates
        ? { ...prev.saturationFlowRates, ...geometryUpdates.saturationFlowRates }
        : prev.saturationFlowRates,
      startupLostTimes: geometryUpdates.startupLostTimes
        ? { ...prev.startupLostTimes, ...geometryUpdates.startupLostTimes }
        : prev.startupLostTimes,
      dischargePolicy: geometryUpdates.dischargePolicy ?? prev.dischargePolicy,
    }));
  }, []);

  // Granular helpers for geometry
  const updateLanes = useCallback((dirOrDict, value) => {
    setTrafficConfig((prev) => {
      if (typeof dirOrDict === "string") {
        return {
          ...prev,
          lanes: { ...prev.lanes, [dirOrDict]: value },
        };
      }
      if (typeof dirOrDict === "object" && dirOrDict !== null) {
        return {
          ...prev,
          lanes: { ...prev.lanes, ...dirOrDict },
        };
      }
      return prev;
    });
  }, []);

  const updateSaturationFlowRates = useCallback((dirOrValueOrDict, value) => {
    setTrafficConfig((prev) => {
      if (typeof dirOrValueOrDict === "string" && value !== undefined) {
        return {
          ...prev,
          saturationFlowRates: { ...prev.saturationFlowRates, [dirOrValueOrDict]: value },
        };
      }
      if (typeof dirOrValueOrDict === "number" || (typeof dirOrValueOrDict === "string" && value === undefined)) {
        // Uniform update to all 4 directions
        const uniformVal = dirOrValueOrDict;
        return {
          ...prev,
          saturationFlowRates: {
            north: uniformVal,
            south: uniformVal,
            east: uniformVal,
            west: uniformVal,
          },
        };
      }
      if (typeof dirOrValueOrDict === "object" && dirOrValueOrDict !== null) {
        return {
          ...prev,
          saturationFlowRates: { ...prev.saturationFlowRates, ...dirOrValueOrDict },
        };
      }
      return prev;
    });
  }, []);

  const updateStartupLostTimes = useCallback((dirOrValueOrDict, value) => {
    setTrafficConfig((prev) => {
      if (typeof dirOrValueOrDict === "string" && value !== undefined) {
        return {
          ...prev,
          startupLostTimes: { ...prev.startupLostTimes, [dirOrValueOrDict]: value },
        };
      }
      if (typeof dirOrValueOrDict === "number" || (typeof dirOrValueOrDict === "string" && value === undefined)) {
        // Uniform update to all 4 directions
        const uniformVal = dirOrValueOrDict;
        return {
          ...prev,
          startupLostTimes: {
            north: uniformVal,
            south: uniformVal,
            east: uniformVal,
            west: uniformVal,
          },
        };
      }
      if (typeof dirOrValueOrDict === "object" && dirOrValueOrDict !== null) {
        return {
          ...prev,
          startupLostTimes: { ...prev.startupLostTimes, ...dirOrValueOrDict },
        };
      }
      return prev;
    });
  }, []);

  // Update simulation settings (cycles, runs, strategy, seed, scaling)
  const updateSimulationSettings = useCallback((arg1, arg2) => {
    setTrafficConfig((prev) => {
      if (typeof arg1 === "string") {
        return {
          ...prev,
          simulation: {
            ...prev.simulation,
            [arg1]: arg2,
          },
        };
      }
      if (typeof arg1 === "object" && arg1 !== null) {
        return {
          ...prev,
          simulation: {
            ...prev.simulation,
            ...arg1,
          },
        };
      }
      return prev;
    });
  }, []);

  // Update active scenario metadata
  const updateScenario = useCallback((scenarioUpdates) => {
    setTrafficConfig((prev) => ({
      ...prev,
      scenario: {
        ...prev.scenario,
        ...scenarioUpdates,
      },
    }));
  }, []);

  // Apply predefined illustrative scenario preset
  const applyScenarioPreset = useCallback((presetId) => {
    const preset = SCENARIO_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setTrafficConfig((prev) => ({
      ...prev,
      initialQueues: { ...preset.initialQueues },
      arrivalRates: { ...preset.arrivalRates },
      lanes: preset.lanes ? { ...preset.lanes } : prev.lanes,
      scenario: {
        name: preset.name,
        description: preset.description,
        isPreset: true,
      },
    }));
  }, []);

  // Reset to original defaults
  const resetTrafficConfig = useCallback(() => {
    setTrafficConfig({
      initialQueues: { ...DEFAULT_DIRECTIONAL_QUEUES },
      arrivalRates: { ...DEFAULT_ARRIVAL_RATES },
      lanes: { ...DEFAULT_LANES },
      saturationFlowRates: { ...DEFAULT_SATURATION_FLOW_RATES },
      startupLostTimes: { ...DEFAULT_STARTUP_LOST_TIMES },
      dischargePolicy: DEFAULT_DISCHARGE_POLICY,
      simulation: { ...DEFAULT_SIMULATION_SETTINGS },
      scenario: { ...DEFAULT_SCENARIO },
    });
  }, []);

  const value = useMemo(
    () => ({
      trafficConfig,
      initialQueues: trafficConfig.initialQueues,
      arrivalRates: trafficConfig.arrivalRates,
      lanes: trafficConfig.lanes,
      saturationFlowRates: trafficConfig.saturationFlowRates,
      startupLostTimes: trafficConfig.startupLostTimes,
      dischargePolicy: trafficConfig.dischargePolicy,
      simulation: trafficConfig.simulation,
      scenario: trafficConfig.scenario,
      updateDirectionalQueues,
      updateArrivalRates,
      updateIntersectionGeometry,
      updateLanes,
      updateSaturationFlowRates,
      updateStartupLostTimes,
      updateSimulationSettings,
      updateScenario,
      applyScenarioPreset,
      resetTrafficConfig,
    }),
    [
      trafficConfig,
      updateDirectionalQueues,
      updateArrivalRates,
      updateIntersectionGeometry,
      updateLanes,
      updateSaturationFlowRates,
      updateStartupLostTimes,
      updateSimulationSettings,
      updateScenario,
      applyScenarioPreset,
      resetTrafficConfig,
    ]
  );

  return (
    <TrafficContext.Provider value={value}>
      {children}
    </TrafficContext.Provider>
  );
}

export function useTraffic() {
  const context = useContext(TrafficContext);
  if (!context) {
    throw new Error("useTraffic must be used within a TrafficProvider.");
  }
  return context;
}

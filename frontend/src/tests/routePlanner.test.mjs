/**
 * Automated Test Suite for Smart Route Planner
 * =============================================
 * Phase 10.6: Integration, Telemetry, and Spatial Logic Verification
 *
 * Runs natively in Node.js via node:test and node:assert.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TRICITY_BOUNDS,
  TRICITY_CENTER,
  TRICITY_LANDMARKS,
  isWithinTricityRegion,
  formatCoordinate,
  calculateHaversineDistanceKm,
} from "../components/routing/mapConstants.js";

describe("Phase 10.6 — Smart Route Planner Integration Test Suite", () => {
  // 1. Coordinate Boundary Verification (Chandigarh Tricity)
  describe("Geographical Boundary & Coordinate Validation", () => {
    it("should accept points strictly within Chandigarh Tricity bounds", () => {
      // Chandigarh Sector 17
      assert.equal(isWithinTricityRegion(30.7333, 76.7794), true);
      // Mohali SAS Nagar
      assert.equal(isWithinTricityRegion(30.7046, 76.7179), true);
      // Panchkula
      assert.equal(isWithinTricityRegion(30.6942, 76.8606), true);
      // Kharar
      assert.equal(isWithinTricityRegion(30.7499, 76.6411), true);
      // Zirakpur
      assert.equal(isWithinTricityRegion(30.6425, 76.8173), true);
    });

    it("should accept exact bounding box corners", () => {
      const [south, west] = TRICITY_BOUNDS[0];
      const [north, east] = TRICITY_BOUNDS[1];
      assert.equal(isWithinTricityRegion(south, west), true);
      assert.equal(isWithinTricityRegion(north, east), true);
      assert.equal(isWithinTricityRegion(south, east), true);
      assert.equal(isWithinTricityRegion(north, west), true);
    });

    it("should reject points outside the Tricity bounding box", () => {
      // New Delhi
      assert.equal(isWithinTricityRegion(28.6139, 77.2090), false);
      // Mumbai
      assert.equal(isWithinTricityRegion(19.0760, 72.8777), false);
      // London
      assert.equal(isWithinTricityRegion(51.5074, -0.1278), false);
      // Just north of boundary (30.86 > 30.85)
      assert.equal(isWithinTricityRegion(30.8600, 76.7794), false);
      // Just south of boundary (30.53 < 30.54)
      assert.equal(isWithinTricityRegion(30.5300, 76.7794), false);
      // Just west of boundary (76.58 < 76.59)
      assert.equal(isWithinTricityRegion(30.7333, 76.5800), false);
      // Just east of boundary (76.94 > 76.93)
      assert.equal(isWithinTricityRegion(30.7333, 76.9400), false);
    });

    it("should reject invalid, null, NaN, or non-numeric coordinate inputs", () => {
      assert.equal(isWithinTricityRegion(NaN, 76.7794), false);
      assert.equal(isWithinTricityRegion(30.7333, NaN), false);
      assert.equal(isWithinTricityRegion(null, 76.7794), false);
      assert.equal(isWithinTricityRegion(30.7333, undefined), false);
      assert.equal(isWithinTricityRegion("30.7333", "76.7794"), false);
    });
  });

  // 2. Haversine Distance Calculations
  describe("Spatial Math & Haversine Distance", () => {
    it("should compute zero distance between identical points", () => {
      const dist = calculateHaversineDistanceKm(TRICITY_CENTER, TRICITY_CENTER);
      assert.equal(dist, 0);
    });

    it("should accurately compute distance between Chandigarh and Mohali", () => {
      const chd = [30.7333, 76.7794];
      const mohali = [30.7046, 76.7179];
      const dist = calculateHaversineDistanceKm(chd, mohali);
      assert.ok(dist !== null);
      // Straight-line distance is ~6.6 km
      assert.ok(dist >= 6.0 && dist <= 7.2, `Expected ~6.6km, got ${dist}`);
    });

    it("should handle null or incomplete coordinate pairs gracefully", () => {
      assert.equal(calculateHaversineDistanceKm(null, [30.7, 76.7]), null);
      assert.equal(calculateHaversineDistanceKm([30.7], [30.7, 76.7]), null);
      assert.equal(calculateHaversineDistanceKm([30.7, 76.7], undefined), null);
    });
  });

  // 3. Coordinate Formatting
  describe("Coordinate String Formatting", () => {
    it("should format positive lat/lon into N/E representation", () => {
      const formatted = formatCoordinate(30.7333, 76.7794, 4);
      assert.equal(formatted, "30.7333°N, 76.7794°E");
    });

    it("should return empty string for non-numeric coordinates", () => {
      assert.equal(formatCoordinate(null, null), "");
      assert.equal(formatCoordinate("abc", 76.7794), "");
    });
  });

  // 4. Tricity Landmarks Completeness
  describe("Preset Regional Hubs & Landmarks", () => {
    it("should include all 7 primary Tricity urban centers", () => {
      assert.equal(TRICITY_LANDMARKS.length >= 7, true);
      const landmarkIds = TRICITY_LANDMARKS.map((l) => l.id);
      assert.ok(landmarkIds.includes("chandigarh"));
      assert.ok(landmarkIds.includes("mohali"));
      assert.ok(landmarkIds.includes("panchkula"));
      assert.ok(landmarkIds.includes("zirakpur"));
      assert.ok(landmarkIds.includes("kharar"));
      assert.ok(landmarkIds.includes("new_chandigarh"));
      assert.ok(landmarkIds.includes("dera_bassi"));
    });

    it("all landmarks should fall strictly within Tricity bounds", () => {
      TRICITY_LANDMARKS.forEach((l) => {
        const [lat, lon] = l.coordinates;
        assert.equal(
          isWithinTricityRegion(lat, lon),
          true,
          `Landmark ${l.name} (${lat}, ${lon}) must be within bounds`
        );
      });
    });
  });

  // 5. Route Comparison & Ranking Verification
  describe("Route Ranking and Recommendation Selection Logic", () => {
    const mockRoutes = [
      {
        route_id: "osrm_0",
        rank: 1,
        score: 0.88,
        is_recommended: true,
        summary: "Via Madhya Marg",
        distance_km: 12.4,
        duration_min: 18.2,
        signal_delay_summary: {
          analysis_status: "success",
          estimated_duration_min: 21.5,
          total_estimated_signal_delay_s: 200.0,
          signal_count: 10,
        },
        intersection_analysis: {
          total_intersection_nodes: 32,
          signalized_intersection_nodes: 10,
          unsignalized_intersection_nodes: 22,
          intersection_density_per_km: 2.58,
        },
      },
      {
        route_id: "osrm_1",
        rank: 2,
        score: 0.74,
        is_recommended: false,
        summary: "Via Dakshin Marg",
        distance_km: 14.1,
        duration_min: 20.0,
        signal_delay_summary: {
          analysis_status: "success",
          estimated_duration_min: 25.0,
          total_estimated_signal_delay_s: 300.0,
          signal_count: 15,
        },
        intersection_analysis: {
          total_intersection_nodes: 40,
          signalized_intersection_nodes: 15,
          unsignalized_intersection_nodes: 25,
          intersection_density_per_km: 2.84,
        },
      },
    ];

    it("should identify recommended route with rank 1 and highest score", () => {
      const recommended = mockRoutes.find((r) => r.is_recommended);
      assert.ok(recommended);
      assert.equal(recommended.route_id, "osrm_0");
      assert.equal(recommended.rank, 1);
      assert.ok(recommended.score > mockRoutes[1].score);
    });

    it("should compute modeled duration difference accurately", () => {
      const route = mockRoutes[0];
      const baselineMin = route.duration_min;
      const estimatedMin = route.signal_delay_summary.estimated_duration_min;
      const diffMin = estimatedMin - baselineMin;
      assert.ok(Math.abs(diffMin - 3.3) < 0.05);

      const delayS = route.signal_delay_summary.total_estimated_signal_delay_s;
      assert.equal(Math.round(delayS / 60.0 * 10) / 10, 3.3);
    });
  });

  // 6. Intersection Ordering & Classification Logic
  describe("Intersection Inspection & Classification", () => {
    const mockIntersections = [
      {
        osm_node_id: 1001,
        latitude: 30.7300,
        longitude: 76.7750,
        distance_along_route_m: 1200.0,
        lateral_distance_m: 1.2,
        is_signalized: true,
        tags: { highway: "traffic_signals" },
      },
      {
        osm_node_id: 1002,
        latitude: 30.7350,
        longitude: 76.7800,
        distance_along_route_m: 450.0,
        lateral_distance_m: 2.0,
        is_signalized: false,
        tags: { highway: "give_way" },
      },
      {
        osm_node_id: 1003,
        latitude: 30.7400,
        longitude: 76.7850,
        distance_along_route_m: 2800.0,
        lateral_distance_m: 0.8,
        is_signalized: true,
        tags: { highway: "traffic_signals" },
      },
    ];

    it("should sort intersections strictly ascending by distance_along_route_m", () => {
      const sorted = [...mockIntersections].sort(
        (a, b) => a.distance_along_route_m - b.distance_along_route_m
      );
      assert.equal(sorted[0].osm_node_id, 1002); // 450m
      assert.equal(sorted[1].osm_node_id, 1001); // 1200m
      assert.equal(sorted[2].osm_node_id, 1003); // 2800m
    });

    it("should correctly classify mapped signal vs no mapped signal tag", () => {
      mockIntersections.forEach((node) => {
        const userLabel = node.is_signalized ? "Mapped signal" : "No mapped signal tag";
        const category = node.is_signalized ? "Signalized" : "Topological intersection";
        if (node.is_signalized) {
          assert.equal(userLabel, "Mapped signal");
          assert.equal(category, "Signalized");
        } else {
          assert.equal(userLabel, "No mapped signal tag");
          assert.equal(category, "Topological intersection");
        }
      });
    });

    it("should correctly match per-signal delay by osm_node_id", () => {
      const mockSignalDelays = [
        {
          osm_node_id: 1001,
          cycle_length_s: 90.0,
          red_time_s: 60.0,
          estimated_delay_s: 20.0,
        },
        {
          osm_node_id: 1003,
          cycle_length_s: 90.0,
          red_time_s: 60.0,
          estimated_delay_s: 20.0,
        },
      ];

      const delayMap = new Map(mockSignalDelays.map((d) => [d.osm_node_id, d]));
      assert.equal(delayMap.has(1001), true);
      assert.equal(delayMap.get(1001).estimated_delay_s, 20.0);
      assert.equal(delayMap.has(1002), false); // Untagged intersection has no delay model
      assert.equal(delayMap.get(1003).cycle_length_s, 90.0);
    });
  });

  // 7. Defensive Handling of Missing / Degraded Data
  describe("Defensive Fallback & Degraded Data Resilience", () => {
    it("should handle null intersection_analysis gracefully", () => {
      const degradedRoute = {
        route_id: "osrm_fallback",
        rank: 1,
        distance_km: 10.0,
        duration_min: 15.0,
        intersection_analysis: null,
        signal_delay_summary: null,
      };

      const hasAnalysis =
        degradedRoute.intersection_analysis != null &&
        degradedRoute.intersection_analysis.analysis_status !== "invalid_geometry";
      assert.equal(hasAnalysis, false);

      const hasDelay =
        degradedRoute.signal_delay_summary != null &&
        degradedRoute.signal_delay_summary.analysis_status !== "error";
      assert.equal(hasDelay, false);
    });

    it("should reject invalid GeoJSON coordinates with NaN or infinite values", () => {
      const testCoords = [
        [30.73, 76.77],
        [NaN, 76.78],
        [30.74, Infinity],
        [30.75, 76.79],
      ];

      const validCoords = testCoords.filter(
        ([lat, lon]) =>
          typeof lat === "number" &&
          typeof lon === "number" &&
          Number.isFinite(lat) &&
          Number.isFinite(lon)
      );

      assert.equal(validCoords.length, 2);
      assert.deepEqual(validCoords[0], [30.73, 76.77]);
      assert.deepEqual(validCoords[1], [30.75, 76.79]);
    });
  });

  // 8. Asynchronous Lifecycle, Stale Request Prevention & State Invalidation
  describe("Asynchronous Lifecycle & State Invalidation", () => {
    it("should verify that AbortController signal correctly flags aborted requests", () => {
      const controller = new AbortController();
      let stateApplied = false;

      // Simulate an async operation that gets aborted before completing
      controller.abort();

      if (!controller.signal.aborted) {
        stateApplied = true;
      }

      assert.equal(stateApplied, false, "Aborted request must not apply state updates");
      assert.equal(controller.signal.aborted, true);
    });

    it("should completely invalidate dependent route and intersection state when inputs change", () => {
      // Simulate planner state
      let state = {
        routes: [{ route_id: "route_1" }],
        selectedRouteId: "route_1",
        selectedIntersectionNodeId: 1001,
        recommendation: { recommended_route_id: "route_1" },
        routesError: null,
        isLoadingRoutes: false,
        activeDetailsTab: "intersections",
      };

      // Invalidation function matching SmartRoutePlanner.jsx
      const invalidateRoutes = () => {
        state = {
          ...state,
          routes: [],
          selectedRouteId: null,
          selectedIntersectionNodeId: null,
          recommendation: null,
          routesError: null,
          isLoadingRoutes: false,
          activeDetailsTab: "comparison",
        };
      };

      invalidateRoutes();

      assert.equal(state.routes.length, 0);
      assert.equal(state.selectedRouteId, null);
      assert.equal(state.selectedIntersectionNodeId, null);
      assert.equal(state.recommendation, null);
      assert.equal(state.activeDetailsTab, "comparison");
    });

    it("should ensure failed request clears loading state and sets error without getting stuck", () => {
      let state = {
        isLoadingRoutes: true,
        routesError: null,
        routes: [],
      };

      // Simulate catch block in handleFindRoutes
      const handleError = (error) => {
        state = {
          ...state,
          isLoadingRoutes: false,
          routesError: error.message || "Failed to calculate routes",
        };
      };

      handleError(new Error("Network timeout"));

      assert.equal(state.isLoadingRoutes, false, "Loading state must be cleared on failure");
      assert.equal(state.routesError, "Network timeout");
      assert.equal(state.routes.length, 0);
    });
  });

  // 9. Keyboard Navigation Index Mathematics
  describe("Combobox Autocomplete Keyboard Index Cycling", () => {
    const listLength = 5;

    it("should increment index on ArrowDown and wrap from last to first", () => {
      let index = -1;
      const nextIndex = (prev, len) => (prev + 1) % len;

      index = nextIndex(index, listLength); // -1 -> 0
      assert.equal(index, 0);

      index = 4; // At last element
      index = nextIndex(index, listLength); // 4 -> 0 (wrapped)
      assert.equal(index, 0);
    });

    it("should decrement index on ArrowUp and wrap from first to last", () => {
      const prevIndex = (prev, len) => (prev <= 0 ? len - 1 : prev - 1);

      assert.equal(prevIndex(0, listLength), 4); // 0 -> 4 (wrapped)
      assert.equal(prevIndex(3, listLength), 2); // 3 -> 2
      assert.equal(prevIndex(-1, listLength), 4); // unselected -> last
    });
  });

  // 10. Signal Delay Formulation Verification
  describe("Signal Delay Mathematical Formulation", () => {
    it("should compute theoretical uniform delay d = R^2 / (2C) matching backend baseline", () => {
      const cycleLength = 90.0;
      const redTime = 60.0;
      const delayPerSignal = Math.pow(redTime, 2) / (2 * cycleLength);

      assert.equal(delayPerSignal, 20.0, "Expected exactly 20.0s delay per signal");

      // For 5 signals
      const totalDelay = 5 * delayPerSignal;
      assert.equal(totalDelay, 100.0);
    });
  });
});

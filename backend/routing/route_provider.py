"""
Route Provider Integration
==========================

Phase 9.2: Driving Route Generation and OSRM Service Integration.

Integrates Open Source Routing Machine (OSRM) driving route service:
- Generates point-to-point driving routes between validated coordinates.
- Requests candidate alternatives where available.
- Requests full GeoJSON geometries and turn-by-turn navigation steps.
- Parses distance (m, km) and baseline duration (s, min).
- Handles single-route, multi-alternative, no-route, and provider failure conditions.
- Provider is completely isolated so it can be replaced with a locally hosted routing engine.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
import requests

from backend.routing.config import (
    ROUTING_PROVIDER,
    OSRM_BASE_URL,
    OSRM_TIMEOUT,
    NOMINATIM_USER_AGENT,
)
from backend.routing.models import (
    Coordinate,
    GeoJSONGeometry,
    RouteManeuver,
    RouteStep,
    RouteResult,
    RouteSearchResponse,
)


class BaseRouteProvider(ABC):
    """Abstract base class for routing engine providers."""

    @abstractmethod
    def find_routes(
        self,
        source: Coordinate,
        destination: Coordinate,
        alternatives: bool = True,
    ) -> RouteSearchResponse:
        """Find driving routes between source and destination coordinates."""
        pass


class OSRMRouteProvider(BaseRouteProvider):
    """
    OSRM (Open Source Routing Machine) route service client.
    
    Supports:
    - Driving profile (/route/v1/driving/...)
    - Alternative route generation
    - Full GeoJSON LineString geometry
    - Turn-by-turn steps with maneuver locations
    """

    def __init__(
        self,
        base_url: str = OSRM_BASE_URL,
        timeout: float = OSRM_TIMEOUT,
        user_agent: str = NOMINATIM_USER_AGENT,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.user_agent = user_agent

    def find_routes(
        self,
        source: Coordinate,
        destination: Coordinate,
        alternatives: bool = True,
    ) -> RouteSearchResponse:
        """
        Request driving routes from OSRM service.
        Raises ValueError if no route is found or the response is invalid.
        Raises TimeoutError or ConnectionError if the HTTP request fails.
        """
        # OSRM coordinate format: {longitude},{latitude};{longitude},{latitude}
        coords_str = f"{source.longitude},{source.latitude};{destination.longitude},{destination.latitude}"
        url = f"{self.base_url}/route/v1/driving/{coords_str}"

        params = {
            "overview": "full",
            "geometries": "geojson",
            "steps": "true",
            "alternatives": "true" if alternatives else "false",
        }
        headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/json",
        }

        try:
            response = requests.get(url, params=params, headers=headers, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
        except requests.exceptions.Timeout as e:
            raise TimeoutError(f"Routing service timed out after {self.timeout}s: {str(e)}") from e
        except requests.exceptions.RequestException as e:
            raise ConnectionError(f"Routing service request failed: {str(e)}") from e
        except ValueError as e:
            raise ValueError(f"Invalid JSON received from routing service: {str(e)}") from e

        code = data.get("code")
        if code != "Ok":
            message = data.get("message", "Unknown routing error")
            if code == "NoRoute":
                raise ValueError(
                    f"No drivable route could be found between ({source.latitude}, {source.longitude}) "
                    f"and ({destination.latitude}, {destination.longitude}). The points may be separated by "
                    f"disconnected road networks, pedestrian-only barriers, or water bodies."
                )
            if code == "NoSegment":
                raise ValueError(
                    f"One or both endpoints ({source.latitude}, {source.longitude}) -> ({destination.latitude}, {destination.longitude}) "
                    f"could not snap to a routable road segment in the routing provider network."
                )
            raise ValueError(f"Routing provider error ({code}): {message}")

        raw_routes = data.get("routes")
        if not isinstance(raw_routes, list) or len(raw_routes) == 0:
            raise ValueError("Routing service returned no route options.")

        parsed_routes: List[RouteResult] = []

        for idx, r_data in enumerate(raw_routes):
            if not isinstance(r_data, dict):
                raise ValueError(f"Invalid route data structure at index {idx}.")

            route_id = f"route_{idx + 1}"
            is_primary = (idx == 0)

            dist_val = r_data.get("distance")
            dur_val = r_data.get("duration")
            if dist_val is None or dur_val is None:
                raise ValueError(f"Route at index {idx} missing distance or duration from routing provider.")
            try:
                dist_m = float(dist_val)
                dur_s = float(dur_val)
            except (ValueError, TypeError) as e:
                raise ValueError(f"Non-numeric distance or duration at route index {idx}: {str(e)}") from e

            # Parse GeoJSON geometry
            geom_data = r_data.get("geometry")
            if not isinstance(geom_data, dict):
                raise ValueError(f"Route at index {idx} has missing or non-dict geometry.")
            geom_type = geom_data.get("type", "LineString")
            geom_coords = geom_data.get("coordinates")
            if not isinstance(geom_coords, list) or len(geom_coords) < 2:
                raise ValueError(f"Route at index {idx} has missing or invalid coordinates in geometry (must have >= 2 points).")

            geometry = GeoJSONGeometry(
                type=geom_type,
                coordinates=geom_coords,
            )

            # Parse steps and summary across legs
            steps: List[RouteStep] = []
            summaries: List[str] = []

            for leg in r_data.get("legs", []):
                leg_summary = leg.get("summary")
                if leg_summary:
                    summaries.append(leg_summary)

                for step_data in leg.get("steps", []):
                    step_name = step_data.get("name", "")
                    s_dist = float(step_data.get("distance", 0.0))
                    s_dur = float(step_data.get("duration", 0.0))
                    s_mode = step_data.get("mode", "driving")

                    maneuver = None
                    m_data = step_data.get("maneuver")
                    if m_data and isinstance(m_data, dict):
                        m_type = m_data.get("type", "turn")
                        m_mod = m_data.get("modifier")
                        m_loc = m_data.get("location", [0.0, 0.0])
                        m_inst = step_data.get("instruction")  # May be synthesized or in step

                        maneuver = RouteManeuver(
                            type=m_type,
                            modifier=m_mod,
                            location=m_loc,
                            instruction=m_inst,
                        )

                    steps.append(
                        RouteStep(
                            name=step_name,
                            distance_m=round(s_dist, 1),
                            distance_km=round(s_dist / 1000.0, 3),
                            duration_s=round(s_dur, 1),
                            duration_min=round(s_dur / 60.0, 2),
                            maneuver=maneuver,
                            mode=s_mode,
                        )
                    )

            route_summary = ", ".join(summaries) if summaries else None

            parsed_routes.append(
                RouteResult(
                    route_id=route_id,
                    is_primary=is_primary,
                    distance_m=round(dist_m, 1),
                    distance_km=round(dist_m / 1000.0, 2),
                    duration_s=round(dur_s, 1),
                    duration_min=round(dur_s / 60.0, 1),
                    geometry=geometry,
                    steps=steps,
                    summary=route_summary,
                )
            )

        return RouteSearchResponse(
            source=source,
            destination=destination,
            routes_count=len(parsed_routes),
            routes=parsed_routes,
            provider="OSRM",
        )


# Module singleton
_DEFAULT_ROUTE_PROVIDER: Optional[BaseRouteProvider] = None


def get_route_provider() -> BaseRouteProvider:
    """Retrieve or initialize the active route provider instance."""
    global _DEFAULT_ROUTE_PROVIDER
    if _DEFAULT_ROUTE_PROVIDER is None:
        if ROUTING_PROVIDER.lower() == "osrm":
            _DEFAULT_ROUTE_PROVIDER = OSRMRouteProvider()
        else:
            _DEFAULT_ROUTE_PROVIDER = OSRMRouteProvider()
    return _DEFAULT_ROUTE_PROVIDER


def generate_routes(
    source: Coordinate,
    destination: Coordinate,
    alternatives: bool = True,
    provider: Optional[BaseRouteProvider] = None,
) -> RouteSearchResponse:
    """Generate driving routes between validated coordinates."""
    active_provider = provider or get_route_provider()
    return active_provider.find_routes(source=source, destination=destination, alternatives=alternatives)

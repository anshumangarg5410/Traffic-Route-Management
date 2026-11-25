"""
Geocoding Service for Chandigarh Tricity
========================================

Phase 9.2: Geocoding and Location Resolution.

Provides:
- Configurable geocoding service adapter (OpenStreetMap Nominatim default).
- Regional bounding box restriction (viewbox & bounded parameters).
- In-memory caching for identical queries.
- Respects Nominatim usage policy (custom User-Agent, bounded queries).
- Rejection of results outside the supported Chandigarh Tricity boundary.
"""

from abc import ABC, abstractmethod
import time
import threading
from collections import OrderedDict
from typing import Dict, Any, List, Optional
import requests

from backend.routing.config import (
    GEOCODING_PROVIDER,
    NOMINATIM_BASE_URL,
    NOMINATIM_USER_AGENT,
    NOMINATIM_TIMEOUT,
    GEOCODING_CACHE_SIZE,
    WEST_LON,
    SOUTH_LAT,
    EAST_LON,
    NORTH_LAT,
    is_within_region,
)
from backend.routing.models import GeocodeResult


class BaseGeocoder(ABC):
    """Abstract base class for geocoding providers."""

    @abstractmethod
    def geocode(self, query: str) -> GeocodeResult:
        """Resolve a location query into geographic coordinates."""
        pass


class NominatimGeocoder(BaseGeocoder):
    """
    OpenStreetMap Nominatim geocoding service adapter.
    
    Applies:
    - Viewbox bounding to favor Chandigarh Tricity results.
    - Regional containment validation.
    - Thread-safe in-memory LRU caching (OrderedDict) preventing cache stampedes.
    - Thread-safe monotonic 1 request/second rate limiting adhering to Nominatim usage policy.
    - Strict timeout and error handling.
    
    LIMITATION NOTE (Single-Process Boundary):
    Rate limiting and caching are enforced in-memory within this Python process via
    threading.Lock() and time.monotonic(). In multi-worker process deployments (e.g.
    uvicorn --workers 4), each worker process maintains an isolated instance. For production
    multi-process deployments, an external centralized coordinator (such as Redis or an
    internal proxy) should be used.
    """

    def __init__(
        self,
        base_url: str = NOMINATIM_BASE_URL,
        user_agent: str = NOMINATIM_USER_AGENT,
        timeout: float = NOMINATIM_TIMEOUT,
        cache_size: int = GEOCODING_CACHE_SIZE,
    ):
        self.base_url = base_url.rstrip("/")
        self.user_agent = user_agent
        self.timeout = timeout
        self.cache_size = cache_size
        self._cache: "OrderedDict[str, GeocodeResult]" = OrderedDict()
        self._last_request_time: float = 0.0
        self._lock = threading.Lock()

    def _normalize_query(self, query: str) -> str:
        """Normalize query string for deterministic cache lookup."""
        return " ".join(query.strip().lower().split())

    def geocode(self, query: str) -> GeocodeResult:
        """
        Geocode a location query into coordinates within Chandigarh Tricity.
        Raises ValueError if query is empty, not found, or outside the supported region.
        Raises ConnectionError or TimeoutError if the provider fails.
        """
        normalized_key = self._normalize_query(query)
        if not normalized_key:
            raise ValueError("Location query cannot be empty.")

        with self._lock:
            # 1. Check in-memory cache under lock (handles cache hits & stampedes)
            if normalized_key in self._cache:
                self._cache.move_to_end(normalized_key)
                return self._cache[normalized_key]

            # 2. Rate limiting protection: Nominatim requires at most 1 request per second
            now = time.monotonic()
            elapsed = now - self._last_request_time
            if elapsed < 1.0:
                time.sleep(1.0 - elapsed)
            self._last_request_time = time.monotonic()

            # Nominatim viewbox format: <left>,<top>,<right>,<bottom> = <min_lon>,<max_lat>,<max_lon>,<min_lat>
            viewbox_str = f"{WEST_LON},{NORTH_LAT},{EAST_LON},{SOUTH_LAT}"

            url = f"{self.base_url}/search"
            headers = {
                "User-Agent": self.user_agent,
                "Accept": "application/json",
            }
            params = {
                "q": query,
                "format": "jsonv2",
                "addressdetails": "1",
                "limit": "5",
                "viewbox": viewbox_str,
                "bounded": "0",  # Allow search with viewbox priority
            }

            try:
                response = requests.get(url, params=params, headers=headers, timeout=self.timeout)
                response.raise_for_status()
                data = response.json()
            except requests.exceptions.Timeout as e:
                raise TimeoutError(f"Geocoding service timed out after {self.timeout}s: {str(e)}") from e
            except requests.exceptions.RequestException as e:
                raise ConnectionError(f"Geocoding service request failed: {str(e)}") from e
            except ValueError as e:
                raise ValueError(f"Invalid JSON received from geocoding service: {str(e)}") from e

            if not isinstance(data, list) or len(data) == 0:
                raise ValueError(f"No geographic results found for location '{query}'.")

            # Select the best candidate inside the supported regional boundary
            in_region_candidate = None
            first_out_candidate = None

            for item in data:
                try:
                    lat = float(item.get("lat"))
                    lon = float(item.get("lon"))
                except (ValueError, TypeError):
                    continue

                if is_within_region(lat, lon):
                    in_region_candidate = (item, lat, lon)
                    break
                elif first_out_candidate is None:
                    first_out_candidate = (item, lat, lon)

            if in_region_candidate is None:
                if first_out_candidate is not None:
                    _, out_lat, out_lon = first_out_candidate
                    raise ValueError(
                        f"Location '{query}' was resolved to ({out_lat:.4f}, {out_lon:.4f}), "
                        f"which is outside the supported Chandigarh Tricity region."
                    )
                raise ValueError(f"No valid coordinate results found for location '{query}'.")

            chosen_item, resolved_lat, resolved_lon = in_region_candidate

            result = GeocodeResult(
                query=query,
                display_name=chosen_item.get("display_name", query),
                latitude=round(resolved_lat, 6),
                longitude=round(resolved_lon, 6),
                is_inside_region=True,
                address=chosen_item.get("address"),
                place_id=chosen_item.get("place_id"),
                osm_type=chosen_item.get("osm_type"),
                osm_id=chosen_item.get("osm_id"),
                bounding_box=[float(x) for x in chosen_item.get("boundingbox", [])] if chosen_item.get("boundingbox") else None,
            )

            # Thread-safe LRU cache insertion
            self._cache[normalized_key] = result
            if len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)

            return result


# Module singleton
_DEFAULT_GEOCODER: Optional[BaseGeocoder] = None


def get_geocoder() -> BaseGeocoder:
    """Retrieve or initialize the active geocoder instance."""
    global _DEFAULT_GEOCODER
    if _DEFAULT_GEOCODER is None:
        if GEOCODING_PROVIDER.lower() == "nominatim":
            _DEFAULT_GEOCODER = NominatimGeocoder()
        else:
            # Fallback to Nominatim if unrecognized
            _DEFAULT_GEOCODER = NominatimGeocoder()
    return _DEFAULT_GEOCODER


def geocode_location(query: str, geocoder: Optional[BaseGeocoder] = None) -> GeocodeResult:
    """Convenience helper to geocode a query using the active provider."""
    active = geocoder or get_geocoder()
    return active.geocode(query)

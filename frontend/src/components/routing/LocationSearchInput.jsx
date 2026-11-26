import { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  MapPin,
  X,
  Loader2,
  Crosshair,
  AlertCircle,
  CheckCircle2,
  Compass,
} from "lucide-react";
import { geocodeLocation } from "../../services/api";
import {
  TRICITY_LANDMARKS,
  formatCoordinate,
  isWithinTricityRegion,
} from "./mapConstants";

/**
 * LocationSearchInput Component
 * =============================
 * Phase 10.2: Debounced geocoding search input with autocomplete suggestions,
 * stale request cancellation, region boundary verification, and map-pick trigger.
 */
export default function LocationSearchInput({
  label,
  badgeLetter = "A",
  badgeColor = "emerald", // 'emerald' | 'rose' | 'blue'
  query = "",
  selectedLocation = null,
  onChangeQuery,
  onSelectLocation,
  onClearLocation,
  onPickOnMap,
  isMapPicking = false,
  placeholder = "Search street, sector, or landmark...",
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [backendResult, setBackendResult] = useState(null);
  const [hasEmptyResult, setHasEmptyResult] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Filter regional landmarks matching the user's current query for instant local suggestions
  const matchingLandmarks = useMemo(() => {
    if (!query || query.trim().length < 2) {
      return TRICITY_LANDMARKS.slice(0, 4); // Show top landmarks as quick suggestions on focus
    }
    const q = query.trim().toLowerCase();
    return TRICITY_LANDMARKS.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.subtitle.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q)
    );
  }, [query]);

  // Combined flat list of suggestions for keyboard navigation
  const allSuggestions = useMemo(() => {
    const list = [];
    if (backendResult) {
      list.push({ type: "backend", item: backendResult });
    }
    matchingLandmarks.forEach((landmark) => {
      list.push({ type: "landmark", item: landmark });
    });
    return list;
  }, [backendResult, matchingLandmarks]);

  // Debounced geocoding search against backend POST /routing/geocode
  useEffect(() => {
    // If the input matches the currently selected location's name, don't trigger search
    const isMatchesSelected =
      selectedLocation &&
      query.trim().toLowerCase() === selectedLocation.displayName?.trim().toLowerCase();

    const trimmed = query.trim();

    // Do nothing if query matches selected location or is too short
    if (isMatchesSelected || trimmed.length < 2) {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      return;
    }

    // Cancel any pending timer and prior in-flight fetch
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Debounce backend API request by 400ms to respect rate limits and reduce server load
    searchTimeoutRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsSearching(true);
      setErrorMessage(null);
      setHasEmptyResult(false);

      try {
        const res = await geocodeLocation(trimmed, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (res && typeof res.latitude === "number" && typeof res.longitude === "number") {
          // Double check regional boundary in frontend
          if (isWithinTricityRegion(res.latitude, res.longitude)) {
            setBackendResult(res);
            setHasEmptyResult(false);
          } else {
            setBackendResult(null);
            setErrorMessage(
              `Resolved to (${formatCoordinate(res.latitude, res.longitude)}), which is outside the Chandigarh Tricity region.`
            );
          }
        } else {
          setBackendResult(null);
          setHasEmptyResult(true);
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        setBackendResult(null);
        const errMsg = err?.message || "";
        if (errMsg.toLowerCase().includes("outside")) {
          setErrorMessage("Location is outside the supported Chandigarh Tricity region.");
        } else if (errMsg.toLowerCase().includes("no geographic results") || errMsg.toLowerCase().includes("not found")) {
          setHasEmptyResult(true);
        } else {
          setErrorMessage("Could not resolve location. Please verify spelling or pick on map.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [query, selectedLocation]);

  // Handle clicking outside to close dropdown
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Selection handlers
  const handleSelectBackendResult = (result) => {
    const item = {
      displayName: result.display_name || result.query,
      coordinates: [result.latitude, result.longitude],
      address: result.address || null,
      osmId: result.osm_id || null,
      sourceType: "geocoded",
    };
    onChangeQuery(item.displayName);
    onSelectLocation(item);
    setIsOpen(false);
  };

  const handleSelectLandmark = (landmark) => {
    const item = {
      displayName: `${landmark.name} (${landmark.subtitle})`,
      coordinates: landmark.coordinates,
      address: null,
      sourceType: "landmark",
    };
    onChangeQuery(item.displayName);
    onSelectLocation(item);
    setIsOpen(false);
  };

  const handleClear = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setBackendResult(null);
    setErrorMessage(null);
    setHasEmptyResult(false);
    setIsSearching(false);
    onChangeQuery("");
    onClearLocation();
  };

  // Badge styles
  const badgeClasses =
    badgeColor === "emerald"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
      : badgeColor === "rose"
      ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
      : "border-blue-500/40 bg-blue-500/10 text-blue-400";

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      {/* Label and Pick-on-Map trigger */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-slate-700">
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold ${badgeClasses}`}
          >
            {badgeLetter}
          </span>
          <span>{label}</span>
          {selectedLocation && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600">
              <CheckCircle2 size={11} />
              <span>Selected</span>
            </span>
          )}
        </div>

        {/* Map-Click Shortcut Button */}
        <button
          type="button"
          onClick={onPickOnMap}
          aria-label={`Pick ${label} on map`}
          aria-pressed={isMapPicking}
          className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:outline-none ${
            isMapPicking
              ? "border border-purple-500/60 bg-purple-500/20 text-purple-300 shadow-sm shadow-purple-500/30 animate-pulse"
              : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800"
          }`}
          title="Click to select this point directly on the map canvas"
        >
          <Crosshair size={11} className={isMapPicking ? "text-purple-400" : ""} />
          <span>{isMapPicking ? "Picking on Map..." : "Pick on Map"}</span>
        </button>
      </div>

      {/* Input Field Container */}
      <div className="relative flex items-center">
        <div className="pointer-events-none absolute left-3 flex items-center text-slate-500">
          <Search size={15} />
        </div>

        <input
          type="text"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={label}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            highlightedIndex >= 0 ? `${badgeLetter}-option-${highlightedIndex}` : undefined
          }
          onFocus={() => {
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setIsOpen(false);
              setHighlightedIndex(-1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!isOpen) {
                setIsOpen(true);
              }
              if (allSuggestions.length > 0) {
                setHighlightedIndex((prev) => (prev + 1) % allSuggestions.length);
              }
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (!isOpen) {
                setIsOpen(true);
              }
              if (allSuggestions.length > 0) {
                setHighlightedIndex((prev) =>
                  prev <= 0 ? allSuggestions.length - 1 : prev - 1
                );
              }
            } else if (e.key === "Enter") {
              if (isOpen && highlightedIndex >= 0 && highlightedIndex < allSuggestions.length) {
                e.preventDefault();
                const sel = allSuggestions[highlightedIndex];
                if (sel.type === "backend") {
                  handleSelectBackendResult(sel.item);
                } else {
                  handleSelectLandmark(sel.item);
                }
                setHighlightedIndex(-1);
              }
            }
          }}
          onChange={(e) => {
            onChangeQuery(e.target.value);
            setBackendResult(null);
            setErrorMessage(null);
            setHasEmptyResult(false);
            setHighlightedIndex(-1);
            setIsOpen(true);
          }}
          className={`w-full rounded-xl border bg-slate-50 py-2.5 pr-16 pl-9 text-xs text-slate-900 placeholder-slate-400 transition focus:outline-none focus:ring-1 ${
            selectedLocation
              ? badgeColor === "emerald"
                ? "border-emerald-500/40 focus:border-emerald-500 focus:ring-emerald-500/30"
                : "border-rose-500/40 focus:border-rose-500 focus:ring-rose-500/30"
              : "border-slate-200 focus:border-blue-500 focus:ring-blue-500/30"
          }`}
        />

        {/* Right Action Icons: Spinner & Clear */}
        <div className="absolute right-2.5 flex items-center gap-1">
          {isSearching && (
            <Loader2 size={14} className="animate-spin text-blue-400" />
          )}

          {query && (
            <button
              type="button"
              onClick={handleClear}
              aria-label={`Clear ${label} input`}
              className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
              title="Clear input"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Coordinate & Subtitle Chip if location selected */}
      {selectedLocation?.coordinates && (
        <div className="flex items-center justify-between px-1 text-[10px] text-slate-600">
          <span className="font-mono text-slate-500">
            {formatCoordinate(
              selectedLocation.coordinates[0],
              selectedLocation.coordinates[1]
            )}
          </span>
          <span className="text-[10px] text-emerald-600/90 font-medium">
            Within Tricity bounds
          </span>
        </div>
      )}

      {/* Autocomplete Suggestions Dropdown Popover */}
      {isOpen && (
        <div
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute top-full left-0 z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur-md"
        >
          {/* Searching Loader State */}
          {isSearching && (
            <div className="flex items-center gap-2 p-2.5 text-xs text-slate-600">
              <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />
              <span>Searching Chandigarh Tricity road network...</span>
            </div>
          )}

          {/* High-Confidence Backend Geocoded Result */}
          {backendResult && (
            <div className="mb-1 border-b border-slate-200 pb-1">
              <p className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-600 uppercase">
                Geocoded Location
              </p>
              <button
                type="button"
                id={`${badgeLetter}-option-0`}
                role="option"
                aria-selected={highlightedIndex === 0}
                onMouseEnter={() => setHighlightedIndex(0)}
                onClick={() => {
                  handleSelectBackendResult(backendResult);
                  setHighlightedIndex(-1);
                }}
                className={`flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                  highlightedIndex === 0
                    ? "bg-blue-600/30 text-white ring-1 ring-blue-500/50"
                    : "hover:bg-blue-500/10 hover:text-slate-900"
                }`}
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
                  <MapPin size={12} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-800">
                    {backendResult.display_name}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                    {formatCoordinate(backendResult.latitude, backendResult.longitude)}
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* Regional Landmarks / Preset Suggestions */}
          {matchingLandmarks.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-600 uppercase">
                {query.trim().length >= 2 ? "Matching Regional Hubs" : "Quick Tricity Hubs"}
              </p>
              <div className="space-y-0.5">
                {matchingLandmarks.map((landmark, idx) => {
                  const globalIdx = backendResult ? idx + 1 : idx;
                  const isHighlighted = highlightedIndex === globalIdx;
                  return (
                    <button
                      key={landmark.id}
                      id={`${badgeLetter}-option-${globalIdx}`}
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseEnter={() => setHighlightedIndex(globalIdx)}
                      onClick={() => {
                        handleSelectLandmark(landmark);
                        setHighlightedIndex(-1);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg p-2 text-left transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                        isHighlighted
                          ? "bg-blue-600/30 text-white ring-1 ring-blue-500/50"
                          : "hover:bg-slate-100/70"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-purple-400">
                          <Compass size={11} />
                        </span>
                        <div>
                          <p className="text-xs font-medium text-slate-800">
                            {landmark.name}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {landmark.subtitle}
                          </p>
                        </div>
                      </div>
                      <span className="font-mono text-[10px] text-slate-500">
                        {formatCoordinate(
                          landmark.coordinates[0],
                          landmark.coordinates[1],
                          2
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty Result Feedback */}
          {hasEmptyResult && !isSearching && !backendResult && (
            <div className="p-3 text-center text-xs text-slate-600">
              <p className="font-medium text-slate-700">No locations found</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                No matching places in Chandigarh Tricity. Try another landmark or pick directly on the map.
              </p>
            </div>
          )}

          {/* Error State Feedback */}
          {errorMessage && !isSearching && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-600">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="font-medium">{errorMessage}</p>
                <button
                  type="button"
                  onClick={onPickOnMap}
                  className="mt-1 font-semibold text-purple-300 underline hover:text-purple-200"
                >
                  Pick on map instead
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

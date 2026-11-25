import { useState } from "react";
import {
  Plus,
  Minus,
  Maximize2,
  Crosshair,
  Layers,
  MapPin,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import { TILE_PROVIDERS, TRICITY_LANDMARKS } from "./mapConstants";

/**
 * Floating Map Controls Bar
 * =========================
 * Provides interactive zoom, view reset, regional landmark navigation,
 * and tile provider switching overlaying the interactive map canvas.
 */
export default function MapControls({
  onZoomIn,
  onZoomOut,
  onResetView,
  onRecenter,
  onSelectLandmark,
  activeTileId,
  onSelectTileProvider,
  isBoundaryVisible = true,
  onToggleBoundary,
}) {
  const [isLayerMenuOpen, setIsLayerMenuOpen] = useState(false);
  const [isLandmarkMenuOpen, setIsLandmarkMenuOpen] = useState(false);

  return (
    <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-auto">
      {/* Primary Zoom & Navigation Controls */}
      <div className="flex flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/90 shadow-xl backdrop-blur-md">
        <button
          type="button"
          onClick={onZoomIn}
          className="flex h-10 w-10 items-center justify-center text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none"
          title="Zoom In"
          aria-label="Zoom in"
        >
          <Plus size={18} />
        </button>

        <div className="h-px bg-slate-800" />

        <button
          type="button"
          onClick={onZoomOut}
          className="flex h-10 w-10 items-center justify-center text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none"
          title="Zoom Out"
          aria-label="Zoom out"
        >
          <Minus size={18} />
        </button>

        <div className="h-px bg-slate-800" />

        <button
          type="button"
          onClick={onResetView}
          className="flex h-10 w-10 items-center justify-center text-slate-300 transition hover:bg-slate-800 hover:text-emerald-400 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none"
          title="Reset View to Tricity Region"
          aria-label="Reset view to Tricity region"
        >
          <Maximize2 size={16} />
        </button>

        <div className="h-px bg-slate-800" />

        <button
          type="button"
          onClick={onRecenter}
          className="flex h-10 w-10 items-center justify-center text-slate-300 transition hover:bg-slate-800 hover:text-blue-400 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none"
          title="Center on Chandigarh"
          aria-label="Center on Chandigarh"
        >
          <Crosshair size={16} />
        </button>
      </div>

      {/* Layer / Tile Provider Switcher */}
      <div className="relative">
        <button
          type="button"
          aria-expanded={isLayerMenuOpen}
          aria-haspopup="true"
          onClick={() => {
            setIsLayerMenuOpen(!isLayerMenuOpen);
            setIsLandmarkMenuOpen(false);
          }}
          className={`flex h-10 w-10 items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none ${
            isLayerMenuOpen
              ? "border-emerald-500 bg-slate-900 text-emerald-400"
              : "border-slate-700/80 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
          title="Change Map Tile Style"
          aria-label="Change map tile style"
        >
          <Layers size={17} />
        </button>

        {isLayerMenuOpen && (
          <div className="absolute right-12 top-0 w-64 rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                Map Tiles
              </span>
              {onToggleBoundary && (
                <button
                  type="button"
                  onClick={onToggleBoundary}
                  className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-emerald-400"
                  title="Toggle Tricity Bounding Box"
                >
                  {isBoundaryVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                  <span>Bounds</span>
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              {TILE_PROVIDERS.map((provider) => {
                const isSelected = provider.id === activeTileId;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => {
                      onSelectTileProvider(provider.id);
                      setIsLayerMenuOpen(false);
                    }}
                    className={`flex w-full items-start justify-between rounded-lg p-2 text-left transition ${
                      isSelected
                        ? "border border-emerald-500/40 bg-emerald-500/10 text-white"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <div>
                      <p className="text-xs font-medium">{provider.name}</p>
                      <p className="text-[10px] text-slate-500">
                        {provider.description}
                      </p>
                    </div>
                    {isSelected && (
                      <Check size={14} className="text-emerald-400 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Target Area Quick-Jump */}
      <div className="relative">
        <button
          type="button"
          aria-expanded={isLandmarkMenuOpen}
          aria-haspopup="true"
          onClick={() => {
            setIsLandmarkMenuOpen(!isLandmarkMenuOpen);
            setIsLayerMenuOpen(false);
          }}
          className={`flex h-10 w-10 items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none ${
            isLandmarkMenuOpen
              ? "border-blue-500 bg-slate-900 text-blue-400"
              : "border-slate-700/80 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
          title="Quick Jump to Urban Center"
          aria-label="Quick jump to urban center"
        >
          <MapPin size={17} />
        </button>

        {isLandmarkMenuOpen && (
          <div className="absolute right-12 top-0 w-64 rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md">
            <div className="mb-2 border-b border-slate-800 pb-2">
              <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                Tricity Urban Centers
              </span>
            </div>

            <div className="max-h-60 space-y-1 overflow-y-auto pr-1">
              {TRICITY_LANDMARKS.map((landmark) => (
                <button
                  key={landmark.id}
                  type="button"
                  onClick={() => {
                    onSelectLandmark(landmark);
                    setIsLandmarkMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
                >
                  <div>
                    <p className="font-medium">{landmark.name}</p>
                    <p className="text-[10px] text-slate-500">
                      {landmark.subtitle}
                    </p>
                  </div>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-mono text-slate-400">
                    z{landmark.zoom}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * SignalHead Component
 * --------------------
 * Represents a realistic standard 3-lens traffic signal head (Red, Yellow, Green).
 * Exactly one lens is illuminated depending on the state ("red", "yellow", "green").
 * Complies with sequential split-phase modeling (no concurrent conflicting greens).
 */
export default function SignalHead({
  state = "red", // "red" | "yellow" | "green"
  orientation = "vertical", // "vertical" | "horizontal"
  size = "md", // "sm" | "md" | "lg"
  label = "",
}) {
  const sizeConfig = {
    sm: {
      casing: "p-1 gap-1 rounded-md",
      lens: "w-3 h-3",
      glow: "shadow-[0_0_8px]",
    },
    md: {
      casing: "p-1.5 gap-1.5 rounded-lg",
      lens: "w-4 h-4",
      glow: "shadow-[0_0_12px]",
    },
    lg: {
      casing: "p-2 gap-2 rounded-xl",
      lens: "w-5 h-5",
      glow: "shadow-[0_0_16px]",
    },
  }[size] || {
    casing: "p-1.5 gap-1.5 rounded-lg",
    lens: "w-4 h-4",
    glow: "shadow-[0_0_12px]",
  };

  const isRed = state === "red";
  const isYellow = state === "yellow";
  const isGreen = state === "green";

  const containerClasses = [
    "inline-flex items-center justify-center bg-slate-50 border border-slate-200 shadow-xl select-none",
    orientation === "horizontal" ? "flex-row" : "flex-col",
    sizeConfig.casing,
  ].join(" ");

  return (
    <div
      className={containerClasses}
      role="status"
      aria-label={`${label ? `${label} ` : ""}Traffic Signal: ${state.toUpperCase()}`}
    >
      {/* Red Lens */}
      <div
        className={`rounded-full transition-all duration-300 ${sizeConfig.lens} ${
          isRed
            ? `bg-red-500 ${sizeConfig.glow} shadow-red-500/80 border border-red-300 ring-2 ring-red-500/30`
            : "bg-red-950/40 border border-red-900/30 opacity-40"
        }`}
        title="Red Light - Stop"
      />

      {/* Yellow Lens */}
      <div
        className={`rounded-full transition-all duration-300 ${sizeConfig.lens} ${
          isYellow
            ? `bg-amber-400 ${sizeConfig.glow} shadow-amber-400/80 border border-amber-200 ring-2 ring-amber-400/30`
            : "bg-amber-950/40 border border-amber-900/30 opacity-40"
        }`}
        title="Yellow Light - Clearance Transition"
      />

      {/* Green Lens */}
      <div
        className={`rounded-full transition-all duration-300 ${sizeConfig.lens} ${
          isGreen
            ? `bg-emerald-400 ${sizeConfig.glow} shadow-emerald-400/90 border border-emerald-200 ring-2 ring-emerald-400/30 animate-pulse`
            : "bg-emerald-950/40 border border-emerald-900/30 opacity-40"
        }`}
        title="Green Light - Right of Way"
      />
    </div>
  );
}

import { useEffect, useId, useRef } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

/**
 * Accessible confirmation modal replacing browser window.confirm() dialogs.
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  isProcessing = false,
  onConfirm,
  onCancel,
}) {
  const titleId = useId();
  const descId = useId();
  const cancelButtonRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    cancelButtonRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !isProcessing) {
        onCancel?.();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isProcessing, onCancel]);

  if (!isOpen) return null;

  const confirmClasses =
    tone === "danger"
      ? "bg-red-500 text-white hover:bg-red-400 focus-visible:ring-red-400"
      : "bg-emerald-600 text-white hover:bg-emerald-400 focus-visible:ring-emerald-400";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-white p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (!isProcessing) onCancel?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-600">
              <AlertTriangle size={20} />
            </div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              {title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            aria-label="Close confirmation dialog"
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <p id={descId} className="mt-3 text-sm leading-relaxed text-slate-700">
          {message}
        </p>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isProcessing}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 ${confirmClasses}`}
          >
            {isProcessing && <Loader2 size={14} className="animate-spin" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

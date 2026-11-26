import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Mail,
  CheckCircle2,
  AlertCircle,
  Info,
  Send,
  ArrowRight,
} from "lucide-react";

const INITIAL_FORM = {
  name: "",
  email: "",
  subject: "",
  message: "",
};

export default function Contact() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [error, setError] = useState(null);
  const [previewSubmitted, setPreviewSubmitted] = useState(false);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setError(null);
    setPreviewSubmitted(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError(null);

    const name = form.name.trim();
    const email = form.email.trim();
    const subject = form.subject.trim();
    const message = form.message.trim();

    if (name.length < 2) {
      setError("Please enter your name (at least 2 characters).");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (subject.length < 3) {
      setError("Please enter a subject (at least 3 characters).");
      return;
    }
    if (message.length < 10) {
      setError("Please enter a message of at least 10 characters.");
      return;
    }

    setPreviewSubmitted(true);
    setForm(INITIAL_FORM);
  };

  return (
    <div className="bg-slate-50 text-slate-900 py-14 md:py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 space-y-10">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
            Contact &amp; Inquiries
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
            Get in Touch with the ITMS Project
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">
            Have questions about Chandigarh Tricity route coverage, signal delay
            assumptions, or the ML model methodology?
          </p>
        </div>

        {/* Honest Demo Notice */}
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
          <Info size={18} className="shrink-0 mt-0.5 text-amber-600" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-100">
              Demonstration Mode Notice
            </p>
            <p className="leading-relaxed text-amber-200/90">
              This form validates your inquiry locally in the browser as a
              frontend demonstration. No backend email-delivery or ticket-storage
              endpoint is configured in this release, so messages are not
              transmitted externally.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-xl"
        >
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200"
            >
              <AlertCircle size={16} className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {previewSubmitted && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs text-emerald-200"
            >
              <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-600" />
              <div>
                <p className="font-semibold text-emerald-100">
                  Inquiry Validated (Frontend Demo Preview)
                </p>
                <p className="mt-0.5 text-emerald-200/90">
                  Your form passed client-side validation. Because no email
                  relay backend is attached, no message was sent over the
                  network.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="contact-name"
                className="block text-xs font-semibold text-slate-700"
              >
                Full Name
              </label>
              <input
                id="contact-name"
                type="text"
                value={form.name}
                onChange={handleChange("name")}
                placeholder="Your name"
                className="w-full rounded-xl border border-slate-200 bg-white/95 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="contact-email"
                className="block text-xs font-semibold text-slate-700"
              >
                Email Address
              </label>
              <input
                id="contact-email"
                type="email"
                value={form.email}
                onChange={handleChange("email")}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-200 bg-white/95 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="contact-subject"
              className="block text-xs font-semibold text-slate-700"
            >
              Subject
            </label>
            <input
              id="contact-subject"
              type="text"
              value={form.subject}
              onChange={handleChange("subject")}
              placeholder="e.g., Question about Tricity route scoring"
              className="w-full rounded-xl border border-slate-200 bg-white/95 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="contact-message"
              className="block text-xs font-semibold text-slate-700"
            >
              Message
            </label>
            <textarea
              id="contact-message"
              rows={5}
              value={form.message}
              onChange={handleChange("message")}
              placeholder="Write your question or feedback..."
              className="w-full rounded-xl border border-slate-200 bg-white/95 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Mail size={14} className="text-slate-500" />
              <span>Client-side validation preview only</span>
            </div>

            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition"
            >
              <Send size={15} />
              <span>Validate &amp; Preview Inquiry</span>
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600">
          <span>Looking to plan a route right now?</span>
          <Link
            to="/route-planner"
            className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 hover:text-emerald-700"
          >
            <span>Open Route Planner</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

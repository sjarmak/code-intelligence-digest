"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

interface MeResponse {
  userId: string;
  email?: string;
  isSourcegraphCom: boolean;
  llmConfig: string;
  digestCount: number;
  savedCount: number;
}

export function AccountBadge() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setMe(data);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [open]);

  if (loading || !me) {
    return (
      <Link
        href="/api/auth/logout"
        className="hidden md:flex items-center gap-2 px-2 py-1.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100"
        title="Sign out"
      >
        Sign out
      </Link>
    );
  }

  const label = me.email ?? "Legacy";
  const shortLabel =
    me.email && me.email.length > 20 ? `${me.email.slice(0, 18)}…` : label;

  return (
    <div className="hidden md:block relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 border border-transparent hover:border-gray-300"
        title="Account and config (multi-account testing)"
        aria-expanded={open}
      >
        <span className="max-w-[140px] truncate" title={me.email ?? "Legacy"}>
          {shortLabel}
        </span>
        <svg
          className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-gray-200 bg-white py-3 px-4 shadow-lg z-50 text-left"
          role="dialog"
          aria-label="Account details"
        >
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">
            Multi-account config
          </div>
          <dl className="space-y-1.5 text-sm">
            <div>
              <dt className="text-gray-500">User ID</dt>
              <dd className="font-mono truncate" title={me.userId}>
                {me.userId}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Email</dt>
              <dd className="truncate" title={me.email ?? "—"}>
                {me.email ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">LLM</dt>
              <dd>{me.llmConfig}</dd>
            </div>
            <div className="flex gap-4">
              <div>
                <dt className="text-gray-500">Digest items</dt>
                <dd className="font-medium">{me.digestCount}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Saved items</dt>
                <dd className="font-medium">{me.savedCount}</dd>
              </div>
            </div>
          </dl>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <Link
              href="/api/auth/logout"
              className="text-sm font-medium text-gray-600 hover:text-black"
            >
              Sign out
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

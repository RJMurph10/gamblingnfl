/** Scope picker for college pages: all FBS games, Top 25 games, or one conference. */

import type { CfbConference } from "@/lib/cfb";
import type { CfbScope } from "@/lib/use-cfb";

export function CfbScopePicker({
  scope,
  onChange,
  conferences,
}: {
  scope: CfbScope;
  onChange: (scope: CfbScope) => void;
  conferences: CfbConference[];
}) {
  const chip = (value: CfbScope, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={scope === value}
      className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
        scope === value
          ? "bg-acc/10 text-acc ring-acc/25"
          : "bg-panel2 text-mute ring-line/10 hover:text-acc"
      }`}
    >
      {label}
    </button>
  );
  const isConference = scope !== "all" && scope !== "top25";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chip("all", "All FBS")}
      {chip("top25", "Top 25")}
      <select
        value={isConference ? scope : ""}
        onChange={(e) => onChange(e.target.value || "all")}
        aria-label="Conference"
        className={`rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
          isConference ? "text-acc ring-acc/25" : "text-mute ring-line/10"
        }`}
      >
        <option value="">Conference…</option>
        {conferences.map((c) => (
          <option key={c.id} value={c.abbr || c.name}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

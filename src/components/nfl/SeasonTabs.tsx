/** Season switcher for the NFL prop trackers (newest first). */
import { propSeasons } from "@/lib/nfl/prop-seasons";

export function SeasonTabs({
  season,
  onChange,
}: {
  season: number;
  onChange: (s: number) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-line/10 p-0.5 font-mono text-[10px]"
      role="group"
      aria-label="Season"
    >
      {propSeasons().map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={`rounded-md px-2 py-0.5 ${s === season ? "bg-acc/15 text-acc" : "text-mute hover:text-foreground"}`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

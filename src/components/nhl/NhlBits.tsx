/** Small shared pieces for the NHL page: team logo and the empty / message panel. */
import { useState, type ReactNode } from "react";
import { Panel } from "@/components/booth";
import { nhlLogoFor, type NhlTeamRef } from "@/lib/nhl";

export function NhlLogo({
  team,
  className = "size-6",
}: {
  team: Pick<NhlTeamRef, "abbr" | "logo" | "name">;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span className={`inline-grid shrink-0 place-items-center font-mono text-[10px] uppercase text-mute ${className}`}>
        {team.abbr}
      </span>
    );
  return (
    <img
      src={team.logo || nhlLogoFor(team.abbr)}
      alt={`${team.name} logo`}
      loading="lazy"
      className={`inline-block shrink-0 object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

export function NhlEmpty({ children }: { children: ReactNode }) {
  return (
    <Panel>
      <p className="py-8 text-center font-mono text-xs text-mute">{children}</p>
    </Panel>
  );
}

/** A small pill button used for filters. */
export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${active ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
    >
      {children}
    </button>
  );
}

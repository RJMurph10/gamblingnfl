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

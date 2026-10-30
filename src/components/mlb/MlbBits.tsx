/** Small shared pieces for the MLB pages: team logo and the empty / message panel. */
import { useState, type ReactNode } from "react";
import { Panel } from "@/components/shared/booth";
import { mlbLogoFor, type MlbTeamRef } from "@/lib/mlb/mlb";

export function MlbLogo({
  team,
  className = "size-6",
}: {
  team: Pick<MlbTeamRef, "abbr" | "logo" | "name">;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span
        className={`inline-grid shrink-0 place-items-center font-mono text-[10px] uppercase text-mute ${className}`}
      >
        {team.abbr}
      </span>
    );
  return (
    <img
      src={team.logo || mlbLogoFor(team.abbr)}
      alt={`${team.name} logo`}
      loading="lazy"
      className={`inline-block shrink-0 object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

export function MlbEmpty({ children }: { children: ReactNode }) {
  return (
    <Panel>
      <p className="py-8 text-center font-mono text-xs text-mute">{children}</p>
    </Panel>
  );
}

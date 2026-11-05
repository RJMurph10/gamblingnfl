/** Small shared pieces for the WNBA pages: team logo, team link, the empty panel. */
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Panel } from "@/components/shared/booth";
import { wnbaLogoFor, type WnbaSide, type WnbaTeamRef } from "@/lib/wnba/wnba";

export function WnbaLogo({
  team,
  className = "size-6",
}: {
  team: Pick<WnbaTeamRef, "id" | "abbr" | "logo" | "name">;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed || !(team.logo || team.id))
    return (
      <span className={`inline-grid shrink-0 place-items-center font-mono text-[9px] uppercase text-mute ${className}`}>
        {team.abbr}
      </span>
    );
  return (
    <img
      src={team.logo || wnbaLogoFor(team.id)}
      alt={`${team.name} logo`}
      loading="lazy"
      className={`inline-block shrink-0 object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

/** A team's name (city or full). */
export function WnbaTeamName({ side, short = false }: { side: Pick<WnbaSide, "team">; short?: boolean }) {
  return (
    <span className="truncate">
      {short ? side.team.abbr : side.team.short}
    </span>
  );
}

export function WnbaTeamLink({ team, className = "" }: { team: WnbaTeamRef; className?: string }) {
  return (
    <Link
      to="/wnba/teams/$teamId"
      params={{ teamId: team.id }}
      className={`inline-flex min-w-0 items-center gap-2 hover:text-acc ${className}`}
      title={team.name}
    >
      <WnbaLogo team={team} className="size-5" />
      <span className="truncate">{team.short}</span>
    </Link>
  );
}

export function WnbaEmpty({ children }: { children: ReactNode }) {
  return (
    <Panel>
      <p className="py-8 text-center font-mono text-xs text-mute">{children}</p>
    </Panel>
  );
}

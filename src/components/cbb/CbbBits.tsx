/** Small shared pieces for the college basketball pages: team logo, team link, the empty panel. */
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Panel } from "@/components/shared/booth";
import { cbbLogoFor, type CbbSide, type CbbTeamRef } from "@/lib/cbb/cbb";

export function CbbLogo({
  team,
  className = "size-6",
}: {
  team: Pick<CbbTeamRef, "id" | "abbr" | "logo" | "name">;
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
      src={team.logo || cbbLogoFor(team.id)}
      alt={`${team.name} logo`}
      loading="lazy"
      className={`inline-block shrink-0 object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

/** "12 Duke" style name with the AP rank in small type. */
export function CbbTeamName({ side, short = false }: { side: Pick<CbbSide, "team" | "rank">; short?: boolean }) {
  return (
    <span className="truncate">
      {side.rank ? <span className="mr-1 font-mono text-[10px] text-faint">{side.rank}</span> : null}
      {short ? side.team.abbr : side.team.short}
    </span>
  );
}

export function CbbTeamLink({ team, className = "" }: { team: CbbTeamRef; className?: string }) {
  return (
    <Link
      to="/cbb/teams/$teamId"
      params={{ teamId: team.id }}
      className={`inline-flex min-w-0 items-center gap-2 hover:text-acc ${className}`}
      title={team.name}
    >
      <CbbLogo team={team} className="size-5" />
      <span className="truncate">{team.short}</span>
    </Link>
  );
}

export function CbbEmpty({ children }: { children: ReactNode }) {
  return (
    <Panel>
      <p className="py-8 text-center font-mono text-xs text-mute">{children}</p>
    </Panel>
  );
}

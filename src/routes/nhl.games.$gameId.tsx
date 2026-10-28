import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { NhlEmpty, NhlLogo } from "@/components/nhl/NhlBits";
import { NhlGameBoard } from "@/components/nhl/NhlGameBoard";
import type { NhlGame } from "@/lib/nhl/nhl";
import { useNhlSchedule } from "@/lib/nhl/use-nhl";

export const Route = createFileRoute("/nhl/games/$gameId")({
  head: () => ({ meta: [{ title: "Game — GamblingNHL" }] }),
  component: NhlGamePage,
});

/** Column label for period index i: 1, 2, 3, then OT and SO (regular season) or 2OT, 3OT… (playoffs). */
function periodHeader(game: NhlGame, i: number): string {
  if (i < 3) return String(i + 1);
  if (game.part === "post") return i === 3 ? "OT" : `${i - 2}OT`;
  return i === 3 ? "OT" : "SO";
}

function LineScore({ game }: { game: NhlGame }) {
  const n = Math.max(game.away.periods?.length ?? 0, game.home.periods?.length ?? 0);
  if (!n) return null;
  const cols = Array.from({ length: Math.max(n, 3) }, (_, i) => i);
  return (
    <Panel padded={false}>
      <PanelHeader title="Line score" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[360px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-normal">Team</th>
              {cols.map((i) => (
                <th key={i} className="px-2 py-2 text-right font-normal">
                  {periodHeader(game, i)}
                </th>
              ))}
              <th className="px-4 py-2 text-right font-normal">T</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {([game.away, game.home] as const).map((side) => (
              <tr key={side.team.id}>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2">
                    <NhlLogo team={side.team} className="size-5" />
                    <span className="font-medium">{side.team.abbr}</span>
                  </span>
                </td>
                {cols.map((i) => (
                  <td key={i} className="px-2 py-2 text-right font-mono tabular-nums text-mute">
                    {side.periods?.[i] ?? "—"}
                  </td>
                ))}
                <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">{side.score ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function NhlGamePage() {
  const { gameId } = Route.useParams();
  const { games, isLoading } = useNhlSchedule(30_000);
  const game = games.find((g) => g.id === gameId);

  if (!game) {
    return (
      <>
        <PageTitle eyebrow="NHL game" title="Game" />
        <NhlEmpty>
          {isLoading ? "Loading game…" : "That game wasn't found in the current schedule."}{" "}
          <Link to="/nhl/games" className="text-acc">
            All games →
          </Link>
        </NhlEmpty>
      </>
    );
  }

  return (
    <>
      <PageTitle eyebrow="NHL game" title={`${game.away.team.abbr} @ ${game.home.team.abbr}`} />
      <div className="space-y-6">
        <NhlGameBoard game={game} games={games} />
        <LineScore game={game} />
        <p className="font-mono text-[11px]">
          <Link to="/nhl/games" className="text-acc">
            ← All games
          </Link>
        </p>
      </div>
    </>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/shared/booth";
import { CbbEmpty } from "@/components/cbb/CbbBits";
import { CbbGamesTable } from "@/components/cbb/CbbGamesTable";
import { etDayKey, etDayLabel, hasScore, type CbbGame } from "@/lib/cbb/cbb";
import { useCbbModel, useCbbSchedule } from "@/lib/cbb/use-cbb";

export const Route = createFileRoute("/cbb/games/")({
  head: () => ({
    meta: [
      { title: "Games — GamblingCBB" },
      {
        name: "description",
        content:
          "Every Division I men's college basketball game this season: upcoming and live games, and final scores with the closing lines.",
      },
    ],
  }),
  component: CbbGamesPage,
});

const PAGE = 40;

function CbbGamesPage() {
  const { games, teams, conferences, isLoading } = useCbbSchedule(60_000);
  const rows = useCbbModel(games);
  const model = useMemo(() => new Map(rows.map((r) => [r.game.id, r])), [rows]);
  const [tab, setTab] = useState<"upcoming" | "results">("upcoming");
  const [conf, setConf] = useState("");
  const [q, setQ] = useState("");
  const [ranked, setRanked] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const match = (g: CbbGame) => {
    if (ranked && !g.home.rank && !g.away.rank) return false;
    if (conf && teams.get(g.home.team.id)?.confId !== conf && teams.get(g.away.team.id)?.confId !== conf) return false;
    if (q) {
      const s = q.toLowerCase();
      const hit = [g.home.team, g.away.team].some((t) => `${t.name} ${t.abbr} ${t.short}`.toLowerCase().includes(s));
      if (!hit) return false;
    }
    return true;
  };
  const upcoming = useMemo(
    () =>
      games
        .filter((g) => (g.status === "scheduled" || g.status === "live") && match(g))
        .sort((a, b) => (a.status === "live" ? -1 : 0) - (b.status === "live" ? -1 : 0) || a.date.localeCompare(b.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, conf, q, ranked, teams],
  );
  const results = useMemo(
    () =>
      games
        .filter((g) => g.status === "final" && hasScore(g) && match(g))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, conf, q, ranked, teams],
  );
  const active = tab === "upcoming" && !upcoming.length && results.length && !q && !conf && !ranked ? "results" : tab;
  const list = active === "upcoming" ? upcoming : results;
  const shownList = list.slice(0, shown);
  // group by day
  const days = useMemo(() => {
    const out: { day: string; games: CbbGame[] }[] = [];
    for (const g of shownList) {
      const day = etDayKey(g.date);
      const last = out[out.length - 1];
      if (last?.day === day) last.games.push(g);
      else out.push({ day, games: [g] });
    }
    return out;
  }, [shownList]);
  const confs = useMemo(() => [...conferences.values()].sort((a, b) => a.short.localeCompare(b.short)), [conferences]);

  return (
    <>
      <PageTitle eyebrow="Men's college basketball" title="Games" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["upcoming", `Upcoming & live${upcoming.length ? "" : " (none)"}`],
            ["results", "Results"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={active === key}
            onClick={() => {
              setTab(key);
              setShown(PAGE);
            }}
            className={`shrink-0 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${active === key ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={ranked}
          onClick={() => setRanked((v) => !v)}
          className={`shrink-0 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${ranked ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
        >
          Top 25
        </button>
        <select
          value={conf}
          onChange={(e) => {
            setConf(e.target.value);
            setShown(PAGE);
          }}
          aria-label="Conference"
          className="rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] text-mute ring-1 ring-line/10"
        >
          <option value="">All conferences</option>
          {confs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.short || c.name}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setShown(PAGE);
          }}
          placeholder="Find a team"
          aria-label="Find a team"
          className="min-w-0 flex-1 rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] ring-1 ring-line/10 placeholder:text-faint sm:max-w-[220px]"
        />
      </div>
      {isLoading ? (
        <CbbEmpty>Loading the schedule…</CbbEmpty>
      ) : !list.length ? (
        <CbbEmpty>{active === "upcoming" ? "No upcoming games match." : "No finished games match."}</CbbEmpty>
      ) : (
        <div className="space-y-6">
          {days.map((d) => (
            <CbbGamesTable
              key={d.day}
              title={etDayLabel(d.day)}
              aside={`${d.games.length} games`}
              games={d.games}
              model={model}
            />
          ))}
          {list.length > shown ? (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="w-full rounded-xl py-3 font-mono text-[11px] uppercase tracking-wider text-acc ring-1 ring-line/10"
            >
              Show more ({list.length - shown} left)
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}

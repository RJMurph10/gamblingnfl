import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageTitle } from "@/components/shared/booth";
import {
  CbaseEmpty,
  CbaseGamesTable,
  SeasonPicker,
  rowFromLined,
  rowFromUpcoming,
  type CbaseRow,
} from "@/components/cbase/CbaseBits";
import { dayLabel, etDay } from "@/lib/cbase/cbase";
import { useCbaseSeason } from "@/lib/cbase/use-cbase";

export const Route = createFileRoute("/cbase/games/")({
  validateSearch: (search: Record<string, unknown>): { season?: number } => ({
    season: Number(search.season) || undefined,
  }),
  head: () => ({
    meta: [
      { title: "Games — GamblingCBASE" },
      {
        name: "description",
        content:
          "Division I college baseball games with betting lines: upcoming games and results, with the opening and latest lines, the model's numbers and graded watch picks.",
      },
    ],
  }),
  component: CbaseGamesPage,
});

const PAGE_DAYS = 10;

function CbaseGamesPage() {
  const { season } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data, isLoading } = useCbaseSeason(season);
  const teams = useMemo(() => data?.teams ?? {}, [data]);
  const [tab, setTab] = useState<"upcoming" | "results">("upcoming");
  const [picksOnly, setPicksOnly] = useState(false);
  const [q, setQ] = useState("");
  const [days, setDays] = useState(PAGE_DAYS);

  const match = (r: CbaseRow) => {
    if (picksOnly && !r.picks?.length) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return `${r.homeName} ${r.awayName}`.toLowerCase().includes(s);
  };
  const upcoming = useMemo(
    () => (data?.upcoming ?? []).map((g) => rowFromUpcoming(g, teams)).filter(match),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, picksOnly, q],
  );
  const results = useMemo(
    () =>
      (data?.lined ?? [])
        .map((g) => rowFromLined(g, teams))
        .filter(match)
        .sort((a, b) => b.start.localeCompare(a.start)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, picksOnly, q],
  );
  const active = tab === "upcoming" && !upcoming.length ? "results" : tab;
  const list = active === "upcoming" ? upcoming : results;
  const grouped = useMemo(() => {
    const out: { day: string; rows: CbaseRow[] }[] = [];
    for (const r of list) {
      const day = etDay(r.start);
      const last = out[out.length - 1];
      if (last?.day === day) last.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out;
  }, [list]);

  const chip = (on: boolean) =>
    `shrink-0 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${on ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`;

  return (
    <>
      <PageTitle
        eyebrow={`College baseball · ${data?.season ?? ""} season`}
        title="Games"
        aside={
          <SeasonPicker
            seasons={data?.seasons ?? []}
            value={data?.season}
            onChange={(s) => navigate({ search: { season: s } })}
          />
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={active === "upcoming"}
          onClick={() => setTab("upcoming")}
          className={chip(active === "upcoming")}
        >
          Upcoming{upcoming.length ? "" : " (none)"}
        </button>
        <button
          type="button"
          aria-pressed={active === "results"}
          onClick={() => setTab("results")}
          className={chip(active === "results")}
        >
          Results
        </button>
        <button
          type="button"
          aria-pressed={picksOnly}
          onClick={() => setPicksOnly((v) => !v)}
          className={chip(picksOnly)}
        >
          Watch picks only
        </button>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a team"
          aria-label="Find a team"
          className="min-w-0 flex-1 rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] ring-1 ring-line/10 placeholder:text-faint sm:max-w-[220px]"
        />
      </div>
      <p className="mb-4 font-mono text-[10px] text-faint">
        Games ESPN had lines for (about {data?.lined.length ?? "—"} this season, mostly bigger
        programs). Every D-I game counts toward the ratings.
      </p>
      {isLoading ? (
        <CbaseEmpty>Loading games…</CbaseEmpty>
      ) : !list.length ? (
        <CbaseEmpty>
          {active === "upcoming" ? "No upcoming games with lines." : "No games match."}
        </CbaseEmpty>
      ) : (
        <div className="space-y-6">
          {grouped.slice(0, days).map((d) => (
            <CbaseGamesTable
              key={d.day}
              title={dayLabel(d.day)}
              aside={`${d.rows.length} games`}
              rows={d.rows}
              teams={teams}
              season={data?.season}
            />
          ))}
          {grouped.length > days ? (
            <button
              type="button"
              onClick={() => setDays((n) => n + PAGE_DAYS)}
              className="w-full rounded-xl py-3 font-mono text-[11px] uppercase tracking-wider text-acc ring-1 ring-line/10"
            >
              Show more days ({grouped.length - days} left)
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}

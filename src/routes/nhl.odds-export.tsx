import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { getNhlOddsRows, getNhlWeekEvents } from "@/lib/nhl/nhl-odds-history.functions";
import { NHL_ODDS_COLUMNS, type NhlOddsRow, type NhlPastGame } from "@/lib/nhl/nhl-odds-history";

export const Route = createFileRoute("/nhl/odds-export")({
  head: () => ({
    meta: [
      { title: "Odds Export — GamblingNHL" },
      { name: "description", content: "Download ESPN's opening and closing NHL lines for a past season as a CSV." },
    ],
  }),
  component: NhlOddsExportPage,
});

const SEASONS = [2025, 2024, 2023, 2022, 2021, 2020, 2019];
const label = (s: number) => `${s}-${String(s + 1).slice(2)}`;
const BATCH = 8;
const PARALLEL = 3;

function toCsv(rows: NhlOddsRow[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [NHL_ODDS_COLUMNS.join(","), ...rows.map((r) => NHL_ODDS_COLUMNS.map((c) => esc(String(r[c] ?? ""))).join(","))].join("\n");
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function NhlOddsExportPage() {
  const [season, setSeason] = useState(2023);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<NhlOddsRow[]>([]);
  const [failed, setFailed] = useState(0);
  const [sample, setSample] = useState<{ rows: NhlOddsRow[]; raw: string } | null>(null);
  const stop = useRef(false);

  const filled = (r: NhlOddsRow) => Boolean(r.mlHomeOpen && r.mlHomeClose);
  const withOpen = rows.filter(filled).length;

  /** Walks the season a week at a time (Sep 25 to Jun 30). `stopAfter` ends early once that many games are found. */
  async function events(stopAfter = Infinity): Promise<NhlPastGame[]> {
    const pad = (n: number) => String(n).padStart(2, "0");
    const all = new Map<string, NhlPastGame>();
    const errs: string[] = [];
    const end = new Date(season + 1, 5, 30);
    for (let d = new Date(season, 8, 25); d <= end && !stop.current; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) {
      const start = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
      setStatus(`Listing ${label(season)} games… week of ${start} · ${all.size} found`);
      try {
        const res = await getNhlWeekEvents({ data: { start } });
        res.games.forEach((g) => all.set(g.id, g));
        errs.push(...res.errors);
      } catch (err) {
        errs.push(`${start}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (all.size >= stopAfter) break;
    }
    if (!all.size) {
      throw new Error(`ESPN returned no finished games for that season.${errs.length ? ` First errors: ${errs.slice(0, 3).join(" | ")}` : ""}`);
    }
    return [...all.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async function testOne() {
    setRunning(true);
    setSample(null);
    try {
      stop.current = false;
      const games = await events(40);
      const pick = games[games.length - 1];
      setStatus(`Reading lines for ${pick.away} @ ${pick.home} (${pick.date.slice(0, 10)})…`);
      const res = await getNhlOddsRows({ data: { games: [pick], withRaw: true } });
      setSample({ rows: res.rows, raw: res.raw });
      setStatus(res.rows.length ? `Found ${res.rows.length} sportsbook rows for one game.` : "ESPN had no lines for that game.");
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  async function runAll() {
    setRunning(true);
    stop.current = false;
    setRows([]);
    setFailed(0);
    try {
      const games = await events();
      const batches: NhlPastGame[][] = [];
      for (let i = 0; i < games.length; i += BATCH) batches.push(games.slice(i, i + BATCH));
      let done = 0;
      let next = 0;
      const all: NhlOddsRow[] = [];
      let bad = 0;
      await Promise.all(
        Array.from({ length: PARALLEL }, async () => {
          while (next < batches.length && !stop.current) {
            const b = batches[next++];
            try {
              const res = await getNhlOddsRows({ data: { games: b } });
              all.push(...res.rows);
              bad += res.failed.length;
            } catch {
              bad += b.length;
            }
            done += b.length;
            setStatus(`${done} of ${games.length} games read · ${all.length} sportsbook rows`);
            setRows([...all]);
            setFailed(bad);
          }
        }),
      );
      setStatus(`${stop.current ? "Stopped" : "Done"}: ${done} of ${games.length} games read.`);
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <PageTitle eyebrow="NHL" title="Odds Export" />
      <div className="space-y-6">
        <Panel>
          <p className="text-sm text-mute">
            Pulls ESPN&apos;s opening and closing moneyline, puck line and total for every finished regular-season game of a
            season, one row per sportsbook. Start with &quot;Test one game&quot; to see whether ESPN still has opening lines
            for that season. A full season takes a few minutes; keep this tab open.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              disabled={running}
              className="rounded-md border border-line/20 bg-panel2 px-3 py-1.5 font-mono text-sm"
            >
              {SEASONS.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={testOne}
              disabled={running}
              className="rounded-md border border-line/20 px-3 py-1.5 font-mono text-xs uppercase tracking-wider hover:text-acc disabled:opacity-50"
            >
              Test one game
            </button>
            <button
              type="button"
              onClick={runAll}
              disabled={running}
              className="rounded-md bg-acc/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-acc ring-1 ring-acc/25 disabled:opacity-50"
            >
              Export full season
            </button>
            {running ? (
              <button
                type="button"
                onClick={() => (stop.current = true)}
                className="rounded-md px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-mute hover:text-loss"
              >
                Stop
              </button>
            ) : null}
          </div>
          {status ? <p className="mt-3 font-mono text-xs text-mute">{status}</p> : null}
        </Panel>

        {sample ? (
          <Panel padded={false}>
            <PanelHeader
              title="One-game test"
              aside={
                <button
                  type="button"
                  onClick={() => download(`nhl-odds-raw-${label(season)}.json`, sample.raw, "application/json")}
                  className="font-mono text-[11px] uppercase tracking-wider text-acc"
                >
                  Download raw JSON
                </button>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Book</th>
                    <th className="px-2 py-2 font-normal">ML open (A / H)</th>
                    <th className="px-2 py-2 font-normal">ML close (A / H)</th>
                    <th className="px-2 py-2 font-normal">Total open</th>
                    <th className="px-4 py-2 font-normal">Total close</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5 font-mono text-[12px]">
                  {sample.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2">{r.provider || "—"}</td>
                      <td className="px-2 py-2">{r.mlAwayOpen || "—"} / {r.mlHomeOpen || "—"}</td>
                      <td className="px-2 py-2">{r.mlAwayClose || "—"} / {r.mlHomeClose || "—"}</td>
                      <td className="px-2 py-2">{r.totalOpenLine || "—"} {r.overOpenOdds || ""}/{r.underOpenOdds || ""}</td>
                      <td className="px-4 py-2">{r.totalCloseLine || "—"} {r.overCloseOdds || ""}/{r.underCloseOdds || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}

        {rows.length ? (
          <Panel>
            <p className="text-sm">
              {rows.length.toLocaleString()} sportsbook rows · {withOpen.toLocaleString()} with both an opening and closing
              moneyline · {failed} games with no lines
            </p>
            <button
              type="button"
              onClick={() => download(`nhl-odds-${label(season)}.csv`, toCsv(rows), "text/csv")}
              className="mt-3 rounded-md bg-acc/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-acc ring-1 ring-acc/25"
            >
              Download CSV
            </button>
          </Panel>
        ) : null}
      </div>
    </>
  );
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import { getHealth } from "@/lib/shared/health.functions";
import type { HealthCheck, HealthStatus } from "@/lib/shared/health";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Status — GamblingNFL" },
      {
        name: "description",
        content:
          "Is the data behind the site fresh? Scheduled jobs, data files, outside feeds and API quotas, checked every hour.",
      },
    ],
  }),
  component: StatusPage,
});

const TONE: Record<HealthStatus, string> = {
  ok: "bg-win/10 text-win ring-win/25",
  warn: "bg-acc/10 text-acc ring-acc/25",
  fail: "bg-loss/10 text-loss ring-loss/25",
};
const LABEL: Record<HealthStatus, string> = { ok: "OK", warn: "Check", fail: "Broken" };
const GROUPS = ["Jobs", "Data", "Feeds", "Quotas", "Site"];
const BLURB: Record<string, string> = {
  Jobs: "Scheduled GitHub jobs: did the last run succeed, and has one succeeded recently enough for the season?",
  Data: "The files the site reads: when each last changed.",
  Feeds: "Outside sources: do they still answer in the shape our code expects?",
  Quotas: "Paid and free API allowances.",
  Site: "The published website.",
};

function ago(iso: string) {
  const m = (Date.now() - Date.parse(iso)) / 60_000;
  if (m < 60) return `${Math.max(1, Math.round(m))} min ago`;
  if (m < 48 * 60) return `${(m / 60).toFixed(1)} h ago`;
  return `${(m / 1440).toFixed(1)} days ago`;
}

function Pill({ status }: { status: HealthStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ${TONE[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}

function Row({ c }: { c: HealthCheck }) {
  return (
    <tr className="align-top">
      <td className="w-20 px-4 py-2.5">
        <Pill status={c.status} />
      </td>
      <td className="px-2 py-2.5 text-sm">{c.name}</td>
      <td className="px-2 py-2.5 font-mono text-[11px] text-mute">
        {c.detail}
        {c.url ? (
          <>
            {" · "}
            <a href={c.url} target="_blank" rel="noreferrer" className="text-acc hover:underline">
              failed run
            </a>
          </>
        ) : null}
      </td>
      <td
        className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-[10px] text-faint"
        suppressHydrationWarning
      >
        {c.status === "ok" ? "" : `since ${ago(c.since)}`}
      </td>
    </tr>
  );
}

function StatusPage() {
  const q = useQuery({
    queryKey: ["site-health"],
    queryFn: () => getHealth(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const report = q.data;
  const groups = useMemo(() => {
    const by = new Map<string, HealthCheck[]>();
    for (const c of report?.checks ?? []) by.set(c.group, [...(by.get(c.group) ?? []), c]);
    return [...by.entries()].sort((a, b) => GROUPS.indexOf(a[0]) - GROUPS.indexOf(b[0]));
  }, [report]);

  if (q.isLoading)
    return <p className="py-10 text-center font-mono text-xs text-mute">Loading status…</p>;
  if (!report)
    return (
      <>
        <PageTitle eyebrow="Site health" title="Status" />
        <Panel>
          <p className="text-sm text-mute">
            No health report yet. The hourly Site health job writes the first one.
          </p>
        </Panel>
      </>
    );
  const { ok, warn, fail } = report.summary;
  const stale = Date.now() - Date.parse(report.checkedAt) > 3 * 3_600_000;
  return (
    <>
      <PageTitle eyebrow="Site health · checked every hour" title="Status" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Overall"
          value={fail ? "Broken" : warn ? "Check" : "All good"}
          note={`${ok + warn + fail} checks`}
          tone={fail ? "loss" : warn ? "mute" : "win"}
        />
        <StatCard label="Broken" value={String(fail)} tone={fail ? "loss" : "mute"} />
        <StatCard label="Worth a look" value={String(warn)} tone="mute" />
        <StatCard
          label="Last check"
          value={ago(report.checkedAt)}
          note={
            stale
              ? "the health job itself looks stale"
              : new Date(report.checkedAt).toLocaleString()
          }
          tone={stale ? "loss" : "mute"}
        />
      </div>
      <div className="space-y-6">
        {groups.map(([group, list]) => (
          <Panel key={group} padded={false}>
            <PanelHeader
              title={group}
              aside={
                <span className="label-mono">
                  {list.filter((c) => c.status === "ok").length} of {list.length} OK
                </span>
              }
            />
            <p className="px-4 pt-3 text-sm text-mute">{BLURB[group]}</p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[640px]">
                <tbody className="divide-y divide-line/5">
                  {list.map((c) => (
                    <Row key={c.id} c={c} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}
      </div>
      <p className="mt-6 font-mono text-[10px] text-faint">
        Off-season jobs and files aren&apos;t expected to be fresh. A phone alert (ntfy) goes out
        when a check breaks or recovers.
      </p>
    </>
  );
}

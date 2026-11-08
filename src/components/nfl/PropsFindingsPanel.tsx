/** The NFL player-prop research scoreboard on the Model page: ★ on the site, leads, and what didn't work. */
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { PROP_FINDINGS, type FindingStatus, type PropFinding } from "@/data/nfl/props-findings";

const GROUPS: { status: FindingStatus; label: string; note: string }[] = [
  { status: "star", label: "★ On the site", note: "Proven on seasons the rule never saw" },
  { status: "lead", label: "Leads", note: "Tracking, not a ★ yet" },
  { status: "none", label: "Tested, no edge", note: "So you don't have to" },
];

function Finding({ f }: { f: PropFinding }) {
  return (
    <div className="space-y-1 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-semibold text-foreground">
          {f.status === "star" ? <span className="text-acc">★ </span> : null}
          {f.title}
        </span>
        {f.link ? (
          <Link to={f.link.to} className="font-mono text-[10px] uppercase tracking-wider text-acc">
            {f.link.label} →
          </Link>
        ) : null}
      </div>
      <p className="text-[13px] leading-snug text-mute">{f.detail}</p>
      {f.seasons?.length ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {f.seasons.map((s) => (
            <span
              key={s.season}
              className={`rounded border border-line/10 px-1.5 py-0.5 font-mono text-[10px] ${
                s.roi === undefined ? "text-mute" : s.roi > 0 ? "text-win" : "text-loss"
              }`}
            >
              {s.season}: {s.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PropsFindingsPanel() {
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Player props research"
        aside={<span className="label-mono">vs real opening lines · 2024–2026</span>}
      />
      <div className="space-y-4 px-4 py-3">
        <p className="text-sm text-mute">
          NFL main-line props graded at the opening line and the book&apos;s real price (ESPN BET
          2024–25, DraftKings 2026), plus the books&apos; alternate-line ladders. Each idea had to
          work on seasons it wasn&apos;t built on.
        </p>
        {GROUPS.map((g) => {
          const items = PROP_FINDINGS.filter((f) => f.status === g.status);
          if (!items.length) return null;
          return (
            <section key={g.status}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <h3 className="font-disp text-base font-semibold uppercase tracking-tight">
                  {g.label}
                </h3>
                <span className="label-mono">{g.note}</span>
              </div>
              <div className="divide-y divide-line/5 rounded-lg border border-line/10">
                {items.map((f) => (
                  <Finding key={f.title} f={f} />
                ))}
              </div>
            </section>
          );
        })}
        <p className="font-mono text-[10px] text-faint">
          Graded at each book&apos;s posted price; this season&apos;s DraftKings lines come without
          prices on ESPN, so 2026 is graded at −110. Past results don&apos;t guarantee future ones.
        </p>
      </div>
    </Panel>
  );
}

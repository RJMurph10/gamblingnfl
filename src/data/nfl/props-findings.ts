/**
 * What the NFL player-prop research has found so far, shown on the Model page. Results are against
 * real opening prop lines (ESPN's saved book lines, 2024-2026), each rule tested on seasons it wasn't
 * built on where possible. Details: the GamblingNFL project doc "props-research".
 * 2026 DraftKings lines come without prices, so 2026 is graded at -110.
 */
export type FindingStatus = "star" | "lead" | "none";

export interface SeasonResult {
  season: string;
  /** e.g. "+7.2%" or "85-50"; tone from the sign of `roi` when given. */
  text: string;
  roi?: number;
}

export interface PropFinding {
  status: FindingStatus;
  title: string;
  detail: string;
  seasons?: SeasonResult[];
  /** A link on the site where it lives, if any. */
  link?: { to: "/props"; label: string };
}

export const PROP_FINDINGS: PropFinding[] = [
  {
    status: "star",
    title: "QB passing-yards overs (model 8%+ above the line)",
    detail:
      "The QB model (form, team implied points, opponent, weather) against DraftKings' opening line. It adds 5–10 points over just betting overs in every season.",
    seasons: [
      { season: "2024", text: "85-50, +7.4%", roi: 7.4 },
      { season: "2025", text: "45-37, +2.2%", roi: 2.2 },
      { season: "2026 (never seen)", text: "28-15, +24.3%", roi: 24.3 },
    ],
    link: { to: "/props", label: "★ on the Props page" },
  },
  {
    status: "lead",
    title: "Rushing-yard unders (main line)",
    detail:
      "Profitable all three seasons (3,067 bets, +4.8%). Rushing yards are lopsided: running backs finish below their recent average in 57% of games (every season since 2012), QBs 60%, and books don't shade rushing lines for it the way they do receiving lines. Strongest for QBs, running backs with lines of 20.5–35 yards, and teams expected to score 3+ points less than usual (rushing overs hit 42% there). Needs DraftKings' real under prices before it gets a ★.",
    seasons: [
      { season: "2024", text: "+7.2%", roi: 7.2 },
      { season: "2025", text: "+1.9%", roi: 1.9 },
      { season: "2026", text: "+4.7%", roi: 4.7 },
    ],
    link: { to: "/props", label: "This week's picks and results" },
  },
  {
    status: "lead",
    title: "Receiving and passing alternate overs around −200",
    detail:
      "Receiving-yard alternate overs priced −175 to −250 won 71% (66% needed, +8.1%, 161 bets); passing yards 74% (+11.8%, 70 bets). Almost all from one season, so it's a hint, not an edge.",
    seasons: [{ season: "2024", text: "+8.1% / +11.8%", roi: 8 }],
  },
  {
    status: "none",
    title: "Blind overs, any market",
    detail:
      "Lose 2–17% in nearly every market and season. Field goals made and kicking points were about break-even.",
  },
  {
    status: "none",
    title: "Full props model on line history",
    detail:
      "Every skill-position market (34,600 props), using each player's past lines, his record against them, the defense's record against lines and team trends. On 2025 and 2026 it was no better than each market's plain over rate.",
  },
  {
    status: "none",
    title: "Rushing alternate overs around −200: avoid",
    detail:
      "Won 54% when they needed 66% (−18.9%). The same lopsided-yards effect as the rushing under, the other way.",
  },
  {
    status: "none",
    title: "Overs in high-scoring games",
    detail:
      "Books raise players' lines with the total. The best case, receiving overs when the team is expected to score 27+, went 51–52% every season: about break-even.",
  },
  {
    status: "none",
    title: "Next man up when the top receiver is out",
    detail:
      "His unders went 67-48 in 2024–2026, but replayed back to 2012 they hit only 44%. Kept as a live tracker on the Props page, not a bet.",
  },
  {
    status: "none",
    title: "Kicker unders, receiver/RB projection model, QB-change props",
    detail:
      "Kicker unders lose 2–12% every season; the receiver/RB model was less accurate than the line in every market; books price QB changes into props.",
  },
];

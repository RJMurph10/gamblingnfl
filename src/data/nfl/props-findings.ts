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
      { season: "2024", text: "82-50, +7.5u", roi: 5.6 },
      { season: "2025", text: "44-34, +4.1u", roi: 5.2 },
      { season: "2026 (never seen)", text: "28-15, +24.3%", roi: 24.3 },
    ],
  },
  {
    status: "lead",
    title: "Rushing-yard unders, tailored (tracked above)",
    detail:
      "A running back or receiver with a 35.5–49.5 yard line, under priced −112 or better. The line range was positive in every season; the price rule keeps a ~53% bet profitable. One slice of about 30 tested, so it's graded live from Nov 8 before it can earn a ★.",
    seasons: [
      { season: "2024", text: "51-50, +9.8u", roi: 9.7 },
      { season: "2025", text: "17-15, +0.6u", roi: 1.8 },
      { season: "2026", text: "36-28, +4.7u", roi: 7.4 },
    ],
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
    title: "Rushing-yard unders on every line",
    detail:
      "Overs hit only 47–48% at the main line, but at ESPN BET's real prices (−115 both ways) unders lost 1.4% in 2024 and 1.2% in 2025. An earlier +7% came from grading some props at unpriced alternate lines, since fixed. The tailored version (running back or receiver lines of 35.5–49.5, under −112 or better: 104-93, +7.7% over 2024–26) is tracked above.",
    seasons: [
      { season: "2024", text: "405-377, −10.9u", roi: -1.4 },
      { season: "2025", text: "555-492, −12.5u", roi: -1.2 },
    ],
  },
  {
    status: "none",
    title: "Blind overs, any market",
    detail:
      "At real prices almost every market lost in both 2024 and 2025, overs and unders alike: ESPN BET charged −115 on both sides. Nothing was positive in both seasons.",
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
    detail: "Books raise players' lines with the total; no over angle by game total held up.",
  },
  {
    status: "none",
    title: "Next man up when the top receiver is out",
    detail:
      "His unders went 67-48 in 2024–2026, but replayed back to 2012 they hit only 44%. Kept as a live tracker above, not a bet.",
  },
  {
    status: "none",
    title: "Kicker unders, receiver/RB projection model, QB-change props",
    detail:
      "Kicker unders lose 2–12% every season; the receiver/RB model was less accurate than the line in every market; books price QB changes into props.",
  },
];

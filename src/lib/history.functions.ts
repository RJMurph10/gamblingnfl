import { createServerFn } from "@tanstack/react-start";
import { fetchNflHistory } from "./nfl-history.server";

/** Past seasons' final scores and closing lines, for the game model and its track record. */
export const getNflHistory = createServerFn({ method: "GET" }).handler(async () =>
  fetchNflHistory(),
);

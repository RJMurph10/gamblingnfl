import { createServerFn } from "@tanstack/react-start";
import { fetchNbaSchedule } from "./nba.server";

/** NBA schedule from ESPN; fetched server-side so the browser doesn't need to call ESPN directly. */
export const getNbaSchedule = createServerFn({ method: "GET" }).handler(async () => fetchNbaSchedule());

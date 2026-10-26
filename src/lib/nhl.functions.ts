import { createServerFn } from "@tanstack/react-start";
import { fetchNhlSchedule } from "./nhl.server";

/** The NHL season so far plus the next two weeks, with sportsbook lines where ESPN has them. */
export const getNhlSchedule = createServerFn({ method: "GET" }).handler(async () => fetchNhlSchedule());

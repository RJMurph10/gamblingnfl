import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchNhlGameProps, fetchNhlPlayerIndex, fetchNhlSchedule } from "./nhl.server";

/** The NHL season so far plus the next two weeks, with sportsbook lines where ESPN has them. */
export const getNhlSchedule = createServerFn({ method: "GET" }).handler(async () => fetchNhlSchedule());

/** Every rostered player with this season's totals (last season's until the new one has stats). */
export const getNhlPlayerIndex = createServerFn({ method: "GET" }).handler(async () => fetchNhlPlayerIndex());

/** DraftKings player props for a game, when ESPN has posted them. */
export const getNhlGameProps = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ gameId: z.string(), awayId: z.string(), homeId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchNhlGameProps(data.gameId, data.awayId, data.homeId));

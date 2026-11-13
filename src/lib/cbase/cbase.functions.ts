import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchCbaseGame, fetchCbaseSeason, fetchCbaseTeam } from "./cbase.server";

/** A season (default: the latest) without its full results list. */
export const getCbaseSeason = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ season: z.number().optional() }).parse(data ?? {}))
  .handler(async ({ data }) => fetchCbaseSeason(data.season));

/** One team's season. */
export const getCbaseTeam = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ key: z.string(), season: z.number().optional() }).parse(data),
  )
  .handler(async ({ data }) => fetchCbaseTeam(data.key, data.season));

/** One game (NCAA id, or "e<ESPN id>" for an upcoming game). */
export const getCbaseGame = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data }) => fetchCbaseGame(data.id));

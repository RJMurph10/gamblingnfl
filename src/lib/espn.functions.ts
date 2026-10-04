/**
 * Client-callable server functions exposing the live ESPN 2026 schedule
 * and game detail feeds. Safe to call from public routes (read-only,
 * no auth required).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchGameDetail, fetchSchedule } from "./espn.server";

export const getLiveSchedule = createServerFn({ method: "GET" }).handler(async () => {
  return fetchSchedule();
});

export const getLiveGame = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ eventId: z.string() }).parse(data))
  .handler(async ({ data }) => {
    return fetchGameDetail(data.eventId);
  });

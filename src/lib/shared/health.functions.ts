import { createServerFn } from "@tanstack/react-start";
import { fetchHealth } from "./health.server";

/** The latest site health report, or null before the first check has run. */
export const getHealth = createServerFn({ method: "GET" }).handler(() => fetchHealth());

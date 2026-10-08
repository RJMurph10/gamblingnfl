import type { GameWeather } from "@/lib/weather.server";

export function GameWeatherCard({
  weather,
  isLoading,
}: {
  weather?: GameWeather | null;
  isLoading?: boolean;
}) {
  /*
   * Only pulse while the weather request is actually loading.
   * A failed/unavailable request gets a normal static card.
   */
  if (isLoading) {
    return (
      <div className="rounded-lg border border-border/50 bg-panel/60 px-3 py-2 text-right min-w-[120px] shadow-sm">
        <div className="h-5 w-16 bg-white/10 rounded ml-auto mb-1 animate-pulse" />
        <div className="h-3 w-12 bg-white/10 rounded ml-auto mb-1 animate-pulse" />
        <div className="h-3 w-20 bg-white/10 rounded ml-auto animate-pulse" />
      </div>
    );
  }

  /*
   * Static fallback if no weather object was returned.
   * This prevents an infinite-looking loading animation.
   */
  if (!weather) {
    return (
      <div className="rounded-lg border border-border/60 bg-panel/75 px-3 py-2 text-right shadow-sm backdrop-blur-sm min-w-[125px]">
        <div className="font-disp text-base sm:text-lg font-bold tracking-tight text-foreground">
          🌡️ —
        </div>

        <div className="text-xs font-medium text-mute tracking-wide">
          Weather unavailable
        </div>

        <div className="font-mono text-[10px] sm:text-[11px] text-faint tracking-wider">
          H: —° L: —°
        </div>
      </div>
    );
  }

  /*
   * Indoor stadium:
   *
   * 🏟️ 72°
   * Indoor
   */
  if (weather.isIndoor) {
    return (
      <div className="rounded-lg border border-border/60 bg-panel/75 px-3 py-2 text-right shadow-sm backdrop-blur-sm min-w-[125px]">
        <div className="flex items-center justify-end gap-1.5 font-disp text-base sm:text-lg font-bold tracking-tight text-foreground">
          <span className="text-lg leading-none">
            🏟️
          </span>

          <span>
            {weather.temperature != null
              ? `${weather.temperature}°`
              : "—"}
          </span>
        </div>

        <div className="text-xs font-semibold text-mute tracking-wide">
          Indoor
        </div>
      </div>
    );
  }

  const isUnavailable =
    weather.condition.toLowerCase() ===
    "weather unavailable";

  return (
    <div className="rounded-lg border border-border/60 bg-panel/75 px-3 py-2 text-right shadow-sm backdrop-blur-sm min-w-[125px]">
      <div className="flex items-center justify-end gap-1.5 font-disp text-base sm:text-lg font-bold tracking-tight text-foreground">
        <span className="text-lg leading-none">
          {weather.emoji}
        </span>

        <span>
          {weather.temperature != null
            ? `${weather.temperature}°`
            : "—"}
        </span>
      </div>

      <div className="text-xs font-medium text-mute tracking-wide">
        {isUnavailable
          ? "Weather unavailable"
          : weather.condition}
      </div>

      <div className="font-mono text-[10px] sm:text-[11px] text-faint tracking-wider">
        H: {weather.high ?? "—"}° L:{" "}
        {weather.low ?? "—"}°
      </div>
    </div>
  );
}


import type { GameWeather } from "@/lib/weather.server";

export function GameWeatherCard({
  weather,
  isLoading,
}: {
  weather?: GameWeather | null;
  isLoading?: boolean;
}) {
  // Hide empty weather cards and unavailable-weather placeholders.
  if (
    isLoading ||
    !weather ||
    weather.condition.toLowerCase() === "weather unavailable"
  ) {
    return null;
  }

  // Indoor stadiums use the static climate-controlled display.
  if (weather.isIndoor) {
    return (
      <div className="min-w-[125px] rounded-lg border border-border/60 bg-panel/75 px-3 py-2 text-right shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-end gap-1.5 font-disp text-base font-bold tracking-tight text-foreground sm:text-lg">
          <span className="text-lg leading-none">🏟️</span>

          <span>
            {weather.temperature != null
              ? `${weather.temperature}°`
              : "—"}
          </span>
        </div>

        <div className="text-xs font-semibold tracking-wide text-mute">
          Indoor
        </div>
      </div>
    );
  }

  // Outdoor forecast with temperature, conditions, high and low.
  return (
    <div className="min-w-[125px] rounded-lg border border-border/60 bg-panel/75 px-3 py-2 text-right shadow-sm backdrop-blur-sm">
      <div className="flex items-center justify-end gap-1.5 font-disp text-base font-bold tracking-tight text-foreground sm:text-lg">
        <span className="text-lg leading-none">
          {weather.emoji}
        </span>

        <span>
          {weather.temperature != null
            ? `${weather.temperature}°`
            : "—"}
        </span>
      </div>

      <div className="text-xs font-medium tracking-wide text-mute">
        {weather.condition}
      </div>

      <div className="font-mono text-[10px] tracking-wider text-faint sm:text-[11px]">
        H: {weather.high ?? "—"}° L: {weather.low ?? "—"}°
      </div>
    </div>
  );
}

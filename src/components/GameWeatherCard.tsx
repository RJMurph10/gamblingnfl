import type { GameWeather } from "@/lib/weather.server";

export function GameWeatherCard({ weather, isLoading }: { weather?: GameWeather | null; isLoading?: boolean }) {
  if (isLoading || !weather) {
    return (
      <div className="rounded-lg border border-border/50 bg-panel/60 px-3 py-2 text-right min-w-[120px] shadow-sm animate-pulse">
        <div className="h-5 w-16 bg-white/10 rounded ml-auto mb-1" />
        <div className="h-3 w-12 bg-white/10 rounded ml-auto mb-1" />
        <div className="h-3 w-20 bg-white/10 rounded ml-auto" />
      </div>
    );
  }

  if (weather.isIndoor) {
    return (
      <div className="rounded-lg border border-border/60 bg-panel/75 px-3 py-2 text-right shadow-sm backdrop-blur-sm min-w-[125px]">
        {/* Line 1 */}
        <div className="font-disp text-base sm:text-lg font-bold tracking-tight text-foreground">
          🏟️ —
        </div>
        {/* Line 2 */}
        <div className="text-xs font-semibold text-mute tracking-wide">
          Indoor
        </div>
        {/* Line 3 */}
        <div className="font-mono text-[10px] sm:text-[11px] text-faint tracking-wider">
          Climate Controlled
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-panel/75 px-3 py-2 text-right shadow-sm backdrop-blur-sm min-w-[125px]">
      {/* Line 1: [Emoji] [Temp]° */}
      <div className="flex items-center justify-end gap-1.5 font-disp text-base sm:text-lg font-bold tracking-tight text-foreground">
        <span className="text-lg leading-none">{weather.emoji}</span>
        <span>{weather.temperature != null ? `${weather.temperature}°` : "—"}</span>
      </div>
      {/* Line 2: [Condition] */}
      <div className="text-xs font-medium text-mute tracking-wide">
        {weather.condition}
      </div>
      {/* Line 3: H: [High]°  L: [Low]° */}
      <div className="font-mono text-[10px] sm:text-[11px] text-faint tracking-wider">
        H: {weather.high ?? "—"}°  L: {weather.low ?? "—"}°
      </div>
    </div>
  );
}

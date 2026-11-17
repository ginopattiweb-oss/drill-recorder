export function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const UNITS: [number, string, string][] = [
  [31536000, "año", "años"],
  [2592000, "mes", "meses"],
  [604800, "semana", "semanas"],
  [86400, "día", "días"],
  [3600, "hora", "horas"],
  [60, "minuto", "minutos"],
];

export function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return "recién";
  for (const [secs, one, many] of UNITS) {
    if (diff >= secs) {
      const n = Math.max(1, Math.round(diff / secs));
      return `hace ${n} ${n === 1 ? one : many}`;
    }
  }
  return "hace 1 minuto";
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

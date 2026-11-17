export const RECORDING_MODES = {
  "screen-cam": "Pantalla y cámara",
  screen: "Solo pantalla",
  cam: "Solo cámara",
} as const;

export type RecordingMode = keyof typeof RECORDING_MODES;

const RECORDING_MODE_KEY = "drill:mode";

export function readRecordingMode(): RecordingMode {
  try {
    const saved = localStorage.getItem(RECORDING_MODE_KEY);
    if (saved && Object.hasOwn(RECORDING_MODES, saved)) return saved as RecordingMode;
  } catch {}
  return "screen-cam";
}

export function saveRecordingMode(mode: RecordingMode): boolean {
  try {
    localStorage.setItem(RECORDING_MODE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

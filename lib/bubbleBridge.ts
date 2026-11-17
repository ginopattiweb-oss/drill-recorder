// Puente con la app nativa "DRILL Bubble" (burbuja de cámara sin marco, siempre encima).
// La app escucha un WebSocket en 127.0.0.1:47811 y solo acepta orígenes de DRILL Recorder.

export type BubbleMessage =
  | { type: "hello"; version: number; size?: number }
  | { type: "visible"; visible: boolean }
  | { type: "size"; index: number }
  | { type: "action"; action: "stop" | "pause" | "resume" | "restart" | "delete" }
  | { type: "connected" }
  | { type: "disconnected" };

const URL = "ws://127.0.0.1:47811";

class BubbleBridge {
  private ws: WebSocket | null = null;
  private pending: WebSocket | null = null;
  private listeners = new Set<(m: BubbleMessage) => void>();

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Intenta conectar; si tarda (p. ej. Chrome pide permiso de red local) la conexión
  // sigue viva en segundo plano y avisa con {type:"connected"} cuando abre.
  connect(timeoutMs = 700): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => settle(false), timeoutMs);
      if (this.pending && this.pending.readyState === WebSocket.CONNECTING) {
        this.pending.addEventListener("open", () => settle(true), { once: true });
        this.pending.addEventListener("close", () => settle(false), { once: true });
        return;
      }
      let ws: WebSocket;
      try {
        ws = new WebSocket(URL);
      } catch {
        return settle(false);
      }
      this.pending = ws;
      ws.onopen = () => {
        this.pending = null;
        this.ws = ws;
        try {
          localStorage.setItem("drill:bubbleApp", "1");
        } catch {}
        this.emit({ type: "connected" });
        settle(true);
      };
      ws.onclose = () => {
        if (this.pending === ws) this.pending = null;
        if (this.ws === ws) {
          this.ws = null;
          this.emit({ type: "disconnected" });
        }
        settle(false);
      };
      ws.onerror = () => settle(false);
      ws.onmessage = (e) => {
        try {
          this.emit(JSON.parse(e.data));
        } catch {}
      };
    });
  }

  // Abre la app con su esquema de URL (solo si alguna vez estuvo instalada) y espera a que conecte.
  async launchAndConnect(waitMs = 5000) {
    if (await this.connect()) return true;
    let known = false;
    try {
      known = localStorage.getItem("drill:bubbleApp") === "1";
    } catch {}
    if (!known) return false;
    const a = document.createElement("a");
    a.href = "drillbubble://open";
    a.click();
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 400));
      if (await this.connect(400)) return true;
    }
    return false;
  }

  send(msg: Record<string, unknown>) {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  on(fn: (m: BubbleMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(m: BubbleMessage) {
    this.listeners.forEach((fn) => fn(m));
  }
}

export const bubbleBridge = new BubbleBridge();

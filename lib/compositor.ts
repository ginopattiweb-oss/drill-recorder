// Compone la burbuja de cámara sobre la captura de pantalla usando Insertable Streams (Chrome/Edge).
// Se maneja por promesas de frames (no rAF ni timers), así que sigue funcionando con la pestaña de
// Boom en segundo plano. La cámara (~30fps constante) marca el ritmo: si la pantalla está quieta,
// se reutiliza el último frame de pantalla.

type ProcessorCtor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
type GeneratorCtor = new (init: { kind: "video" }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };

const g = globalThis as unknown as {
  MediaStreamTrackProcessor?: ProcessorCtor;
  MediaStreamTrackGenerator?: GeneratorCtor;
  OffscreenCanvas?: typeof OffscreenCanvas;
};

export function canComposite() {
  return !!(g.MediaStreamTrackProcessor && g.MediaStreamTrackGenerator && g.OffscreenCanvas);
}

export type Compositor = { track: MediaStreamTrack; setBubble: (on: boolean) => void; stop: () => void };

export function compositeCamera(screen: MediaStreamTrack, cam: MediaStreamTrack, bubbleOn = true): Compositor {
  const Processor = g.MediaStreamTrackProcessor!;
  const Generator = g.MediaStreamTrackGenerator!;
  const s = screen.getSettings();
  const W = s.width || 1920;
  const H = s.height || 1080;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  const gen = new Generator({ kind: "video" });
  const writer = gen.writable.getWriter();
  const screenClone = screen.clone();
  const camClone = cam.clone();
  const readers: ReadableStreamDefaultReader<VideoFrame>[] = [];
  let screenFrame: VideoFrame | null = null;
  let stopped = false;
  let busy = false;
  let bubble = bubbleOn;

  const pump = async (track: MediaStreamTrack, onFrame: (f: VideoFrame) => void | Promise<void>) => {
    const reader = new Processor({ track }).readable.getReader();
    readers.push(reader);
    while (!stopped) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done || !value) break;
      await onFrame(value);
    }
  };

  const draw = async (camFrame: VideoFrame) => {
    if (busy || !screenFrame || stopped) return camFrame.close();
    busy = true;
    try {
      // pantalla, manteniendo proporción
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      const sw = screenFrame.displayWidth;
      const sh = screenFrame.displayHeight;
      const k = Math.min(W / sw, H / sh);
      const dw = sw * k;
      const dh = sh * k;
      const ox = (W - dw) / 2;
      const oy = (H - dh) / 2;
      ctx.drawImage(screenFrame, ox, oy, dw, dh);

      if (!bubble) {
        const out = new VideoFrame(canvas, { timestamp: camFrame.timestamp });
        await writer.write(out);
        return;
      }
      // burbuja circular abajo a la izquierda (como Loom)
      const d = Math.round(Math.min(dw, dh) * 0.24);
      const m = Math.round(Math.min(dw, dh) * 0.035);
      const x = ox + m;
      const y = oy + dh - d - m;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = d * 0.08;
      ctx.shadowOffsetY = d * 0.02;
      ctx.beginPath();
      ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#222";
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
      ctx.clip();
      const cw = camFrame.displayWidth;
      const ch = camFrame.displayHeight;
      const side = Math.min(cw, ch);
      ctx.translate(x + d, y);
      ctx.scale(-1, 1); // espejado, igual que la burbuja en pantalla
      ctx.drawImage(camFrame, (cw - side) / 2, (ch - side) / 2, side, side, 0, 0, d, d);
      ctx.restore();

      const out = new VideoFrame(canvas, { timestamp: camFrame.timestamp });
      await writer.write(out); // el generador cierra el frame
    } catch {
      // frame perdido: se sigue con el próximo
    } finally {
      camFrame.close();
      busy = false;
    }
  };

  pump(screenClone, (f) => {
    screenFrame?.close();
    screenFrame = f;
  });
  pump(camClone, draw);

  return {
    track: gen,
    setBubble(on) {
      bubble = on;
    },
    stop() {
      stopped = true;
      readers.forEach((r) => r.cancel().catch(() => {}));
      screenFrame?.close();
      screenFrame = null;
      screenClone.stop();
      camClone.stop();
      writer.close().catch(() => {});
      gen.stop();
    },
  };
}

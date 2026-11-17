"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Camera, CameraOff, Mic, MicOff, Monitor, Pause, Play, RotateCcw, Trash2, User, X } from "lucide-react";
import { Logo, LogoMark } from "./Logo";
import { formatTime } from "@/lib/format";
import { canComposite, compositeCamera, type Compositor } from "@/lib/compositor";
import { bubbleBridge } from "@/lib/bubbleBridge";

import { readRecordingMode, saveRecordingMode, type RecordingMode as Mode } from "@/lib/recordingPreferences";

type Phase = "closed" | "setup" | "countdown" | "recording" | "paused" | "uploading";

const PART_SIZE = 45 * 1024 * 1024;
const BUBBLE_SIZES = [140, 220, 320];
const COUNTDOWN_SECONDS = 3;

const RecorderCtx = createContext<{ open: () => void }>({ open: () => {} });
export const useRecorder = () => useContext(RecorderCtx);

function pickMime(withAudio: boolean) {
  const candidates = withAudio
    ? ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,opus", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/mp4;codecs=avc1.640028", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function pickAudioMime() {
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function putWithProgress(url: string, body: Blob, type: string, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", type);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}: ${xhr.responseText}`)));
    xhr.onerror = () => reject(new Error("network error"));
    xhr.send(body);
  });
}

async function grabFrame(track: MediaStreamTrack): Promise<Blob | null> {
  try {
    const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
    if (!IC) return null;
    const bmp = await new IC(track).grabFrame();
    const scale = Math.min(1, 1280 / bmp.width);
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b), "image/jpeg", 0.82));
  } catch {
    return null;
  }
}

// Fallback de miniatura: primer frame del video ya grabado.
async function thumbFromBlob(blob: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(blob);
    const done = (b: Blob | null) => {
      URL.revokeObjectURL(url);
      resolve(b);
    };
    const t = setTimeout(() => done(null), 5000);
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    v.onloadeddata = () => {
      v.currentTime = 0.3;
    };
    v.onseeked = () => {
      clearTimeout(t);
      const scale = Math.min(1, 1280 / (v.videoWidth || 1280));
      const c = document.createElement("canvas");
      c.width = Math.round((v.videoWidth || 1280) * scale);
      c.height = Math.round((v.videoHeight || 720) * scale);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => done(b), "image/jpeg", 0.82);
    };
    v.onerror = () => {
      clearTimeout(t);
      done(null);
    };
  });
}

function CamVideo({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay muted playsInline />;
}

function ControlBar(p: {
  phase: Phase;
  elapsed: number;
  count: number;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onDelete: () => void;
}) {
  const live = p.phase === "recording" || p.phase === "paused";
  return (
    <div className={`ctl-bar ${p.phase === "paused" ? "paused" : ""}`}>
      <button className="ctl-stop" onClick={p.onStop} disabled={!live} title="Terminar grabación" aria-label="Stop recording">
        <i />
      </button>
      <div className="ctl-time">{p.phase === "countdown" ? `${p.count}…` : formatTime(p.elapsed / 1000)}</div>
      <div className="ctl-sep" />
      {p.phase === "paused" ? (
        <button className="ctl-btn" onClick={p.onResume} title="Reanudar" aria-label="Resume">
          <Play size={16} fill="currentColor" />
        </button>
      ) : (
        <button className="ctl-btn" onClick={p.onPause} disabled={!live} title="Pausar" aria-label="Pause">
          <Pause size={16} fill="currentColor" />
        </button>
      )}
      <button className="ctl-btn" onClick={p.onRestart} disabled={!live} title="Reiniciar" aria-label="Restart">
        <RotateCcw size={16} />
      </button>
      <button className="ctl-btn" onClick={p.onDelete} title="Cancelar y borrar" aria-label="Delete">
        <Trash2 size={16} />
      </button>
    </div>
  );
}

export function RecorderProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("closed");
  const [mode, setMode] = useState<Mode>("screen-cam");
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [upload, setUpload] = useState({ pct: 0, label: "" });
  const [pipWin, setPipWin] = useState<Window | null>(null);
  const [videoPip, setVideoPip] = useState(false);
  const [floatError, setFloatError] = useState<string | null>(null);
  const [nativeVisible, setNativeVisible] = useState(false); // burbuja de la app Boom Bubble
  const [nativeConnected, setNativeConnected] = useState(false);
  const [bubbleSize, setBubbleSize] = useState(1);
  const [bubblePos, setBubblePos] = useState<{ x: number; y: number } | null>(null);

  const micStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const displayRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const audioRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timeRef = useRef({ accum: 0, startedAt: 0, running: false });
  const thumbRef = useRef<Blob | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishRef = useRef<() => void>(() => {});
  const phaseRef = useRef<Phase>("closed");
  phaseRef.current = phase;
  const pipWinRef = useRef<Window | null>(null);
  pipWinRef.current = pipWin;
  const videoPipRef = useRef<HTMLVideoElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const pipLayoutRef = useRef<boolean | null>(null);
  const actionsRef = useRef({ pause: () => {}, resume: () => {}, restart: () => {}, cancel: () => {} });
  const nativeVisibleRef = useRef(false);
  nativeVisibleRef.current = nativeVisible;

  const showCam = mode !== "screen" && camOn;

  /* ---------- dispositivos ---------- */
  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setCams(all.filter((d) => d.kind === "videoinput" && d.deviceId));
    setMics(all.filter((d) => d.kind === "audioinput" && d.deviceId));
  }, []);

  const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

  const acquireCam = useCallback(async (deviceId?: string) => {
    stopStream(camStreamRef.current);
    camStreamRef.current = null;
    setCamStream(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
      camStreamRef.current = s;
      setCamStream(s);
      setCamId(s.getVideoTracks()[0]?.getSettings().deviceId ?? "");
      return true;
    } catch {
      setError("No pudimos acceder a la cámara. Revisá los permisos del navegador.");
      setCamOn(false);
      return false;
    }
  }, []);

  const acquireMic = useCallback(async (deviceId?: string) => {
    stopStream(micStreamRef.current);
    micStreamRef.current = null;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = s;
      setMicId(s.getAudioTracks()[0]?.getSettings().deviceId ?? "");
      return true;
    } catch {
      setError("No pudimos acceder al micrófono. Revisá los permisos del navegador.");
      setMicOn(false);
      return false;
    }
  }, []);

  // medidor de nivel de micrófono
  useEffect(() => {
    if (phase === "closed" || phase === "uploading" || !micOn) return;
    const s = micStreamRef.current;
    if (!s) return;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(s).connect(an);
    const buf = new Uint8Array(an.fftSize);
    let raf = 0;
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      setMicLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ctx.close();
    };
  }, [phase === "closed" || phase === "uploading", micOn, micId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- ventana flotante (Document Picture-in-Picture) ---------- */
  const closePip = useCallback(() => {
    pipWinRef.current?.close();
    pipWinRef.current = null;
    setPipWin(null);
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    setVideoPip(false);
  }, []);

  // Fallback: Picture-in-Picture nativo del <video> de la cámara (también flota sobre todas las apps)
  const openVideoPip = useCallback(async () => {
    const v = videoPipRef.current;
    if (!v || !document.pictureInPictureEnabled || document.pictureInPictureElement) return !!document.pictureInPictureElement;
    try {
      await v.requestPictureInPicture();
      setVideoPip(true);
      setFloatError(null);
      return true;
    } catch (e) {
      console.warn("[boom] video PiP falló", e);
      return false;
    }
  }, []);

  const openPip = useCallback(async (m: Mode, cam: boolean) => {
    const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: object): Promise<Window>; window: Window | null } })
      .documentPictureInPicture;
    const withCam = m !== "screen" && cam;
    if (!dpip) {
      if (withCam) await openVideoPip();
      return;
    }
    // si ya hay una ventana abierta con el mismo layout, se reutiliza
    if (pipWinRef.current && !pipWinRef.current.closed && pipLayoutRef.current === withCam) return;
    dpip.window?.close();
    try {
      const w = await dpip.requestWindow({ ...(withCam ? { width: 330, height: 260 } : { width: 120, height: 290 }), disallowReturnToOpener: true });
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const style = w.document.createElement("style");
          style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
          w.document.head.appendChild(style);
        } catch {
          if (sheet.href) {
            const link = w.document.createElement("link");
            link.rel = "stylesheet";
            link.href = sheet.href;
            w.document.head.appendChild(link);
          }
        }
      }
      w.document.title = "DRILL Recorder";
      w.document.body.className = document.body.className;
      w.addEventListener("pagehide", () => {
        if (pipWinRef.current === w) pipWinRef.current = null;
        setPipWin((cur) => (cur === w ? null : cur));
      });
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      pipWinRef.current = w;
      pipLayoutRef.current = withCam;
      setPipWin(w);
      setFloatError(null);
    } catch (e) {
      console.warn("[boom] Document PiP falló", e);
      if (!withCam || !(await openVideoPip())) {
        setFloatError(`No se pudo abrir la burbuja flotante (${(e as Error).name}). Se va a reintentar al empezar a grabar.`);
      }
    }
  }, [openVideoPip]);

  const camLabel = () => camStreamRef.current?.getVideoTracks()[0]?.label ?? "";

  const showFloating = useCallback(
    (m: Mode, cam: boolean) => {
      const withCam = m !== "screen" && cam;
      if (bubbleBridge.connected) {
        closePip();
        bubbleBridge.send(withCam ? { type: "show", camera: camLabel() } : { type: "hide" });
        return;
      }
      openPip(m, cam);
    },
    [closePip, openPip],
  );

  /* ---------- abrir / cerrar ---------- */
  const teardown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    stopStream(camStreamRef.current);
    stopStream(micStreamRef.current);
    stopStream(displayRef.current);
    camStreamRef.current = micStreamRef.current = displayRef.current = null;
    setCamStream(null);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    compositorRef.current?.stop();
    compositorRef.current = null;
    closePip();
    bubbleBridge.send({ type: "hide" });
  }, [closePip]);

  const open = useCallback(async () => {
    if (phaseRef.current !== "closed") return;
    const m = readRecordingMode();
    setMode(m);
    setError(null);
    setPhase("setup");
    // ¿está corriendo Boom Bubble? (localhost responde al instante; la activación del click sigue vigente)
    const native = await bubbleBridge.connect(500);
    setNativeConnected(native);
    if (!native) {
      openPip(m, true); // respaldo: ventana flotante con marco
      bubbleBridge.launchAndConnect(); // si la app está instalada, se abre y reemplaza a la ventana
    }
    const [camOk] = await Promise.all([m !== "screen" ? acquireCam() : Promise.resolve(false), acquireMic()]);
    setCamOn(m === "screen" ? true : camOk);
    if (bubbleBridge.connected && m !== "screen" && camOk) bubbleBridge.send({ type: "show", camera: camLabel() });
    refreshDevices();
  }, [acquireCam, acquireMic, openPip, refreshDevices]);

  const cancel = useCallback(() => {
    for (const r of [recRef.current, audioRecRef.current]) {
      if (r && r.state !== "inactive") {
        r.onstop = null;
        r.stop();
      }
    }
    recRef.current = audioRecRef.current = null;
    chunksRef.current = [];
    audioChunksRef.current = [];
    teardown();
    setPhase("closed");
  }, [teardown]);

  const changeMode = (m: Mode) => {
    setMode(m);
    saveRecordingMode(m);
    if (m !== "screen" && camOn && !camStreamRef.current) acquireCam(camId);
    if (m === "screen") {
      stopStream(camStreamRef.current);
      camStreamRef.current = null;
      setCamStream(null);
    }
    showFloating(m, camOn);
  };

  const toggleCam = () => {
    if (camOn) {
      stopStream(camStreamRef.current);
      camStreamRef.current = null;
      setCamStream(null);
      setCamOn(false);
      if (mode === "cam") setMode("screen");
      showFloating(mode === "cam" ? "screen" : mode, false);
    } else {
      setCamOn(true);
      acquireCam(camId).then((ok) => ok && bubbleBridge.connected && bubbleBridge.send({ type: "show", camera: camLabel() }));
      showFloating(mode, true);
    }
  };

  const toggleMic = () => {
    if (micOn) {
      stopStream(micStreamRef.current);
      micStreamRef.current = null;
      setMicOn(false);
    } else {
      setMicOn(true);
      acquireMic(micId);
    }
  };

  /* ---------- grabación ---------- */
  const needsBurnedBubble = () => {
    const surface = (displayRef.current?.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
    const floating = !!pipWinRef.current || !!document.pictureInPictureElement || nativeVisibleRef.current;
    return surface !== "monitor" || !floating;
  };

  useEffect(() => {
    compositorRef.current?.setBubble(needsBurnedBubble());
  }, [pipWin, videoPip, nativeVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  const tick = useCallback(() => {
    const t = timeRef.current;
    setElapsed(t.accum + (t.running ? performance.now() - t.startedAt : 0));
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const i = setInterval(tick, 250);
    return () => clearInterval(i);
  }, [phase, tick]);

  const beginRecording = useCallback(() => {
    const display = displayRef.current;
    const sources = [
      ...(micOn ? micStreamRef.current?.getAudioTracks() ?? [] : []),
      ...(display?.getAudioTracks() ?? []),
    ].filter((t) => t.readyState === "live");
    const hasAudio = sources.length > 0;
    // una sola fuente → pista directa; varias (mic + audio del sistema) → mezcla con WebAudio
    let audioTrack: MediaStreamTrack | null = sources[0] ?? null;
    if (sources.length > 1) {
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      ctx.resume().catch(() => {});
      const dest = ctx.createMediaStreamDestination();
      for (const t of sources) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
      audioTrack = dest.stream.getAudioTracks()[0];
    }
    const camTrack = camStreamRef.current?.getVideoTracks()[0];
    const screenTrack = display?.getVideoTracks()[0];
    let videoTrack = mode === "cam" ? camTrack : screenTrack;
    // Siempre se graba a través del compositor: dibuja la cámara dentro del video salvo cuando se graba
    // la pantalla completa con la burbuja flotante visible (ahí ya sale en la captura y quedaría duplicada).
    // Si la burbuja flotante se cierra en medio de la grabación, la cámara pasa a dibujarse en el video.
    if (mode === "screen-cam" && camOn && camTrack && screenTrack && canComposite()) {
      compositorRef.current ??= compositeCamera(screenTrack, camTrack, needsBurnedBubble());
      videoTrack = compositorRef.current.track;
    }
    if (!videoTrack) {
      setError("No hay fuente de video para grabar.");
      setPhase("setup");
      return;
    }
    const stream = new MediaStream([videoTrack, ...(audioTrack ? [audioTrack] : [])]);
    const mimeType = pickMime(hasAudio);
    const rec = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: mode === "cam" ? 2_000_000 : 2_500_000,
      audioBitsPerSecond: 128_000,
    });
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.start(1000);
    recRef.current = rec;

    audioChunksRef.current = [];
    audioRecRef.current = null;
    if (hasAudio && audioTrack) {
      const am = pickAudioMime();
      const ar = new MediaRecorder(new MediaStream([audioTrack]), { mimeType: am, audioBitsPerSecond: 32_000 });
      ar.ondataavailable = (e) => e.data.size && audioChunksRef.current.push(e.data);
      ar.start(1000);
      audioRecRef.current = ar;
    }

    timeRef.current = { accum: 0, startedAt: performance.now(), running: true };
    setElapsed(0);
    thumbRef.current = null;
    setTimeout(async () => {
      if (recRef.current === rec) thumbRef.current = await grabFrame(videoTrack);
    }, 1200);
    setPhase("recording");
  }, [micOn, mode, camOn]);

  const runCountdown = useCallback(() => {
    setPhase("countdown");
    setCount(COUNTDOWN_SECONDS);
    let n = COUNTDOWN_SECONDS;
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        beginRecording();
      } else setCount(n);
    }, 1000);
  }, [beginRecording]);

  const skipCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    beginRecording();
  };

  const start = async () => {
    setError(null);
    // se crea dentro del click para que no quede "suspended" por la política de autoplay
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    audioCtxRef.current.resume().catch(() => {});
    if (mode === "cam" && !camStreamRef.current) {
      setError("Activá la cámara para grabar en modo Cámara.");
      return;
    }
    // reintento de la burbuja flotante con la activación fresca de este click (antes de getDisplayMedia)
    if (showCam && !nativeVisibleRef.current && !pipWinRef.current && !document.pictureInPictureElement) openPip(mode, camOn);
    const displayPromise =
      mode !== "cam"
        ? navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "monitor", frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: true,
          selfBrowserSurface: "exclude",
          systemAudio: "include",
          surfaceSwitching: "include",
            monitorTypeSurfaces: "include",
          } as DisplayMediaStreamOptions)
        : null;
    if (displayPromise) {
      try {
        const display = await displayPromise;
        displayRef.current = display;
        display.getVideoTracks()[0].addEventListener("ended", () => {
          if (phaseRef.current === "recording" || phaseRef.current === "paused") finishRef.current();
          else if (phaseRef.current === "countdown") cancel();
        });
      } catch {
        setError("No se eligió ninguna pantalla para grabar.");
        return;
      }
    }
    runCountdown();
  };

  const pause = () => {
    recRef.current?.pause();
    audioRecRef.current?.pause();
    const t = timeRef.current;
    t.accum += performance.now() - t.startedAt;
    t.running = false;
    tick();
    setPhase("paused");
  };

  const resume = () => {
    recRef.current?.resume();
    audioRecRef.current?.resume();
    timeRef.current.startedAt = performance.now();
    timeRef.current.running = true;
    setPhase("recording");
  };

  const restart = () => {
    for (const r of [recRef.current, audioRecRef.current]) {
      if (r && r.state !== "inactive") {
        r.onstop = null;
        r.stop();
      }
    }
    recRef.current = audioRecRef.current = null;
    chunksRef.current = [];
    audioChunksRef.current = [];
    runCountdown();
  };

  const finish = async () => {
    const rec = recRef.current;
    if (!rec) return;
    const t = timeRef.current;
    const durationMs = Math.round(t.accum + (t.running ? performance.now() - t.startedAt : 0));
    t.running = false;
    const stopRec = (r: MediaRecorder | null) =>
      new Promise<void>((res) => {
        if (!r || r.state === "inactive") return res();
        r.onstop = () => res();
        r.stop();
      });
    const vt = (mode === "cam" ? camStreamRef.current : displayRef.current)?.getVideoTracks()[0];
    const settings = vt?.getSettings();
    setPhase("uploading");
    setUpload({ pct: 0, label: "Preparando tu video…" });
    await Promise.all([stopRec(rec), stopRec(audioRecRef.current)]);
    recRef.current = null;
    const mime = (rec.mimeType || "video/webm").split(";")[0];
    const blob = new Blob(chunksRef.current, { type: mime });
    const audioBlob = audioChunksRef.current.length
      ? new Blob(audioChunksRef.current, { type: (audioRecRef.current?.mimeType || "audio/webm").split(";")[0] })
      : null;
    audioRecRef.current = null;
    teardown();
    try {
      window.focus();
    } catch {}

    try {
      const thumb = thumbRef.current ?? (await thumbFromBlob(blob));
      const parts = Math.max(1, Math.ceil(blob.size / PART_SIZE));
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Grabación · ${new Date().toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}`,
          mimeType: mime,
          parts, sizeBytes: blob.size, durationMs, width: settings?.width, height: settings?.height }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { id, uploads, thumb: thumbUpload } = (await res.json()) as {
        id: string;
        uploads: { signedUrl: string }[];
        thumb: { signedUrl: string };
      };
      const shareUrl = `${location.origin}/share/${id}`;
      navigator.clipboard?.writeText(shareUrl).catch(() => {});
      setUpload({ pct: 0, label: "Subiendo video…" });
      let done = 0;
      for (let i = 0; i < parts; i++) {
        const slice = blob.slice(i * PART_SIZE, (i + 1) * PART_SIZE, mime);
        await putWithProgress(uploads[i].signedUrl, slice, mime, (loaded) =>
          setUpload({ pct: Math.round(((done + loaded) / blob.size) * 100), label: "Subiendo video…" }),
        );
        done += slice.size;
      }
      let hasThumbnail = false;
      if (thumb) {
        await putWithProgress(thumbUpload.signedUrl, thumb, "image/jpeg", () => {})
          .then(() => (hasThumbnail = true))
          .catch(() => {});
      }
      await fetch(`/api/videos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ready", hasThumbnail }),
      });
      if (audioBlob && audioBlob.size > 2000) {
        const fd = new FormData();
        fd.append("audio", audioBlob, "audio");
        fetch(`/api/videos/${id}/transcribe`, { method: "POST", body: fd }).catch(() => {});
      }
      setUpload({ pct: 100, label: "¡Listo!" });
      router.push(`/share/${id}?new=1`);
      setTimeout(() => setPhase("closed"), 400);
    } catch (e) {
      setUpload({ pct: 0, label: `Error al subir: ${(e as Error).message}` });
      setTimeout(() => setPhase("closed"), 5000);
    }
  };
  finishRef.current = finish;
  actionsRef.current = { pause, resume, restart, cancel };

  // Boom Bubble: visibilidad, controles y reconexión
  useEffect(() => {
    const off = bubbleBridge.on((m) => {
      if (m.type === "connected") {
        setNativeConnected(true);
        const ph = phaseRef.current;
        if (ph !== "closed" && ph !== "uploading" && camStreamRef.current) {
          closePip();
          bubbleBridge.send({ type: "show", camera: camLabel() });
        }
      } else if (m.type === "disconnected") {
        setNativeConnected(false);
        setNativeVisible(false);
      } else if (m.type === "visible") {
        setNativeVisible(m.visible);
      } else if (m.type === "hello" && typeof m.size === "number") {
        setBubbleSize(m.size);
      } else if (m.type === "size") {
        setBubbleSize(m.index);
      } else if (m.type === "action") {
        const ph = phaseRef.current;
        if (m.action === "stop" && (ph === "recording" || ph === "paused")) finishRef.current();
        if (m.action === "pause" && ph === "recording") actionsRef.current.pause();
        if (m.action === "resume" && ph === "paused") actionsRef.current.resume();
        if (m.action === "restart" && (ph === "recording" || ph === "paused")) actionsRef.current.restart();
        if (m.action === "delete") actionsRef.current.cancel();
      }
    });
    return () => {
      off();
    };
  }, [closePip]);

  const elapsedSec = Math.floor(elapsed / 1000);
  useEffect(() => {
    bubbleBridge.send({ type: "state", phase: phase === "closed" ? "idle" : phase, elapsedMs: elapsedSec * 1000, count });
  }, [phase, elapsedSec, count]);

  // atajos estilo Loom: ⌥⇧L iniciar/terminar, ⌥⇧P pausar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey) return;
      if (e.code === "KeyL") {
        e.preventDefault();
        if (phaseRef.current === "closed") open();
        else if (phaseRef.current === "recording" || phaseRef.current === "paused") finishRef.current();
      }
      if (e.code === "KeyP") {
        e.preventDefault();
        if (phaseRef.current === "recording") pause();
        else if (phaseRef.current === "paused") resume();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const ms = navigator.mediaSession as MediaSession & { setActionHandler(a: string, h: (() => void) | null): void };
    try {
      ms.setActionHandler("hangup", () => finishRef.current());
    } catch {}
    return () => {
      try {
        ms.setActionHandler("hangup", null);
      } catch {}
    };
  }, [phase]);

  useEffect(() => {
    if (phase === "closed" || phase === "setup") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  /* ---------- burbuja arrastrable (en la página) ---------- */
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  // un solo tamaño para las dos burbujas (la de la página y la de Boom Bubble)
  const pickSize = (i: number) => {
    setBubbleSize(i);
    bubbleBridge.send({ type: "size", index: i });
  };
  const size = BUBBLE_SIZES[bubbleSize];
  const pos = bubblePos ?? { x: 24, y: typeof window !== "undefined" ? window.innerHeight - size - 24 : 400 };
  const onBubbleDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };
  const onBubbleMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setBubblePos({
      x: Math.max(8, Math.min(window.innerWidth - size - 8, e.clientX - dragRef.current.dx)),
      y: Math.max(8, Math.min(window.innerHeight - size - 8, e.clientY - dragRef.current.dy)),
    });
  };

  const live = phase === "countdown" || phase === "recording" || phase === "paused";
  const controlProps = { phase, elapsed, count, onStop: finish, onPause: pause, onResume: resume, onRestart: restart, onDelete: cancel };
  const bars = 10;

  return (
    <RecorderCtx.Provider value={{ open }}>
      {children}

      {phase === "setup" && (
        <div className="rec-panel" role="dialog" aria-label="Grabadora de DRILL">
          <div className="rec-head">
            <Logo size={26} />
            <span className="spacer" />
            <button className="icon-btn" onClick={cancel} aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>
          <div className="modes">
            {(
              [
                ["screen-cam", "Pantalla + Cám", [Monitor, User]],
                ["screen", "Pantalla", [Monitor]],
                ["cam", "Cámara", [User]],
              ] as const
            ).map(([m, label, icons]) => (
              <button key={m} className={`mode ${mode === m ? "active" : ""}`} onClick={() => changeMode(m)}>
                <span className="mode-icons">
                  {icons.map((I, i) => (
                    <I key={i} size={i ? 13 : 18} />
                  ))}
                </span>
                {label}
              </button>
            ))}
          </div>
          {mode !== "screen" && (
            <div className={`dev-row ${camOn ? "" : "off"}`}>
              {camOn ? <Camera size={18} /> : <CameraOff size={18} />}
              <select
                value={camId}
                disabled={!camOn}
                onChange={(e) => {
                  setCamId(e.target.value);
                  acquireCam(e.target.value);
                }}
                aria-label="Cámara"
              >
                {cams.length === 0 && <option value="">Cámara</option>}
                {cams.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || "Cámara"}
                  </option>
                ))}
              </select>
              <button className={`pill-toggle ${camOn ? "" : "off"}`} onClick={toggleCam}>
                {camOn ? "On" : "Off"}
              </button>
            </div>
          )}
          <div className={`dev-row ${micOn ? "" : "off"}`}>
            {micOn ? <Mic size={18} /> : <MicOff size={18} />}
            <select
              value={micId}
              disabled={!micOn}
              onChange={(e) => {
                setMicId(e.target.value);
                acquireMic(e.target.value);
              }}
              aria-label="Micrófono"
            >
              {mics.length === 0 && <option value="">Micrófono</option>}
              {mics.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || "Micrófono"}
                </option>
              ))}
            </select>
            {micOn && (
              <span className="meter" aria-hidden>
                {Array.from({ length: 5 }, (_, i) => (
                  <i key={i} className={micLevel * bars > i * 2 ? "lit" : ""} style={{ height: 5 + i * 2.6 }} />
                ))}
              </span>
            )}
            <button className={`pill-toggle ${micOn ? "" : "off"}`} onClick={toggleMic}>
              {micOn ? "On" : "Off"}
            </button>
          </div>
          {mode !== "screen" && camOn && (
            <div className="size-row">
              <span>Tamaño de cámara</span>
              <div className="size-pick" role="radiogroup" aria-label="Tamaño de cámara">
                {BUBBLE_SIZES.map((s, i) => (
                  <button key={s} role="radio" aria-checked={i === bubbleSize} className={i === bubbleSize ? "sel" : ""} onClick={() => pickSize(i)} aria-label={["Chica", "Mediana", "Grande"][i]}>
                    <span style={{ width: 6 + i * 3, height: 6 + i * 3 }} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <button className="btn btn-primary rec-start" onClick={start}>
            Empezar a grabar
          </button>
          {error && <div className="rec-error">{error}</div>}
          {floatError && !error && !nativeConnected && <div className="rec-error">{floatError}</div>}
          {mode !== "screen" && (
            <p className="rec-hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="rec-dot" style={{ background: nativeConnected ? "var(--primary)" : "var(--grey4)", animation: nativeConnected ? undefined : "none" }} />
              {nativeConnected ? "Burbuja de escritorio activa (Boom Bubble)" : "Burbuja en ventana — abrí Boom Bubble para el círculo sin marco"}
            </p>
          )}
          {mode === "screen-cam" && (
            <p className="rec-hint">
              Tip: elegí <b>Pantalla completa</b> para que tu burbuja de cámara quede en el video. Atajo: <kbd>⌥</kbd>
              <kbd>⇧</kbd>
              <kbd>L</kbd>
            </p>
          )}
        </div>
      )}

      {/* burbuja de cámara en la página (si no hay ventana flotante) */}
      {/* <video> oculto que alimenta el PiP nativo (fallback) */}
      {camStream && phase !== "closed" && phase !== "uploading" && (
        <div style={{ position: "fixed", left: 0, top: 0, width: 2, height: 2, opacity: 0, pointerEvents: "none", overflow: "hidden" }} aria-hidden>
          <video
            ref={(el) => {
              (videoPipRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
              if (el && el.srcObject !== camStream) {
                el.srcObject = camStream;
                el.play().catch(() => {});
                el.onleavepictureinpicture = () => setVideoPip(false);
              }
            }}
            muted
            playsInline
            autoPlay
          />
        </div>
      )}

      {!pipWin && !videoPip && !nativeVisible && showCam && camStream && (phase === "setup" || live) && (
        <div
          className="bubble"
          style={{ left: pos.x, top: pos.y, width: size, height: size }}
          onPointerDown={onBubbleDown}
          onPointerMove={onBubbleMove}
          onPointerUp={() => (dragRef.current = null)}
        >
          <CamVideo stream={camStream} />
          <div className="bubble-sizes">
            {BUBBLE_SIZES.map((s, i) => (
              <button key={s} className={i === bubbleSize ? "sel" : ""} onClick={() => pickSize(i)} aria-label={`Tamaño ${i + 1}`}>
                <span style={{ width: 6 + i * 3, height: 6 + i * 3, borderRadius: "50%", background: "#fff", display: "block" }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {!pipWin && !nativeVisible && live && <ControlBar {...controlProps} />}

      {phase === "countdown" && (
        <div className="countdown">
          <div className="countdown-card">
            <div className="countdown-heading">
              <LogoMark size={22} />
              <span>Grabación en</span>
            </div>
            <div className="countdown-readout" role="timer" aria-label={`${count} segundos para grabar`}>
              <span key={count} className="countdown-num" aria-hidden="true">
                {String(count).padStart(2, "0")}
              </span>
            </div>
            <div className="countdown-progress" aria-hidden="true">
              {Array.from({ length: COUNTDOWN_SECONDS }, (_, index) => {
                const second = COUNTDOWN_SECONDS - index;
                return <span key={second} data-state={count < second ? "done" : count === second ? "active" : "waiting"} />;
              })}
            </div>
            <button type="button" className="countdown-skip" onClick={skipCountdown}>
              Grabar ahora
            </button>
          </div>
        </div>
      )}

      {phase === "uploading" && (
        <div className="upload-overlay">
          <div className="upload-card">
            <span className="burst">
              <LogoMark size={44} />
            </span>
            <h3>{upload.pct >= 100 ? "¡Tu video está listo!" : "Creando tu video"}</h3>
            <p>{upload.label}</p>
            <div className="progress">
              <i style={{ width: `${Math.max(4, upload.pct)}%` }} />
            </div>
          </div>
        </div>
      )}

      {pipWin &&
        phase !== "closed" &&
        createPortal(
          <div className="pip-root" style={showCam ? undefined : { flexDirection: "column", justifyContent: "center" }}>
            {live ? (
              <ControlBar {...controlProps} />
            ) : (
              !showCam && (
                <div className="pip-status">
                  <LogoMark size={36} />
                  <div style={{ marginTop: 8 }}>{phase === "uploading" ? "Subiendo…" : "Listo"}</div>
                </div>
              )
            )}
            {showCam && (
              <div className="pip-bubble">
                <CamVideo stream={camStream} />
                {phase === "countdown" && (
                  <button type="button" className="pip-count" aria-label="Grabar ahora" onClick={skipCountdown}>
                    <span key={count} className="countdown-num">
                      {String(count).padStart(2, "0")}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>,
          pipWin.document.body,
        )}
    </RecorderCtx.Provider>
  );
}

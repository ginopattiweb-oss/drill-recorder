"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Captions,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatTime } from "@/lib/format";
import type { Chapter, TranscriptSegment } from "@/lib/supabase";

export type PlayerHandle = { seek: (t: number) => void; time: () => number; play: () => void; el: () => HTMLDivElement | null };

const SPEEDS = [0.8, 1, 1.2, 1.5, 1.7, 2, 2.5];

export function Player(props: {
  ref?: React.Ref<PlayerHandle>;
  urls: string[];
  mime: string;
  durationMs: number;
  poster: string | null;
  transcript: TranscriptSegment[] | null;
  chapters: Chapter[] | null;
  reactions: { emoji: string; timestamp_ms: number; id: string }[];
  onTime?: (t: number) => void;
  onTheatre?: () => void;
  onFirstPlay?: () => void;
}) {
  const { urls, mime, durationMs, poster, transcript, chapters, reactions, onTime, onTheatre, onFirstPlay } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(urls.length === 1 ? urls[0] : null);
  const [loadPct, setLoadPct] = useState(0);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(durationMs / 1000);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [menu, setMenu] = useState<null | "speed">(null);
  const [cc, setCc] = useState(true);
  const [idle, setIdle] = useState(false);
  const [fs, setFs] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [flash, setFlash] = useState<{ key: number; icon: "play" | "pause" | "back" | "fwd" } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPlayed = useRef(false);

  // videos de varias partes (>45MB): se bajan y se unen en un Blob
  useEffect(() => {
    if (urls.length <= 1) return;
    let cancelled = false;
    let objectUrl = "";
    (async () => {
      const blobs: Blob[] = [];
      for (let i = 0; i < urls.length; i++) {
        const r = await fetch(urls[i]);
        blobs.push(await r.blob());
        if (!cancelled) setLoadPct(Math.round(((i + 1) / urls.length) * 100));
      }
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob(blobs, { type: mime }));
      setSrc(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [urls, mime]);

  const v = () => videoRef.current;

  const doFlash = (icon: "play" | "pause" | "back" | "fwd") => setFlash({ key: Date.now(), icon });

  const play = useCallback(() => {
    const el = v();
    if (!el) return;
    setStarted(true);
    el.play().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    const el = v();
    if (!el) return;
    if (el.paused) {
      play();
      doFlash("play");
    } else {
      el.pause();
      doFlash("pause");
    }
  }, [play]);

  const seek = useCallback(
    (time: number) => {
      const el = v();
      if (!el) return;
      const max = Number.isFinite(el.duration) ? el.duration : dur;
      el.currentTime = Math.max(0, Math.min(max - 0.05, time));
      setT(el.currentTime);
      setStarted(true);
    },
    [dur],
  );

  useImperativeHandle(props.ref, () => ({ seek, time: () => v()?.currentTime ?? 0, play, el: () => wrapRef.current }), [seek, play]);

  const skip = useCallback(
    (d: number) => {
      seek((v()?.currentTime ?? 0) + d);
      doFlash(d < 0 ? "back" : "fwd");
    },
    [seek],
  );

  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrapRef.current?.requestFullscreen();
  }, []);

  const setRate = useCallback((s: number) => {
    setSpeed(s);
    if (v()) v()!.playbackRate = s;
  }, []);

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // atajos de teclado del player de Loom
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") {
        e.preventDefault();
        toggle();
      } else if (k === "j" || e.key === "ArrowLeft") skip(-5);
      else if (k === "l" || e.key === "ArrowRight") skip(5);
      else if (k === "m") setMuted((m) => !m);
      else if (k === "f") toggleFs();
      else if (k === "a") setCc((c) => !c);
      else if (k === "t") onTheatre?.();
      else if (k === "s") setRate(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
      else return;
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (v()) {
      v()!.muted = muted;
      v()!.volume = volume;
    }
  }, [muted, volume]);

  const poke = () => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (v() && !v()!.paused && !menu) setIdle(true);
    }, 2600);
  };

  const effDur = Number.isFinite(dur) && dur > 0 ? dur : durationMs / 1000;
  const pct = effDur ? Math.min(100, (t / effDur) * 100) : 0;

  // segmentos del scrubber según capítulos
  const segs =
    chapters && chapters.length > 1
      ? chapters.map((c, i) => ({ start: c.start, end: chapters[i + 1]?.start ?? effDur, title: c.title }))
      : [{ start: 0, end: effDur, title: "" }];

  const timeFromEvent = (e: React.PointerEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    return { x, t: (x / r.width) * effDur };
  };

  const scrubbing = useRef(false);
  const caption = cc && transcript ? transcript.find((s) => t >= s.start && t <= s.end + 0.3)?.text : null;
  const hoverChapter = hover ? segs.find((s) => hover.t >= s.start && hover.t < s.end)?.title : null;

  return (
    <div
      ref={wrapRef}
      className={`player ${idle && playing ? "idle" : ""}`}
      onMouseMove={poke}
      onMouseLeave={() => playing && setIdle(true)}
      style={fs ? { borderRadius: 0 } : undefined}
    >
      <video
        ref={videoRef}
        src={src ?? undefined}
        playsInline
        preload="metadata"
        poster={poster ?? undefined}
        onClick={toggle}
        onDoubleClick={toggleFs}
        onPlay={() => {
          setPlaying(true);
          poke();
          if (!firstPlayed.current) {
            firstPlayed.current = true;
            onFirstPlay?.();
          }
        }}
        onPause={() => {
          setPlaying(false);
          setIdle(false);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(e) => {
          const ct = e.currentTarget.currentTime;
          if (!scrubbing.current) setT(ct);
          onTime?.(ct);
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onEnded={() => setIdle(false)}
      />

      {!started && (
        <div className="player-poster" style={poster ? { backgroundImage: `url(${poster})` } : undefined} onClick={toggle}>
          <div className="big-play">
            <span className="big-play-circle">
              <Play size={36} fill="#fff" color="#fff" style={{ marginLeft: 4 }} />
            </span>
            <span className="big-play-time">{formatTime(effDur)}</span>
          </div>
        </div>
      )}

      {(!src || (waiting && started)) && (
        <div className="player-loading" style={!src ? undefined : { background: "transparent" }}>
          <div style={{ display: "grid", justifyItems: "center", gap: 10 }}>
            <div className="spinner" />
            {!src && <span>Cargando video… {loadPct}%</span>}
          </div>
        </div>
      )}

      {flash && (
        <div key={flash.key} className="flash">
          {flash.icon === "play" && <Play size={30} fill="#fff" />}
          {flash.icon === "pause" && <Pause size={30} fill="#fff" />}
          {flash.icon === "back" && <RotateCcw size={28} />}
          {flash.icon === "fwd" && <RotateCw size={28} />}
        </div>
      )}

      {caption && started && (
        <div className="captions">
          <span>{caption}</span>
        </div>
      )}

      <div className="controls" onClick={(e) => e.stopPropagation()}>
        <div
          className="scrub"
          onPointerDown={(e) => {
            scrubbing.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const p = timeFromEvent(e);
            setT(p.t);
          }}
          onPointerMove={(e) => {
            const p = timeFromEvent(e);
            setHover(p);
            if (scrubbing.current) setT(p.t);
          }}
          onPointerUp={(e) => {
            scrubbing.current = false;
            seek(timeFromEvent(e).t);
          }}
          onPointerLeave={() => setHover(null)}
        >
          <div className="scrub-track">
            {segs.map((s, i) => {
              const w = ((s.end - s.start) / effDur) * 100;
              const fill = Math.max(0, Math.min(1, (t - s.start) / (s.end - s.start)));
              const buf = Math.max(0, Math.min(1, (buffered - s.start) / (s.end - s.start)));
              return (
                <div key={i} className="scrub-seg" style={{ width: `${w}%` }}>
                  <div className="buf" style={{ width: `${buf * 100}%` }} />
                  <div className="fill" style={{ width: `${fill * 100}%` }} />
                </div>
              );
            })}
          </div>
          <div className="scrub-knob" style={{ left: `${pct}%` }} />
          {reactions.map((r) => (
            <span key={r.id} className="reaction-marker" style={{ left: `${Math.min(100, (r.timestamp_ms / 1000 / effDur) * 100)}%` }}>
              {r.emoji}
            </span>
          ))}
          {hover && (
            <div className="scrub-tip" style={{ left: hover.x }}>
              {formatTime(hover.t)}
              {hoverChapter && <small>{hoverChapter}</small>}
            </div>
          )}
        </div>

        <div className="ctrl-row">
          <button className="cbtn playbtn" onClick={toggle} aria-label={playing ? "Pause, keyboard shortcut K" : "Play, keyboard shortcut K"}>
            {playing ? <Pause size={18} fill="#fff" /> : <Play size={18} fill="#fff" />}
          </button>
          <button className="cbtn" onClick={() => skip(-5)} aria-label="Step backward, keyboard shortcut J">
            <RotateCcw size={18} />
          </button>
          <button className="cbtn" onClick={() => skip(5)} aria-label="Step forward, keyboard shortcut L">
            <RotateCw size={18} />
          </button>
          <div className="vol">
            <button className="cbtn" onClick={() => setMuted((m) => !m)} aria-label="Mute, keyboard shortcut M">
              {muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
            <input
              className="vol-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuted(Number(e.target.value) === 0);
              }}
              aria-label="Volume"
            />
          </div>
          <div className="grow">
            {formatTime(t)} / {formatTime(effDur)}
          </div>
          {transcript && transcript.length > 0 && (
            <button className={`cbtn ${cc ? "on" : ""}`} onClick={() => setCc((c) => !c)} aria-label="Closed captions, keyboard shortcut A">
              <Captions size={20} />
            </button>
          )}
          <button className="cbtn" onClick={() => setMenu(menu === "speed" ? null : "speed")} aria-label="Playback Speed, keyboard shortcut S">
            {speed}×
          </button>
          {onTheatre && !fs && (
            <button className="cbtn" onClick={onTheatre} aria-label="Theatre mode, keyboard shortcut T">
              <RectangleHorizontal size={19} />
            </button>
          )}
          <button
            className="cbtn"
            onClick={() => v()?.requestPictureInPicture?.().catch(() => {})}
            aria-label="Minimize Player"
          >
            <PictureInPicture2 size={18} />
          </button>
          <button className="cbtn" onClick={toggleFs} aria-label="Full screen, keyboard shortcut F">
            {fs ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>

        {menu === "speed" && (
          <div className="menu">
            <div className="menu-title">Velocidad</div>
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={s === speed ? "sel" : ""}
                onClick={() => {
                  setRate(s);
                  setMenu(null);
                }}
              >
                {s}×{s === speed && <span>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Video } from "lucide-react";
import { useRecorder } from "./Recorder";
import { LogoMark } from "./Logo";

export function RecordButton({ label = "Nuevo video", size = "", href }: { label?: string; size?: string; href?: string }) {
  const { open } = useRecorder();
  const inner = (
    <>
      <Video size={18} />
      {label}
    </>
  );
  return href ? (
    <Link className={`btn btn-primary ${size}`} href={href}>
      {inner}
    </Link>
  ) : (
    <button className={`btn btn-primary ${size}`} onClick={open}>
      {inner}
    </button>
  );
}

export function RecordFab({ href }: { href?: string }) {
  const { open } = useRecorder();
  const inner = (
    <>
      <LogoMark size={22} />
      Grabar un video
    </>
  );
  return href ? (
    <Link className="fab" href={href}>
      {inner}
    </Link>
  ) : (
    <button className="fab" onClick={open}>
      {inner}
    </button>
  );
}

import { NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { partPath } from "@/lib/supabase";
import { store } from "@/lib/store";

const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 20);

export async function GET() {
  try {
    return NextResponse.json(await store.listVideos());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Crea el registro del video y devuelve URLs de subida para que el navegador suba directo
// (URLs firmadas de Supabase Storage, o el endpoint local /api/upload si no hay Supabase).
export async function POST(req: Request) {
  const body = await req.json();
  const mime = String(body.mimeType || "video/webm");
  const parts = Math.max(1, Math.min(200, Number(body.parts) || 1));
  const id = newId();

  try {
    await store.createVideo({
      id,
      title: body.title || `Grabación · ${new Date().toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}`,
      status: "uploading",
      mime_type: mime,
      parts,
      size_bytes: Number(body.sizeBytes) || 0,
      duration_ms: Math.round(Number(body.durationMs) || 0),
      width: body.width ?? null,
      height: body.height ?? null,
    });
    const paths = Array.from({ length: parts }, (_, i) => partPath(id, i, mime));
    paths.push(`${id}/thumb.jpg`);
    const uploads = await store.createUploads(paths);
    const thumb = uploads.pop()!;
    return NextResponse.json({ id, uploads, thumb });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

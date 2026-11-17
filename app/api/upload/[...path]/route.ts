import { NextResponse } from "next/server";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { localFilePath, store } from "@/lib/store";
import { hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

// Subida local (modo sin Supabase): reemplaza a las URLs firmadas de Supabase Storage.
// Solo el dueño puede subir (middleware.ts). El navegador hace PUT directo desde la grabadora.
export async function PUT(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (hasSupabase()) return NextResponse.json({ error: "local storage disabled" }, { status: 404 });
  const rel = (await params).path.join("/");
  const file = localFilePath(rel);
  if (!file || !req.body) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (!(await store.getVideo(rel.split("/")[0]))) return NextResponse.json({ error: "unknown video" }, { status: 404 });

  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.part`;
  try {
    await pipeline(Readable.fromWeb(req.body as never), createWriteStream(tmp));
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

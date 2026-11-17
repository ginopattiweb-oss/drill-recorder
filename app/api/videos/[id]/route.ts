import { NextResponse } from "next/server";
import { store } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const [video, comments, reactions] = await Promise.all([store.getVideo(id), store.getComments(id), store.getReactions(id)]);
  if (!video) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ video, comments, reactions });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
  if (["uploading", "ready", "error"].includes(body.status)) patch.status = body.status;
  if (typeof body.hasThumbnail === "boolean") patch.has_thumbnail = body.hasThumbnail;
  try {
    const data = await store.updateVideo(id, patch);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await store.deleteVideo(id);
  return NextResponse.json({ ok: true });
}

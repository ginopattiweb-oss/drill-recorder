import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ views: await store.incrementViews(id) });
}

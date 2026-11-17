import { Library } from "@/components/Library";
import { thumbUrl } from "@/lib/supabase";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await store.listVideos();
  const videos = data.map((v) => ({
    id: v.id,
    title: v.title,
    duration_ms: v.duration_ms,
    views: v.views,
    created_at: v.created_at,
    author_name: v.author_name,
    status: v.status,
    thumb: thumbUrl(v),
  }));
  return <Library videos={videos} storage={store.mode()} aiEnabled={Boolean(process.env.GROQ_API_KEY)} />;
}

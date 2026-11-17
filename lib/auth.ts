import { INSTALLATION_NAMESPACE, recorderPassword } from "@/lib/deployment";

export const OWNER_COOKIE = `${INSTALLATION_NAMESPACE}_owner`;

// Token de sesión del dueño: sha256 de la contraseña (funciona en edge y node).
export async function ownerToken() {
  const pw = recorderPassword();
  if (!pw) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${INSTALLATION_NAMESPACE}:${pw}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isOwnerToken(value: string | undefined) {
  const t = await ownerToken();
  return t === null ? process.env.VERCEL_ENV !== "production" : value === t;
}

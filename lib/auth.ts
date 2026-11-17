export const OWNER_COOKIE = "boom_owner";

// Token de sesión del dueño: sha256 de la contraseña (funciona en edge y node).
export async function ownerToken() {
  const pw = process.env.BOOM_PASSWORD;
  if (!pw) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`boom:${pw}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isOwnerToken(value: string | undefined) {
  const t = await ownerToken();
  return t === null || value === t; // sin BOOM_PASSWORD configurada → todo abierto (dev)
}

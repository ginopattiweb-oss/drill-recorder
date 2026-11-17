// Prepara el entorno la primera vez y (con --doctor) muestra qué está activo y qué falta.
// Se ejecuta solo antes de `npm run dev`. Nunca imprime valores de claves.
import { copyFileSync, existsSync, readFileSync } from "node:fs";

const doctor = process.argv.includes("--doctor");

if (!existsSync(".env.local") && existsSync(".env.example")) {
  copyFileSync(".env.example", ".env.local");
  console.log("✓ Creé .env.local desde .env.example (todo vacío: funciona en modo local).");
}

const env = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim();
  }
}
const has = (k) => Boolean(env[k] || process.env[k]);

const major = Number(process.versions.node.split(".")[0]);
const supabase = has("SUPABASE_URL") && has("SUPABASE_SERVICE_KEY");
const namespace = env.RECORDER_INSTALLATION_NAMESPACE || process.env.RECORDER_INSTALLATION_NAMESPACE || "drill";
const rows = [
  [major >= 20, `Node ${process.versions.node}`, "Necesitas Node 20 o superior (nodejs.org)."],
  [true, supabase ? "Almacenamiento: Supabase (producción)" : "Almacenamiento: local (carpeta .data/)", null],
  [has("GROQ_API_KEY"), "IA (transcripción, resumen, capítulos): Groq", "Falta GROQ_API_KEY → agrégala en .env.local (gratis en console.groq.com)."],
  [has("RECORDER_PASSWORD") || has(`${namespace.toUpperCase()}_PASSWORD`), "Contraseña del dueño", "Sin RECORDER_PASSWORD la biblioteca queda abierta. Está bien en localhost; pónla si despliegas."],
];

if (doctor) {
  console.log("\nEstado de DRILL Recorder:\n");
  for (const [ok, label, hint] of rows) console.log(`${ok ? "✓" : "•"} ${label}${!ok && hint ? `\n    ${hint}` : ""}`);
  console.log("\nAbre http://localhost:3030 con Chrome o Edge (la grabadora necesita permisos de pantalla y cámara).\n");
} else if (!has("GROQ_API_KEY")) {
  console.log("ℹ Falta GROQ_API_KEY: DRILL Recorder funciona, pero sin transcripción/resumen con IA. Ver `npm run doctor`.");
}

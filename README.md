# DRILL Recorder

Graba tu pantalla y tu cámara, y comparte el video con un link. Player estilo Loom con reacciones, comentarios con timestamp, transcripción, capítulos y resumen con IA.

**Funciona en tu computadora sin cuentas ni claves.**

## Empezar (1 minuto)

Requisitos: Node 20+ y Chrome o Edge.

```bash
npm install
npm run dev
```

Abre http://localhost:3030 y pulsa **Nuevo video**.

Con Claude Code: abre esta carpeta, y Claude lee `CLAUDE.md`, instala, arranca y te pide solo lo que falte.

## Qué activar (todo opcional, en `.env.local`)

| Función | Variable |
|---|---|
| Transcripción, resumen y capítulos con IA (gratis) | `GROQ_API_KEY` (console.groq.com) |
| Compartir en internet | `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` y ejecutar `supabase/schema.sql` |
| Proteger tu biblioteca | `RECORDER_PASSWORD` |
| Tu nombre en la interfaz | `NEXT_PUBLIC_RECORDER_OWNER_NAME` |

Sin `GROQ_API_KEY` verás el aviso "Falta GROQ_API_KEY" y todo lo demás funciona. `npm run doctor` te dice qué está activo.

## Burbuja de cámara (macOS, opcional)

`bash desktop/DrillBubble/build.sh` instala una app que muestra tu cámara en un círculo siempre visible. En otros sistemas la web usa Picture-in-Picture de Chrome/Edge.

## Seguridad

Nunca subas `.env.local` ni la carpeta `.data/` (ya están en `.gitignore`). Si lo publicas en internet, usa Supabase y define `RECORDER_PASSWORD`.

En una instalación existente, conservá su namespace de almacenamiento con `RECORDER_INSTALLATION_NAMESPACE` antes de publicar.

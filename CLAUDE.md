# CLAUDE.md — DRILL Recorder (plantilla tipo Loom)

DRILL Recorder graba pantalla + cámara + micrófono, sube el video y lo comparte por link con un player estilo Loom (reacciones, comentarios con timestamp, transcripción, capítulos y resumen con IA). **Funciona en localhost sin ninguna clave.**

## Qué hacer al abrir este proyecto (hazlo tú, sin preguntar)

1. Si no existe `node_modules/`, ejecuta `npm install` (requiere Node 20+; si falta, dile al usuario que lo instale desde nodejs.org).
2. Ejecuta `npm run dev` (en segundo plano). Crea `.env.local` solo la primera vez y arranca en **http://localhost:3030**.
3. Ejecuta `npm run doctor` y resume al usuario en pocas líneas qué está activo y qué falta.
4. Abre http://localhost:3030 en el navegador. La grabadora requiere **Chrome o Edge** y dar permisos de pantalla, cámara y micrófono.
5. Pide al usuario **solo** lo que falte y que él quiera activar (ver "Qué necesita del usuario"). No bloquees nada esperando claves.

## Qué necesita del usuario (todo opcional)

| Para qué | Variable en `.env.local` | Cómo conseguirla |
|---|---|---|
| Transcripción, título, resumen y capítulos con IA | `GROQ_API_KEY` | console.groq.com → API Keys (gratis) |
| Compartir en internet (videos en la nube) | `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | supabase.com → proyecto nuevo → Project Settings → API (clave `service_role`). Luego ejecutar `supabase/schema.sql` en el SQL Editor |
| Proteger la biblioteca | `RECORDER_PASSWORD` | La elige el usuario. **Obligatoria si se despliega en internet** |
| Nombre en la barra lateral y como autor | `NEXT_PUBLIC_RECORDER_OWNER_NAME` | Lo elige el usuario |

Cómo pedir una clave: dile al usuario dónde obtenerla y que la pegue él mismo en `.env.local`; si te la da en el chat, escríbela en `.env.local` sin repetirla en ningún mensaje, commit ni log. Después de cambiar `.env.local`, reinicia `npm run dev`.

Mientras falte `GROQ_API_KEY` la app muestra avisos "Falta GROQ_API_KEY" en la biblioteca y en cada video; es el comportamiento esperado, no un error.

## Reglas de seguridad

- Nunca imprimas, copies ni commitees valores de `.env.local`. Si necesitas saber qué hay configurado, usa `npm run doctor` (solo muestra qué está activo).
- `SUPABASE_SERVICE_KEY` solo se usa en el servidor. Jamás con prefijo `NEXT_PUBLIC_`.
- `.data/` (videos y base local) y `.env*` están en `.gitignore`. No los subas.
- Si el usuario va a desplegar públicamente, exige `RECORDER_PASSWORD` y Supabase (el modo local no es para internet).

## Arquitectura

- **Next.js 15** (App Router) + React 19 + TypeScript. Puerto 3030.
- **Dos backends intercambiables** en `lib/store.ts`:
  - *Local* (sin claves): `.data/drill.json` + archivos en `.data/files/{id}/`. Subida por `PUT /api/upload/...`, lectura con Range en `/api/files/...`.
  - *Supabase* (con `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`): tablas `drill_videos`, `drill_comments`, `drill_reactions`, función `drill_increment_views`, bucket público `drill-videos` y URLs firmadas de subida.
- **Grabación** (`components/Recorder.tsx`): modos Pantalla+Cámara / Pantalla / Cámara, vúmetro, cuenta regresiva, pausa/reiniciar/borrar, atajos `⌥⇧L` (grabar/terminar) y `⌥⇧P` (pausa). Cámara y barra flotan con Document Picture-in-Picture (Chrome). `lib/compositor.ts` mezcla la cámara sobre la pantalla con Insertable Streams. MediaRecorder graba MP4 (H.264) o WebM; en paralelo un audio liviano para transcribir.
- **Subida**: el navegador sube directo (sin pasar el video por funciones serverless). Videos de más de 45 MB se parten en `part-N` y el player los une.
- **Share** (`/share/[id]`, público): player (atajos K/J/L/M/F/S/T/A), reacciones emoji (teclas 1-6), comentarios con timestamp (C), transcripción sincronizada, capítulos, resumen, OG tags.
- **IA** (`app/api/videos/[id]/transcribe`): Groq `whisper-large-v3-turbo` + `openai/gpt-oss-120b`. Sin `GROQ_API_KEY` responde 503 con un mensaje claro y la app sigue funcionando.
- **Auth**: `RECORDER_PASSWORD` protege biblioteca, grabar, renombrar, borrar y subir (`middleware.ts`, cookie `drill_owner`). Los links `/share/*` son públicos. Sin contraseña, todo abierto (modo localhost).

## Burbuja de cámara nativa (solo macOS, opcional)

`desktop/DrillBubble/` es una app Swift que muestra un círculo de cámara sin marco, siempre encima de todo. La web se conecta por WebSocket a `127.0.0.1:47811` (`lib/bubbleBridge.ts`).

- Instalar: `bash desktop/DrillBubble/build.sh` (requiere `xcode-select --install`; instala en `~/Applications`).
- Orígenes permitidos: `localhost:3030/3000`. Para tu dominio de producción: `defaults write app.drill.bubble extraOrigins -array "https://drill-recorder.vercel.app"`.
- En Windows/Linux no existe esta app: la web ya muestra la cámara flotante con Picture-in-Picture de Chrome/Edge.

## Despliegue (opcional)

1. Crea el proyecto de Supabase y ejecuta `supabase/schema.sql`.
2. En Vercel, carga `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GROQ_API_KEY`, `RECORDER_PASSWORD` y `NEXT_PUBLIC_SITE_URL` (con `vercel env add`; nunca en el repo).
3. `vercel deploy --prod`.

## Comandos

```
npm run dev      # desarrollo en :3030 (crea .env.local la primera vez)
npm run doctor   # qué está activo y qué falta
npm run build    # build de producción
npm run lint
```

## Problemas frecuentes

- *No me deja grabar*: usa Chrome/Edge en `localhost` (o https) y acepta los permisos de pantalla, cámara y micrófono.
- *"Falta GROQ_API_KEY"*: normal sin clave. Agrégala en `.env.local` y reinicia.
- *El link no abre en otro dispositivo*: en modo local los videos viven en tu computadora; despliega con Supabase para compartir.
- *Puerto 3030 ocupado*: cierra el otro proceso o cambia `-p 3030` en `package.json` (y los orígenes de la burbuja).

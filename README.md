# Audiorr Web

Frontend web de Audiorr, cliente de streaming de música audiophile-grade. Consume un servidor Navidrome (compatible Subsonic) y, opcionalmente, el backend Audiorr (Node.js) para features avanzadas como Smart Mix, daily mixes y multi-device sync.

La app iOS nativa (Swift + SwiftUI con custom AVAudioEngine DSP) es el producto canónico. Esta es su contraparte web — misma arquitectura, mismo naming, mismo comportamiento donde la plataforma lo permite.

## Stack

- **SvelteKit + Svelte 5** (runes, sin stores legacy)
- **TypeScript strict** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **TanStack Svelte Query** — server state
- **Dexie** (IndexedDB) — persistencia de queue, settings, offline metadata
- **Zod** — validación y derivación de tipos para la API
- **Web Audio API + AudioWorklet** — DSP (en progreso, Phase 2)
- **Phosphor** — iconos
- **Söhne** (Klim) — tipografía principal, Inter como fallback
- **CSS custom (sin Tailwind)** — design system con tokens en dos capas (primitives + semantic)
- **pnpm** — package manager

Despliegue en Docker self-hosted, junto al backend.

## Arrancar en local

```bash
pnpm install
pnpm dev    # Vite dev server en http://localhost:5173
pnpm check  # svelte-check con TS strict
pnpm build  # producción (adapter-node)
```

Necesitas un servidor Navidrome accesible. Al primer arranque la app te lleva a `/login` para configurar credenciales (URL + usuario + password); el password no se guarda en localStorage — se deriva un token Subsonic (`md5(password+salt)`) y solo eso se persiste.

## Estructura

```
src/
├── lib/
│   ├── audio/         AudioEngine, CrossfadeExecutor, DJMixingService, AudioWorklets
│   ├── components/    UI (shared, now-playing, shell, …)
│   ├── services/      NavidromeService, BackendService, QueueManager, persistence
│   ├── stores/        Svelte 5 runes (.svelte.ts) — player, queue, theme, etc
│   ├── styles/        tokens/ (primitives + semantic), reset, globals
│   ├── types/         Zod schemas + types derivados
│   └── utils/         Helpers puros (mappers, palette, format, …)
└── routes/            file-based routing de SvelteKit
    ├── +layout.svelte                shell, sidebar, mini player, mounts
    ├── +page.svelte                  home
    ├── library/                      grid virtualizado de albums/playlists/artists
    ├── album/[id]/                   detail + see-all
    ├── artist/[id]/{albums,similar}
    ├── playlist/[id]/
    ├── search/                       resultados (input vive en sidebar)
    ├── settings/
    └── design-system/                referencia interna de tokens y componentes
```

## Convenciones

El detalle vive en [`CLAUDE.md`](./CLAUDE.md) — convenciones de TypeScript, naming, design system, arquitectura del audio engine, mapeo a iOS, y el plan de desarrollo. Léelo antes de tocar cualquier cosa no trivial.

Hard rules de los componentes:
- Solo consumen tokens semánticos (`--text-primary`, `--bg-surface`, …), nunca primitivos directos.
- Todos los stores en `.svelte.ts` con runes — nada de `writable`/`readable` legacy.
- Validación de respuestas API con Zod, tipos derivados (`type X = z.infer<typeof XSchema>`).
- Animaciones con `--ease-ios-default` salvo razón específica.

## Estado

En desarrollo activo. La UI principal (home, library, detail pages, search, queue panel, mini player) está funcional. El audio engine está en Phase 1 (HTMLAudioElement básico); Phase 2 portará el DSP con AudioWorklet + crossfade desde el iOS.

Mira la sección "Current status" de `CLAUDE.md` para el plan detallado.

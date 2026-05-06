# Audiorr Web — Project Context

> This file is the source of truth for project conventions, architecture, and design decisions. Read it fully before making any change.

---

## What is Audiorr Web

Audiorr Web is the **web frontend** for Audiorr — an audiophile-grade music streaming client that consumes a Navidrome server (Subsonic-compatible) plus an optional Audiorr Backend (Node.js) for advanced features.

The companion **iOS app** is the canonical product. iOS is fully native Swift + SwiftUI with a custom AVAudioEngine DSP pipeline. The web frontend should mirror its **architecture, naming, and behavior** as closely as the platform allows.

The web frontend is a **rewrite from a previous TypeScript + Tailwind version** that has been outgrown by the iOS app. The goal is to bring the web closer to the iOS experience in feel, polish, and code organization, while accepting browser-platform limitations (no real-time CoreAudio, no lensing, no haptics).

The iOS source repo is at https://github.com/cha0sisme/Audiorr-Frontend — the `ios/` folder. Refer to it as the behavioral spec when porting features.

---

## Stack (locked in)

| Layer | Tech |
|---|---|
| Framework | **SvelteKit** + **Svelte 5** (with runes) |
| Language | **TypeScript strict** (`strict: true`, `noUncheckedIndexedAccess: true`) |
| Bundler | Vite (built into SvelteKit) |
| Package manager | **pnpm** |
| Server state | **TanStack Query** (`@tanstack/svelte-query`) |
| Client state | **Svelte 5 runes** (`$state`, `$derived`) in `.svelte.ts` files — NO Zustand, NO Pinia |
| Persistent state | **IndexedDB via Dexie** for queue, settings, offline metadata |
| Validation | **Zod** for API response validation |
| Realtime | **Socket.io client** (Audiorr Connect multi-device sync) |
| Audio | **Web Audio API** + **AudioWorklet** for custom DSP |
| Animations | `svelte/transition`, `svelte/motion` (springs), **Motion One** for complex cases |
| Hero transitions | **View Transitions API** |
| Headless primitives | **Bits UI** or **Melt UI** (Radix equivalents for Svelte) |
| Sheets | **Vaul-Svelte** for draggable sheets (Now Playing, Queue) |
| Icons | **Lucide** or **Phosphor** (Phosphor preferred for iOS-feel) |
| Fonts | system-ui (SF Pro on Apple), **Inter** as fallback |
| Tests | **Vitest** for unit (DJMixingService, SmartMix), **Playwright** for E2E |
| Lint/Format | ESLint + Prettier with svelte plugins |
| Deploy | Vercel or Cloudflare Pages (frontend); existing Node backend stays put |

### Explicitly NOT used (do not introduce)

- ❌ Tailwind — design system is custom CSS with tokens
- ❌ Redux, Zustand, Pinia, Nano Stores — runes replace them
- ❌ React, Next.js, Solid — Svelte 5 is the choice
- ❌ shadcn/Radix UI directly — we have our own components on top of headless primitives
- ❌ Storybook — replaced with an internal `/design-system` route
- ❌ GraphQL — REST is fine, the API contracts already exist

---

## Project structure

Mirror the iOS app structure where it makes sense. Service names should match Swift counterparts.

```
src/
├── lib/
│   ├── audio/
│   │   ├── AudioEngine.ts            ← Mirrors AudioEngineManager.swift
│   │   ├── CrossfadeExecutor.ts      ← Mirrors CrossfadeExecutor.swift
│   │   ├── DJMixingService.ts        ← Pure logic port from Swift
│   │   ├── BiquadCoefficients.ts     ← Audio EQ Cookbook formulas
│   │   └── worklets/
│   │       └── biquad-processor.js   ← AudioWorkletProcessor (4 cascaded biquads)
│   │
│   ├── services/
│   │   ├── NavidromeService.ts       ← Subsonic API client
│   │   ├── BackendService.ts         ← Audiorr Backend API
│   │   ├── ConnectService.ts         ← Socket.io multi-device sync
│   │   ├── LyricsService.ts          ← LRCLib synced lyrics
│   │   ├── ScrobbleService.ts        ← Navidrome + backend scrobbling
│   │   ├── ColorExtractor.ts         ← Album art dominant color
│   │   └── QueueManager.ts           ← Queue state, scrobble triggers
│   │
│   ├── stores/                       ← Runes-based stores in .svelte.ts
│   │   ├── player.svelte.ts
│   │   ├── queue.svelte.ts
│   │   ├── settings.svelte.ts
│   │   └── connect.svelte.ts
│   │
│   ├── components/
│   │   ├── shared/                   ← Reusable across views
│   │   ├── now-playing/
│   │   ├── home/
│   │   ├── album/
│   │   ├── artist/
│   │   ├── playlist/
│   │   └── settings/
│   │
│   ├── styles/
│   │   ├── tokens/
│   │   │   ├── primitives.css        ← Layer 1: raw scales, spacing, motion
│   │   │   └── semantic.css          ← Layer 2: functional meaning
│   │   ├── reset.css                 ← Modern SPA-friendly reset
│   │   └── globals.css               ← Imports the three above
│   │
│   ├── types/                        ← Shared TS types (Song, Album, etc.)
│   └── utils/                        ← Pure helpers
│
├── routes/                           ← SvelteKit file-based routing
│   ├── +layout.svelte                ← App shell, theme provider, mini player
│   ├── +layout.ts                    ← Top-level loaders
│   ├── +page.svelte                  ← HomeView equivalent
│   ├── album/[id]/+page.svelte
│   ├── artist/[id]/+page.svelte
│   ├── playlist/[id]/+page.svelte
│   ├── search/+page.svelte
│   ├── settings/+page.svelte
│   └── design-system/+page.svelte    ← Internal token/component reference
│
└── app.html
```

---

## Design system

### Philosophy

Two-layer token system:

1. **Primitives** (`primitives.css`) — raw scales (color, spacing, type, motion). Generated via Radix Colors using `#0097fe` as the brand seed. Includes hex fallback + P3 wide-gamut overrides via OKLCH.
2. **Semantic** (`semantic.css`) — functional meaning. Components consume ONLY these tokens.

**Hard rule:** A component file must NEVER reference `--gray-N` or `--blue-N` directly. Always use the semantic name (`--bg-surface`, `--accent`, `--text-primary`, etc.). If you need a token that doesn't exist semantically, add it to `semantic.css` first.

### Aesthetic direction

Inspired by **iOS 26 Liquid Glass**, but adapted honestly for the web:

- The browser cannot do real lensing/refraction. We approximate with `backdrop-filter: blur() saturate()` + gradients + inset top highlights for the glass "edge light".
- **Glass is reserved for floating controls only**: tab bar, mini player, search bars, sheets, popovers. NEVER use glass behind text content (lyrics, song lists, album details). This is an iOS 26 HIG rule and we follow it.
- Three-layer hierarchy is always preserved: solid content (back) → glass controls (mid) → text on solid (front, never on glass directly).
- Squircle corners are simulated with regular `border-radius` (browsers don't support `corner-shape: squircle` yet).
- Motion: prefer `--ease-ios-default: cubic-bezier(0.32, 0.72, 0, 1)` (Apple's official iOS 26 curve) and `svelte/motion` springs for interruptible animations.

### Theme handling

Themes are switched by toggling `.dark` / `.light-theme` classes on `:root`. Both color scales are present in primitives.css. Most semantic tokens auto-adapt because they reference primitives that already swap. Some semantics have explicit dark overrides (scrim, row-playing). FOUC must be prevented in SSR — use SvelteKit hooks to set the theme class before hydration.

### Wide-gamut

Use OKLCH primitives for color manipulation in JS (e.g., extracting album art tint and tinting Now Playing background). The `culori` library is preferred over `color-thief` for OKLCH operations.

---

## Architecture rules

### Audio engine

- The audio engine lives in its own module and is the ONLY place that touches `AudioContext`, `AudioWorkletNode`, and the DOM-level audio APIs. Components never call Web Audio directly.
- DSP runs inside an AudioWorklet (`biquad-processor.js`). The kernel is a port of `BiquadDSPKernel.swift` — Direct Form II Transposed, 4 cascaded stages.
- Coefficient updates flow main thread → worklet via `port.postMessage()`. The worklet always uses the latest received coefficients (lock-free by design).
- `DJMixingService.ts` is pure logic — no `AudioContext` references. It computes a `TransitionProfile` and decision objects, exactly like the Swift version. Easy to unit test.
- If JS perf becomes a bottleneck (unlikely for 4 biquads), the kernel can later be rewritten in Rust → wasm-pack and loaded inside the worklet. Don't optimize prematurely.

### Services mirror iOS

When porting a Swift service:

- Keep the same name (`NavidromeService`, `QueueManager`, `DJMixingService`).
- Keep the same public method signatures where the platform allows.
- Use `class` with private fields where iOS uses a class. Use a module of pure functions where iOS uses a struct or enum.
- Validate API responses with Zod schemas — derive TS types from the schema so they stay in sync.

### State

- **Server state** (Navidrome, backend) → TanStack Query. Cache, retry, optimistic updates handled by the lib.
- **Client state** (queue, now playing, UI flags) → Svelte 5 runes in `.svelte.ts` modules. Pattern:

  ```ts
  // src/lib/stores/player.svelte.ts
  class PlayerStore {
    isPlaying = $state(false);
    progress = $state(0);
    currentSong = $state<Song | null>(null);

    play() { this.isPlaying = true; }
    pause() { this.isPlaying = false; }
  }

  export const player = new PlayerStore();
  ```

  Imported as `import { player } from '$lib/stores/player.svelte.ts'` and used directly: `player.isPlaying`, `player.play()`. No subscribe boilerplate.

- **Persistent state** (queue restoration, settings, offline metadata) → IndexedDB via Dexie. Wrap in services, never access Dexie directly from components.
- **Credentials** → only in localStorage encrypted, OR delegate to backend session cookies. Never plain.

### Components

- Single `.svelte` file per component. Scoped styles inside `<style>`.
- Component-level CSS uses ONLY semantic tokens.
- Headless primitives from Bits UI / Melt UI for accessibility (dialogs, popovers, sliders, dropdowns). Style them ourselves.
- Animations preferred order: `svelte/transition` → `svelte/motion` springs → Motion One → custom CSS keyframes.
- No prop drilling beyond 2 levels — use stores or context.

### Routing

- File-based via SvelteKit.
- Each route loads its own data with `+page.ts` loaders OR TanStack Query inside the page component. Pick one per page, don't mix.
- `+layout.svelte` owns the shell: sidebar (desktop), tab bar (mobile), mini player.

### Offline

- Service Worker generated via SvelteKit's built-in support or Workbox.
- Audio files cached via Cache API (mirrors iOS `OfflineStorageManager`).
- Metadata cached via Dexie/IndexedDB (mirrors iOS SwiftData).
- LRU eviction policy with user-configurable cache limit (default 2 GB to match iOS).

---

## Backend / API contracts

Two backends to integrate with:

- **Navidrome** (Subsonic-compatible REST API) — handles authentication, library, streaming URLs. Always required.
- **Audiorr Backend** (Node.js, optional) — provides audio analysis (BPM, key, energy, structure), Smart Mix v3.0, daily mixes, weekly chart, Connect (Socket.io), Canvas, listening stats.

The web app must detect backend availability and gracefully hide bundle-exclusive features when absent. Mirror the iOS `BackendService.isAvailable` pattern.

API contracts are defined in the iOS code as Swift models. Port them to TS using Zod schemas in `src/lib/types/`. Keep names identical (`NavidromeSong`, `AnalysisData`, `TransitionProfile`).

---

## Conventions

### TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- No `any`. Use `unknown` and narrow.
- Prefer `type` over `interface` unless extending.
- Zod schemas are the source of truth for API types: `type Song = z.infer<typeof SongSchema>`.

### Naming

- Files: kebab-case for components (`mini-player.svelte`), PascalCase for service classes (`NavidromeService.ts`), camelCase for utilities.
- Stores in `.svelte.ts` files exported as lowercase singletons (`player`, `queue`).
- CSS custom properties: kebab-case (`--bg-surface`).
- Data attributes for hooks: `data-scrollable`, `data-selectable`.

### Imports

- Use SvelteKit aliases: `$lib/...`, `$app/...`. No relative imports across module boundaries.
- Absolute over relative when crossing 2+ directory levels.

### Comments

- Minimal but meaningful. Code should explain itself; comments explain WHY.
- Document non-obvious decisions referencing the iOS counterpart when applicable: `// Mirrors AudioEngineManager.swift:142 — bass swap timing`.

### Commits

- Conventional commits: `feat:`, `fix:`, `refactor:`, `style:`, `chore:`, `docs:`.
- Reference iOS version when porting: `feat: port DJMixingService from iOS v4.0`.

---

## Current status

### Done

- ✅ Stack decisions locked.
- ✅ Design system primitives (`primitives.css`) — full Radix scales (light + dark), spacing, type scale fluida, motion curves, shadows with theme-adaptive colors.
- ✅ Design system semantics (`semantic.css`) — backgrounds, glass family, text hierarchy, borders, status placeholders, Audiorr-specific tokens (player, lyrics, queue rows).
- ✅ Modern reset (`reset.css`) — SPA-friendly, iOS-feel touches, accessible focus rings, custom scrollbars.

### Next priorities (in order)

1. **Project bootstrap** — initialize SvelteKit + TS strict + pnpm. Wire up `globals.css` import in root layout. Set up theme switching with FOUC prevention.
2. **`/design-system` route** — visual reference page rendering all tokens. This is the internal "Storybook" and validates the system before component work.
3. **Three anchor components** — primary button, album card, mini player. Validates the system end-to-end.
4. **NavidromeService port** — auth + library browsing endpoints with Zod schemas.
5. **AudioEngine skeleton** — `AudioContext`, two `AudioBufferSourceNode`, basic gapless transition (no DSP yet).
6. **BiquadDSPProcessor (AudioWorklet)** — port from Swift kernel.
7. **DJMixingService port** — pure logic, fully unit-tested with Vitest.
8. **CrossfadeExecutor** — wire automation thread to worklet, mirror Swift state machine.
9. **HomeView, AlbumView, PlaylistView** — UI for library browsing.
10. **Now Playing fullscreen + Queue sheet.**
11. **Lyrics + LRCLib integration.**
12. **Offline mode** — Service Worker + Dexie + Cache API.
13. **Bundle features** — SmartMix, Daily Mixes, Weekly Top, Connect.

---

## How to work on this project with Claude Code

When asked to do anything:

1. Re-read this file if uncertain about conventions.
2. Check if the iOS code has the equivalent in `https://github.com/cha0sisme/Audiorr-Frontend/tree/main/ios` and use it as the behavioral reference.
3. For ANY new component CSS: only consume semantic tokens. If a needed semantic token doesn't exist, add it to `semantic.css` first with reasoning.
4. For ANY new Svelte 5 store: use runes, never legacy `writable`/`readable`.
5. For ANY API call: define a Zod schema first, derive types from it.
6. For ANY animation: use `--ease-ios-default` unless there's a specific reason otherwise.
7. Run `pnpm check` (svelte-check) and `pnpm lint` after non-trivial changes.

When in doubt, prefer **fewer dependencies, more native platform features** (View Transitions, container queries, runes, AudioWorklet).

---

*Last updated: when this file was created. Update the "Current status" section as work progresses.*

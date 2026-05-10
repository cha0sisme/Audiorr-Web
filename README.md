# Audiorr Web

Web frontend for [Audiorr](https://github.com/cha0sisme/Audiorr-Frontend) — an audiophile-grade music streaming client.
SvelteKit client for a self-hosted [Navidrome](https://www.navidrome.org) library, with optional integration against the private Audiorr Backend for advanced features (DJ-grade mixing, Smart Mix, Daily Mixes, Canvas, multi-device sync).

![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![SvelteKit](https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![Web Audio API](https://img.shields.io/badge/Web%20Audio%20API-AudioWorklet-orange)
![TanStack Query](https://img.shields.io/badge/TanStack%20Query-6-FF4154?logo=reactquery&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-4-3E67B1)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

---

## ⚠️ Status: backend-coupled today, standalone mode planned

Audiorr Web currently requires the **Audiorr Backend** (private, not yet released) running on the same network. Without it, most features will fail to load — Smart Mix, Daily Mixes, Canvas, Connect, listening stats and the home feed all fetch from backend endpoints.

A standalone mode that gates backend-dependent features behind an `isBackendAvailable` flag (mirroring the iOS app's behaviour) is planned for Q2 2026. The goal: someone with only a Navidrome instance should be able to clone this repo and have a fully usable client, with backend-powered features lighting up automatically when the backend is reachable.

If you only have Navidrome and want a working Audiorr client today, the iOS app is the right entry point — it ships with this exact dual-mode design from day one.

---

## Features

### Available with Navidrome alone (current implementation)

These are technically wired but partially gated by the home feed and other backend-dependent flows. Until the standalone gate lands, expect rough edges on first-launch with no backend.

- **Gapless playback** with a dual-chain audio engine (HTMLAudioElement + Web Audio API)
- **Biquad DSP via AudioWorklet** — 4-stage cascaded filter (highpass, lowpass, shelf, notch) processed off the main thread
- **Full library browsing** — albums, artists, playlists, search
- **Queue management** with IndexedDB persistence across sessions
- **Synchronized lyrics** via [LRCLib](https://lrclib.net)
- **Album art color theming** — dominant color extraction with OKLCH (culori + node-vibrant)
- **Dark / light themes** — iOS 26 Liquid Glass aesthetic, FOUC-free via SvelteKit SSR hook
- **Wide-gamut color** — P3 OKLCH primitives with hex fallback
- **Self-hosted, no cloud dependency** for what's already wired

### Requires Audiorr Backend (private)

- **Audiorr Connect** — Spotify-Connect-style multi-device control over Socket.io (transfer playback, remote control, receiver-only mode)
- **DJ-grade crossfades** — port of the iOS `DJMixingService` algorithm (in progress; ~6,000 LOC from Swift to TypeScript, deferred until iOS v13 stabilises)
- **Smart Mix** — playlist reordering by Camelot harmonic compatibility, energy arc, BPM progression, vocal-trainwreck avoidance
- **Smart Playlists** — three rotating playlists generated server-side: *Tiempo Atrás*, *En Bucle*, *Radar de Novedades*
- **Daily Mixes** — up to five personalised mixes generated nightly
- **Canvas** — looping video or still per song (sourced from Spotify, requires Spotify credentials configured server-side)
- **Listening stats / Wrapped** — weekly Top 10 and yearly summaries from the backend's local SQLite store
- **Home feed** — Jump Back In, dynamic rows, editorial sections from the backend's `homepage_layout`
- **Last.fm scrobbling** via the backend's Socket.io channel
- **Housekeeping admin panel** for the backend operator

---

## Architecture

### System overview

Audiorr is a multi-platform product with three pieces:

```
┌───────────────────────────────────────────────────────────┐
│  Audiorr Backend  (Node.js + TypeScript, private)         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Analysis    │  │ Smart Mix    │  │ Socket.io        │ │
│  │ librosa +   │  │ daily mixes  │  │ multi-device     │ │
│  │ Essentia    │  │ playlists    │  │ Connect          │ │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘ │
│         └────────────────┴───────────────────┘           │
│                     REST API  /api/*                      │
└──────────────────────────┬────────────────────────────────┘
                           │
         ┌─────────────────┴──────────────────┐
         │                                    │
┌────────▼────────┐                  ┌────────▼────────────┐
│  Audiorr Web    │                  │  Audiorr iOS         │
│  (this repo)    │                  │  Swift + SwiftUI     │
│  SvelteKit 5    │                  │  AVAudioEngine DSP   │
│  Web Audio API  │                  │  canonical product   │
└────────┬────────┘                  └─────────────────────┘
         │
┌────────▼────────┐
│   Navidrome     │
│   Subsonic API  │
│   (always req.) │
└─────────────────┘
```

**Navidrome** is always required — it handles auth, library, and audio streaming URLs.
**Audiorr Backend** is currently coupled — making it optional is the next major architectural milestone for this repo (see status note above).

### DJ Mixing Engine (planned, not yet ported)

The core algorithmic feature of Audiorr. iOS (Swift / AVAudioEngine) is the canonical implementation; the web port to TypeScript + Web Audio API is on the roadmap but **not yet present in the codebase** beyond the audio engine skeleton.

What's live today in `src/lib/audio/`: an `AudioEngine` dual-chain (HTMLAudioElement + Web Audio nodes) with an equal-power crossfade and an `AudioWorkletProcessor` running four cascaded biquad stages (`worklets/biquad-processor.js`). No decision layer, no transition-type classifier, no per-type gain curves.

What's planned (intentionally deferred): a `DJMixingService.ts` decision layer that classifies each A→B pair into one of eleven transition types (`CROSSFADE`, `EQ_MIX`, `BEAT_MATCH_BLEND`, `NATURAL_BLEND`, `CUT`, `CUT_A_FADE_IN_B`, `FADE_OUT_A_CUT_B`, `STEM_MIX`, `DROP_MIX`, `CLEAN_HANDOFF`, `VINYL_STOP`) using BPM ratio, key compatibility, energy delta, danceability, structure segments and vocal density; plus a `CrossfadeExecutor.ts` execution layer wiring decisions to the existing audio engine with per-type gain curves and biquad sweeps.

The port is held back on purpose: the iOS Swift implementation is still iterating week to week. Porting it before the algorithm stabilises means re-porting every iteration. When iOS lands a version we're willing to call "v13 final", the web gets the port in one focused pass (~6,000 LOC from Swift, estimated 35-50h of work).

**Platform differences vs iOS** (relevant when the port lands):
- `BiquadFilterNode` (Web Audio) instead of `AVAudioUnitEQ` — same filter types, different coefficient path
- Web Audio latency is higher and less predictable than CoreAudio; lookahead is more generous
- Autoplay policy: `AudioContext` requires a user gesture before first play

### Client architecture

```
src/lib/
├── audio/           AudioEngine + biquad coefficient helpers (CrossfadeExecutor and
│                    DJMixingService not yet ported — see status above)
│   └── worklets/    biquad-processor.js (AudioWorkletProcessor, 4 cascaded biquads)
├── components/      Shared UI components (AlbumCard, PlaylistCard, SongList, MiniPlayer, …)
├── services/        NavidromeService, BackendService, QueueManager, ColorExtractor, …
├── stores/          Svelte 5 runes (.svelte.ts) — player, queue, theme, credentials
├── styles/          tokens/ (primitives + semantic), reset.css, globals.css
├── types/           Zod schemas + derived TypeScript types
└── utils/           Pure helpers (mappers, palette, format, …)

src/routes/          SvelteKit file-based routing
├── /                Home feed
├── /album/[id]
├── /artist/[id]
├── /playlist/[id]
├── /library/        Albums, smart playlists, daily mixes, my playlists
├── /search
├── /settings
├── /profile         Wrapped-lite stats
├── /housekeeping    Admin panel (backend operator only)
└── /design-system   Internal token + component reference
```

### Design system

Two-layer CSS token system — no Tailwind, no CSS-in-JS:

- **Primitives** (`primitives.css`): raw scales (color via Radix Colors seeded at `#0097fe`, spacing, type, motion). P3 OKLCH overrides alongside hex fallbacks.
- **Semantic** (`semantic.css`): functional tokens consumed by components (`--text-primary`, `--bg-surface`, `--accent`, …). Components never reference primitives directly.

Aesthetic: iOS 26 Liquid Glass approximated with `backdrop-filter: blur() saturate()` and inset edge highlights. Glass reserved for floating chrome only (mini player, tab bar, sheets).

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes) |
| Language | TypeScript 5 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Bundler | Vite 6 |
| Package manager | pnpm |
| Server state | TanStack Svelte Query 6 |
| Client state | Svelte 5 runes in `.svelte.ts` — no Zustand/Redux |
| Persistent state | IndexedDB via Dexie 4 |
| Validation | Zod 4 |
| Audio DSP | Web Audio API + AudioWorklet (4-stage biquad processor) |
| Color extraction | node-vibrant + culori (OKLCH) |
| Icons | Phosphor Svelte |
| Fonts | system-ui / Inter (variable) |
| Deploy | Docker (adapter-node), co-located with Audiorr Backend |

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 20
- [pnpm](https://pnpm.io) ≥ 9 (`npm install -g pnpm`)
- A running [Navidrome](https://www.navidrome.org) instance accessible from your browser
- Access to an Audiorr Backend instance for the full feature set (private, not yet released — limits the usefulness of standalone clones until the standalone-gate work lands)

### Local development

```bash
git clone https://github.com/cha0sisme/Audiorr-web.git
cd Audiorr-web
pnpm install
pnpm dev        # Vite dev server → http://localhost:5173
```

On first run, the app redirects to `/login`. Enter your Navidrome URL and credentials. The password is never stored in plain text — a Subsonic token (`md5(password + salt)`) is derived and persisted instead.

### Type checking and build

```bash
pnpm check      # svelte-check with TypeScript strict
pnpm build      # Production build (adapter-node)
pnpm preview    # Preview production build locally
```

### Docker (production)

The app is designed to run alongside the Audiorr Backend in the same Docker Compose stack. The deployment recipe is currently private to the project's maintainer; whether it ships in this repo or in a separate deployment repo is an open decision tied to the eventual public-release plan of the backend.

---

## Companion projects

- **[Audiorr](https://github.com/cha0sisme/Audiorr-Frontend)** — native iOS app. Standalone-first design; runs on your iPhone with just Navidrome. Currently the most complete surface of the product.
- **Audiorr Backend** — Node.js + TypeScript service. Private repository. Powers Smart Mix, AutoMix, Daily Mixes, Connect, Canvas, listening stats. Public release plan TBD.

---

## Contributing

This is a personal project and not open to external contributions at this time. The codebase is published for reference and transparency.

Before making any non-trivial change, read `CLAUDE.md` — it documents conventions, architecture decisions, and the iOS behavioural spec to mirror.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Acknowledgments

Key & BPM data powered by [GetSongBPM](https://getsongbpm.com) & [GetSongKey](https://getsongkey.com)

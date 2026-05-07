# Audiorr Web

Web frontend for [Audiorr](https://github.com/cha0sisme/Audiorr-Frontend) — an audiophile-grade music streaming client.
Connects to a self-hosted [Navidrome](https://www.navidrome.org) server and, optionally, the Audiorr Backend for advanced features (DJ-mixing engine, Smart Mixes, Daily Mixes, Canvas, multi-device sync).

![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![SvelteKit](https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![Web Audio API](https://img.shields.io/badge/Web%20Audio%20API-AudioWorklet-orange)
![TanStack Query](https://img.shields.io/badge/TanStack%20Query-6-FF4154?logo=reactquery&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-4-3E67B1)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

---

## Features

- **Gapless playback** with dual-chain audio engine (HTMLAudioElement + Web Audio API nodes)
- **Automatic DJ crossfades** — port of the iOS DJMixingService algorithm (in progress)
- **Biquad DSP via AudioWorklet** — 4-stage cascaded filter (highpass, lowpass, shelf, notch sweeps) processed off the main thread
- **Full library browsing** — albums, artists, playlists, search
- **Home feed** — Jump Back In, Daily Mixes, Smart Playlists, New Releases, Recently Added, Top Played
- **Queue management** with IndexedDB persistence across sessions
- **Album art color theming** — dominant color extraction with OKLCH (culori + node-vibrant)
- **Dark / light themes** — iOS 26 Liquid Glass aesthetic; FOUC-free via SvelteKit SSR hook
- **Wide-gamut color** — P3 OKLCH primitives with hex fallback
- **Responsive layout** — sidebar on desktop, tab bar on mobile (in progress)
- **Self-hosted, no cloud dependency** — works entirely on your local network

---

## Architecture

### System overview

Audiorr is a multi-platform product with three main pieces:

```
┌───────────────────────────────────────────────────────────┐
│  Audiorr Backend  (Node.js + TypeScript, private)         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Analysis    │  │ Smart Mix    │  │ Socket.io        │ │
│  │ librosa +   │  │ daily mixes  │  │ multi-device     │ │
│  │ Essentia    │  │ playlists    │  │ Connect          │ │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘ │
│         │                │                   │           │
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
**Audiorr Backend** is optional but unlocks the DJ engine and Smart Mix features. It runs in the same Docker Compose stack as the web app.

### Audiorr Backend

Private Node.js + TypeScript service (not in this repo). Provides:

- Audio analysis pipeline (BPM, key, energy, structure, vocal segments, intro/outro detection) via **librosa + Essentia** (Python worker)
- Cache layer (SQLite) with content-hash invalidation
- REST endpoints: `/api/analysis/<id>`, `/api/labels/...`, `/api/daily-mixes`, `/api/smart-playlists`, `/api/playlists/<id>/cover.png`, `/api/stats/...`
- Socket.io server for multi-device real-time sync (Audiorr Connect)

### DJ Mixing Engine

The core algorithmic feature of Audiorr. The iOS app (Swift/AVAudioEngine) is the canonical implementation; the web is porting it to TypeScript + Web Audio API.

**Decision layer** (`DJMixingService.ts`) — pure logic, no audio context:
- Classifies each A→B pair into one of 12 transition types: `NATURAL_BLEND`, `BEAT_MATCH_BLEND`, `DROP_MIX`, `CUT`, `CLEAN_HANDOFF`, `EQ_MIX`, `CROSSFADE`, `SMOOTH`, `FADE_OUT_A_CUT_B`, `CUT_A_FADE_IN_B`, `HALF_TIME_BRIDGE`, `VINYL_STOP`
- Decision factors: BPM ratio, key compatibility, energy delta, danceability, structure segments (intro/outro/chorus), vocal density
- **Tier 4 / earlyBlend**: advances B's entry to the first kick in its instrumental intro when A is in a reliable instrumental outro
- **B→A communication**: A adjusts its fade curve by reading three flags from B (intro bars, immediate impact, harmonic clash level)
- **Chill recipe**: five-belt guard disables automations when both tracks are chill-energy
- **aNaturalDecay**: B skips its initial ramp when A decays naturally to silence; 10% easing to avoid thump

**Execution layer** (`CrossfadeExecutor.ts`) — wires decisions to Web Audio:
- Dual audio chain (A/B) with `AudioWorkletNode` carrying 4 cascaded biquad stages
- Biquad sweeps during crossfades: highpass/lowpass on A and B independently, low-shelf boosts, notch for frequency clash regions, dynamic Q resonance
- Gain curves vary by transition type (not uniform equal-power)
- Beat-aligned time-stretch when BPMs are close
- Anticipation tease: brief B preview ("teasing") before full swap

**Platform differences vs iOS** (documented in `CLAUDE.md`):
- `BiquadFilterNode` (Web Audio) instead of `AVAudioUnitEQ` — same filter types, different coefficient path
- Web Audio latency is higher and less predictable than CoreAudio; lookahead is more generous
- Autoplay policy: `AudioContext` requires a user gesture before first play
- Backend is always co-located in Docker — no `isBackendAvailable` probing needed on web

**Current status**: AudioEngine dual-chain skeleton with equal-power crossfade is live. Full `DJMixingService` port (~6,000 LOC from Swift) is pending.

### Client architecture

```
src/lib/
├── audio/           AudioEngine, CrossfadeExecutor, DJMixingService, BiquadCoefficients
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
└── /design-system   Internal token + component reference
```

### Design system

Two-layer CSS token system — no Tailwind, no CSS-in-JS:

- **Primitives** (`primitives.css`): raw scales (color via Radix Colors seeded at `#0097fe`, spacing, type, motion). P3 OKLCH overrides alongside hex fallbacks.
- **Semantic** (`semantic.css`): functional tokens consumed by components (`--text-primary`, `--bg-surface`, `--accent`, …). Components never reference primitives directly.

Aesthetic: iOS 26 Liquid Glass approximated with `backdrop-filter: blur() saturate()` + inset edge highlights. Glass reserved for floating chrome only (mini player, tab bar, sheets).

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

### Local development

```bash
git clone https://github.com/cha0sisme/audiorr-web.git
cd audiorr-web
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

The app is designed to run alongside the Audiorr Backend in the same Docker Compose stack. Refer to the backend deployment docs for the full compose configuration.

---

## Contributing

This is a personal project and not open to external contributions at this time. The codebase is published for reference and transparency.

Before making any non-trivial change, read `CLAUDE.md` — it documents all conventions, architecture decisions, and the iOS behavioral spec to mirror.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Acknowledgments

Key & BPM data powered by [GetSongBPM](https://getsongbpm.com).

<script lang="ts">
  /**
   * LiveListeners — "Escuchando ahora" en el Sidebar.
   *
   * Presencia social estilo Spotify Friend Activity para el grupo pequeño de
   * Audiorr: muestra al RESTO de usuarios (nunca el propio) que están sonando
   * en vivo, con su avatar + la portada del álbum. Solo aparece cuando hay
   * alguien escuchando; si no, la sección desaparece (coherente con el resto
   * del repo: `{#if data.length > 0}`).
   *
   * Datos reales: Subsonic `getNowPlaying` (mismo queryKey que Personas →
   * dedup de cache). Orden ALFABÉTICO, no por recencia: con poll de 30s la
   * recencia haría bailar las filas en cada refetch. La animación va por diff
   * de lista (key por `username`): entrada/salida cuando alguien empieza/para,
   * FLIP al reordenar; el cambio de canción lo absorbe la propia fila sin
   * re-montarse. Copy + naming validados por marketing-lead.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { getNowPlaying } from '$services/NavidromeService';
  import { credentials } from '$stores/credentials.svelte';
  import LiveListenerRow from './LiveListenerRow.svelte';

  type Props = { collapsed?: boolean };
  const { collapsed = false }: Props = $props();

  const enabled = $derived(credentials.isConfigured);

  const nowPlayingQ = createQuery(() => ({
    queryKey: ['nowPlaying'],
    queryFn: () => getNowPlaying(),
    enabled,
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false
  }));

  // Ventana de "en vivo": Navidrome conserva entradas un rato tras el último
  // play. Acotamos a reproducciones recientes para no mostrar fantasmas.
  const LIVE_WINDOW_MIN = 10;

  type Listener = {
    username: string;
    title: string;
    artist: string;
    coverArt: string | null;
  };

  const self = $derived((credentials.current?.username ?? '').toLowerCase());

  const listeners = $derived.by<Listener[]>(() => {
    const entries = nowPlayingQ.data ?? [];
    const seen = new Set<string>();
    const out: Listener[] = [];
    for (const e of entries) {
      const key = e.username.toLowerCase();
      if (key === self) continue; // nunca el propio usuario
      if (!e.title) continue; // sin canción → no es escucha
      if ((e.minutesAgo ?? 0) > LIVE_WINDOW_MIN) continue;
      if (seen.has(key)) continue; // 1 fila por persona
      seen.add(key);
      out.push({
        username: e.username,
        title: e.title,
        artist: e.artist ?? '',
        coverArt: e.coverArt ?? e.albumId ?? null
      });
    }
    return out.sort((a, b) => a.username.localeCompare(b.username));
  });

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Entrada/salida de una persona (empieza/para de sonar): fade + slide + blur.
  function presence(_node: Element, { duration = 320 } = {}) {
    if (reduceMotion) return { duration: 0 };
    return {
      duration,
      easing: cubicOut,
      css: (t: number, u: number) =>
        `opacity:${t}; transform: translateY(${u * 8}px); filter: blur(${u * 4}px);`
    };
  }
  const flipDuration = reduceMotion ? 0 : 320;
</script>

{#if listeners.length > 0}
  <div class="activity" class:collapsed>
    {#if !collapsed}<p class="section-label">Escuchando ahora</p>{/if}
    <div class="list" role="list" aria-label="Escuchando ahora">
      {#each listeners as l (l.username)}
        <div
          role="listitem"
          in:presence
          out:presence
          animate:flip={{ duration: flipDuration, easing: cubicOut }}
        >
          <LiveListenerRow listener={l} {collapsed} />
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .activity {
    display: grid;
    gap: var(--space-2);
    min-height: 0;
  }
  .section-label {
    margin: 0;
    padding: 0 var(--space-3);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
</style>

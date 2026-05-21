<script lang="ts">
  import type { Snippet } from 'svelte';

  type Kind = 'album' | 'playlist' | 'artist';

  type Props = {
    title: string;
    /** Subtítulo opcional (counts, "X álbumes · Y canciones", etc.).
        Renderizado tipográficamente menor bajo el h1. */
    subtitle?: string | undefined;
    /** Determina las columnas: album/playlist = 2-5 col flex, artist = 3-7 col más chico. */
    kind: Kind;
    /** Wrapper interno:
        - 'grid' (default): renderiza `<div class="grid">` con display:grid +
          columnas auto-fill capadas. El caller mete `{#each} <Card />`.
        - 'plain': solo header + padding del page. Los children se renderizan
          tal cual, sin grid CSS — para que el caller pueda usar VirtualGrid
          u otro layout custom sin que el grid externo interfiera. */
    wrapper?: 'grid' | 'plain';
    /** Snippet opcional renderizado a la derecha del título — para acciones
        como "Crear playlist" o un selector de orden. */
    headerAction?: Snippet | undefined;
    children: Snippet;
  };

  let { title, subtitle, kind, wrapper = 'grid', headerAction, children }: Props = $props();
</script>

<div class="page">
  <header>
    <div class="heading">
      <h1>{title}</h1>
      {#if subtitle}
        <p class="subtitle">{subtitle}</p>
      {/if}
    </div>
    {#if headerAction}
      <div class="actions">{@render headerAction()}</div>
    {/if}
  </header>

  {#if wrapper === 'grid'}
    <div class="grid" data-kind={kind}>
      {@render children()}
    </div>
  {:else}
    {@render children()}
  {/if}
</div>

<style>
  .page {
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: grid;
    gap: var(--space-6);
  }

  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .heading {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  header h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    line-height: 1.1;
  }
  .subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  /* Grid de cards. Detalles importantes:
     - `minmax(MIN, MAX)` con MAX en px (no 1fr) — capa el ancho máximo de
       cada celda al mismo tamaño que usan los carruseles del home (180-200
       para albums/playlists, 140-160 para artists). Sin este cap, `1fr`
       hacía que las celdas crecieran a 300+ px en pantallas anchas, dejando
       los covers desproporcionados respecto al resto de la web.
     - `justify-content: start` — el espacio sobrante a la derecha queda
       vacío (paridad Apple Music desktop, Spotify) en vez de estirar las
       cells o centrarlas asimétricamente.
     - `align-items: start` — cada celda toma solo la altura natural de su
       contenido. Sin esto el default `stretch` hacía que items adyacentes
       de alturas distintas (con/sin badge, con/sin year) parecieran
       "solaparse" porque las cells se estiraban a la altura del más alto
       de su fila, empujando textos contra los covers de la fila siguiente. */
  .grid {
    display: grid;
    gap: var(--space-5);
    justify-content: start;
    align-items: start;
  }
  .grid[data-kind='album'],
  .grid[data-kind='playlist'] {
    grid-template-columns: repeat(auto-fill, minmax(180px, 200px));
  }
  .grid[data-kind='artist'] {
    grid-template-columns: repeat(auto-fill, minmax(140px, 160px));
    gap: var(--space-6);
  }

  @media (max-width: 640px) {
    .page {
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
    /* Mobile: vuelven a `1fr` para que dos cards llenen el viewport (sin
       espacio vacío incómodo en pantallas pequeñas). */
    .grid[data-kind='album'],
    .grid[data-kind='playlist'] {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    }
    .grid[data-kind='artist'] {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    }
    h1 {
      font-size: var(--text-2xl);
    }
  }
</style>

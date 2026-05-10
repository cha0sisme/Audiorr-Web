<script lang="ts">
  /**
   * CreatePlaylistButton — CTA primary "Crear playlist".
   *
   * Estilo primary CTA mirror Apple Music: usa los tokens canónicos
   * `--play-bg` / `--play-fg` / `--play-bg-hover` definidos en
   * `semantic.css:303-306` como "Primary play button — brand, theme-
   * agnostic. Es la acción principal del sistema". Crear playlist
   * encaja exactamente en esa categoría — es la acción más prominente
   * del library tab Playlists.
   *
   * Componente shared para evitar duplicación de estilos entre
   * `/library?tab=playlists` y `/library/playlists` + `/library/my-playlists`.
   */
  import { Plus } from 'phosphor-svelte';
  import { createPlaylistUI } from '$stores/playlist-mutations-ui.svelte';

  type Props = {
    /** Texto visible. Default "Crear playlist". */
    label?: string;
  };

  let { label = 'Crear playlist' }: Props = $props();
</script>

<button
  type="button"
  class="cpb"
  onclick={() => createPlaylistUI.open()}
  aria-label="Crear nueva playlist"
>
  <Plus size={14} weight="bold" />
  <span>{label}</span>
</button>

<style>
  .cpb {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-full);
    background: var(--play-bg);
    color: var(--play-fg);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    box-shadow: var(--play-shadow);
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .cpb:hover {
    background: var(--play-bg-hover);
  }
  .cpb:active {
    transform: scale(0.97);
    transition-duration: var(--duration-instant);
  }
  .cpb:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring), var(--play-shadow);
  }
</style>

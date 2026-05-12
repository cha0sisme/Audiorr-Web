<script lang="ts">
  /**
   * Row de un artista dentro de ViewArtistsDialog. Vive aparte para tener su
   * propio `createQuery` por artista (Svelte Query no funciona dentro de
   * un {#each} si vive en el padre — necesita scope de componente).
   *
   * Fetchea `getArtist(id)` para resolver avatar. Usa la queryKey global
   * `['artist', id]`: si el usuario ya visitó este perfil, la imagen sale
   * al instante sin red.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { User } from 'phosphor-svelte';
  import CoverImage from './CoverImage.svelte';
  import * as nav from '$services/NavidromeService';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { credentials } from '$stores/credentials.svelte';

  type Props = {
    id: string;
    name: string;
    onSelect: () => void;
  };

  let { id, name, onSelect }: Props = $props();

  const artistQ = createQuery(() => ({
    queryKey: ['artist', id],
    queryFn: () => nav.getArtist(id),
    enabled: credentials.isConfigured && !!id,
    retry: false,
    staleTime: 1000 * 60 * 30
  }));

  const coverUrl = $derived.by(() => {
    const a = artistQ.data;
    if (!a) return undefined;
    if (a.artistImageUrl && a.artistImageUrl.length > 0) return a.artistImageUrl;
    if (a.coverArt) return getCoverArtUrl(a.coverArt, 120);
    return undefined;
  });
</script>

<button type="button" class="row" onclick={onSelect}>
  <span class="avatar" aria-hidden="true">
    <CoverImage src={coverUrl} alt="" shape="circle" priority="low" width={120} height={120}>
      {#snippet fallback()}
        <User size="60%" weight="regular" />
      {/snippet}
    </CoverImage>
  </span>
  <span class="name">{name}</span>
</button>

<style>
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: transparent;
    color: var(--text-primary);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .row:hover {
    background: var(--bg-surface-hover);
  }
  .row:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .avatar {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: block;
  }
  .name {
    min-width: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

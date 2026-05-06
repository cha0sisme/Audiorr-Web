<script lang="ts">
  import Toast from './Toast.svelte';
  import { toasts } from '$stores/toasts.svelte';
</script>

<div class="viewport" aria-live="polite" aria-atomic="false">
  {#each toasts.items as t (t.id)}
    <Toast
      variant={t.variant}
      title={t.title}
      description={t.description}
      duration={t.duration}
      onDismiss={() => toasts.dismiss(t.id)}
    />
  {/each}
</div>

<style>
  .viewport {
    position: fixed;
    top: var(--space-5);
    right: var(--space-5);
    z-index: var(--z-popover);
    display: grid;
    gap: var(--space-3);
    pointer-events: none;
  }
  .viewport > :global(*) {
    pointer-events: auto;
  }

  @media (max-width: 640px) {
    .viewport {
      top: var(--space-3);
      left: var(--space-3);
      right: var(--space-3);
      justify-items: center;
    }
  }
</style>

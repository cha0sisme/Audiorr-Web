<script lang="ts">
  /**
   * StarRating10 — control 1-10 estrellas. Mirror del iOS StarRatingControl
   * que usa el TransitionDetailSheet (línea 1118).
   *
   * Click en estrella N → setValue(N). Click sobre la actual → reset a 0
   * (limpiar rating). Hover muestra preview con tinte muted.
   *
   * Usa `--accent` y `--text-tertiary` del design system para encajar con el
   * resto de la app. Tamaño configurable via prop.
   */
  import { Star } from 'phosphor-svelte';

  type Props = {
    value: number; // 0 = sin rating; 1..10 = rating
    onChange?: (next: number) => void;
    size?: number; // px
    disabled?: boolean;
  };

  let { value, onChange, size = 28, disabled = false }: Props = $props();

  let hoverIndex = $state<number | null>(null);

  function handleClick(idx: number) {
    if (disabled) return;
    // Click sobre la estrella ya activa → toggle off (limpia rating).
    const next = idx === value ? 0 : idx;
    onChange?.(next);
  }
  function handleEnter(idx: number) {
    if (disabled) return;
    hoverIndex = idx;
  }
  function handleLeave() {
    hoverIndex = null;
  }

  const displayValue = $derived(hoverIndex ?? value);
</script>

<div
  class="rating"
  class:disabled
  role="slider"
  aria-label="Valoración 0 a 10"
  aria-valuemin={0}
  aria-valuemax={10}
  aria-valuenow={value}
  tabindex={disabled ? -1 : 0}
  onmouseleave={handleLeave}
>
  {#each Array.from({ length: 10 }, (_, i) => i + 1) as i (i)}
    <button
      type="button"
      class="star-btn"
      class:active={i <= displayValue}
      class:hovering={hoverIndex !== null && i <= hoverIndex}
      class:locked={hoverIndex === null && i <= value}
      style:--star-size="{size}px"
      aria-label="{i} estrellas"
      onclick={() => handleClick(i)}
      onmouseenter={() => handleEnter(i)}
      {disabled}
    >
      <Star size={size} weight={i <= displayValue ? 'fill' : 'regular'} />
    </button>
  {/each}
</div>

<style>
  .rating {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    -webkit-tap-highlight-color: transparent;
  }
  .rating.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .rating:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    border-radius: var(--radius-md);
  }

  .star-btn {
    border: none;
    background: transparent;
    padding: 4px 2px;
    cursor: pointer;
    color: var(--text-tertiary);
    display: grid;
    place-items: center;
    line-height: 0;
    transition:
      color var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-spring-soft);
    -webkit-tap-highlight-color: transparent;
  }
  .star-btn:focus-visible {
    outline: none;
    color: var(--accent);
  }

  /* "Locked" = el rating actual confirmado. Color accent. */
  .star-btn.locked {
    color: var(--accent);
  }
  /* Hovering (incluido el track antes del cursor) — tono más suave para
     distinguir del confirmado. */
  .star-btn.hovering {
    color: color-mix(in srgb, var(--accent) 75%, transparent);
  }
  .star-btn:active {
    transform: scale(0.88);
  }
</style>

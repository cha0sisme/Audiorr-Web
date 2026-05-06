<script lang="ts">
  type Props = {
    checked: boolean;
    label?: string;
    description?: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  };

  let {
    checked = $bindable(),
    label,
    description,
    disabled = false,
    onchange
  }: Props = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<label class="row" class:disabled>
  {#if label || description}
    <span class="text">
      {#if label}<span class="label">{label}</span>{/if}
      {#if description}<span class="description">{description}</span>{/if}
    </span>
  {/if}

  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label ?? 'Toggle'}
    {disabled}
    class="track"
    data-on={checked || undefined}
    onclick={toggle}
  >
    <span class="thumb"></span>
  </button>
</label>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    cursor: pointer;
  }
  .row.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .label {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
  }
  .description {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.3;
  }

  /* iOS standard switch: 51 × 31 con thumb de 27 */
  .track {
    flex-shrink: 0;
    position: relative;
    width: 51px;
    height: 31px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--switch-track-off);
    cursor: inherit;
    padding: 0;
    transition: background var(--duration-normal) var(--ease-ios-default);
    -webkit-tap-highlight-color: transparent;
  }
  .track[data-on] {
    background: var(--switch-track-on);
  }
  .track:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 27px;
    height: 27px;
    border-radius: var(--radius-full);
    background: var(--switch-thumb);
    box-shadow: var(--shadow-md);
    transition: transform var(--duration-normal) var(--ease-ios-default);
  }
  .track[data-on] .thumb {
    transform: translateX(20px);
  }
  .track:active .thumb {
    /* iOS-style: el thumb se "estira" levemente al presionar */
    width: 31px;
  }
  .track[data-on]:active .thumb {
    transform: translateX(16px);
  }
</style>

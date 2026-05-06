<script lang="ts">
  type Props = {
    width?: string;
    height?: string;
    radius?: string;
    /** Forma de uso rápido. Si pasás `circle` ignora width/height y usa `size`. */
    circle?: boolean;
    size?: string;
  };

  let {
    width = '100%',
    height = '1em',
    radius = 'var(--radius-sm)',
    circle = false,
    size = '40px'
  }: Props = $props();
</script>

<span
  class="skeleton"
  class:circle
  style:width={circle ? size : width}
  style:height={circle ? size : height}
  style:border-radius={circle ? 'var(--radius-full)' : radius}
  aria-hidden="true"
></span>

<style>
  .skeleton {
    display: inline-block;
    background: linear-gradient(
      90deg,
      var(--bg-surface) 0%,
      var(--bg-surface-hover) 50%,
      var(--bg-surface) 100%
    );
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.6s linear infinite;
  }

  @keyframes skeleton-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
      background: var(--bg-surface-hover);
    }
  }
</style>

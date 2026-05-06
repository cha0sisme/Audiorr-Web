<script lang="ts">
  type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  type Status = 'online' | 'offline' | 'away';

  type Props = {
    name: string;
    src?: string;
    size?: Size;
    status?: Status;
  };

  let { name, src, size = 'md', status }: Props = $props();

  const sizes: Record<Size, number> = {
    xs: 24,
    sm: 32,
    md: 40,
    lg: 56,
    xl: 80
  };

  const dim = $derived(sizes[size]);

  const initials = $derived(
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('')
  );

  /* Hash determinístico → hue. Mismo nombre = mismo color siempre. */
  const hue = $derived(
    [...name].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0) % 360
  );
</script>

<span
  class="avatar"
  data-size={size}
  style:width="{dim}px"
  style:height="{dim}px"
  style:--avatar-bg="oklch(0.55 0.15 {hue})"
  style:--avatar-fg="oklch(0.96 0.04 {hue})"
  aria-label={name}
  title={name}
>
  {#if src}
    <img {src} alt="" loading="lazy" decoding="async" />
  {:else}
    <span class="initials">{initials || '?'}</span>
  {/if}

  {#if status}
    <span class="status" data-status={status} aria-label="Estado: {status}"></span>
  {/if}
</span>

<style>
  .avatar {
    position: relative;
    display: inline-grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--avatar-bg);
    color: var(--avatar-fg);
    overflow: visible;
    flex-shrink: 0;
    user-select: none;
    box-shadow: 0 0 0 1px var(--border-subtle) inset;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--radius-full);
    display: block;
  }

  .initials {
    font-weight: 600;
    letter-spacing: var(--tracking-body);
    line-height: 1;
  }

  .avatar[data-size='xs'] .initials { font-size: 10px; }
  .avatar[data-size='sm'] .initials { font-size: 13px; }
  .avatar[data-size='md'] .initials { font-size: 15px; }
  .avatar[data-size='lg'] .initials { font-size: 20px; }
  .avatar[data-size='xl'] .initials { font-size: 30px; }

  /* Status indicator: dot abajo a la derecha con ring del color de fondo */
  .status {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 30%;
    height: 30%;
    min-width: 8px;
    min-height: 8px;
    max-width: 18px;
    max-height: 18px;
    border-radius: var(--radius-full);
    box-shadow: 0 0 0 2px var(--bg-canvas);
  }
  .status[data-status='online'] { background: oklch(0.72 0.18 145); }
  .status[data-status='away']   { background: oklch(0.78 0.15 75); }
  .status[data-status='offline']{ background: var(--text-disabled); }
</style>

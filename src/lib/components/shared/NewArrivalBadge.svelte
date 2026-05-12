<script lang="ts">
  /**
   * Badge "Nuevo" inline — análogo al ExplicitBadge en posicionamiento:
   * vive dentro del `<p class="title">` de AlbumCard. Plano: solo texto,
   * sin dot, sin sombra, sin borde, sin animación. Visible pero discreto.
   *
   * Aparece para álbumes con `createdAt` en las últimas 48h (que es la
   * misma ventana que usaba la versión anterior con HOY/AYER). Un solo
   * label por simplicidad — el usuario no necesita más granularidad
   * que "es nuevo".
   */
  type Props = {
    createdAt?: string | undefined;
  };

  let { createdAt }: Props = $props();

  const isNew = $derived.by(() => {
    if (!createdAt) return false;
    const ts = Date.parse(createdAt);
    if (Number.isNaN(ts)) return false;
    const ageMs = Date.now() - ts;
    return ageMs >= 0 && ageMs < 48 * 60 * 60 * 1000;
  });
</script>

{#if isNew}
  <span class="badge" role="img" aria-label="Añadido recientemente">Nuevo</span>
{/if}

<style>
  .badge {
    /* inline-flex + flex-shrink: 0 → se alinea al texto del título y no
       se aplasta cuando el padre tiene overflow:hidden + ellipsis (mismo
       patrón que ExplicitBadge). */
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 1px 6px 2px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--text-on-accent, white);
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.04em;
    line-height: 1;
    user-select: none;
    vertical-align: middle;
  }
</style>

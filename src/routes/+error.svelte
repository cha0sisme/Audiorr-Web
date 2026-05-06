<script lang="ts">
  /**
   * Página de error genérica — captura 404, 500, etc. dentro del shell del
   * +layout. La sidebar, mini player y demás chrome siguen visibles.
   *
   * Copy contextual según status:
   *   - 404: "no encontramos esta página"
   *   - 401/403: "necesitas iniciar sesión"
   *   - 5xx: "algo salió mal" + botón Reintentar
   *   - default: error genérico con el mensaje del servidor.
   *
   * Tendencia 2026: status grande ligero, illustration en-brand sutil
   * (vinilo con groove animation, no caricatura), CTA primaria clara.
   * Mucho whitespace, bajo contraste cromático.
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { ArrowClockwise, ArrowLeft } from 'phosphor-svelte';

  const status = $derived(page.status);
  const errorMessage = $derived(page.error?.message ?? '');

  const copy = $derived.by(() => {
    if (status === 404) {
      return {
        title: 'No encontramos esta página',
        desc:
          'El enlace que seguiste o la URL que escribiste no existe. Vuelve atrás o explora desde el inicio.'
      };
    }
    if (status === 401 || status === 403) {
      return {
        title: 'Acceso restringido',
        desc: 'Necesitas iniciar sesión para acceder a este contenido.'
      };
    }
    if (status >= 500) {
      return {
        title: 'Algo salió mal',
        desc:
          errorMessage ||
          'Hubo un problema al procesar tu solicitud. Reintenta en unos segundos.'
      };
    }
    return {
      title: 'Error',
      desc: errorMessage || 'Ocurrió un error inesperado.'
    };
  });

  function goHome() {
    goto('/');
  }
  function retry() {
    if (typeof window !== 'undefined') window.location.reload();
  }
  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      goto('/');
    }
  }
</script>

<svelte:head>
  <title>{status} · Audiorr</title>
</svelte:head>

<div class="error-page">
  <div class="vinyl-wrap" aria-hidden="true">
    <!-- Vinilo simple con grooves concéntricas. SVG plano, label central
         con el accent color del tema. Rotación lenta (cinéticamente vivo
         pero contemplativo, no animado-festivo) + leve tilt fijo. -->
    <svg class="vinyl" viewBox="0 0 200 200" width="180" height="180">
      <!-- Disco principal -->
      <circle cx="100" cy="100" r="96" fill="var(--vinyl-disc)" />
      <!-- Grooves -->
      <circle cx="100" cy="100" r="86" fill="none" stroke="var(--vinyl-groove)" stroke-width="0.6" />
      <circle cx="100" cy="100" r="78" fill="none" stroke="var(--vinyl-groove)" stroke-width="0.4" />
      <circle cx="100" cy="100" r="70" fill="none" stroke="var(--vinyl-groove)" stroke-width="0.6" />
      <circle cx="100" cy="100" r="62" fill="none" stroke="var(--vinyl-groove)" stroke-width="0.4" />
      <circle cx="100" cy="100" r="54" fill="none" stroke="var(--vinyl-groove)" stroke-width="0.6" />
      <!-- Highlight glint en el borde superior izquierdo (depth) -->
      <path
        d="M 100 8 A 92 92 0 0 1 175 50"
        fill="none"
        stroke="var(--vinyl-highlight)"
        stroke-width="1"
        stroke-linecap="round"
      />
      <!-- Label central -->
      <circle cx="100" cy="100" r="36" fill="var(--accent)" />
      <circle cx="100" cy="100" r="36" fill="none" stroke="var(--vinyl-disc)" stroke-width="0.5" />
      <!-- Spindle hole -->
      <circle cx="100" cy="100" r="3" fill="var(--bg-canvas)" />
    </svg>
  </div>

  <p class="status" aria-label="Código de estado {status}">{status}</p>
  <h1 class="title">{copy.title}</h1>
  <p class="desc">{copy.desc}</p>

  <div class="actions">
    {#if status >= 500}
      <button type="button" class="btn btn-primary" onclick={retry}>
        <ArrowClockwise size={16} weight="bold" />
        Reintentar
      </button>
      <button type="button" class="btn btn-secondary" onclick={goHome}>
        Ir al inicio
      </button>
    {:else if status === 401 || status === 403}
      <button type="button" class="btn btn-primary" onclick={() => goto('/login')}>
        Iniciar sesión
      </button>
      <button type="button" class="btn btn-secondary" onclick={goHome}>
        Ir al inicio
      </button>
    {:else}
      <button type="button" class="btn btn-primary" onclick={goHome}>
        Ir al inicio
      </button>
      <button type="button" class="btn btn-secondary" onclick={goBack}>
        <ArrowLeft size={16} weight="bold" />
        Atrás
      </button>
    {/if}
  </div>
</div>

<style>
  /* Vinyl color tokens — definidos inline acá porque son específicos de
     esta página. Si los reusamos en otro sitio, mover a semantic.css. */
  .error-page {
    --vinyl-disc: var(--gray-12);
    --vinyl-groove: var(--gray-8);
    --vinyl-highlight: rgb(255 255 255 / 0.18);

    /* system-ui only en esta página → cero font loading, cero swap, cero
       layout shift. Las error pages se permiten una identidad visual
       ligeramente distinta (es estándar — Vercel y Linear lo hacen). */
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

    min-height: 100%;
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: var(--space-4);
  }

  .vinyl-wrap {
    /* Rotación muy lenta — vinilo "todavía caliente" después del error.
       18s/rev, linear (rotación física es lineal), infinite. */
    animation: vinyl-spin 18s linear infinite;
    /* Tilt sutil + drop shadow para depth. */
    transform: rotate(-12deg);
    margin-bottom: var(--space-2);
    filter: drop-shadow(0 12px 24px rgb(0 0 0 / 0.25));
  }
  .vinyl {
    display: block;
  }
  @keyframes vinyl-spin {
    from { transform: rotate(-12deg); }
    to   { transform: rotate(348deg); } /* -12 + 360 = 348 → continúa la rotación desde la posición tilteada */
  }
  @media (prefers-reduced-motion: reduce) {
    .vinyl-wrap {
      animation: none;
    }
  }

  /* Status code: muy grande, weight ligero, low contrast. Estilo Vercel/Linear.
     font-size FIJO (no clamp con vw) — el vw se recalcula con cualquier
     cambio del viewport (scrollbar appearing, view-transition snapshot vs
     live, etc), causando reflow visible del número. Fixed size es estable. */
  .status {
    margin: 0;
    font-size: 6rem;
    font-weight: 200;
    line-height: 1;
    letter-spacing: var(--tracking-tighter);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    /* Negative margin top para acercar al vinilo sin afectar el flex gap. */
    margin-top: calc(-1 * var(--space-2));
  }

  .title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
    max-width: 28ch;
  }

  .desc {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-secondary);
    max-width: 48ch;
    line-height: 1.5;
  }

  .actions {
    margin-top: var(--space-4);
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    justify-content: center;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-5);
    height: 40px;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
    -webkit-tap-highlight-color: transparent;
  }
  .btn:active {
    transform: scale(0.97);
    transition-duration: var(--duration-instant);
  }
  .btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .btn-primary {
    background: var(--text-primary);
    color: var(--bg-canvas);
  }
  .btn-primary:hover {
    background: var(--text-secondary);
  }

  .btn-secondary {
    background: transparent;
    color: var(--text-primary);
    border-color: var(--border-subtle);
  }
  .btn-secondary:hover {
    background: var(--bg-surface-hover);
    border-color: var(--border-strong);
  }

  @media (max-width: 640px) {
    .error-page {
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
    .vinyl {
      width: 140px;
      height: 140px;
    }
    .status {
      font-size: 4.5rem;
    }
    .title {
      font-size: var(--text-xl);
    }
  }
</style>

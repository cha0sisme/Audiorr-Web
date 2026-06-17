// Gestión centralizada del document title.
//
// Antes cada página declaraba su propio `<svelte:head><title>`, lo que dejaba
// huecos (páginas sin título heredaban el de la anterior — SvelteKit no resetea
// `<head>` entre navegaciones) y formatos inconsistentes. Aquí hay una única
// fuente de verdad: las páginas declaran sus segmentos vía `<PageTitle>`, el
// layout raíz renderiza el único `<title>` y `beforeNavigate` resetea al
// default para que nunca persista un título stale.

const BRAND = 'Audiorr';
const SEP = ' · ';

class PageTitleStore {
  /** Segmentos de la página activa, en el orden en que deben mostrarse.
      Ej. ['Michael Jackson', 'Discografía'] o ['Thriller']. */
  segments = $state<string[]>([]);

  /** Título final que renderiza el layout raíz. Vacío → solo la marca. */
  full = $derived(
    this.segments.length > 0 ? [...this.segments, BRAND].join(SEP) : BRAND
  );

  set(segments: (string | null | undefined)[]) {
    this.segments = segments.filter((s): s is string => !!s && s.length > 0);
  }

  reset() {
    this.segments = [];
  }
}

export const pageTitle = new PageTitleStore();

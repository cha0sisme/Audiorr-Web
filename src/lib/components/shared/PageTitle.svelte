<script lang="ts">
  import { pageTitle } from '$stores/page-title.svelte';

  // Cada página declara sus segmentos; este componente los empuja al store
  // único que el layout raíz renderiza. Sin markup propio.
  let { segments }: { segments: (string | null | undefined)[] } = $props();

  // $effect solo corre en browser → en SSR el store queda virgen y el layout
  // renderiza la marca por defecto (coherente con que las queries son
  // enabled: browser y el SSR ya muestra el fallback genérico). Reactivo:
  // cuando la query de TanStack carga, el título se enriquece solo
  // ('Álbum' → 'Thriller') sin recargar.
  $effect(() => {
    pageTitle.set(segments);
  });
</script>

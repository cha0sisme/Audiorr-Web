<script lang="ts">
  /**
   * /user/[username] — perfil público de cualquier usuario del servidor.
   *
   * Reutiliza `ProfileView` (la misma vista que `/profile`). Todo lo que
   * muestra es no sensible — coherente con la presencia "Escuchando ahora"
   * del Sidebar, desde donde se enlaza ("Ver perfil"). Si el username
   * coincide con el logueado, marca `isSelf` para el copy del hero.
   */
  import { page } from '$app/state';
  import ProfileView from '$components/profile/ProfileView.svelte';
  import { credentials } from '$stores/credentials.svelte';

  const username = $derived(decodeURIComponent(page.params.username ?? ''));
  const isSelf = $derived(
    username.toLowerCase() === (credentials.current?.username ?? '').toLowerCase()
  );
</script>

<ProfileView {username} {isSelf} />

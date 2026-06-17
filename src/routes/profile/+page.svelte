<script lang="ts">
  /**
   * /profile — perfil propio del usuario logueado. La vista vive en
   * `ProfileView` (compartida con `/user/[username]`, el perfil público).
   */
  import ProfileView from '$components/profile/ProfileView.svelte';
  import { credentials } from '$stores/credentials.svelte';

  const username = $derived(credentials.current?.username ?? '');
</script>

<ProfileView {username} isSelf />

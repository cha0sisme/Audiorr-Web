<script lang="ts">
  /** /housekeeping → redirect a /housekeeping/dashboard (default landing). */
  import { goto } from '$app/navigation';
  $effect(() => {
    goto('/housekeeping/dashboard', { replaceState: true });
  });
</script>

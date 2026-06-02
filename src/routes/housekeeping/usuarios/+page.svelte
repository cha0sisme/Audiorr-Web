<script lang="ts">
  /**
   * /housekeeping/usuarios
   *
   * Sección de gestión de cuenta/usuarios. De momento alberga el gestor de
   * sesiones activas; queda como contenedor para futuras herramientas de
   * usuario (preferencias, roles, etc).
   */
  import SessionsPanel from './SessionsPanel.svelte';
</script>

<svelte:head>
  <title>Usuarios · Housekeeping</title>
</svelte:head>

<SessionsPanel />

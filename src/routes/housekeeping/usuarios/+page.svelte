<script lang="ts">
  /**
   * /housekeeping/usuarios
   *
   * Sección de gestión de cuenta/usuarios. Alberga el panel admin de sesiones
   * activas (todas las sesiones del servidor agrupadas por usuario); queda
   * como contenedor para futuras herramientas de usuario.
   */
  import SessionsAdminPanel from './SessionsAdminPanel.svelte';
</script>

<svelte:head>
  <title>Usuarios · Housekeeping</title>
</svelte:head>

<SessionsAdminPanel />

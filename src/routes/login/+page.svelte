<script lang="ts">
  import { goto } from '$app/navigation';
  import FloatingInput from '$components/shared/FloatingInput.svelte';
  import Button from '$components/shared/Button.svelte';
  import Logo from '$components/shared/Logo.svelte';
  import { connect, NavidromeError } from '$services/NavidromeService';
  import { toasts } from '$stores/toasts.svelte';
  import { credentials } from '$stores/credentials.svelte';

  let serverUrl = $state('');
  let username = $state('');
  let password = $state('');
  let connecting = $state(false);
  let connectError = $state<string | undefined>();

  // Si ya estás conectado, te mandamos al home — no tiene sentido re-mostrar
  // el form. Click "Desconectar" en /settings te trae acá de vuelta.
  $effect(() => {
    if (credentials.isConfigured) {
      goto('/', { replaceState: true });
    }
  });

  async function handleConnect(e: SubmitEvent) {
    e.preventDefault();
    if (connecting) return;
    connecting = true;
    connectError = undefined;
    try {
      const result = await connect({ serverUrl, username, password });
      password = '';
      toasts.success(
        'Conectado',
        `Audiorr enlazado con tu Navidrome v${result.serverVersion ?? result.version}`
      );
      goto('/', { replaceState: true });
    } catch (err) {
      const msg =
        err instanceof NavidromeError
          ? err.message
          : err instanceof TypeError
            ? 'No se pudo contactar al servidor'
            : 'Error desconocido';
      connectError = msg;
      toasts.error('No se pudo conectar', msg);
    } finally {
      connecting = false;
    }
  }
</script>

<svelte:head>
  <title>Conectar · Audiorr</title>
</svelte:head>

<div class="login-page">
  <div class="card">
    <header class="brand">
      <Logo size={56} label="Audiorr" />
      <h1>Audiorr</h1>
    </header>

    <form onsubmit={handleConnect}>
      <FloatingInput
        label="URL del servidor"
        type="url"
        bind:value={serverUrl}
        required
        autocomplete="url"
      />
      <FloatingInput
        label="Usuario"
        bind:value={username}
        autocomplete="username"
        required
      />
      <FloatingInput
        label="Contraseña"
        type="password"
        bind:value={password}
        autocomplete="current-password"
        required
        error={connectError}
      />

      <div class="actions">
        <Button type="submit" loading={connecting} size="lg">
          {connecting ? 'Conectando…' : 'Conectar'}
        </Button>
      </div>
    </form>
  </div>
</div>

<style>
  .login-page {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: var(--space-6);
    background: var(--bg-canvas);
    /* Sutil ambient gradient como fondo — no compite con el form */
    background-image:
      radial-gradient(circle at 20% 10%, var(--bg-accent-soft), transparent 50%),
      radial-gradient(circle at 80% 90%, var(--bg-accent-subtle), transparent 55%);
  }

  .card {
    width: 100%;
    max-width: 420px;
    padding: var(--space-8) var(--space-6) var(--space-6);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-2xl);
    display: grid;
    gap: var(--space-6);
  }

  .brand {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    text-align: center;
  }
  .brand h1 {
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    margin: 0;
  }

  form {
    display: grid;
    gap: var(--space-3);
  }

  .actions {
    display: grid;
    margin-top: var(--space-3);
  }
  .actions :global(button) {
    width: 100%;
  }
</style>

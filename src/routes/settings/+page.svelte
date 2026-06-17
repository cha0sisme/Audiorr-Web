<script lang="ts">
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { theme } from '$stores/theme.svelte';
  import { audioSettings } from '$stores/audio-settings.svelte';
  import Toggle from '$components/shared/Toggle.svelte';
  import SessionsSelfPanel from '$components/sessions/SessionsSelfPanel.svelte';

  let isDark = $derived(theme.current === 'dark');
  let useReplayGain = $derived(audioSettings.useReplayGain);
</script>

<PageTitle segments={['Ajustes']} />

<div class="page">
  <header>
    <h1>Ajustes</h1>
    <p class="lead">Configuración de tu cuenta y la app.</p>
  </header>

  <!-- ============================================ Apariencia -->
  <section class="card">
    <h2>Apariencia</h2>
    <div class="row">
      <Toggle
        checked={isDark}
        label="Tema oscuro"
        description="Alterna entre tema oscuro y claro. Se respeta la preferencia del sistema por defecto."
        onchange={(v) => theme.set(v ? 'dark' : 'light')}
      />
    </div>
  </section>

  <!-- ============================================ Audio -->
  <section class="card">
    <h2>Audio</h2>
    <div class="row">
      <Toggle
        checked={useReplayGain}
        label="ReplayGain"
        description="Normaliza el volumen entre canciones usando los tags ReplayGain de cada pista. Si la pista no los tiene, se aplica una atenuación por defecto para evitar saltos bruscos."
        onchange={(v) => (audioSettings.useReplayGain = v)}
      />
    </div>
  </section>

  <!-- ============================================ Seguridad / sesiones -->
  <SessionsSelfPanel />

  <!-- ============================================ Recursos -->
  <section class="card">
    <h2>Recursos</h2>
    <ul class="links">
      <li><a href="/design-system">Design system de referencia →</a></li>
    </ul>
  </section>
</div>

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: grid;
    gap: var(--space-6);
  }

  header h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0 0 var(--space-2);
  }
  .lead {
    color: var(--text-secondary);
    margin: 0;
  }

  .card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-5) var(--space-6);
    display: grid;
    gap: var(--space-3);
  }
  .card h2 {
    font-size: var(--text-lg);
    font-weight: 600;
    margin: 0;
  }
  .row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    align-items: center;
  }

  .links {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }
  .links a {
    color: var(--text-accent);
    text-decoration: none;
    font-weight: 500;
  }
  .links a:hover {
    color: var(--text-accent-strong);
  }
</style>

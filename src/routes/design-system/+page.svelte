<script lang="ts">
  import Button from '$components/shared/Button.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import Toggle from '$components/shared/Toggle.svelte';
  import Avatar from '$components/shared/Avatar.svelte';
  import Input from '$components/shared/Input.svelte';
  import Toast from '$components/shared/Toast.svelte';
  import MiniPlayer from '$components/now-playing/MiniPlayer.svelte';
  import { theme } from '$stores/theme.svelte';
  import { Spring } from 'svelte/motion';
  import { fade, fly, scale } from 'svelte/transition';
  import {
    Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, Heart, Queue,
    MusicNote, MusicNotes, Waveform, SpeakerHigh, SpeakerSlash,
    MagnifyingGlass, House, Gear, User, List, Plus, X, ArrowRight,
    DownloadSimple, Star, DotsThree, CaretRight
  } from 'phosphor-svelte';

  const grayScale = Array.from({ length: 12 }, (_, i) => `--gray-${i + 1}`);
  const blueScale = Array.from({ length: 12 }, (_, i) => `--blue-${i + 1}`);

  const radii = [
    'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'
  ] as const;

  const spaces = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;

  // Söhne weights showcase
  const sohneWeights = [
    { weight: 200, name: 'Extraleicht' },
    { weight: 300, name: 'Leicht' },
    { weight: 400, name: 'Buch' },
    { weight: 500, name: 'Kraftig' },
    { weight: 600, name: 'Halbfett' },
    { weight: 700, name: 'Dreiviertelfett' },
    { weight: 800, name: 'Fett' },
    { weight: 900, name: 'Extrafett' }
  ];

  const typeScale = [
    { token: '--text-xs', label: 'xs · 12→13' },
    { token: '--text-sm', label: 'sm · 14→15' },
    { token: '--text-base', label: 'base · 16→17' },
    { token: '--text-lg', label: 'lg · 18→20' },
    { token: '--text-xl', label: 'xl · 22→24' },
    { token: '--text-2xl', label: '2xl · 28→32' },
    { token: '--text-3xl', label: '3xl · 36→44' },
    { token: '--text-4xl', label: '4xl · 48→60' }
  ];

  const sampleAlbums = [
    { title: 'Currents', artist: 'Tame Impala' },
    { title: 'In Rainbows', artist: 'Radiohead' },
    { title: 'Random Access Memories', artist: 'Daft Punk' },
    { title: 'Discovery', artist: 'Daft Punk' },
    { title: 'Blonde', artist: 'Frank Ocean' },
    { title: 'AM', artist: 'Arctic Monkeys' }
  ];

  let miniProgress = $state(0.42);
  let miniPlaying = $state(true);

  // Toggle demos
  let crossfadeOn = $state(true);
  let lyricsOn = $state(false);
  let normalizeOn = $state(true);
  let plainOff = $state(false);

  // Form demo
  let serverUrl = $state('https://music.homelab.local');
  let username = $state('leandro');
  let password = $state('');
  let passwordError = $derived(
    password.length > 0 && password.length < 6 ? 'Mínimo 6 caracteres' : ''
  );
  let formStatus = $state<'idle' | 'submitting' | 'done'>('idle');
  function submitForm(e: SubmitEvent) {
    e.preventDefault();
    if (passwordError) return;
    formStatus = 'submitting';
    setTimeout(() => (formStatus = 'done'), 900);
  }

  // Motion section
  const easings = [
    { name: 'ios-default', token: '--ease-ios-default', note: 'iOS 26 default · cubic-bezier(0.32, 0.72, 0, 1)' },
    { name: 'out-quart', token: '--ease-out-quart', note: 'Aceleración rápida, frenado largo' },
    { name: 'out-expo', token: '--ease-out-expo', note: 'Frenado dramático, pop' },
    { name: 'spring-soft', token: '--ease-spring-soft', note: 'Rebote sutil al final' },
    { name: 'spring-bouncy', token: '--ease-spring-bouncy', note: 'Rebote marcado, juguetón' }
  ];

  let easeRunning = $state(false);
  function playEasings() {
    easeRunning = false;
    requestAnimationFrame(() => requestAnimationFrame(() => (easeRunning = true)));
  }

  // Spring demo
  let sliderValue = $state(50);
  const springX = new Spring(50, { stiffness: 0.12, damping: 0.45 });
  $effect(() => {
    springX.target = sliderValue;
  });

  // Stagger list
  let listVisible = $state(true);
  const listItems = ['Discover Weekly', 'Daily Mix 1', 'Liked Songs', 'Recently Played', 'Top 50 Global'];

  // Sheet demo
  let sheetOpen = $state(false);

  // Toast demos
  type ToastVariant = 'success' | 'error' | 'warning' | 'info';
  type ToastEntry = { id: number; variant: ToastVariant; title: string; description?: string | undefined };
  let toasts = $state<ToastEntry[]>([]);
  let nextToastId = 0;

  function pushToast(variant: ToastVariant, title: string, description?: string) {
    const id = nextToastId++;
    toasts = [...toasts, { id, variant, title, description }];
  }
  function dismissToast(id: number) {
    toasts = toasts.filter((t) => t.id !== id);
  }

  // Phosphor icons demo
  const iconWeights = ['thin', 'light', 'regular', 'bold', 'fill', 'duotone'] as const;
  const iconCategories = [
    {
      title: 'Player controls',
      icons: [
        { name: 'Play', C: Play },
        { name: 'Pause', C: Pause },
        { name: 'SkipBack', C: SkipBack },
        { name: 'SkipForward', C: SkipForward },
        { name: 'Shuffle', C: Shuffle },
        { name: 'Repeat', C: Repeat }
      ]
    },
    {
      title: 'Media',
      icons: [
        { name: 'MusicNote', C: MusicNote },
        { name: 'MusicNotes', C: MusicNotes },
        { name: 'Waveform', C: Waveform },
        { name: 'SpeakerHigh', C: SpeakerHigh },
        { name: 'SpeakerSlash', C: SpeakerSlash },
        { name: 'Queue', C: Queue }
      ]
    },
    {
      title: 'Navegación',
      icons: [
        { name: 'House', C: House },
        { name: 'MagnifyingGlass', C: MagnifyingGlass },
        { name: 'List', C: List },
        { name: 'Gear', C: Gear },
        { name: 'User', C: User },
        { name: 'CaretRight', C: CaretRight }
      ]
    },
    {
      title: 'Acciones',
      icons: [
        { name: 'Heart', C: Heart },
        { name: 'Star', C: Star },
        { name: 'DownloadSimple', C: DownloadSimple },
        { name: 'Plus', C: Plus },
        { name: 'X', C: X },
        { name: 'DotsThree', C: DotsThree }
      ]
    }
  ];

  const statusTokens = [
    { name: 'success', solid: 'var(--status-success)', bg: 'var(--status-success-bg)', text: 'var(--status-success-text)' },
    { name: 'warning', solid: 'var(--status-warning)', bg: 'var(--status-warning-bg)', text: 'var(--status-warning-text)' },
    { name: 'danger',  solid: 'var(--status-danger)',  bg: 'var(--status-danger-bg)',  text: 'var(--status-danger-text)' },
    { name: 'info',    solid: 'var(--status-info)',    bg: 'var(--status-info-bg)',    text: 'var(--status-info-text)' }
  ];
</script>

<div class="page">
  <header class="hero">
    <div>
      <p class="eyebrow">Design System · v0.1</p>
      <h1>Audiorr Web</h1>
      <p class="lead">
        Validación visual de tokens y componentes ancla. Cambiá el tema para ver
        cómo se adapta todo.
      </p>
    </div>
    <button class="theme-btn" onclick={() => theme.toggle()}>
      <span class="dot" data-theme={theme.current}></span>
      Tema: <strong>{theme.current}</strong>
    </button>
  </header>

  <!-- ============================================================ TOKENS -->

  <section>
    <h2>Color · Gray scale</h2>
    <div class="swatch-row">
      {#each grayScale as token, i}
        <div class="swatch">
          <div class="chip" style:background="var({token})"></div>
          <span>{i + 1}</span>
        </div>
      {/each}
    </div>
  </section>

  <section>
    <h2>Color · Blue (brand)</h2>
    <div class="swatch-row">
      {#each blueScale as token, i}
        <div class="swatch">
          <div class="chip" style:background="var({token})"></div>
          <span>{i + 1}</span>
        </div>
      {/each}
    </div>
  </section>

  <section>
    <h2>Semantic backgrounds</h2>
    <div class="bg-row">
      <div class="bg-chip" style:background="var(--bg-canvas)">canvas</div>
      <div class="bg-chip" style:background="var(--bg-surface)">surface</div>
      <div class="bg-chip" style:background="var(--bg-surface-elevated)">elevated</div>
      <div class="bg-chip" style:background="var(--bg-accent)" style:color="var(--text-on-accent)">accent</div>
    </div>
  </section>

  <section>
    <h2>Type scale</h2>
    <div class="type-stack">
      {#each typeScale as t}
        <div class="type-row">
          <span class="type-label">{t.label}</span>
          <span class="type-sample" style:font-size="var({t.token})">
            La música es la taquigrafía de la emoción
          </span>
        </div>
      {/each}
    </div>
  </section>

  <!-- ============================================================ SÖHNE -->
  <section class="sohne-section">
    <h2>Typography · Söhne (Klim)</h2>
    <p class="caption">
      Trial fonts cargados desde <code>/public/sohne/</code>. Disponibles vía
      <code>font-family: 'Söhne'</code> y <code>'Söhne Mono'</code>.
      <strong>NO usar en producción sin licencia.</strong>
    </p>

    <p class="caption" style:margin-top="var(--space-5)">8 weights — mismo texto.</p>
    <div class="sohne-weights">
      {#each sohneWeights as w}
        <div class="sohne-row" style:font-weight={w.weight}>
          <span class="sohne-meta">{w.weight} · {w.name}</span>
          <span class="sohne-sample sohne-font">Audiorr — música audiophile</span>
        </div>
      {/each}
    </div>

    <p class="caption" style:margin-top="var(--space-6)">Italics (Kursiv).</p>
    <div class="sohne-weights">
      <div class="sohne-row" style:font-weight={400} style:font-style="italic">
        <span class="sohne-meta">400 italic</span>
        <span class="sohne-sample sohne-font">Reproduciendo ahora — Tame Impala</span>
      </div>
      <div class="sohne-row" style:font-weight={500} style:font-style="italic">
        <span class="sohne-meta">500 italic</span>
        <span class="sohne-sample sohne-font">Reproduciendo ahora — Tame Impala</span>
      </div>
      <div class="sohne-row" style:font-weight={700} style:font-style="italic">
        <span class="sohne-meta">700 italic</span>
        <span class="sohne-sample sohne-font">Reproduciendo ahora — Tame Impala</span>
      </div>
    </div>

    <p class="caption" style:margin-top="var(--space-6)">
      A/B vs Inter (actual). Mismo texto, mismo tamaño, mismo weight.
    </p>

    <div class="ab-grid">
      <div class="ab-cell">
        <span class="ab-label">Inter (actual)</span>
        <h3 class="ab-hero">Currents</h3>
        <p class="ab-body">
          Tame Impala · 2015 · 13 canciones · 51 min
        </p>
      </div>
      <div class="ab-cell">
        <span class="ab-label">Söhne</span>
        <h3 class="ab-hero sohne-font">Currents</h3>
        <p class="ab-body sohne-font">
          Tame Impala · 2015 · 13 canciones · 51 min
        </p>
      </div>

      <div class="ab-cell">
        <span class="ab-label">Inter — body</span>
        <p class="ab-body-long">
          Crossfade automático activado. La transición entre la canción actual y
          la siguiente se calcula en base a tempo, key musical, y energy de cada
          track usando análisis del backend.
        </p>
      </div>
      <div class="ab-cell">
        <span class="ab-label">Söhne — body</span>
        <p class="ab-body-long sohne-font">
          Crossfade automático activado. La transición entre la canción actual y
          la siguiente se calcula en base a tempo, key musical, y energy de cada
          track usando análisis del backend.
        </p>
      </div>

      <div class="ab-cell">
        <span class="ab-label">Inter — UI label</span>
        <button class="demo-btn">Reproducir</button>
        <kbd class="demo-kbd">⌘K</kbd>
      </div>
      <div class="ab-cell">
        <span class="ab-label">Söhne — UI label</span>
        <button class="demo-btn sohne-font">Reproducir</button>
        <kbd class="demo-kbd sohne-font">⌘K</kbd>
      </div>
    </div>

    <p class="caption" style:margin-top="var(--space-6)">
      Söhne Mono — para code, kbd, tabular numerals (precios, durations, BPM).
    </p>
    <div class="ab-grid">
      <div class="ab-cell">
        <span class="ab-label">Mono actual (system mono)</span>
        <p class="ab-mono">3:45 · 128 BPM · A♯ minor</p>
        <p class="ab-mono">€19.99 · 2024-03-15</p>
      </div>
      <div class="ab-cell">
        <span class="ab-label">Söhne Mono</span>
        <p class="ab-mono sohne-mono-font">3:45 · 128 BPM · A♯ minor</p>
        <p class="ab-mono sohne-mono-font">€19.99 · 2024-03-15</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Radius</h2>
    <div class="radius-row">
      {#each radii as r}
        <div class="radius-item">
          <div class="radius-box" style:border-radius="var(--radius-{r})"></div>
          <span>{r}</span>
        </div>
      {/each}
    </div>
  </section>

  <section>
    <h2>Spacing</h2>
    <div class="space-stack">
      {#each spaces as s}
        <div class="space-row">
          <span class="space-label">space-{s}</span>
          <div class="space-bar" style:width="var(--space-{s})"></div>
        </div>
      {/each}
    </div>
  </section>

  <section>
    <h2>Shadows</h2>
    <div class="shadow-row">
      {#each ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as s}
        <div class="shadow-card" style:box-shadow="var(--shadow-{s})">{s}</div>
      {/each}
    </div>
  </section>

  <!-- ============================================================ COMPONENTS -->

  <section>
    <h2>Button</h2>

    <div class="component-grid">
      <div>
        <p class="caption">Primary · sizes</p>
        <div class="row">
          <Button size="sm">Reproducir</Button>
          <Button size="md">Reproducir</Button>
          <Button size="lg">Reproducir</Button>
        </div>
      </div>

      <div>
        <p class="caption">Variants</p>
        <div class="row">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
      </div>

      <div>
        <p class="caption">States</p>
        <div class="row">
          <Button>Normal</Button>
          <Button loading>Cargando</Button>
          <Button disabled>Disabled</Button>
        </div>
      </div>
    </div>
  </section>

  <section>
    <h2>AlbumCard</h2>
    <p class="caption">Hover sobre una card para ver el botón de play y la elevación.</p>
    <div class="album-grid">
      {#each sampleAlbums as a, i}
        <AlbumCard id="ds-album-{i}" title={a.title} artist={a.artist} />
      {/each}
    </div>
  </section>

  <section>
    <h2>Toggle (Switch)</h2>
    <p class="caption">Estilo iOS — el thumb se estira al presionar.</p>

    <div class="settings-card">
      <Toggle
        bind:checked={crossfadeOn}
        label="Crossfade automático"
        description="Mezcla suave entre canciones siguiendo el análisis de Smart Mix."
      />
      <hr />
      <Toggle
        bind:checked={lyricsOn}
        label="Letras sincronizadas"
        description="Mostrar lyrics con timing cuando estén disponibles vía LRCLib."
      />
      <hr />
      <Toggle
        bind:checked={normalizeOn}
        label="Normalización de volumen"
        description="Aplica ReplayGain por canción y por álbum."
      />
      <hr />
      <Toggle bind:checked={plainOff} label="Sin descripción" />
      <hr />
      <Toggle checked={true} disabled label="Disabled (on)" />
    </div>
  </section>

  <section>
    <h2>Avatar</h2>
    <p class="caption">Color generado del hash del nombre — mismo nombre, mismo color siempre.</p>

    <div class="row" style:align-items="flex-end">
      <Avatar name="Leandro Sastre" size="xs" />
      <Avatar name="Leandro Sastre" size="sm" />
      <Avatar name="Leandro Sastre" size="md" />
      <Avatar name="Leandro Sastre" size="lg" />
      <Avatar name="Leandro Sastre" size="xl" />
    </div>

    <p class="caption" style:margin-top="var(--space-5)">Variedad de nombres y estados.</p>
    <div class="row">
      <Avatar name="Tame Impala" status="online" />
      <Avatar name="Frank Ocean" status="away" />
      <Avatar name="Daft Punk" status="offline" />
      <Avatar name="Radiohead" />
      <Avatar name="Arctic Monkeys" />
      <Avatar name="Mac DeMarco" />
      <Avatar name="?" />
    </div>
  </section>

  <section>
    <h2>Input</h2>
    <p class="caption">Idle, hover, focus, con helper, con error, disabled.</p>

    <div class="form-grid">
      <Input label="Idle" placeholder="Buscar canciones..." />
      <Input label="Con helper" placeholder="usuario@host" helper="Tu user de Navidrome" />
      <Input
        label="Con error"
        type="password"
        value="123"
        error="La contraseña es muy corta"
      />
      <Input label="Disabled" value="No editable" disabled />
    </div>
  </section>

  <section>
    <h2>Formulario · Conectar a Navidrome</h2>
    <p class="caption">Combinación real: inputs + toggle + botón con loading.</p>

    <form class="connect-form" onsubmit={submitForm}>
      <Input
        label="URL del servidor"
        type="url"
        bind:value={serverUrl}
        placeholder="https://..."
        required
      />
      <Input
        label="Usuario"
        bind:value={username}
        autocomplete="username"
        required
      />
      <Input
        label="Contraseña"
        type="password"
        bind:value={password}
        error={passwordError}
        autocomplete="current-password"
        required
      />

      <div class="settings-card" style:margin-top="var(--space-2)">
        <Toggle
          bind:checked={normalizeOn}
          label="Recordar sesión"
          description="Guarda credenciales cifradas en este navegador."
        />
      </div>

      <div class="form-actions">
        <Button variant="ghost" type="button">Cancelar</Button>
        <Button type="submit" loading={formStatus === 'submitting'}>
          {formStatus === 'done' ? 'Conectado ✓' : 'Conectar'}
        </Button>
      </div>
    </form>
  </section>

  <!-- ============================================================ ICONS -->

  <section>
    <h2>Icons · Phosphor</h2>
    <p class="caption">
      Sistema de iconos. Cada uno se importa por nombre desde
      <code>phosphor-svelte</code> (tree-shakeable). Soporta 6 weights.
    </p>

    <p class="caption" style:margin-top="var(--space-5)">
      Mismo icono (<code>Play</code>) en los 6 weights disponibles.
    </p>
    <div class="icon-weights">
      {#each iconWeights as w}
        <div class="icon-weight">
          <Play size={28} weight={w} />
          <span class="icon-weight-label">{w}</span>
        </div>
      {/each}
    </div>

    {#each iconCategories as cat}
      <p class="caption" style:margin-top="var(--space-5)">{cat.title}</p>
      <div class="icon-grid">
        {#each cat.icons as i}
          <div class="icon-cell">
            <i.C size={26} weight="regular" />
            <span class="icon-cell-name">{i.name}</span>
          </div>
        {/each}
      </div>
    {/each}
  </section>

  <!-- ============================================================ STATUS -->

  <section>
    <h2>Status colors</h2>
    <p class="caption">
      Para success / warning / danger / info. Cada uno tiene <code>solid</code>
      (fondo CTA), <code>bg</code> (badge tinted), <code>text</code> (texto sobre bg),
      <code>border</code> y <code>contrast</code>.
    </p>

    <div class="status-grid">
      {#each statusTokens as t}
        <div class="status-card">
          <div class="status-solid" style:background={t.solid}>{t.name}</div>
          <div class="status-bg" style:background={t.bg} style:color={t.text}>
            <span class="status-dot" style:background={t.solid}></span>
            Mensaje de ejemplo
          </div>
          <code class="status-token">--status-{t.name}</code>
        </div>
      {/each}
    </div>

    <p class="caption" style:margin-top="var(--space-5)">
      Bonus: <code>--playback</code> = green-9 — uso reservado para sliders /
      scrubbers / progress bars de transporte. Distinto del accent (brand) y de
      los status para no mezclar roles.
    </p>
    <div class="row">
      <div class="playback-sample">
        <div class="playback-track">
          <div class="playback-fill" style:width="62%"></div>
        </div>
      </div>
    </div>
  </section>

  <section>
    <h2>Toast / Notification</h2>
    <p class="caption">
      Glass tipo iOS, icono coloreado por variante, action opcional. Auto-dismiss
      a los 4s.
    </p>

    <div class="row">
      <Button size="sm" variant="secondary" onclick={() => pushToast('success', 'Conectado', 'Sesión iniciada en Navidrome.')}>
        Success
      </Button>
      <Button size="sm" variant="secondary" onclick={() => pushToast('error', 'Error de conexión', 'No se pudo contactar al servidor.')}>
        Error
      </Button>
      <Button size="sm" variant="secondary" onclick={() => pushToast('warning', 'Calidad reducida', 'Streaming a 96 kbps por ancho de banda limitado.')}>
        Warning
      </Button>
      <Button size="sm" variant="secondary" onclick={() => pushToast('info', 'Sincronizando biblioteca', 'Pueden tardar unos segundos.')}>
        Info
      </Button>
    </div>

    <div class="toast-stack" aria-live="polite">
      {#each toasts as t (t.id)}
        <Toast
          variant={t.variant}
          title={t.title}
          description={t.description}
          onDismiss={() => dismissToast(t.id)}
        />
      {/each}
    </div>
  </section>

  <!-- ============================================================ MOTION -->

  <section>
    <h2>Motion · Easings</h2>
    <p class="caption">
      Comparación de las curvas. Pulsá <em>Reproducir</em> y observá cómo cada caja
      llega de forma distinta al borde derecho.
    </p>

    <div class="ease-controls">
      <Button size="sm" onclick={playEasings}>Reproducir</Button>
      <Button size="sm" variant="ghost" onclick={() => (easeRunning = false)}>Reset</Button>
    </div>

    <div class="ease-stack">
      {#each easings as e}
        <div class="ease-row">
          <div class="ease-label">
            <span class="ease-name">{e.name}</span>
            <span class="ease-note">{e.note}</span>
          </div>
          <div class="ease-track">
            <div
              class="ease-box"
              data-animate={easeRunning || undefined}
              style:transition="left 1000ms var({e.token})"
            ></div>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section>
    <h2>Motion · Spring</h2>
    <p class="caption">
      Mové el slider. La pelota lo sigue con un Spring (stiffness 0.12, damping 0.45)
      — entrada lineal, salida con inercia y rebote sutil.
    </p>

    <div class="spring-demo">
      <input
        type="range"
        min="0"
        max="100"
        bind:value={sliderValue}
        aria-label="Posición del spring"
      />
      <div class="spring-track">
        <div class="spring-ball" style:left="calc({springX.current}% - 14px)"></div>
      </div>
      <div class="spring-readout">
        target: <strong>{sliderValue.toFixed(0)}</strong> ·
        spring: <strong>{springX.current.toFixed(1)}</strong>
      </div>
    </div>
  </section>

  <section>
    <h2>Motion · Stagger</h2>
    <p class="caption">
      Patrón típico: lista que aparece con delay escalonado por índice. Útil para
      Home, Search results, sidebar.
    </p>

    <div class="row" style:margin-bottom="var(--space-4)">
      <Button size="sm" variant="secondary" onclick={() => (listVisible = !listVisible)}>
        {listVisible ? 'Ocultar lista' : 'Mostrar lista'}
      </Button>
    </div>

    <ul class="stagger-list">
      {#if listVisible}
        {#each listItems as item, i (item)}
          <li
            in:fly|global={{ y: 12, duration: 300, delay: i * 50 }}
            out:fade|global={{ duration: 150 }}
          >
            <span class="dot-mini"></span>
            {item}
          </li>
        {/each}
      {/if}
    </ul>
  </section>

  <section>
    <h2>Motion · Sheet (preview)</h2>
    <p class="caption">
      Patrón que vamos a usar para Now Playing y Queue: fly desde abajo + fade del scrim.
    </p>

    <div class="row">
      <Button onclick={() => (sheetOpen = true)}>Abrir sheet</Button>
    </div>

    {#if sheetOpen}
      <div
        class="scrim"
        transition:fade={{ duration: 200 }}
        onclick={() => (sheetOpen = false)}
        role="presentation"
      >
        <div
          class="sheet"
          transition:fly={{ y: 200, duration: 350 }}
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.key === 'Escape' && (sheetOpen = false)}
          tabindex="-1"
          role="dialog"
          aria-modal="true"
          aria-label="Demo sheet"
        >
          <div class="sheet-handle"></div>
          <h3>Sheet de demostración</h3>
          <p>
            Fly + fade desde abajo, con ease iOS por defecto. Click fuera para cerrar.
          </p>
          <div class="row" style:justify-content="flex-end">
            <Button variant="ghost" onclick={() => (sheetOpen = false)}>Cerrar</Button>
          </div>
        </div>
      </div>
    {/if}
  </section>

  <section>
    <h2>MiniPlayer</h2>
    <p class="caption">
      Glass sobre fondo con gradiente — recordá que glass solo va en controles flotantes,
      nunca detrás de texto largo.
    </p>

    <div class="mini-stage">
      <div class="mini-bg"></div>
      <div class="mini-anchor">
        <MiniPlayer
          title="Let It Happen"
          artist="Tame Impala"
          progress={miniProgress}
          isPlaying={miniPlaying}
          onPlayPause={() => (miniPlaying = !miniPlaying)}
        />
      </div>
    </div>

    <div class="row" style:margin-top="var(--space-4)">
      <Button
        size="sm"
        variant="secondary"
        onclick={() => (miniProgress = Math.max(0, miniProgress - 0.1))}
      >
        - 10%
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onclick={() => (miniProgress = Math.min(1, miniProgress + 0.1))}
      >
        + 10%
      </Button>
      <span class="caption" style:align-self="center">
        progress: {Math.round(miniProgress * 100)}%
      </span>
    </div>
  </section>
</div>

<style>
  .page {
    max-width: 1100px;
    margin: 0 auto;
    padding: var(--space-12) var(--space-6) var(--space-24);
    display: grid;
    gap: var(--space-12);
  }

  .hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-6);
    flex-wrap: wrap;
  }

  .eyebrow {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
    margin-bottom: var(--space-2);
  }

  h1 {
    font-size: var(--text-4xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
  }

  .lead {
    margin-top: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-lg);
    max-width: 50ch;
  }

  h2 {
    font-size: var(--text-xl);
    font-weight: 600;
    margin: 0 0 var(--space-4);
    color: var(--text-primary);
  }

  section {
    padding-top: var(--space-6);
    border-top: 1px solid var(--separator-subtle);
  }

  .caption {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin: 0 0 var(--space-3);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }

  .theme-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .theme-btn:hover {
    background: var(--bg-surface-active);
    color: var(--text-primary);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    background: var(--text-primary);
  }
  .dot[data-theme='light'] {
    background: var(--accent);
  }

  /* Swatches */
  .swatch-row {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: var(--space-2);
  }
  .swatch {
    display: grid;
    gap: var(--space-1);
    text-align: center;
  }
  .chip {
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
  }
  .swatch span {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .bg-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-3);
  }
  .bg-chip {
    padding: var(--space-6);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  /* Type */
  .type-stack {
    display: grid;
    gap: var(--space-3);
  }
  .type-row {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: var(--space-4);
    align-items: baseline;
  }
  .type-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  /* Radius */
  .radius-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  .radius-item {
    display: grid;
    gap: var(--space-2);
    text-align: center;
  }
  .radius-box {
    width: 64px;
    height: 64px;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
  }
  .radius-item span {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  /* Space */
  .space-stack {
    display: grid;
    gap: var(--space-2);
  }
  .space-row {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: var(--space-3);
  }
  .space-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .space-bar {
    height: 16px;
    background: var(--accent);
    border-radius: var(--radius-xs);
  }

  /* Shadows */
  .shadow-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--space-6);
  }
  .shadow-card {
    aspect-ratio: 1.5;
    background: var(--bg-surface-elevated);
    border-radius: var(--radius-md);
    display: grid;
    place-items: center;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  /* Components */
  .component-grid {
    display: grid;
    gap: var(--space-6);
  }

  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--space-5);
  }

  .mini-stage {
    position: relative;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    padding: var(--space-12) var(--space-6);
    isolation: isolate;
  }
  .mini-bg {
    position: absolute;
    inset: 0;
    z-index: -1;
    background:
      radial-gradient(circle at 20% 30%, var(--blue-7), transparent 60%),
      radial-gradient(circle at 80% 70%, var(--blue-5), transparent 55%),
      linear-gradient(135deg, var(--gray-4), var(--gray-6));
  }
  .mini-anchor {
    display: flex;
    justify-content: center;
  }

  /* Settings card iOS-style: rows con divider hairline */
  .settings-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-4) var(--space-5);
    max-width: 560px;
  }
  .settings-card hr {
    border: none;
    border-top: 1px solid var(--separator-subtle);
    margin: var(--space-3) 0;
  }

  /* Form layouts */
  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: var(--space-5);
    max-width: 720px;
  }

  .connect-form {
    display: grid;
    gap: var(--space-4);
    max-width: 420px;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  /* Motion · Easings */
  .ease-controls {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
  }
  .ease-stack {
    display: grid;
    gap: var(--space-3);
  }
  .ease-row {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: var(--space-4);
    align-items: center;
  }
  .ease-label {
    display: grid;
    gap: 2px;
  }
  .ease-name {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    font-family: var(--font-mono);
  }
  .ease-note {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .ease-track {
    position: relative;
    height: 32px;
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
  }
  .ease-box {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 24px;
    height: 24px;
    background: var(--accent);
    border-radius: var(--radius-sm);
  }
  .ease-box[data-animate] {
    left: calc(100% - 28px);
  }

  /* Motion · Spring */
  .spring-demo {
    display: grid;
    gap: var(--space-3);
    max-width: 560px;
  }
  .spring-demo input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .spring-track {
    position: relative;
    height: 28px;
    background: var(--bg-surface);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
  }
  .spring-ball {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    background: var(--accent);
    box-shadow: var(--shadow-sm);
  }
  .spring-readout {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .spring-readout strong {
    color: var(--text-primary);
  }

  /* Motion · Stagger list */
  .stagger-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-1);
    max-width: 360px;
  }
  .stagger-list li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }
  .dot-mini {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--accent);
    flex-shrink: 0;
  }

  /* Sheet demo */
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    backdrop-filter: blur(4px);
    z-index: 100;
    display: grid;
    align-items: end;
    justify-items: center;
  }
  .sheet {
    width: min(440px, calc(100% - var(--space-6)));
    margin-bottom: var(--space-6);
    padding: var(--space-5) var(--space-6) var(--space-6);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-2xl);
    display: grid;
    gap: var(--space-4);
  }
  .sheet h3 {
    font-size: var(--text-xl);
    font-weight: 600;
    margin: 0;
  }
  .sheet p {
    color: var(--text-secondary);
    margin: 0;
    font-size: var(--text-base);
    line-height: 1.5;
  }
  .sheet-handle {
    width: 40px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--handle-bar);
    margin: 0 auto;
  }

  /* Status colors */
  .status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-4);
    max-width: 920px;
  }
  .status-card {
    display: grid;
    gap: var(--space-2);
  }
  .status-solid {
    height: 64px;
    border-radius: var(--radius-md);
    color: white;
    display: grid;
    place-items: center;
    font-weight: 600;
    text-transform: capitalize;
    font-size: var(--text-sm);
  }
  .status-bg {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .status-token {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  /* Playback sample */
  .playback-sample {
    width: 320px;
    max-width: 100%;
  }
  .playback-track {
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--player-progress-bg);
    overflow: hidden;
  }
  .playback-fill {
    height: 100%;
    background: var(--player-progress-fill);
    border-radius: inherit;
  }

  /* Toast stack — área donde se acumulan los toasts del demo */
  .toast-stack {
    position: fixed;
    top: var(--space-5);
    right: var(--space-5);
    z-index: 1000;
    display: grid;
    gap: var(--space-3);
    pointer-events: none;
  }
  .toast-stack > :global(*) {
    pointer-events: auto;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.92em;
    color: var(--text-secondary);
    background: var(--bg-surface);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
  }

  /* === Söhne section === */
  .sohne-font {
    font-family: 'Söhne', var(--font-sans);
  }
  .sohne-mono-font {
    font-family: 'Söhne Mono', var(--font-mono);
  }

  .sohne-weights {
    display: grid;
    gap: var(--space-2);
  }
  .sohne-row {
    display: grid;
    grid-template-columns: 200px 1fr;
    align-items: baseline;
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--separator-subtle);
  }
  .sohne-meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    font-weight: 400 !important;
    font-style: normal !important;
  }
  .sohne-sample {
    font-size: var(--text-xl);
    color: var(--text-primary);
    letter-spacing: var(--tracking-body);
  }

  /* A/B comparison grid — 2 columnas, Inter izq, Söhne der */
  .ab-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }
  .ab-cell {
    padding: var(--space-5);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }
  .ab-label {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }
  .ab-hero {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    line-height: 1.05;
  }
  .ab-body {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .ab-body-long {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-primary);
    line-height: 1.5;
  }
  .ab-mono {
    margin: 0;
    font-size: var(--text-base);
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }

  /* Demo button para A/B */
  .demo-btn {
    height: 40px;
    padding: 0 var(--space-5);
    border: none;
    border-radius: var(--radius-full);
    background: var(--bg-accent);
    color: var(--text-on-accent);
    font: inherit;
    font-size: var(--text-base);
    font-weight: 600;
    cursor: pointer;
    justify-self: start;
  }
  .demo-kbd {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    background: var(--bg-canvas);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    color: var(--text-tertiary);
    font-size: 12px;
    font-weight: 500;
    justify-self: start;
  }

  @media (max-width: 768px) {
    .ab-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Icons section */
  .icon-weights {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
  }
  .icon-weight {
    display: grid;
    place-items: center;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    min-width: 90px;
    color: var(--text-primary);
  }
  .icon-weight-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--space-2);
    max-width: 920px;
  }
  .icon-cell {
    display: grid;
    place-items: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-3);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .icon-cell:hover {
    background: var(--bg-surface-hover);
  }
  .icon-cell-name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
</style>

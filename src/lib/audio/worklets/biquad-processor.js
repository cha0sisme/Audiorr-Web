// @ts-nocheck — corre en el AudioWorklet global scope (AudioWorkletProcessor,
// registerProcessor). El proyecto tiene checkJs:true para .ts checks pero acá
// los globals no existen en el typing principal.
// BiquadProcessor — AudioWorkletProcessor.
// Port verbatim de BiquadDSPKernel.swift. 4 biquads cascadeados, stereo,
// Direct Form II Transposed. Lock-free: el main thread postMessage'a coeffs
// nuevos y el worklet los aplica en el siguiente process(). Sin smoothing
// (iOS tampoco hace ramp) — los main-thread automation ticks de 16 ms son
// suficientemente pequeños para ser inaudibles.

const NUM_STAGES = 4;
const MAX_CHANNELS = 2;
const DENORMAL_THRESHOLD = 1e-15;
const PASSTHROUGH_EPS = 1e-6;

function isPassthrough(c) {
  return (
    Math.abs(c.b0 - 1) < PASSTHROUGH_EPS &&
    Math.abs(c.b1) < PASSTHROUGH_EPS &&
    Math.abs(c.b2) < PASSTHROUGH_EPS &&
    Math.abs(c.a1) < PASSTHROUGH_EPS &&
    Math.abs(c.a2) < PASSTHROUGH_EPS
  );
}

class BiquadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 4 stages × passthrough coefficients.
    this.coeffs = new Array(NUM_STAGES);
    for (let s = 0; s < NUM_STAGES; s++) {
      this.coeffs[s] = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
    }
    // State: z1[stage][channel], z2[stage][channel].
    this.z1 = new Float32Array(NUM_STAGES * MAX_CHANNELS);
    this.z2 = new Float32Array(NUM_STAGES * MAX_CHANNELS);

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'coeffs' && Array.isArray(msg.coeffs)) {
      // Replace all 4 stages atomically (single-threaded JS — no race).
      for (let s = 0; s < NUM_STAGES; s++) {
        const c = msg.coeffs[s];
        if (c) this.coeffs[s] = { b0: c.b0, b1: c.b1, b2: c.b2, a1: c.a1, a2: c.a2 };
      }
    } else if (msg.type === 'reset') {
      this.z1.fill(0);
      this.z2.fill(0);
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;

    const channelCount = Math.min(input.length, output.length, MAX_CHANNELS);
    if (channelCount === 0) return true;

    const frames = output[0] ? output[0].length : 0;

    // Si no hay input (source aún no conectada), salida en silencio. Mantener
    // worklet vivo — return true.
    if (input.length === 0) {
      for (let ch = 0; ch < output.length; ch++) {
        const out = output[ch];
        if (out) out.fill(0);
      }
      return true;
    }

    for (let ch = 0; ch < channelCount; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      if (!inCh || !outCh) continue;

      // Copy input → output. Stages procesan in-place sobre outCh.
      outCh.set(inCh);

      for (let s = 0; s < NUM_STAGES; s++) {
        const c = this.coeffs[s];
        if (isPassthrough(c)) continue; // fast path

        const idx = s * MAX_CHANNELS + ch;
        let z1 = this.z1[idx];
        let z2 = this.z2[idx];
        const b0 = c.b0;
        const b1 = c.b1;
        const b2 = c.b2;
        const a1 = c.a1;
        const a2 = c.a2;

        // Direct Form II Transposed — port verbatim de BiquadDSPKernel.swift.
        for (let i = 0; i < frames; i++) {
          const x = outCh[i];
          const y = b0 * x + z1;
          z1 = b1 * x - a1 * y + z2;
          z2 = b2 * x - a2 * y;
          outCh[i] = y;
        }

        // Denormal flush — números subnormales colapsan perf en algunas FPU.
        if (Math.abs(z1) < DENORMAL_THRESHOLD) z1 = 0;
        if (Math.abs(z2) < DENORMAL_THRESHOLD) z2 = 0;
        // NaN/Inf guard — si coefs inestables se colaron, resetea sin esperar 'reset'.
        if (!isFinite(z1) || !isFinite(z2)) { z1 = 0; z2 = 0; }
        this.z1[idx] = z1;
        this.z2[idx] = z2;
      }
    }

    // Si el input tenía menos canales que el output (mono → stereo), duplicar.
    if (channelCount < output.length) {
      const src = output[0];
      if (src) {
        for (let ch = channelCount; ch < output.length; ch++) {
          const dst = output[ch];
          if (dst) dst.set(src);
        }
      }
    }

    return true;
  }
}

registerProcessor('biquad-processor', BiquadProcessor);

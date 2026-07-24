/**
 * Tests for parseOrigin — troceo de `contextUri` al origen de reproducción.
 * Cubre cada esquema + los casos límite (centinela top-weekly, plegado
 * smartmix→playlist, id vacío, sin ':', null).
 */

import { describe, expect, it } from 'vitest';
import { parseOrigin } from './playback-origin';

describe('parseOrigin', () => {
  it('álbum', () => {
    expect(parseOrigin('album:abc123')).toEqual({ kind: 'album', id: 'abc123' });
  });

  it('playlist', () => {
    expect(parseOrigin('playlist:pl-1')).toEqual({ kind: 'playlist', id: 'pl-1' });
  });

  it('artista', () => {
    expect(parseOrigin('artist:art-9')).toEqual({ kind: 'artist', id: 'art-9' });
  });

  it('smartmix se pliega a playlist (mismo id)', () => {
    expect(parseOrigin('smartmix:pl-1')).toEqual({ kind: 'playlist', id: 'pl-1' });
  });

  it('top-weekly es centinela (no lleva id navegable)', () => {
    expect(parseOrigin('playlist:top-weekly')).toEqual({ kind: 'top-weekly' });
  });

  it('id con ":" dentro se conserva entero', () => {
    expect(parseOrigin('playlist:a:b:c')).toEqual({ kind: 'playlist', id: 'a:b:c' });
  });

  it('null / vacío → null', () => {
    expect(parseOrigin(null)).toBeNull();
    expect(parseOrigin(undefined)).toBeNull();
    expect(parseOrigin('')).toBeNull();
  });

  it('esquema sin id → null', () => {
    expect(parseOrigin('album:')).toBeNull();
    expect(parseOrigin('playlist:')).toBeNull();
  });

  it('sin ":" → null', () => {
    expect(parseOrigin('album')).toBeNull();
  });

  it('esquema desconocido → null', () => {
    expect(parseOrigin('queue:xyz')).toBeNull();
    expect(parseOrigin('mix:xyz')).toBeNull();
  });
});

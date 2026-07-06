/**
 * Label de conteos de un artista — "X álbumes · Y apariciones". Diferencia
 * la discografía propia (album artist) de las participaciones ("Aparece
 * en"). Compartido entre ArtistCard (/library/artists) y la meta-line del
 * hero de ArtistDetail para que ambas superficies hablen igual.
 */
export function artistCountsLabel(own: number, appears: number): string | null {
  const parts: string[] = [];
  if (own > 0) parts.push(`${own} ${own === 1 ? 'álbum' : 'álbumes'}`);
  if (appears > 0) parts.push(`${appears} ${appears === 1 ? 'aparición' : 'apariciones'}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

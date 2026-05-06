/**
 * Limpia las notas Last.fm que vienen en `getAlbumInfo2.notes` y
 * `getArtistInfo2.biography`. Mirrors `cleanNotes()` del iOS.
 *
 * Last.fm always closes the body con un link "<a href=...>Read more on
 * Last.fm</a>" + el texto literal. Lo removemos entero porque el link
 * apunta a una página externa que no queremos abrir desde el card.
 *
 * Después strippeamos el resto de tags HTML (typically <br> y nada más),
 * y unescape de las entidades más comunes que Last.fm devuelve crudas.
 */
export function cleanNotes(html: string | undefined | null): string {
  if (!html) return '';

  return html
    .replace(/<a[^>]*>[^<]*Read more on Last\.fm[^<]*<\/a>/gi, '')
    .replace(/Read more on Last\.fm/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

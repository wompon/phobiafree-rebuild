/** R2 hero image override helpers (kept separate to avoid circular imports). */

export function r2ImageKey(slug, filename) {
  return `site-img/${slug}/img/${filename}`;
}

export async function serveSiteImageOverride(env, pathname) {
  const m = pathname.match(/^\/((?:fear-of-[a-z0-9-]+|my_fear))\/img\/([a-z0-9._-]+)$/i);
  if (!m || !env.CHAT_FILES) return null;
  const key = r2ImageKey(m[1], m[2]);
  const obj = await env.CHAT_FILES.get(key);
  if (!obj) return null;
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // Hero images rarely change; cache a day so the ~50-100KB WebP isn't refetched
  // every visit. Re-uploading via /editor deletes the stale .webp (see upload
  // handler), so a new photo shows the fresh PNG until optimize-images is re-run.
  headers.set('cache-control', 'public, max-age=86400');
  return new Response(obj.body, { headers });
}

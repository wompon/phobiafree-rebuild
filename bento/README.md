# Bento phobia pages (newincludes)

Like the old PHP `includes/` model, but assembled **at build time** into complete SEO-ready HTML.

## Layout

- `bento/newincludes/` — shared chrome (head, nav, footer, modal, consult script)
- `bento/template.html` — page assembly order
- `bento/styles.css` — shared styles
- `bento/pages/<slug>/page.json` — meta, photo, slug aliases
- `bento/pages/<slug>/body.html` — hero + main content for that phobia

## Commands

```bash
# Refresh includes from a hand-edited public HTML (rarely needed)
node scripts/setup-bento-includes.js

# Build all pages under bento/pages/ → public/<slug>.html
node scripts/build-bento.js

# Deploy
npx wrangler deploy -c wrangler-site.jsonc
```

## Add another phobia

1. Add an entry in `scripts/generate-bento-pages.js` (or extend `bento/phobias.json` + regenerate)
2. Put the hero image at `public/<slug>/img/<short-name>.png` (e.g. `snakes.png`)
3. Run:

```bash
node scripts/generate-bento-pages.js
node scripts/build-bento.js
npx wrangler deploy -c wrangler-site.jsonc
```

Old latin URLs (e.g. `/ophidiophobia`) 301-redirect to the new English paths.

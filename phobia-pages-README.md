# Static phobia pages — what's going on

## The good news about your architecture
Your phobia pages are built really well for this migration. Each one (like
aerophobia.php) is just a **content file** — a list of headlines and copy. All
the actual HTML lives in ONE shared file, phobia-template.php. That's exactly
how it should be.

Because these pages have no per-visitor logic (they're the same for everyone),
we don't need PHP or a Worker for them at all. We can render them into plain
.html files once and serve them as static files on Cloudflare Pages — fast and
free.

## The one blocker
phobia-template.php pulls in 8 helper files from an `includes/` folder that
did NOT come through when you uploaded the project:

  includes/head.php          (the <head> section — fonts, CSS, meta tags)
  includes/nav.php           (the top navigation bar)
  includes/phobia_map.php    (maps slugs to display names)
  includes/modal.php         (the "book consultation" popup)
  includes/chat.php          (the chat widget)
  includes/tracker.php       (the visitor-tracking script tag)
  includes/footer.php        (the page footer)
  section_order_init.php     (homepage section ordering)

Without these, I can't produce complete pages — they'd be missing their head,
nav, footer, booking popup, etc.

## What I built anyway
build-phobia-pages.js — a generator script. Once you provide the includes,
running it ONCE produces all ~40 phobia pages as static .html files, ready to
drop into Pages. It:
  - reads each phobia's content file
  - inlines the shared template + includes
  - writes dist/<phobia>.html for each one

So we're not hand-converting 99 files — the script does them all in one run.

## What I need from you
Upload the `includes/` folder (those 8 files). They're on your server in the
same directory as the phobia pages. If you're not sure where:
  - In GoDaddy cPanel File Manager, look in the phobiafree.life folder for a
    subfolder called `includes`
  - Also grab section_order_init.php (it's in the main folder, not includes/)

Once you upload those, I'll wire them into the generator, we run it, and all the
phobia pages become static files.

## If the includes are hard to find
Alternative: we skip the auto-generator and instead I build you a single fresh
modern template from scratch (new head/nav/footer/modal), and we generate the
pages from your existing content files against THAT. You'd lose the exact old
styling but get a clean rebuild. Your call — but easiest is just uploading the
includes folder if you can find it.

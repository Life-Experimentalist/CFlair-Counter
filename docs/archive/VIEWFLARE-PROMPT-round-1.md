# Prompt: CFlair-Counter → ViewFlare

Paste everything below the line into a fresh Claude Code session opened at
`V:\Code\ProjectCode\CFlair-Counter`. It is one job in four parts: the rename, the
install-count aggregator, the shields endpoint, and the brand. Do them in that order,
part 2 onward assumes the new name is already in place.

---

You are working in `CFlair-Counter`, a Cloudflare Pages Advanced Mode project
(`functions/` + a bundled `_worker.js`, D1 for storage) that serves view counts and SVG
badges at `counter.vkrishna04.me`. It is being renamed to **ViewFlare** and given three
new capabilities. Work through the four parts in order. Do not push; commit each part
separately and stop for review.

## Ground rules

- **Do not invent or estimate numbers.** Every count this service reports must come from a
  real API response. If an upstream API is unreachable, the aggregate must say so rather
  than guess or fall back to a stale figure without labelling it stale.
- **Never sum two registries into one number without saying so.** If VS Code Marketplace
  and Open VSX are added together, the response must carry the breakdown as well as the
  total, and any badge that shows only the total must label it "installs (all registries)".
- Do not commit secrets. `wrangler.toml` currently has `ADMIN_PASSWORD =
  "your-secure-admin-password-here"`. That placeholder stays a placeholder; real values
  belong in Cloudflare's dashboard secrets, not the repo.
- Match the existing code style. This is plain TypeScript on Workers with no framework;
  keep it that way.

## Part 1: the rename

`CFlair`, `cflair`, `CFlairCounter` and `cflaircounter` appear in **11 tracked files**
(ignore anything under `.wrangler/`, which is build scratch):

```
README.md
INTEGRATION.md
package.json
wrangler.toml
public/index.html
docs/AI-AGENT-QUICKSTART.md
docs/CLOUDFLARE-SETUP.md
docs/DEVELOPMENT-GUIDE.md
postman/README.md
postman/CFlairCounter.postman_collection.json
postman/CFlairCounter.postman_environment.json
.portfolio/project.json
```

Rules for the pass:

- Display name → **ViewFlare**. Package/worker slug → `viewflare`. Postman files get
  renamed on disk to `ViewFlare.postman_collection.json` and
  `ViewFlare.postman_environment.json`, and their internal `info.name` updated too.
- `wrangler.toml`'s `name = "cflaircounter"` → `name = "viewflare"`. **Flag this to the
  user before they deploy**: renaming a Pages project in `wrangler.toml` does not rename
  the project in Cloudflare. It targets a *different* project. The custom domain
  `counter.vkrishna04.me` has to be moved to the new project in the Cloudflare dashboard,
  and the D1 binding re-attached. Write those steps into `docs/CLOUDFLARE-SETUP.md` as a
  migration section. Do not attempt the Cloudflare-side move yourself.
- **Do not change the public URL.** `counter.vkrishna04.me` stays. It is already used by
  the portfolio and by the GitHub profile README badge
  (`counter.vkrishna04.me/api/views/VKrishna04/badge`), and breaking it breaks both. If a
  second hostname is wanted later, add it as an alias, never as a replacement.
- Add one line near the top of the README: the project was previously called
  CFlair-Counter. People who bookmarked it should be able to tell it is the same thing.
- `compatibility_date = "2024-03-20"` is stale. Bump it to the current date and run the
  local dev server to confirm nothing breaks.

## Part 2: the install-count aggregator

New capability. ViewFlare should be able to report, for a given project, how many times it
has actually been installed or downloaded, pulled live from wherever it ships, and added
up in one place.

Sources to support, each optional per project:

| Source | Where the number comes from |
|---|---|
| VS Code Marketplace | the Marketplace public extension-query API, `statistics` → `install` |
| Open VSX | `https://open-vsx.org/api/{namespace}/{extension}` → `downloadCount` |
| PyPI | the PyPI JSON API, or pypistats for a rolling window, so pick one and say which in the response |
| GitHub releases | sum of `assets[].download_count` across releases for the repo |
| npm | the npm registry downloads endpoint, if a package is configured |

Design requirements:

- Configuration is per project, stored alongside the existing project record in D1. A
  project with no sources configured behaves exactly as it does today.
- **Cache aggressively.** These APIs are rate-limited and some are slow. Cache each source
  independently with a TTL (start at 6 hours, make it configurable) so one dead upstream
  cannot take down the whole response.
- The response carries the breakdown *and* the total, plus a `fetchedAt` per source and a
  `stale: true` flag on any source served from an expired cache because the upstream
  failed. Never silently substitute a stale number for a live one.
- Partial failure is normal, not an error: if 3 of 4 sources answer, return those 3 with
  the total labelled as covering 3 of 4, and the failed one marked. Do not 500.
- Add a `GET /api/installs/{project}` endpoint and document it in `INTEGRATION.md`
  alongside the existing views API, with a real worked example.

## Part 3: shields

The counter already serves SVG badges. Extend that so a user can put their own numbers on
their own README without a third-party shields.io round-trip.

- `GET /api/installs/{project}/badge`: an SVG badge of the aggregate, same styling
  options the existing view badge supports (colour, label, style).
- Also expose `GET /api/installs/{project}/shields.json` in
  [shields.io endpoint format](https://shields.io/badges/endpoint-badge)
  (`{schemaVersion, label, message, color}`) so anyone who prefers shields.io can point it
  at ViewFlare as a custom endpoint. Cheap to add, and it makes ViewFlare useful to people
  who are not going to switch badge providers.
- Every badge route must set sensible `Cache-Control`, because GitHub's camo proxy will hammer
  these otherwise.
- Document both in `INTEGRATION.md` with copy-pasteable markdown.

## Part 4: the brand

- A logo and a social banner, placed at `docs/public/logo.png` and
  `docs/public/banner.png` to match the convention CogniGate already uses in this
  ecosystem, and referenced from the README header.
- `public/index.html` is the admin panel; give it the new name and the logo.
- **Ask the user for the image files rather than generating placeholder art.** There is a
  set of image-generation prompts in `docs/BRAND-PROMPTS.md` (see below), the user is
  producing the assets from those. Until the files exist, reference them but do not commit
  broken image links to the README; keep the header text-only and add a TODO.

Write `docs/BRAND-PROMPTS.md` containing the prompts below verbatim, so the user has them
in the repo.

---

# Image prompts for ViewFlare (for the user to run)

**Logo: square app icon, 1024×1024, transparent background**

> A minimal flat vector app icon for a developer analytics service called ViewFlare. The
> mark is a stylised eye whose iris is a small solar flare, a rising arc of light with
> three short radiating rays. Geometric, built from clean circles and arcs, no gradient
> mesh, no photorealism, no text. Two colours only: a warm amber-to-orange flare against a
> deep indigo eye outline. Flat vector, sharp edges, generous negative space, reads clearly
> at 32×32. Transparent background.

**Alternate logo, if the eye reads as surveillance rather than analytics**

> A minimal flat vector app icon for a developer analytics service called ViewFlare. The
> mark is a bar chart of three ascending bars where the tallest bar erupts into a small
> solar flare arc at its top. Geometric, clean, no text, no gradient mesh. Warm amber and
> orange flare against a deep indigo base. Flat vector, sharp edges, reads clearly at
> 32×32. Transparent background.

**Social banner: 1280×640, for the README header and the GitHub social preview**

> A wide developer-tool banner, 1280 by 640, dark deep-indigo background with a subtle
> grid of faint dots. On the left, the ViewFlare mark: a stylised eye with a solar-flare
> iris in warm amber and orange. To its right, the word "ViewFlare" in a clean geometric
> sans-serif, white, and beneath it in smaller muted grey the line "One place for every
> number your projects earn." In the lower right, three small abstract badge shapes
> suggesting count pills, in amber. Flat vector illustration, high contrast, lots of empty
> space, no photorealism, no stock-photo people, no extra text.

**Favicon: 512×512**

> The ViewFlare mark alone, the solar-flare eye, flat vector, amber flare on deep indigo,
> filled circular background rather than transparent, no text, maximum contrast, designed
> to stay legible at 16×16.

---

## Finish

Run whatever build and lint the repo has. Commit each of the four parts as its own commit.
**Do not push.** Then report: which files were renamed, what the Cloudflare-side migration
steps are, which install sources you implemented and which you could not, and anything in
the four parts you decided against and why.

# ViewFlare brand art: prompts and where each output goes

Nothing here runs automatically. Run the prompts yourself in whatever image tool
you prefer, then save the results to the paths in the table and commit them.

## What already exists

`assets/logo.png` is a 2048x2048 mark you generated earlier: three ascending
white bars on a rounded navy square, the tallest bar erupting into an amber
flame. That composition is the brand. Every prompt below keeps it.

Its colours drifted from the site though. The icon uses navy `#1c2352` and a
single amber `#fc9f18`; the deployed page sits on `#05060d` and runs the flare
through `#ffc247` into `#ff7a45`. Side by side the icon reads bluer and flatter
than the product. Regenerating with the hexes below closes that gap. If you would
rather ship what you have, it is usable, just noticeably lighter than the page it
sits on.

## The palette, taken from the shipped CSS

| Token | Hex | Role |
|---|---|---|
| `--space-0` | `#05060d` | the ground, near black with a blue cast |
| `--space-1` | `#0a0d18` | one step up, panel fills |
| `--space-2` | `#111524` | icon plate, card fills |
| `--flare-1` | `#ffc247` | the hot core of the flare |
| `--flare-2` | `#ff7a45` | the flare's body |
| `--flare-3` | `#e0457b` | the flare cooling into rose |
| `--flare-4` | `#9b5de5` | the cold tail, violet |
| `--ion` | `#5ad3f0` | the cold counterpart, links and figures |
| `--text-main` | `#e9edf9` | the bars, and any text |
| `--text-muted` | `#8a92ac` | secondary text |

The flare is one gradient read in order: `#ffc247` at the hottest point, through
`#ff7a45`, into `#e0457b`, ending at `#9b5de5`. Do not scatter those four as
separate flat colours; they are a temperature ramp along a single shape.

## Outputs

| File | Size | Prompt | Used by |
|---|---|---|---|
| `assets/logo.png` | 2048 square | 1. App icon | the source of truth, downscaled into the rest |
| `public/logo.png` | 512 square | downscale of 1 | the page header and the admin shell |
| `public/logo-dark.png` | 512 square | 2. Light-ground variant | any light-background embed |
| `public/favicon.png` | 512 square | 3. Favicon | browser tab |
| `public/og.png` | 1200x630 | 4. Open Graph card | link previews on every platform |
| `docs/public/banner.png` | 1280x640 | 5. Social banner | README header, GitHub social preview |
| `public/wordmark.svg` | vector | 6. Wordmark, see the warning | header lockup |

Downscaling is a command, not a prompt. Once `assets/logo.png` is final:

```bash
python -c "from PIL import Image; im=Image.open('assets/logo.png'); im.resize((512,512), Image.LANCZOS).save('public/logo.png', optimize=True)"
```

## A warning about text

Image generators cannot spell. Every one of them will hand back VIEWFLAIRE,
VEIWFLARE, or VIEWFLARF, and the failure is not always obvious at a glance. Do
not ask for the word "ViewFlare" in any prompt below. Generate the mark alone,
then set the word in a vector tool (Figma, Inkscape, Illustrator) in Space
Grotesk Medium, which is the display face the site already loads. Prompts 4 and
5 are composed that way on purpose: generate the background and the mark, add the
text yourself.

---

## 1. App icon, 1024x1024 or larger, transparent background

Replaces `assets/logo.png`.

> A flat vector app icon for a developer analytics service. Inside a rounded
> square plate in near-black blue `#111524` with a 22 percent corner radius, three
> ascending vertical bars in off-white `#e9edf9`, evenly spaced, flat square tops,
> the tallest on the right. The top of the tallest bar breaks into a stylised
> flame: two clean tapering tongues of fire rising and curling right, drawn as
> solid vector shapes with sharp corners, no soft edges. The flame is a vertical
> gradient, amber `#ffc247` at its base where it meets the bar, through orange
> `#ff7a45` in the body, cooling to rose `#e0457b` at the tips. Geometric
> construction, uniform stroke logic, generous negative space between the bars.
> Reads clearly at 32 pixels. Centred, transparent background outside the plate.

Negative: no text, no letters, no numbers, no gradient mesh, no photorealistic
fire, no smoke, no embers, no sparks, no glow bloom, no drop shadow, no bevel, no
3D extrusion, no outer stroke, no watermark, no background scene.

## 2. Light-ground variant, 1024x1024, transparent background

Replaces `public/logo-dark.png`. The name is historical: this is the variant for
placing on a light background, where the dark plate would be a heavy block.

> The same icon, plate removed. Three ascending bars in deep near-black blue
> `#05060d`, the tallest breaking into the same two-tongued flame with the amber
> `#ffc247` to orange `#ff7a45` to rose `#e0457b` vertical gradient. No enclosing
> shape of any kind. Flat vector, sharp corners, transparent background.

Negative: no plate, no rounded square, no circle, no container, no text, no
shadow, no glow, no 3D.

## 3. Favicon, 512x512, filled background

Replaces `public/favicon.png`. This one is not a downscale of prompt 1: at 16
pixels the three bars collapse into a smear, so the favicon drops to two bars.

> A flat vector favicon. Filled rounded square in near-black blue `#111524`,
> edge to edge, no transparent margin. On it, two thick vertical bars in off-white
> `#e9edf9` with a wide gap between them, the right one taller and breaking into a
> single simple flame tongue in a gradient from amber `#ffc247` to orange
> `#ff7a45`. Maximum contrast, chunky shapes, minimum detail. Must stay legible at
> 16 pixels.

Negative: no text, no thin lines, no small details, no third bar, no gradient
mesh, no shadow, no transparency.

## 4. Open Graph card, 1200x630, background only

Composed into `public/og.png`. Generate the background here, then place the mark
from prompt 2 and set the text in a vector tool. Until that file exists, the
`og:image` meta tag stays out of the HTML rather than pointing at a 404.

> A wide abstract background for a developer tool link preview, 1200 by 630.
> Deep space ground, a vertical gradient from `#05060d` at the top to `#0a0d18` at
> the bottom. A faint regular grid of small dots in `rgba(150,168,214,0.13)` across
> the whole field. Rising from the lower right corner, a single broad soft plume of
> light on a diagonal, amber `#ffc247` at its narrow root, spreading through orange
> `#ff7a45` and rose `#e0457b`, dissolving into violet `#9b5de5` and then into the
> background before it reaches the top edge. The left two thirds stay dark and
> almost empty. Calm, wide, cinematic, no focal object.

Negative: no text, no letters, no logo, no mockups, no device frames, no people,
no stars, no lens flare, no nebula clouds, no busy detail, nothing in the left
half.

Compose on top, in a vector tool:
- The mark from prompt 2 at roughly 120 pixels, upper left of the clear area.
- "ViewFlare" in Space Grotesk Medium, 72 pixels, `#e9edf9`.
- "Every number your projects earn, in one place." in IBM Plex Sans Regular, 32
  pixels, `#8a92ac`, directly under it.

## 5. Social banner, 1280x640, background only

Composed into `docs/public/banner.png`, which is the README header and the GitHub
social preview. GitHub crops the preview, so keep everything important inside the
centre 1200x600.

> The same deep space field, 1280 by 640: vertical gradient `#05060d` to
> `#0a0d18`, faint dot grid in `rgba(150,168,214,0.13)`. Across the lower third, a
> thin rising line chart drawn as a single clean stroke in `#5ad3f0`, four gentle
> steps upward, no fill under it, no axes, no labels, no data points. Where the
> line ends on the right it releases one narrow plume of light upward, amber
> `#ffc247` into orange `#ff7a45` into rose `#e0457b`, fading to nothing. The upper
> half stays empty for text.

Negative: no text, no numbers, no axis labels, no grid lines, no legend, no
tooltips, no UI chrome, no screenshots, no people, no 3D.

Compose on top: the mark from prompt 2 and the same two text lines as prompt 4,
in the empty upper half.

## 6. Wordmark, vector, no generator

Saved as `public/wordmark.svg`. Do not generate this. Set it:

- "ViewFlare" in Space Grotesk Medium, single weight, no italics, letter spacing
  at minus 1 percent, in `#e9edf9`.
- The mark from prompt 2 to its left, height matched to the cap height of the V,
  gap equal to the width of the letter e.
- Export as SVG with the text converted to outlines, so it renders the same
  everywhere without loading a font.

## After you generate

The two files currently in `public/` are the old CLOUD COUNTER art and are 1.3MB
and 1.2MB. Both are shipped to every visitor. Replacing them with 512 pixel
downscales takes each under 100KB, which matters more for the page score than any
of the art choices above.

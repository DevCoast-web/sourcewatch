# Aperture Eye

SourceWatch's selected mark: folded aperture blades surrounding a square preserved record. The master SVG is `aperture-eye.svg`; use `aperture-eye-light.svg` on dark backgrounds. The paths are editable vector geometry. PNG exports include real transparency where appropriate.

- Forest green: `#194D3B`
- Warm ivory: `#F6F3EB`
- Keep clear space of at least half the central square on every side.
- Use the standalone mark at 32px or larger where possible; use the app-icon version for small favicon contexts.
- Keep the square center, negative spaces and proportions intact. Do not add gradients, shadows, outlines or verification badges to the mark.
- The symbol identifies SourceWatch; it is not a certification seal or evidence-verification status.

`wordmark.svg` includes the SourceWatch name and tagline. SVG text uses Arial with a sans-serif fallback; convert text to outlines in a design editor for font-independent print delivery. Symbol geometry itself has no font dependency.

Regenerate the tracked SVG, PNG, Windows ICO, favicon and native iOS icon from the same geometry with:

```sh
node scripts/build-brand.mjs
```

Requires installed project dependencies and Playwright Chromium. The iOS asset has a full opaque square background so iOS can apply its own mask. Desktop PNG/ICO and the web icon use rounded corners. Source assets change immediately; previously published binaries retain their original embedded icons until rebuilt.

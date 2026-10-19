# Experimental Scripts

This directory contains developer-facing manual checks, diagnostics, and feasibility spikes.

These files are intentionally kept out of the automated test tree:

- They do not act as CI-style regression tests.
- Several scripts depend on a live local server, local binaries, or interactive inspection.
- They are meant for on-demand investigation, not for `npm test`.

Current structure:

- `diagnostics/`: environment and library introspection scripts such as CLI availability, Ghostscript capability checks, MuPDF API inspection, and pdf.js feature probing.
- `manual/`: scripts that exercise a live server or multi-step local workflow and are best treated as manual verification helpers.
- `spikes/`: one-off feasibility experiments for MuPDF SVG generation and resource cleanup behavior.

Image-extraction probes used while building `src/server/pdf-images.ts`:

- `probe-mupdf.mjs`: which output document formats the bundled MuPDF accepts (`png`/`jpeg`/`svg` are supported; `bmp`/`tiff`/`gif`/`webp` are not).
- `probe-census.mjs`: PDF stream census (`/Subtype /Image` vs content streams vs fonts) plus a mupdf device-callback census. This is what proved a LaTeX paper can contain **zero** bitmap images while still showing hundreds of vector `fillPath` calls.
- `probe-coords.mjs`: image `ctm` vs `toStructuredText` bbox coordinate spaces. Both use the same top-left origin, so no flipping is needed.
- `probe-fixture.mjs`: confirms the generated fixture decodes cleanly for every filter, with no decoder warnings.
- `probe-captions-fixture.mjs`: prints the caption actually bound to each extracted image, which is the fastest way to debug naming regressions.
- `probe-endpoint.mjs`: end-to-end check of `POST /api/pdf/extract-images` against a real server instance.

Run these scripts from the project root so package resolution, server URLs, and relative paths stay predictable.
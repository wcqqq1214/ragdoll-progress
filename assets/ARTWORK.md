# Fanqie artwork

Generated with the built-in imagegen tool, using the owner's cat photos
`IMG_4427.jpeg` and `IMG_4442.jpeg` as identity references and the previous
`preview.png` as the illustration style reference. Source photos are not
distributed with this repository.

`fanqie-atlas.png` is the original transparent 4-column, 2-row generated atlas.
`cat-sprite.png` packs its eight poses in one horizontal row of 420 × 235 cells:
six running frames, resting loaf, curled sleeping pose. The extension displays
each cell at 84 × 47 CSS pixels. Running takes 840 ms per cycle.

`preview.png` and `ragdoll-progress.gif` are derived from the same frames.
The GIF uses six 140 ms frames. `preview.html` demonstrates the production CSS
on light and dark backgrounds, at actual size and 3× size.

To rebuild, make the optional `sharp` Node package available and run
`node scripts/build-sprites.cjs`. The extension itself has no runtime dependencies.
The build crops each cell to its primary silhouette, uses one common scale,
aligns the face side and ground contact, and packs the PNG and GIF assets.

## Generation prompt

Use case: identity-preserve.
Asset type: production sprite atlas for a tiny browser video-progress companion.
Input images: images 1 and 2 are identity references of the real cat Fanqie; image 3 is the existing illustration style reference. Redraw the character to match this specific real adult ragdoll, preserving the soft hand-painted illustration style.
Deliver one transparent RGBA PNG, landscape 2:1, arranged as EXACTLY 4 columns by 2 rows of equal square cells, with one full-body cat per cell. No text, grid lines, shadows on a floor, scenery, extra objects or background. Actual alpha transparency, no checkerboard painted into the image.
Character: fluffy adult seal bicolor ragdoll, fuller rounded cheeks, generous white chest ruff, creamy white body with muted taupe saddle, very plush broad dark brown tail, dark ears, pink nose, natural subdued blue eyes with dark pupils (not huge anime eyes). Faithfully preserve the forehead's pointed white blaze widening onto the nose and the slightly asymmetric dark brown eye masks from the photos. Same head size, facial markings, body volume, camera angle, and character identity throughout all eight cells.
Composition: every cat faces RIGHT in a side/three-quarter view, eyes visible. Each square cell has ample transparent padding. Full tail and all paws inside cell, constant character scale, same floor baseline approximately at 78% of each cell's height; max horizontal footprint 86% of cell width. Maintain consistent head anchor across first 6 frames. Artwork should read clearly at 84px wide: simplified fur tufts, clear color masses, delicate muted brown outline; no heavy dark outlines.
Read order left to right, top then bottom.
Cells 1–6: six consecutive distinct poses of ONE smooth gentle running cycle, ordered contact, down/compression, push-off, flight/extension, opposite contact, recovery. Keep body and head stable with only subtle bounce, coherent alternating fore/hind legs, tail follows softly. It's a soft padded trot/bound, not an extreme leap; avoid body stretching or morphing.
Cell 7: same cat peacefully lying in a loaf, front paws tucked, head upright looking right, tail wrapped alongside, eyes relaxed and open.
Cell 8: same cat curled up asleep, head resting on forepaws on the right, eyes closed, plush tail curled around body.
This is an integrated replacement of the existing animation: exact 4x2 regular layout, eight cleanly separated full cats, honest alpha transparency, stable scale and likeness are critical.

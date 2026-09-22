# Geometry library

Core nesting math lives in `geometry.ts` (inches internally).

**Unit tests:** run `npm test` (vitest). Watch mode: `npm run test:watch`.

Covered: yardage/`orderYards`, `canPlace`, panel footprint/rotate, used length,
`patternHOffset` (centers leftover width), pattern cell centers & snap (top-origin
vertical; centered horizontal), **1D stripes** when H or V repeat is 0,
`findBestSpotOnPattern` (2D / vertical / horizontal stripe modes, no overlap),
`nextSequentialLabel`, `autoNestCandidates`, `suggestSplit` (oversized seam/split
recommendation), `tryRotate90` (refuse rotate when footprint won't fit the bolt).

## Trapezoids (MVP)

Panels may be `kind: 'rect' | 'trap'`. Traps have parallel top & bottom across the bolt
at rotation 0. **Seam allowance:** each finished dim expands by 2×SA
(`cutTop/Bottom/Height = finished + 2×SA`), then an isosceles trapezoid is built and
centered in its AABB. Overlap uses convex polygon SAT when a trap is involved;
auto-nest still places via AABB footprints.

## Circles (MVP)

Panels may be `kind: 'circle'`. Store cut diameter as `width = length = cutDiameter`
(`circleCutFromFinished`: finishedDiameter + 2×SA). Footprint is always a square
(rotation-invariant; `orientationsThatFit` returns `[0]` only). Overlap:
circle–circle uses center distance; circle–rect uses closest-point-on-AABB;
circle–trap uses a 32-gon via `panelPolygon` + SAT. Rotate/flip are no-ops (UI hides).
`suggestSplit` is not used — oversized circles get `PANEL_TOO_LARGE_RESIZE`.


## Irregular quads (MVP)

Panels may be `kind: 'irregular'`. Defined by four finished side lengths (Left, Front,
Right, Back) plus one diagonal (front-left → back-right). **Seam allowance:** each of
the five finished lengths expands by 2×SA, then `quadPolygonFromSides` builds the cut
polygon (AABB → `width`/`length`). Default diagonal follows fabric-calculator rules:
symmetric/keystone when an opposite pair is equal; forepeak (right angle at front-left)
when all four sides are unequal. Overlap uses convex polygon SAT like traps; rotate/flip
OK; oversized → `PANEL_TOO_LARGE_RESIZE` (no split).

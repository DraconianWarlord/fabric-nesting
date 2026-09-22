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
auto-nest still places via AABB footprints. Circles are deferred.

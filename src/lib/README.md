# Geometry library

Core nesting math lives in `geometry.ts` (inches internally).

**Unit tests:** run `npm test` (vitest). Watch mode: `npm run test:watch`.

Covered: yardage/`orderYards`, `canPlace`, panel footprint/rotate, used length,
`patternHOffset` (centers leftover width), pattern cell centers & snap (top-origin
vertical; centered horizontal), **1D stripes** when H or V repeat is 0,
`findBestSpotOnPattern` (2D / vertical / horizontal stripe modes, no overlap),
`nextSequentialLabel`, `autoNestCandidates`, `suggestSplit` (oversized seam/split
recommendation), `tryRotate90` (refuse rotate when footprint won't fit the bolt).

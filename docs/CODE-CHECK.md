# Fabric Nesting — Code Check

Owned by **Nesting Code Check** bot. Run on weekday mornings and on demand. Stay quiet when green.

## Commands (repo root)

```bash
npm test
npx tsc -b --pretty false
```

Optional (non-blocking style): `npm run lint`

## Known footguns (fail / flag)

1. **Unbounded nest candidate grids** — cartesian / stepped x×y probes without a hard cap (past freeze on irregular Auto-Nest). Prefer capped candidate sets (`CANDIDATE_CAP` or equivalent) and regression/perf tests that would catch a freeze.
2. **Dynamic PDF imports** — `jspdf` / export paths must stay sync-safe for click handlers (no broken lazy import that leaves Export PDF dead). Keep export wiring tests green.
3. **Missing probe geometry for poly kinds** — irregular / trap / circle packs must use real panel geometry in probes, not AABB-only when that caused bad nests; don’t regress to box-only probes for polys without an explicit decision + test.
4. **Layout regressions** — `layout.regression.test.ts` (and siblings) must stay green: header calc switch, mobile More menu, critical chrome classes.
5. **Calculator conventions** — B/W chrome + Sailrite Blue `#24285e` actions; don’t silently reintroduce rainbow chrome in shared tokens.

## Report shape (red only)

- Verdict: **fail**
- SHA + branch
- Which command failed + short excerpt
- One must-fix (if clear)

## Out of scope

Feature design, Brand tokens ownership, UX spacing reviews, other calculators (until Zach expands).

# Sailrite Fabric Nesting (prototype)

Local MVP of a fabric nesting tool inspired by [Sailrite’s Fabric Nesting app](https://www.fabric-calculator.com/fabric_nesting/index.html).

## Features (MVP)
- Set fabric usable width (inches / mm)
- Add rectangular or **trapezoid** panels (qty supported; finished sizes + seam allowance)
- Drag, rotate 90°, flip H/V, duplicate, delete
- Live **exact yards** + suggested order (next 0.25 yd)
- Overlap / off-bolt warnings

## Run
```bash
npm install
npm run dev
```

```bash
npm test
npm run build
```

## Notes
- Enter finished sizes; cut = finished + 2×seam allowance (rects and traps).
- Trapezoids: parallel top & bottom across the bolt; circles not yet supported.
- Estimate only — verify before cutting or ordering.

Live: https://fabric-nesting-woad.vercel.app

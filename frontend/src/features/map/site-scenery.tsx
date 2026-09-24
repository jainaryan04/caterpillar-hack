/**
 * Basemap art for the schematic site plan: terrain, the open pit, haul roads
 * and the fixed plant around them. Purely decorative — nothing here is data —
 * but every feature is drawn where its real zone sits (the zones seeded in
 * Prediction/db/schema.sql, projected through SITE_BOUNDS), so the scenery
 * agrees with the geofences drawn on top of it:
 *
 *   Bench 4 / Bench 5      -> terraced pit, ramp down from Haul Road 2
 *   Crusher Pad            -> crusher, feed hopper, conveyor, product stockpile
 *   Waste Dump North       -> overburden mounds
 *   Workshop & Fuel Bay    -> workshop shed, site office, parking bays
 *   Fuel Farm              -> storage tanks
 *
 * Colours are the --map-* tokens: earth tones only. Status colours stay
 * reserved for markers and brand yellow never appears on the map (spec §9.4).
 */

import { SITE_PLAN } from "@/lib/site-plan";

/* Haul roads between work areas */
export const ROADS = [
  "M 300 250 L 380 305 L 740 350 L 840 350",
  "M 330 430 L 380 305",
  "M 560 240 L 560 300",
  "M 845 430 L 850 470",
];

/* Ramp from Haul Road 2 down into the pit floor */
const RAMP = "M 380 305 C 330 280 250 250 235 205 C 225 170 300 150 400 168";

/* Pit terraces, outermost (highest) first */
const TERRACES = [
  { rx: 330, ry: 150, fill: "fill-(--map-pit-1)" },
  { rx: 260, ry: 112, fill: "fill-(--map-pit-2)" },
  { rx: 190, ry: 76, fill: "fill-(--map-pit-3)" },
  { rx: 120, ry: 44, fill: "fill-(--map-pit-4)" },
];
const PIT = { cx: 400, cy: 170 };

const DUMP_MOUNDS = [
  { x: 150, y: 425, rx: 40, ry: 24 },
  { x: 245, y: 400, rx: 46, ry: 27 },
  { x: 305, y: 478, rx: 34, ry: 20 },
  { x: 170, y: 515, rx: 50, ry: 29 },
  { x: 268, y: 552, rx: 36, ry: 19 },
];

const TREES: [number, number, number][] = [
  [960, 60, 8], [982, 92, 6], [944, 120, 7], [976, 152, 9], [958, 205, 6], [985, 240, 7],
  [722, 58, 7], [748, 36, 6], [706, 96, 6],
  [452, 468, 7], [474, 500, 6], [432, 522, 8], [642, 470, 6], [690, 520, 8], [664, 560, 6],
  [505, 602, 7], [418, 598, 6],
  [38, 150, 7], [26, 200, 6], [54, 262, 8], [36, 318, 6],
];

/** A stockpile / spoil mound: a dome with a lit face and a shaded face. */
function Mound({ x, y, rx, ry }: { x: number; y: number; rx: number; ry: number }) {
  return (
    <g>
      <path d={`M ${x - rx} ${y} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`} className="fill-(--map-stockpile) stroke-(--map-stockpile-edge)" strokeWidth="1" />
      <path d={`M ${x} ${y - ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} L ${x} ${y} Z`} className="fill-(--map-stockpile-edge)" fillOpacity="0.45" />
      <line x1={x - rx - 4} y1={y} x2={x + rx + 4} y2={y} className="stroke-(--map-stockpile-edge)" strokeWidth="1" />
    </g>
  );
}

function Tree({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} className="fill-(--map-tree)" />
      <circle cx={x + r * 0.3} cy={y + r * 0.25} r={r * 0.55} className="fill-(--map-tree-dark)" />
    </g>
  );
}

/** Building footprint with a ridge line — reads as a roof from above. */
function Building({ x, y, w, h, doors = 0 }: { x: number; y: number; w: number; h: number; doors?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="1.5" className="fill-(--map-building) stroke-(--map-roof)" strokeWidth="1.25" />
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} className="stroke-(--map-roof)" strokeWidth="1" />
      {Array.from({ length: doors }, (_, i) => {
        const dw = w / (doors * 2 + 1);
        return <rect key={i} x={x + dw * (i * 2 + 1)} y={y + h - 2} width={dw} height="4" className="fill-(--map-roof)" />;
      })}
    </g>
  );
}

export function SiteScenery({ compact }: { compact?: boolean }) {
  return (
    <g aria-hidden>
      <defs>
        <pattern id="map-gravel" patternUnits="userSpaceOnUse" width="14" height="14">
          <circle cx="3" cy="4" r="0.8" className="fill-(--map-contour)" />
          <circle cx="10" cy="9" r="0.6" className="fill-(--map-contour)" />
          <circle cx="6" cy="12" r="0.5" className="fill-(--map-contour)" />
        </pattern>
      </defs>

      {/* Terrain */}
      <rect width={SITE_PLAN.width} height={SITE_PLAN.height} className="fill-(--map-land)" />
      <rect width={SITE_PLAN.width} height={SITE_PLAN.height} fill="url(#map-gravel)" />

      {/* Open pit: filled terraces, bench crests as contour lines */}
      {TERRACES.map((t) => (
        <ellipse
          key={t.rx}
          cx={PIT.cx}
          cy={PIT.cy}
          rx={t.rx}
          ry={t.ry}
          className={`${t.fill} stroke-(--map-contour)`}
          strokeWidth="1.5"
        />
      ))}
      {TERRACES.slice(1).map((t) => (
        <ellipse
          key={`crest-${t.rx}`}
          cx={PIT.cx}
          cy={PIT.cy - 3}
          rx={t.rx + 4}
          ry={t.ry + 3}
          fill="none"
          className="stroke-(--map-ink)"
          strokeOpacity="0.35"
          strokeWidth="0.75"
          strokeDasharray="2 4"
        />
      ))}

      {/* Haul roads: shoulder, surface, centre line */}
      {[RAMP, ...ROADS].map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" className="stroke-(--map-contour)" strokeWidth={i === 0 ? 14 : 18} strokeLinecap="round" strokeLinejoin="round" />
          <path d={d} fill="none" className="stroke-(--map-road)" strokeWidth={i === 0 ? 10 : 14} strokeLinecap="round" strokeLinejoin="round" />
          {!compact ? (
            <path d={d} fill="none" className="stroke-(--map-road-line)" strokeWidth="1.25" strokeDasharray="8 7" strokeLinecap="round" />
          ) : null}
        </g>
      ))}

      {/* Waste Dump North: overburden mounds + truck tracks */}
      {!compact ? (
        <path d="M 330 430 C 290 450 230 460 200 470 M 330 430 C 300 500 280 520 270 535" fill="none" className="stroke-(--map-road)" strokeWidth="5" strokeLinecap="round" />
      ) : null}
      {DUMP_MOUNDS.map((m) => (
        <Mound key={`${m.x}-${m.y}`} {...m} />
      ))}

      {/* Crusher Pad: hopper -> crusher -> conveyor -> product stockpile */}
      <path d="M 786 296 L 806 296 L 802 312 L 790 312 Z" className="fill-(--map-roof)" />
      <Building x={800} y={300} w={40} h={32} />
      <line x1="840" y1="318" x2="900" y2="392" className="stroke-(--map-roof)" strokeWidth="5" strokeLinecap="round" />
      <line x1="840" y1="318" x2="900" y2="392" className="stroke-(--map-building)" strokeWidth="2" strokeDasharray="2 3" />
      <Mound x={904} y={410} rx={28} ry={20} />
      <Mound x={792} y={410} rx={22} ry={14} />

      {/* Workshop & Fuel Bay: shed with roller doors, site office, parking */}
      <Building x={775} y={488} w={72} h={44} doors={3} />
      <Building x={862} y={494} w={38} h={24} />
      <line x1="775" y1="568" x2="905" y2="568" className="stroke-(--map-ink)" strokeOpacity="0.5" strokeWidth="1" />
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={775 + i * 16} y1="568" x2={775 + i * 16} y2="584" className="stroke-(--map-ink)" strokeOpacity="0.5" strokeWidth="1" />
      ))}

      {/* Fuel Farm: storage tanks */}
      {[
        [941, 485],
        [966, 485],
        [953, 509],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="9" className="fill-(--map-tank) stroke-(--map-roof)" strokeWidth="1.25" />
          <circle cx={x} cy={y} r="4" fill="none" className="stroke-(--map-roof)" strokeWidth="0.75" />
        </g>
      ))}

      {TREES.map(([x, y, r]) => (
        <Tree key={`${x}-${y}`} x={x} y={y} r={r} />
      ))}

      {/* Orientation: north arrow and a 500 m scale bar (1 px ≈ 3.37 m at this latitude) */}
      {!compact ? (
        <>
          <g transform="translate(976 606)">
            <circle r="13" className="fill-(--map-land) stroke-(--map-ink)" strokeWidth="1" />
            <path d="M 0 -9 L 5 5 L 0 2 L -5 5 Z" className="fill-(--map-ink)" />
            <text y="-15" textAnchor="middle" className="fill-(--map-ink) font-sans text-[9px] font-semibold">
              N
            </text>
          </g>
          <g transform="translate(18 618)">
            <rect width="148" height="5" className="fill-(--map-land) stroke-(--map-ink)" strokeWidth="1" />
            <rect width="74" height="5" className="fill-(--map-ink)" />
            <text y="-4" className="fill-(--map-ink) font-mono text-[9px]">0</text>
            <text x="148" y="-4" textAnchor="end" className="fill-(--map-ink) font-mono text-[9px]">
              500 m
            </text>
          </g>
        </>
      ) : null}
    </g>
  );
}

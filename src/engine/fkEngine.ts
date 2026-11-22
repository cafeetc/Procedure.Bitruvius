/**
 * Feature Notes (Plain English):
 * - Forward Kinematics (FK) & 43-Joint Rig Graph: Walks parent-to-child from pelvis up
 *   the dual spine and out each limb, turning local angles into exact world positions.
 * - Closed-Chain Shoulder Bond & Chungus Rib Anchor: Keeps collarbones, shoulder blades,
 *   and inner ribs linked reliably with self-corrective stops so nothing snaps inside-out.
 * - Elastic Prometheus Wings: Lets the back wings pop out smoothly and flex arms alongside them.
 * - Anti-Phallic Lower Spine Engine: Shifts the lower spine (lumbar) and everything above
 *   it upward so the lower spine's bottom pixel sits cleanly on the hip swivel point
 *   instead of hanging down below the hips.
 * - Body-In-Canvas Guard: Measures the live head-to-toe puppet bounds and clamps panning,
 *   zooming, and popup room splits so Bitruvius can never leave the visible canvas.
 */
import { cloneGotzState } from './gotzHandEngine';
import {
  CANONICAL_PROPORTIONS,
  VECTOR_EPSILON_PX,
  safeFinite,
  snapAngularEpsilon,
} from './jointLimits';
import { ANATOMICAL_LIMITS, EFFECTOR_ROLES, LIMB_CHAINS } from './rigMetadata';
import { auditRigHierarchy, getCanonicalBoneLabel, sortNodesTopologically, type HierarchyAuditReport } from './rigRoles';
import type {
  BodyTurnView,
  BondStatusItem,
  CameraBox,
  Keyframe,
  PartRigInstance,
  PoseSnapshot,
  RawRigDef,
  RigNode,
  RigPiece,
} from './types';

export { CANONICAL_PROPORTIONS, auditRigHierarchy };
export type { HierarchyAuditReport };

export const DEG = Math.PI / 180;
const IDENTITY = [1, 0, 0, 1, 0, 0];

export function mkCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function decImage(src: string): Promise<ImageBitmap | HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(im).then(resolve, () => resolve(im));
      } else {
        resolve(im);
      }
    };
    im.onerror = () => reject(new Error('Failed to decode sprite asset'));
    im.src = src;
  });
}

const PT: Array<[number, number]> = [
  [33, 50],
  [50, 48],
  [64, 95],
  [71, 135],
  [72, 162],
  [55, 162],
  [48, 128],
  [38, 96],
].map((q) => [q[0] / 74, q[1] / 263]);

const PF: Array<[number, number]> = [
  [0, 104 / 263],
  [1, 104 / 263],
  [1, 1],
  [0, 1],
];

function cutPolyMask(
  src: CanvasImageSource & { width: number; height: number },
  poly: Array<[number, number]>,
  mir: boolean,
  cutOut: boolean,
): OffscreenCanvas | HTMLCanvasElement {
  const c = mkCanvas(src.width, src.height);
  const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = cutOut ? 'destination-out' : 'destination-in';
  g.beginPath();
  poly.forEach((q, i) => {
    const x = (mir ? 1 - q[0] : q[0]) * c.width;
    const y = q[1] * c.height;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  g.fill();
  return c;
}

function splitHandBitmap(
  bm: CanvasImageSource & { width: number; height: number },
  mir: boolean,
) {
  const t = cutPolyMask(bm, PT, mir, false);
  const r = cutPolyMask(bm, PT, mir, true);
  return {
    t,
    f: cutPolyMask(r as CanvasImageSource & { width: number; height: number }, PF, mir, false),
    p: cutPolyMask(r as CanvasImageSource & { width: number; height: number }, PF, mir, true),
  };
}

export function setPieceBitmap(
  p: RigPiece,
  bm: CanvasImageSource & { width: number; height: number },
  onReady?: () => void,
): void {
  if (p.sib && !p.gotzManaged) {
    if (!p.full0) p.full0 = bm;
    const q = splitHandBitmap(bm, !!p.mir);
    setPieceBitmap(p.sib[0], q.t, onReady);
    setPieceBitmap(p.sib[1], q.f, onReady);
    bm = q.p;
  }
  if (!p.bm0) p.bm0 = bm;
  p.bm = bm;
  const st = Math.max(1, Math.min(8, Math.floor(Math.min(p.w, p.h) / 16)));
  const mw = Math.ceil(p.w / st);
  const mh = Math.ceil(p.h / st);
  const o = mkCanvas(mw, mh).getContext('2d', {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  o.drawImage(bm, 0, 0, mw, mh);
  const d = o.getImageData(0, 0, mw, mh).data;
  const m = new Uint8Array(mw * mh);
  for (let i = 0; i < m.length; i++) {
    m[i] = d[i * 4 + 3] > 30 ? 1 : 0;
  }
  p.m = m;
  p.mw = mw;
  p.mh = mh;
  p.st = st;
  onReady?.();
}

export function addDigits(def: RawRigDef): void {
  if (def.dg) return;
  def.dg = 1;
  const map: Record<string, (typeof def.nodes)[number]> = {};
  def.nodes.forEach((n) => {
    map[n.id] = n;
  });

  for (const s of ['R', 'L'] as const) {
    const m = s === 'L';
    const X = (x: number) => (m ? 2504 - x : x);
    const handNode = map['hand' + s];
    if (!handNode?.pieces?.length) continue;
    const pal = handNode.pieces[0] as unknown as RigPiece;
    pal.restBox = { x: pal.x, y: pal.y, w: pal.w, h: pal.h };
    pal.gotzManaged = true;
    pal.mir = m;

    def.nodes.push(
      { id: 'thumb' + s, name: 'Thumb ' + s, parent: 'hand' + s, pivot: [X(545), 4030], pieces: [] },
      { id: 'thumbTip' + s, name: 'Thumb tip ' + s, parent: 'thumb' + s, pivot: [X(609), 4347], pieces: [], lock: 1 },
      { id: 'finger' + s, name: 'Finger ' + s, parent: 'hand' + s, pivot: [X(492), 4183], pieces: [] },
      { id: 'fingerTip' + s, name: 'Finger tip ' + s, parent: 'finger' + s, pivot: [X(492), 4697], pieces: [], lock: 1 },
      { id: 'toe' + s, name: 'Toe tip ' + s, parent: 'foot' + s, pivot: [m ? 2296 : 192, 7593], pieces: [], lock: 1 },
    );
  }
}

export function addJoints(def: RawRigDef): void {
  if (def.jn) return;
  def.jn = 1;
  const map: Record<string, (typeof def.nodes)[number]> = {};
  def.nodes.forEach((n) => {
    map[n.id] = n;
  });

  if (map.head) {
    def.nodes.push(
      { id: 'lip', name: 'Head pose swivel', parent: 'head', pivot: [1259, 685], pieces: [] },
      { id: 'chinTip', name: 'Skull tip', parent: 'lip', pivot: [1259, 890], pieces: [], lock: 1 },
    );
  }

  if (map.femurR && map.femurL && map.pelvis) {
    map.femurR.pivot = [990, 3598];
    map.femurL.pivot = [1521, 3598];
    map.pelvis.bar = ['femurR', 'femurL'];
    if (map.pelvis.pieces && map.pelvis.pieces.length >= 2 && !map.hipR && !map.hipL) {
      const sorted = map.pelvis.pieces.slice().sort((a, b) => a.x - b.x);
      map.pelvis.pieces = [];
      def.nodes.push(
        // Hips flip & rotate at the rotate point at the bottom of the spine [1257, 3382]
        { id: 'hipR', name: 'Right hip', parent: 'pelvis', pivot: [1257, 3382], pieces: [sorted[0]] },
        { id: 'hipL', name: 'Left hip', parent: 'pelvis', pivot: [1257, 3382], pieces: [sorted[1]] },
      );
      map.femurR.parent = 'hipR';
      map.femurL.parent = 'hipL';
    }
  }

  if (map.thorax && map.thorax.pieces && !map.ribR && !map.ribL) {
    const ribs = map.thorax.pieces.filter((p) => p.name === 'Ribcage').sort((a, b) => a.x - b.x);
    if (ribs.length >= 2) {
      map.thorax.pieces = map.thorax.pieces.filter((p) => p.name !== 'Ribcage');
      map.thorax.bar = ['ribR', 'ribL'];
      def.nodes.push(
        // Default rib origin shares rotational origin with upper spine / shoulder swivel [1257.5, 2377.5]
        { id: 'ribR', name: 'Right ribcage', parent: 'thorax', pivot: [1257.5, 2377.5], pieces: [ribs[0]] },
        { id: 'ribL', name: 'Left ribcage', parent: 'thorax', pivot: [1257.5, 2377.5], pieces: [ribs[1]] },
      );
    }
  }

  for (const s of ['L', 'R'] as const) {
    const br = map['brace' + s];
    if (!br || !map.neck) continue;
    br.pivot = map.neck.pivot.slice() as [number, number];
    const bw = br.pieces?.find((p) => p.name === 'Backshoulder');
    if (bw) {
      // Balance both wings symmetrically around centerline MX=1257 and equal starter height
      bw.x = s === 'L' ? 1147 : 643;
      bw.y = 1115;
      def.nodes.push({
        id: 'wing' + s,
        name: 'Back wing ' + s,
        parent: 'brace' + s,
        pivot: [bw.x + bw.w / 2, bw.y + bw.h / 2],
        pieces: [],
        lock: 1,
        ghost: 1,
      });
    }
    def.nodes.push({
      id: 'swivelTip' + s,
      name: 'Swivel tip ' + s,
      parent: 'swivel' + s,
      pivot: s === 'L' ? [2031, 1334] : [483, 1390],
      pieces: [],
      lock: 1,
    });
  }
}

/**
 * Anti-Phallic Engine: raises the lower spine (`lumbar`) and every descendant above it
 * (`thorax`, `neck`, `head`, `rib`, `swivel`, `brace`, `wing`, arms, hands) so the
 * lowest pixel of `lumbar` rests flush on the hip swivel point (`hipR` / `hipL` Y = 3382)
 * instead of protruding downward between the hips.
 */
export function applyAntiPhallicLowerSpine(def: RawRigDef): number {
  if (def.antiPhallic) return 0;
  def.antiPhallic = 1;
  const map: Record<string, (typeof def.nodes)[number]> = {};
  def.nodes.forEach((n) => {
    map[n.id] = n;
  });

  const lum = map.lumbar;
  if (!lum || !lum.pieces?.length) return 0;
  const hipRef = map.hipR ?? map.hipL ?? map.pelvis;
  const hipY = hipRef ? hipRef.pivot[1] : lum.pivot[1];

  let lumbarBottomY = -1e9;
  for (const p of lum.pieces) {
    lumbarBottomY = Math.max(lumbarBottomY, p.y + p.h);
  }
  const shiftY = hipY - lumbarBottomY;
  if (!Number.isFinite(shiftY) || Math.abs(shiftY) <= 0.5) return 0;

  // Shift lumbar's own pieces up so its bottom pixel sits at hipY while keeping its swivel on the hips
  for (const p of lum.pieces) {
    p.y += shiftY;
    const rp = p as unknown as { restBox?: { y: number } };
    if (rp.restBox) rp.restBox.y += shiftY;
  }

  // Shift every node above lumbar (all strict descendants of lumbar) by the exact same delta
  const isAboveLumbar = (n: (typeof def.nodes)[number]): boolean => {
    let cur = n.parent ? map[n.parent] : undefined;
    let guard = 0;
    while (cur && guard++ < 64) {
      if (cur.id === 'lumbar') return true;
      cur = cur.parent ? map[cur.parent] : undefined;
    }
    return false;
  };

  for (const n of def.nodes) {
    if (!isAboveLumbar(n)) continue;
    n.pivot[1] += shiftY;
    if (n.aim?.from) {
      n.aim.from[1] += shiftY;
    }
    if (n.pieces) {
      for (const p of n.pieces) {
        p.y += shiftY;
        const rp = p as unknown as { restBox?: { y: number } };
        if (rp.restBox) rp.restBox.y += shiftY;
      }
    }
  }
  return shiftY;
}

export type RibAnchorMode = 'upper' | 'lower' | 'ribwings';

/**
 * Computes live procedural Chungus rib flare bounds from:
 *  1. Inner rib border clearance vs live Swivel bone (inner rib cannot stretch beyond swivel)
 *  2. Collarbone (braceL/R) rotation & tendon extension headroom (stops when collarbone locks)
 */
export function computeChungusRibBounds(
  id: string,
  by?: Record<string, RigNode>,
  prometheusWings = false,
): [number, number] {
  if (id !== 'ribR' && id !== 'ribL') return [-180, 180];
  const side: 'R' | 'L' = id === 'ribR' ? 'R' : 'L';
  const sideSign = side === 'L' ? 1 : -1;
  const fallbackMax = prometheusWings ? 12.5 : 8.5;

  if (!by || !by.thorax || !by.neck) {
    return side === 'R' ? [-fallbackMax, 2] : [-2, fallbackMax];
  }

  const th = by.thorax;
  const nk = by.neck;
  const sw = by['swivel' + side];
  const ac = by['acromion' + side];
  const br = by['brace' + side];

  // Ensure world transforms on thorax/swivel/acromion/brace reflect current pose before measuring
  const spinePx = (th.w[0] || th.w[1]) ? pos(th, by) : [th.piv[0], th.piv[1]];
  const neckPx = (nk.w[0] || nk.w[1]) ? pos(nk, by) : [nk.piv[0], nk.piv[1]];
  const spDx = neckPx[0] - spinePx[0];
  const spDy = neckPx[1] - spinePx[1];
  const spLen = Math.hypot(spDx, spDy) || 1;
  // Lateral outward unit vector perpendicular to spine (+1 on Left, -1 on Right)
  const upX = spDx / spLen;
  const upY = spDy / spLen;
  const outX = -upY * sideSign;
  const outY = upX * sideSign;

  // 1. Swivel corridor limit: inner rib medial rim (~1010px above spine junction, starting 74px across midline)
  let swivelMaxFlare = fallbackMax;
  if (sw && ac && (ac.w[0] || ac.w[1])) {
    const swPos = pos(sw, by);
    const acPos = pos(ac, by);
    const acLat = (acPos[0] - spinePx[0]) * outX + (acPos[1] - spinePx[1]) * outY;
    const swLat = (swPos[0] - spinePx[0]) * outX + (swPos[1] - spinePx[1]) * outY;
    // Measure swivel lateral span at sternal rib height (~85% up toward acromion)
    const swivelCorridor = Math.max(0, swLat + (acLat - swLat) * 0.82);
    // Allow inner rib crest to expand at most into 34% of live swivel corridor (strictly inside swivel)
    const maxLatTravel = Math.max(0, swivelCorridor * 0.34);
    const sternalHeight = 1010;
    const medialOffset = 74;
    const sinBound = Math.max(-0.5, Math.min(0.42, (maxLatTravel + medialOffset) / sternalHeight));
    // If swivel is pinched tightly (<130px from spine), collapse outward flare cleanly to 0
    swivelMaxFlare = swivelCorridor < 130 ? 0 : Math.max(0, (Math.asin(sinBound) / DEG));
  }

  // 2. Collarbone (brace) rotation & tendon extension saturation
  let collarMaxFlare = fallbackMax;
  if (br && ac && br.aim && (br.w[0] || br.w[1]) && (ac.w[0] || ac.w[1])) {
    const brPos = pos(br, by);
    const acPos = pos(ac, by);
    const L0 = Math.hypot(br.aim.from[0] - br.piv[0], br.aim.from[1] - br.piv[1]) || 1;
    const curDist = Math.hypot(acPos[0] - brPos[0], acPos[1] - brPos[1]);
    const stretchMax = L0 * (prometheusWings ? br.aim.max * 1.04 : br.aim.max);
    const stretchSat = Math.max(0, Math.min(1, (curDist - L0 * 0.98) / Math.max(1, stretchMax - L0 * 0.98)));

    const maxTilt = br.limits ? Math.max(Math.abs(br.limits[0]), Math.abs(br.limits[1])) : 18;
    const angSat = Math.max(0, Math.min(1, Math.abs(normalizeDeg(br.ang)) / Math.max(1, maxTilt)));

    const brAxis = Math.atan2(br.w[1], br.w[0]);
    const thAxis = Math.atan2(th.w[1], th.w[0]);
    const swingDeg = Math.abs(normalizeDeg((brAxis - thAxis) / DEG));
    const maxSwing = prometheusWings ? 36 : 22;
    const swingSat = Math.max(0, Math.min(1, swingDeg / maxSwing));

    const collarSat = Math.max(angSat, stretchSat, swingSat);
    if (collarSat >= 0.985) {
      collarMaxFlare = 0;
    } else {
      collarMaxFlare = fallbackMax * (1 - collarSat * 0.82);
    }
  }

  const maxOut = Math.max(0, Math.min(fallbackMax, swivelMaxFlare, collarMaxFlare));
  const minIn = 2.0;
  return side === 'R' ? [-maxOut, minIn] : [-minIn, maxOut];
}

/**
 * Reactive rotational bounds for ribR/ribL in Chungus Swing ('lower' mode) anchored at the
 * upper/lower spine junction [1257.5, 2377.5], halting stretch cleanly before inner rib passes
 * swivel or collarbone locks.
 */
export function clampChungusRibAngle(
  id: string,
  deg: number,
  mode: RibAnchorMode,
  by?: Record<string, RigNode>,
  prometheusWings = false,
): number {
  const safe = Number.isFinite(deg) ? deg : 0;
  const norm = normalizeDeg(safe);
  if (mode !== 'lower') return norm;
  const [min, max] = computeChungusRibBounds(id, by, prometheusWings);
  return Math.max(min, Math.min(max, norm));
}

/**
 * Sets ribR & ribL rotational origins between:
 *  - 'upper': upper chest / manubrium sternum [1258, 1408]
 *  - 'lower': Chungus Swing — originates where upper spine (thorax) and lower spine (lumbar) meet [1257.5, 2377.5]
 *  - 'ribwings': bilateral neck anchors [1215, 1327] / [1299, 1271]
 */
export function applyRibAnchorMode(
  by: Record<string, RigNode>,
  mode: RibAnchorMode,
  prometheusWings = false,
): void {
  const ribR = by.ribR;
  const ribL = by.ribL;
  if (!ribR || !ribL) return;
  if (mode === 'upper') {
    const th = by.thorax;
    const nk = by.neck;
    const px = nk ? nk.rest[0] : 1258;
    const py = th && nk ? nk.rest[1] + (th.rest[1] - nk.rest[1]) * 0.216 : 1130;
    ribR.piv = [px, py];
    ribR.rest = [px, py];
    ribL.piv = [px, py];
    ribL.rest = [px, py];
  } else if (mode === 'lower') {
    // Chungus mode originates exactly where upper and lower spine meet (thorax pivot)
    const junc = by.thorax;
    const px = junc ? junc.rest[0] : 1257.5;
    const py = junc ? junc.rest[1] : 2099.5;
    ribR.piv = [px, py];
    ribR.rest = [px, py];
    ribL.piv = [px, py];
    ribL.rest = [px, py];
    ribR.ang = clampChungusRibAngle('ribR', ribR.ang, 'lower', by, prometheusWings);
    ribL.ang = clampChungusRibAngle('ribL', ribL.ang, 'lower', by, prometheusWings);
  } else {
    const nk = by.neck;
    const nx = nk ? nk.rest[0] : 1258;
    const ny = nk ? nk.rest[1] : 862.5;
    ribR.piv = [nx - 43, ny + 186.5];
    ribR.rest = [nx - 43, ny + 186.5];
    ribL.piv = [nx + 41, ny + 130.5];
    ribL.rest = [nx + 41, ny + 130.5];
  }
}

/**
 * Opens or closes the muscular chest cavity between ribR/ribL when Chungus Swing is paired
 * with Prometheus wings, dynamically sized from reactive swivel & collarbone limits.
 */
export function applyChungusChestCavity(
  by: Record<string, RigNode>,
  openCavity: boolean,
  prometheusWings = true,
): void {
  const ribR = by.ribR;
  const ribL = by.ribL;
  if (openCavity) {
    if (by.swivelR) by.swivelR.ang = Math.max(-14, Math.min(by.swivelR.ang, -7));
    if (by.swivelL) by.swivelL.ang = Math.min(14, Math.max(by.swivelL.ang, 7));
    if (ribR && ribL) {
      const [minR] = computeChungusRibBounds('ribR', by, prometheusWings);
      const [, maxL] = computeChungusRibBounds('ribL', by, prometheusWings);
      const targetR = Math.min(ribR.ang, Math.max(minR, minR * 0.72));
      const targetL = Math.max(ribL.ang, Math.min(maxL, maxL * 0.72));
      ribR.ang = clampChungusRibAngle('ribR', targetR, 'lower', by, prometheusWings);
      ribL.ang = clampChungusRibAngle('ribL', targetL, 'lower', by, prometheusWings);
    }
  } else if (ribR && ribL) {
    ribR.ang = 0;
    ribL.ang = 0;
  }
}

/**
 * Abstract parent lookup ready for Reverse-Hierarchy IK without refactoring solver callers.
 */
export function parentOf(n: RigNode, by: Record<string, RigNode>): RigNode | null {
  return n.parent ? by[n.parent] ?? null : null;
}

export function pos(n: RigNode, by: Record<string, RigNode>, out: [number, number] = [0, 0]): [number, number] {
  const par = parentOf(n, by);
  const w = par ? par.w : IDENTITY;
  const tx = safeFinite(n.tx, 0);
  const ty = safeFinite(n.ty, 0);
  const x = safeFinite(n.piv[0], 0) + (n.parent ? 0 : tx);
  const y = safeFinite(n.piv[1], 0) + (n.parent ? 0 : ty);
  out[0] = safeFinite(w[0] * x + w[2] * y + w[4], x);
  out[1] = safeFinite(w[1] * x + w[3] * y + w[5], y);
  return out;
}

export function setW(n: RigNode, rad: number, by: Record<string, RigNode>): void {
  const par = parentOf(n, by);
  const p = par ? par.w : IDENTITY;
  const safeRad = safeFinite(rad, 0);
  const c = Math.cos(safeRad);
  const s = Math.sin(safeRad);
  const fx = n.flipX ? -1 : 1;
  const px = safeFinite(n.piv[0], 0);
  const py = safeFinite(n.piv[1], 0);
  const tx = safeFinite(n.tx, 0);
  const ty = safeFinite(n.ty, 0);
  const e = px - fx * c * px + s * py + tx;
  const f = py - fx * s * px - c * py + ty;
  const m00 = fx * c;
  const m01 = -s;
  const m10 = fx * s;
  const m11 = c;
  const w = n.w;
  w[0] = safeFinite(p[0] * m00 + p[2] * m10, 1);
  w[1] = safeFinite(p[1] * m00 + p[3] * m10, 0);
  w[2] = safeFinite(p[0] * m01 + p[2] * m11, 0);
  w[3] = safeFinite(p[1] * m01 + p[3] * m11, 1);
  w[4] = safeFinite(p[0] * e + p[2] * f + p[4], px);
  w[5] = safeFinite(p[1] * e + p[3] * f + p[5], py);
}

export function normalizeDeg(deg: number): number {
  const safe = safeFinite(deg, 0);
  return snapAngularEpsilon(((((safe + 180) % 360) + 360) % 360) - 180);
}

export function toPure360(deg: number): number {
  return ((Math.round(safeFinite(deg, 0)) % 360) + 360) % 360;
}

export function clampAnatomicalAngle(n: RigNode, deg: number, constrainLimits: boolean): number {
  const norm = normalizeDeg(deg);
  if (!constrainLimits) return norm;
  const [min, max] = n.limits;
  return snapAngularEpsilon(Math.max(min, Math.min(max, norm)));
}

export const CORE_TRIANGLE_NODE_IDS = new Set([
  'lumbar',
  'thorax',
  'neck',
  'swivelL',
  'swivelR',
  'braceL',
  'braceR',
  'acromionL',
  'acromionR',
]);

export function isCoreTriangleNode(id: string): boolean {
  return CORE_TRIANGLE_NODE_IDS.has(id);
}

export interface CoreTriangleState {
  side: 'L' | 'R';
  mode: 'elastic' | 'mechanical';
  strained: boolean;
  /** 0 = inside unbroken core triangle, 0..1 = easing through buffer zone, 1 = full break threshold */
  bufferFactor: number;
  broken: boolean;
  stretchRatio: number;
}

/**
 * Evaluates the Core Triangle (Spine thorax/lumbar -> Collarbone brace -> Swivel -> Shoulder Socket acromion)
 * so UI overlays and solvers know when a joint is easing inside the elastic/mechanical buffer zone.
 */
export function evalCoreTriangleState(
  side: 'L' | 'R',
  by: Record<string, RigNode>,
  prometheusWings = false,
): CoreTriangleState {
  const mode: 'elastic' | 'mechanical' = prometheusWings ? 'elastic' : 'mechanical';
  const sw = by['swivel' + side];
  const br = by['brace' + side];
  const ac = by['acromion' + side];
  const th = by.thorax;
  const lu = by.lumbar;
  if (!sw || !br || !ac) {
    return { side, mode, strained: false, bufferFactor: 0, broken: false, stretchRatio: 0 };
  }

  const thAng = th ? th.ang : 0;
  const luAng = lu ? lu.ang : 0;
  const swRel = Math.abs(normalizeDeg(sw.ang - thAng));
  const brAng = Math.abs(normalizeDeg(br.ang));
  const acAng = Math.abs(normalizeDeg(ac.ang));
  const spRel = Math.max(Math.abs(normalizeDeg(thAng)), Math.abs(normalizeDeg(luAng)));

  let stretchRatio = 0;
  if (br.aim && (br.w[0] || br.w[1]) && (ac.w[0] || ac.w[1])) {
    const bp = pos(br, by);
    const ap = pos(ac, by);
    const L0 = Math.max(VECTOR_EPSILON_PX, Math.hypot(br.aim.from[0] - br.piv[0], br.aim.from[1] - br.piv[1]));
    const d = Math.hypot(ap[0] - bp[0], ap[1] - bp[1]);
    stretchRatio = Math.max(0, Math.abs(d - L0) / (L0 * (prometheusWings ? 0.28 : 0.14)));
  }

  const swZone = Math.max(0, (swRel - 16) / (prometheusWings ? 26 : 12));
  const brZone = Math.max(0, (brAng - 8) / (prometheusWings ? 18 : 6));
  const acZone = Math.max(0, (acAng - 22) / (prometheusWings ? 34 : 14));
  const spZone = Math.max(0, (spRel - 44) / 32);
  const bondDelta = sw.bond ? Math.abs(normalizeDeg(sw.eff - sw.ang)) / (prometheusWings ? 14 : 6) : 0;

  const raw = Math.max(swZone, brZone, acZone, spZone, stretchRatio, bondDelta);
  const bufferFactor = Math.max(0, Math.min(1, raw));
  return {
    side,
    mode,
    strained: bufferFactor > 0.04,
    bufferFactor,
    broken: bufferFactor >= 0.96,
    stretchRatio,
  };
}

/**
 * Simulates an elastic (Prometheus) or mechanical detent buffer zone around Core Triangle joints
 * (`Collarbone`, `Swivel`, `Shoulder Socket`, `Spine`) so displacements ease in and ease out
 * smoothly instead of breaking or hard-snapping the core triangle.
 */
export function applyCoreTriangleBufferEasing(
  n: RigNode,
  rawDeg: number,
  by: Record<string, RigNode>,
  prometheusWings: boolean,
): number {
  const norm = normalizeDeg(rawDeg);
  const thAng = by.thorax ? safeFinite(by.thorax.ang, 0) : 0;

  let refAng = 0;
  let coreSafe = 180;
  let bufferHeadroom = 0;

  if (n.id === 'swivelL' || n.id === 'swivelR') {
    refAng = thAng;
    coreSafe = 16;
    bufferHeadroom = prometheusWings ? 26 : 12;
  } else if (n.id === 'braceL' || n.id === 'braceR') {
    coreSafe = 8;
    bufferHeadroom = prometheusWings ? 28 : 6;
  } else if (n.id === 'acromionL' || n.id === 'acromionR') {
    coreSafe = 22;
    bufferHeadroom = prometheusWings ? 38 : 13;
  } else if (n.id === 'lumbar') {
    coreSafe = 48;
    bufferHeadroom = 34;
  } else if (n.id === 'thorax') {
    coreSafe = 44;
    bufferHeadroom = 32;
  } else {
    return norm;
  }

  const rel = normalizeDeg(norm - refAng);
  const absRel = Math.abs(rel);
  if (absRel <= coreSafe || bufferHeadroom <= 0.1) {
    return norm;
  }

  const sign = rel >= 0 ? 1 : -1;
  const excess = absRel - coreSafe;
  // Ease-in/ease-out mechanical detent or elastic buffer curve around the boundary
  const u = Math.min(1, excess / bufferHeadroom);
  const hermite = u * u * (3 - 2 * u);
  const damped = prometheusWings
    ? bufferHeadroom * Math.tanh(excess / (bufferHeadroom * 0.95))
    : bufferHeadroom * (0.68 * Math.tanh(excess / bufferHeadroom) + 0.32 * hermite * (excess / Math.max(excess, bufferHeadroom)));
  return normalizeDeg(refAng + sign * (coreSafe + Math.min(bufferHeadroom, damped)));
}

/**
 * Enforces realistic shoulder-girdle constraints when Prometheus wing mode is OFF
 * so back shoulders stay tucked at the paddle/shoulderbone/swivel/spine junction,
 * while routing past core bounds smoothly through the Core Triangle buffer zone.
 */
export function clampRealisticShoulder(
  n: RigNode,
  deg: number,
  by: Record<string, RigNode>,
  prometheusWings: boolean,
  bodyView: BodyTurnView = 'front',
  sideArmsFavorOpposite = false,
): number {
  const isSide = bodyView === 'sideR' || bodyView === 'sideL';
  const isThreeQuarter = bodyView === 'threeQuarterR' || bodyView === 'threeQuarterL';
  if (n.id === 'swivelL' || n.id === 'swivelR') {
    const txAng = by.thorax ? by.thorax.ang : 0;
    const maxSwivel = prometheusWings ? 62 : isSide ? (sideArmsFavorOpposite ? 40 : 35) : isThreeQuarter ? 32 : 28;
    const buffered = isSide
      ? deg
      : applyCoreTriangleBufferEasing(n, deg, by, prometheusWings);
    const rel = Math.max(-maxSwivel, Math.min(maxSwivel, normalizeDeg(buffered - txAng)));
    return normalizeDeg(txAng + rel);
  }
  const buffered = applyCoreTriangleBufferEasing(n, deg, by, prometheusWings);
  if (prometheusWings) return buffered;
  if (n.id === 'braceL' || n.id === 'braceR') {
    const maxBrace = isSide ? 24 : 12;
    return Math.max(-maxBrace, Math.min(maxBrace, buffered));
  }
  if (n.id === 'acromionL' || n.id === 'acromionR') {
    const maxAcro = isSide ? 42 : 35;
    return Math.max(-maxAcro, Math.min(maxAcro, buffered));
  }
  return buffered;
}

export function getTensionRatio(n: RigNode): { ratio: number; nearLimit: boolean; atLimit: boolean } {
  const [min, max] = n.limits;
  if (min <= -179 && max >= 179) {
    return { ratio: 0, nearLimit: false, atLimit: false };
  }
  const span = Math.max(1, max - min);
  const distMin = n.ang - min;
  const distMax = max - n.ang;
  const nearest = Math.min(distMin, distMax);
  const normMargin = nearest / (span * 0.5);
  return {
    ratio: Math.max(0, Math.min(1, 1 - normMargin)),
    nearLimit: nearest <= 8 && nearest > 0.5,
    atLimit: nearest <= 0.5,
  };
}

/**
 * IK-ready math utility: converts a desired world-space angle into local joint angle.
 */
export function worldToLocalAngle(n: RigNode, targetWorldRad: number, by: Record<string, RigNode>): number {
  const par = parentOf(n, by);
  const p = par ? par.w : IDENTITY;
  const parentWorldRad = Math.atan2(p[1], p[0]);
  return normalizeDeg((targetWorldRad - parentWorldRad) / DEG);
}

/**
 * IK-ready math utility: orients a node so its localTip vector points toward targetWorldRad.
 */
export function setWorldDir(
  n: RigNode,
  localTip: [number, number],
  targetWorldRad: number,
  by: Record<string, RigNode>,
): void {
  const tipLocalRad = Math.atan2(localTip[1] - n.piv[1], localTip[0] - n.piv[0]);
  n.ang = worldToLocalAngle(n, targetWorldRad - tipLocalRad, by);
}

/**
 * Closed-chain shoulder bond: keeps navel -> swivel -> acromion -> collarbone -> neck closed
 * with a Core Triangle elastic/mechanical buffer zone and left/right chirality preservation.
 */
export function bondAng(
  n: RigNode,
  by: Record<string, RigNode>,
  bondOn: boolean,
  prometheusWings = false,
  bodyView: BodyTurnView = 'front',
  sideArmsFavorOpposite = false,
): number {
  const b = n.bond;
  if (!b || !bondOn || !b.aim) return safeFinite(n.ang, 0);
  const ac = by[b.aim.to];
  if (!ac || !n.parent || !b.parent || !by[n.parent] || !by[b.parent]) return safeFinite(n.ang, 0);
  const lw = by[n.parent].w;
  const tw = by[b.parent].w;
  const bp = b.piv;
  const nx = tw[0] * bp[0] + tw[2] * bp[1] + tw[4];
  const ny = tw[1] * bp[0] + tw[3] * bp[1] + tw[5];
  const f = b.aim.from;
  const L0 = Math.max(VECTOR_EPSILON_PX, Math.hypot(f[0] - bp[0], f[1] - bp[1]));
  const lo = b.aim.min * L0;
  const hi = b.aim.max * L0;
  const px = n.piv[0];
  const py = n.piv[1];
  const ax = ac.piv[0] - px;
  const ay = ac.piv[1] - py;
  const sideSign = n.id.endsWith('L') ? 1 : -1;
  const txAng = safeFinite(by[b.parent] ? by[b.parent].ang : 0, 0);
  const isSide = bodyView === 'sideR' || bodyView === 'sideL';
  const isThreeQuarter = bodyView === 'threeQuarterR' || bodyView === 'threeQuarterL';

  const v = (a: number) => {
    const r = safeFinite(a, 0) * DEG;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const X = px + c * ax - s * ay;
    const Y = py + s * ax + c * ay;
    const wx = lw[0] * X + lw[2] * Y + lw[4];
    const wy = lw[1] * X + lw[3] * Y + lw[5];
    const d = Math.hypot(wx - nx, wy - ny);
    // Elastic/mechanical buffer envelope around normal collarbone reach
    const stretchTol = prometheusWings ? 1.28 : isSide ? 1.24 : 1.12;
    const loSoft = lo * (prometheusWings || isSide ? 0.52 : 0.92);
    const hiSoft = hi * stretchTol;
    const rawDistErr = d < loSoft ? loSoft - d : d > hiSoft ? d - hiSoft : 0;
    const bufScale = L0 * 0.08;
    const distErr = rawDistErr > 0 ? rawDistErr + (bufScale * (rawDistErr / (rawDistErr + bufScale))) * 0.35 : 0;
    const lateralSigned = ((wx - nx) * tw[0] + (wy - ny) * tw[1]) * sideSign;
    const minLat = isSide
      ? sideArmsFavorOpposite
        ? -120
        : 12
      : prometheusWings
        ? 32
        : isThreeQuarter
          ? 110
          : 240;
    const latErr = lateralSigned < minLat ? (minLat - lateralSigned) * 4 : 0;
    const relAng = Math.abs(normalizeDeg(a - txAng));
    const maxRel = prometheusWings ? 95 : isSide ? 42 : isThreeQuarter ? 36 : 32;
    const angErr = relAng > maxRel ? (relAng - maxRel) * 25 : 0;
    return distErr + latErr + angErr;
  };

  // Seed search inside realistic shoulder range around thorax if current angle is cross-body/out of bounds
  const curAng = safeFinite(n.ang, 0);
  const seedCap = isSide ? 38 : isThreeQuarter ? 32 : 28;
  const seed = prometheusWings
    ? curAng
    : normalizeDeg(txAng + Math.max(-seedCap, Math.min(seedCap, normalizeDeg(curAng - txAng))));

  if (v(seed) === 0) return snapAngularEpsilon(seed);
  for (let i = 1; i <= 720; i++) {
    for (const s of [1, -1]) {
      const a = seed + s * i * 0.5;
      if (v(a) === 0) {
        let bad = a - s * 0.5;
        let good = a;
        for (let j = 0; j < 22; j++) {
          const m = (bad + good) / 2;
          if (v(m) === 0) good = m;
          else bad = m;
        }
        return snapAngularEpsilon(good);
      }
    }
  }
  let best = seed;
  let bv = v(best);
  for (let i = -360; i <= 360; i++) {
    const a = seed + i * 0.5;
    const e = v(a);
    if (e < bv) {
      bv = e;
      best = a;
    }
  }
  return snapAngularEpsilon(best);
}

export function setAim(
  n: RigNode,
  by: Record<string, RigNode>,
  bondOn: boolean,
  prometheusWings = false,
  bodyView: BodyTurnView = 'front',
): void {
  if (!n.aim || !n.parent || !by[n.parent]) return;
  const pw = by[n.parent].w;
  const p = n.piv;
  const F = n.aim.from;
  const ac = by[n.aim.to];
  if (!ac || !ac.parent || !by[ac.parent]) return;
  const aw = by[ac.parent].w;
  const Qx = aw[0] * ac.piv[0] + aw[2] * ac.piv[1] + aw[4];
  const Qy = aw[1] * ac.piv[0] + aw[3] * ac.piv[1] + aw[5];
  const X = pw[0] * p[0] + pw[2] * p[1] + pw[4];
  const Y = pw[1] * p[0] + pw[3] * p[1] + pw[5];
  const vx = Qx - X;
  const vy = Qy - Y;
  const rawDist = Math.hypot(vx, vy);
  // Deterministic singularity guard if target collapses onto pivot or degenerate vector
  const hasDir = Number.isFinite(rawDist) && rawDist > VECTOR_EPSILON_PX;
  const dist = hasDir ? rawDist : 1;
  const refDx = F[0] - p[0];
  const refDy = F[1] - p[1];
  const L0 = Math.hypot(refDx, refDy) > VECTOR_EPSILON_PX ? Math.hypot(refDx, refDy) : 1;
  const refAng = Math.hypot(refDx, refDy) > VECTOR_EPSILON_PX ? Math.atan2(refDy, refDx) : 0;
  const isSide = bodyView === 'sideR' || bodyView === 'sideL';
  const maxTilt = prometheusWings ? 62 : isSide ? 24 : 14;
  const clampedAng = Math.max(-maxTilt, Math.min(maxTilt, normalizeDeg(n.ang)));
  const parentAng = Math.atan2(pw[1], pw[0]);
  const dirX = hasDir ? vx / dist : Math.cos(parentAng);
  const dirY = hasDir ? vy / dist : Math.sin(parentAng);
  let a = Math.atan2(dirY, dirX) - refAng + clampedAng * DEG;
  if (!prometheusWings) {
    const relRad = Math.atan2(Math.sin(a - parentAng), Math.cos(a - parentAng));
    const maxSwing = (isSide ? 40 : 24) * DEG;
    a = parentAng + Math.max(-maxSwing, Math.min(maxSwing, relRad));
  }
  const delta = (hasDir ? rawDist : L0) - L0;
  // Scale elastic stretch smoothly using Leonardo shoulder-to-forearm proportional ratio (1/8 / 1/5 = 0.625)
  const armSegRatio = CANONICAL_PROPORTIONS.leonardo.upperArmToHeight / CANONICAL_PROPORTIONS.leonardo.forearmHandToHeight;
  const rawSlide = delta * (prometheusWings ? Math.min(0.82, 0.5 + armSegRatio * 0.448) : 0.5);
  const [minS, maxS] = bondOn
    ? prometheusWings
      ? [-0.52 * L0, 0.36 * L0]
      : [-0.24 * L0, 0.14 * L0]
    : prometheusWings
      ? [-0.26 * L0, 0.22 * L0]
      : [-0.14 * L0, 0.08 * L0];
  // Smooth C1 ease-in/ease-out elastic/mechanical buffer zone around the joint
  const span = Math.max(1, (maxS - minS) * 0.5);
  const mid = (minS + maxS) * 0.5;
  const normDelta = (rawSlide - mid) / span;
  const absN = Math.min(1.5, Math.abs(normDelta));
  const easeCurve = absN <= 0.65 ? normDelta : Math.sign(normDelta) * (0.65 + (span > 1 ? 0.35 * Math.tanh((absN - 0.65) * 1.45) : 0));
  const slide = mid + span * easeCurve;
  const stretchRatio = (delta - slide) / L0;
  const scaleCap = prometheusWings ? 0.028 : 0.014;
  const microScale = 1 + Math.max(-scaleCap, Math.min(scaleCap, stretchRatio * (prometheusWings ? 0.08 : 0.06)));
  const c = safeFinite(Math.cos(a) * microScale, 1);
  const s = safeFinite(Math.sin(a) * microScale, 0);
  const w = n.w;
  w[0] = c;
  w[1] = s;
  w[2] = -s;
  w[3] = c;
  w[4] = safeFinite(X + dirX * slide - (c * p[0] - s * p[1]), p[0]);
  w[5] = safeFinite(Y + dirY * slide - (s * p[0] + c * p[1]), p[1]);
}

export interface PrometheusShoulderDragBaseline {
  swivel0: number;
  acro0: number;
  brace0: number;
  humerus0: number;
  forearm0: number;
  hand0: number;
}

/**
 * Elastic Prometheus wing coupling: dragging or articulating a popped Prometheus wing
 * flexes the collarbone & shoulder swivel elastically while driving strong compensatory
 * follow-through across the upper arm, elbow, and wrist (greater than normal shoulder coupling).
 */
export function applyPrometheusArmCompensation(
  side: 'L' | 'R',
  by: Record<string, RigNode>,
  base: PrometheusShoulderDragBaseline,
  dSwivel: number,
  dNeck: number,
  constrainLimits: boolean,
): void {
  const swivel = by['swivel' + side];
  const acromion = by['acromion' + side];
  const brace = by['brace' + side];
  const humerus = by['humerus' + side];
  const forearm = by['forearm' + side];
  const hand = by['hand' + side];
  if (!swivel || !acromion || !brace) return;

  const targetBrace = Math.max(-54, Math.min(54, normalizeDeg(base.brace0 + dNeck)));
  brace.ang = constrainLimits ? clampAnatomicalAngle(brace, targetBrace, true) : targetBrace;
  const dBrace = normalizeDeg(brace.ang - base.brace0);

  swivel.ang = clampAnatomicalAngle(
    swivel,
    base.swivel0 + dSwivel * 1.15 + dBrace * 0.52,
    constrainLimits,
  );
  acromion.ang = clampAnatomicalAngle(
    acromion,
    base.acro0 - dSwivel * 0.35 - dBrace * 0.35,
    constrainLimits,
  );

  const upperArm = CANONICAL_PROPORTIONS.leonardo.upperArmToHeight;
  const forearmHand = CANONICAL_PROPORTIONS.leonardo.forearmHandToHeight;
  const handFrac = CANONICAL_PROPORTIONS.vitruvius.handToHeight;
  // Distal attenuation ratios grounded in Leonardo's arm-division proportions (elbow->wrist+hand vs shoulder->elbow)
  const forearmAtten = (upperArm / (forearmHand + upperArm)) * 1.1; // ~0.42
  const handAtten = (handFrac / forearmHand) * 0.56; // ~0.28

  if (humerus) {
    humerus.ang = clampAnatomicalAngle(
      humerus,
      base.humerus0 + dBrace * 0.85 + dSwivel * 0.32,
      constrainLimits,
    );
  }
  if (forearm) {
    forearm.ang = clampAnatomicalAngle(
      forearm,
      base.forearm0 + dBrace * forearmAtten,
      constrainLimits,
    );
  }
  if (hand) {
    hand.ang = clampAnatomicalAngle(
      hand,
      base.hand0 - dBrace * handAtten,
      constrainLimits,
    );
  }
}

/**
 * Reciprocal elastic wing/shoulder follow when moving an arm while Prometheus wings are active.
 */
export function applyPrometheusWingFollowFromArm(
  side: 'L' | 'R',
  by: Record<string, RigNode>,
  dHumerusDeg: number,
  constrainLimits: boolean,
): void {
  const sw = by['swivel' + side];
  const br = by['brace' + side];
  const clampedDelta = Math.max(-90, Math.min(90, normalizeDeg(dHumerusDeg)));
  if (sw) {
    sw.ang = clampAnatomicalAngle(sw, sw.ang + clampedDelta * 0.28, constrainLimits);
  }
  if (br) {
    br.ang = clampAnatomicalAngle(br, br.ang + clampedDelta * 0.34, constrainLimits);
  }
}

function hasTopologicalOrder(nodes: RigNode[]): boolean {
  const idxMap = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) idxMap.set(nodes[i].id, i);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.parent) {
      const pIdx = idxMap.get(n.parent);
      if (pIdx !== undefined && pIdx >= i) return false;
    }
    if (n.aim?.to) {
      const tIdx = idxMap.get(n.aim.to);
      if (tIdx !== undefined && tIdx >= i) return false;
    }
  }
  return true;
}

export function solveRig(
  nodes: RigNode[],
  by: Record<string, RigNode>,
  bondOn: boolean,
  wingPop = 0,
  ribAnchor: RibAnchorMode = 'upper',
  bodyView: BodyTurnView = 'front',
  sideArmsFavorOpposite = false,
): void {
  const safeWingPop = safeFinite(wingPop, 0);
  const activeWings = safeWingPop > 0.05;
  // Guarantee strict parent-before-child topological evaluation order
  const evalOrder = hasTopologicalOrder(nodes) ? nodes : sortNodesTopologically(nodes, by);

  for (const n of evalOrder) {
    // Self-corrective deterministic guards against NaN/Infinity propagation
    n.ang = snapAngularEpsilon(n.ang);
    n.tx = safeFinite(n.tx, 0);
    n.ty = safeFinite(n.ty, 0);
    if (!Number.isFinite(n.piv[0]) || !Number.isFinite(n.piv[1])) {
      n.piv = n.rest.slice() as [number, number];
    }

    if (n.id === 'wingL' || n.id === 'wingR') {
      n.ghost = !activeWings;
      if (safeWingPop > 0.001 && n.parent && by[n.parent]) {
        const br = by[n.parent];
        const side = n.id === 'wingL' ? 1 : -1;
        const flareRad = side * -32 * safeWingPop * DEG;
        const c = Math.cos(flareRad);
        const s = Math.sin(flareRad);
        const dx = n.rest[0] - br.piv[0];
        const dy = n.rest[1] - br.piv[1];
        n.piv = [
          br.piv[0] + c * dx - s * dy + side * 42 * safeWingPop,
          br.piv[1] + s * dx + c * dy - 26 * safeWingPop,
        ];
      } else {
        n.piv = n.rest.slice() as [number, number];
      }
    }

    if (n.aim) {
      setAim(n, by, bondOn, activeWings, bodyView);
    } else {
      let solvedAng = bondAng(n, by, bondOn, activeWings, bodyView, sideArmsFavorOpposite);
      // Self-corrective Chungus check after thorax/swivel/acromion/brace have updated world frames
      if (ribAnchor === 'lower' && (n.id === 'ribR' || n.id === 'ribL')) {
        solvedAng = clampChungusRibAngle(n.id, solvedAng, 'lower', by, activeWings);
        n.ang = solvedAng;
      }
      n.eff = snapAngularEpsilon(solvedAng);
      setW(n, n.eff * DEG, by);
    }
  }
}

export function getBondStatus(nodes: RigNode[], bondOn: boolean): BondStatusItem[] {
  if (!bondOn) return [];
  const items: BondStatusItem[] = [];
  for (const n of nodes) {
    if (n.bond) {
      const delta = n.eff - n.ang;
      items.push({
        side: n.id.slice(-1),
        delta,
        strained: Math.abs(delta) > 0.05,
      });
    }
  }
  return items;
}

export function assetTips(nodes: RigNode[]): void {
  for (const n of nodes) {
    n.at = null;
    if (n.id === 'hipR') {
      n.at = [825, 3115];
      continue;
    }
    if (n.id === 'hipL') {
      n.at = [1689, 3115];
      continue;
    }
    if (n.id === 'ribR') {
      const rp = n.pieces[0];
      n.at = rp ? [rp.x, rp.y + rp.h] : [696, 2370];
      continue;
    }
    if (n.id === 'ribL') {
      const rp = n.pieces[0];
      n.at = rp ? [rp.x + rp.w, rp.y + rp.h] : [1808, 2314];
      continue;
    }
    if (!n.pieces.length || n.aim || n.bar || nodes.some((k) => k.parent === n.id)) continue;
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    for (const p of n.pieces) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + p.w);
      y1 = Math.max(y1, p.y + p.h);
    }
    let best: [number, number] | null = null;
    let bd = 40;
    const candidates: Array<[number, number]> = [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
      [(x0 + x1) / 2, y0],
      [(x0 + x1) / 2, y1],
      [x0, (y0 + y1) / 2],
      [x1, (y0 + y1) / 2],
    ];
    for (const c of candidates) {
      const d = Math.hypot(c[0] - n.piv[0], c[1] - n.piv[1]);
      if (d > bd) {
        bd = d;
        best = c;
      }
    }
    n.at = best;
  }
}

export function buildRigGraph(rawInput: RawRigDef, includeDigitsAndJoints = true) {
  const def: RawRigDef = JSON.parse(JSON.stringify(rawInput));
  if (includeDigitsAndJoints) {
    addDigits(def);
    addJoints(def);
    applyAntiPhallicLowerSpine(def);
  }

  const chainLookup: Record<string, string> = {};
  for (const ch of LIMB_CHAINS) {
    if (ch.swiv) chainLookup[ch.swiv] = ch.id;
    chainLookup[ch.upper] = ch.id;
    chainLookup[ch.lower] = ch.id;
    chainLookup[ch.effector] = ch.id;
  }

  let nodes: RigNode[] = def.nodes.map((n) => ({
    id: n.id,
    name: getCanonicalBoneLabel(n.id, n.name || n.id),
    parent: n.parent || null,
    aim: n.aim || null,
    pieces: (n.pieces || []) as RigPiece[],
    piv: n.pivot.slice() as [number, number],
    rest: n.pivot.slice() as [number, number],
    baseRest: n.pivot.slice() as [number, number],
    ang: n.ang || 0,
    tx: 0,
    ty: 0,
    w: new Float64Array(6),
    eff: 0,
    bond: null,
    lock: !!n.lock,
    ghost: !!n.ghost,
    bar: n.bar || null,
    at: null,
    limits: ANATOMICAL_LIMITS[n.id] ?? [-180, 180],
    effectorRole: EFFECTOR_ROLES[n.id] ?? null,
    chainId: chainLookup[n.id] ?? null,
    flipX: !!n.flipX,
  }));

  const by: Record<string, RigNode> = {};
  nodes.forEach((n) => {
    by[n.id] = n;
  });

  nodes.forEach((n) => {
    if (n.aim) {
      const ac = by[n.aim.to];
      const sw = ac && ac.parent ? by[ac.parent] : null;
      if (sw) sw.bond = n;
    }
  });

  nodes = sortNodesTopologically(nodes, by);
  const hierarchyAudit = auditRigHierarchy(nodes, by);
  if (!hierarchyAudit.valid) {
    // Re-run topological sort cleanly if any auxiliary node needed settling
    nodes = sortNodesTopologically(nodes, by);
  }

  assetTips(nodes);

  const root = nodes.find((n) => !n.parent) || nodes[0];
  const pieces: RigPiece[] = [];
  nodes.forEach((n) =>
    n.pieces.forEach((p) => {
      p.node = n;
      p.wing = p.name === 'Backshoulder';
      // Canonical shoulder-girdle depth invariant: Ribs (front) -> Swivel (middle) -> Back Shoulderbone (behind)
      if (n.id === 'ribL') p.i = 32;
      else if (n.id === 'swivelL') p.i = 33;
      else if (p.wing && n.id === 'braceL') p.i = 34;
      else if (n.id === 'ribR') p.i = 23;
      else if (n.id === 'swivelR') p.i = 24;
      else if (p.wing && n.id === 'braceR') p.i = 25;
      p.i0 = p.i;
      pieces.push(p);
    }),
  );
  pieces.sort((a, b) => b.i - a.i);

  return {
    W: def.W || 2500,
    H: def.H || 2500,
    nodes,
    by,
    root,
    pieces,
  };
}

export function sortPiecesForWings(pieces: RigPiece[], _popped: boolean): void {
  // Swivel stays strictly obscured behind Ribcage and ahead of Back Shoulderbone (Prometheus Wings) even when wings pop
  for (const p of pieces) {
    const n = p.node;
    if (n?.id === 'ribL') p.i = 32;
    else if (n?.id === 'swivelL') p.i = 33;
    else if (p.wing && n?.id === 'braceL') p.i = 34;
    else if (n?.id === 'ribR') p.i = 23;
    else if (n?.id === 'swivelR') p.i = 24;
    else if (p.wing && n?.id === 'braceR') p.i = 25;
    else p.i = p.i0 ?? p.i;
  }
  pieces.sort((a, b) => b.i - a.i);
}

/**
 * Returns rigid/elastic piece world matrix. For Backshoulder ("Prometheus wing"),
 * remains locked to braceL/R when wingPop=0 and elastically pops/flexes outward when wingPop>0.
 */
export function getPieceWorldMatrix(
  p: RigPiece,
  wingPop = 0,
  out: Float64Array = new Float64Array(6),
): Float64Array {
  const n = p.node;
  if (!n) {
    out.set(IDENTITY);
    return out;
  }
  const w = n.w;
  if (!p.wing || wingPop <= 0.001) {
    out.set(w);
    return out;
  }
  const side = n.id === 'braceL' ? 1 : -1;
  const elasticBend = Math.max(-18, Math.min(18, n.ang * 0.42)) * wingPop;
  const flareRad = (side * -32 * wingPop + elasticBend) * DEG;
  const chordScale = 1 + Math.max(-0.08, Math.min(0.14, Math.abs(n.ang) * 0.0028 * wingPop + (wingPop - 1) * 0.22));
  const c = Math.cos(flareRad) * chordScale;
  const s = Math.sin(flareRad) * chordScale;
  const px = n.piv[0];
  const py = n.piv[1];
  const tx = side * 42 * wingPop;
  const ty = -26 * wingPop;
  const e = px - c * px + s * py + tx;
  const f = py - s * px - c * py + ty;
  out[0] = w[0] * c + w[2] * s;
  out[1] = w[1] * c + w[3] * s;
  out[2] = -w[0] * s + w[2] * c;
  out[3] = -w[1] * s + w[3] * c;
  out[4] = w[0] * e + w[2] * f + w[4];
  out[5] = w[1] * e + w[3] * f + w[5];
  return out;
}

const TMP_MAT = new Float64Array(6);

export function hitTestPiece(
  q: [number, number],
  pieces: RigPiece[],
  wingPop = 0,
): { node: RigNode; piece: RigPiece } | null {
  for (let k = pieces.length - 1; k >= 0; k--) {
    const p = pieces[k];
    if (!p.m || !p.node || !p.mw || !p.st) continue;
    const w = getPieceWorldMatrix(p, wingPop, TMP_MAT);
    const det = w[0] * w[3] - w[1] * w[2];
    if (!det) continue;
    const dx = q[0] - w[4];
    const dy = q[1] - w[5];
    const x = (w[3] * dx - w[2] * dy) / det - p.x;
    const y = (-w[1] * dx + w[0] * dy) / det - p.y;
    if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
    if (p.m[((y / p.st) | 0) * p.mw + ((x / p.st) | 0)]) {
      return { node: p.node, piece: p };
    }
  }
  return null;
}

export function hitTest(q: [number, number], pieces: RigPiece[], wingPop = 0): RigNode | null {
  return hitTestPiece(q, pieces, wingPop)?.node ?? null;
}

export function samplePieceWorldMask(p: RigPiece, wx: number, wy: number, wingPop = 0): boolean {
  if (!p.m || !p.node || !p.mw || !p.mh || !p.st) return false;
  const w = getPieceWorldMatrix(p, wingPop, TMP_MAT);
  const det = w[0] * w[3] - w[1] * w[2];
  if (!det) return false;
  const dx = wx - w[4];
  const dy = wy - w[5];
  const x = (w[3] * dx - w[2] * dy) / det - p.x;
  const y = (-w[1] * dx + w[0] * dy) / det - p.y;
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return false;
  const mx = Math.min(p.mw - 1, Math.max(0, (x / p.st) | 0));
  const my = Math.min(p.mh - 1, Math.max(0, (y / p.st) | 0));
  return p.m[my * p.mw + mx] > 0;
}

/**
 * Generalized bounding-box camera fit math prepared for Phase 2 Camera Bar presets.
 */
export function fitBoxParams(box: CameraBox, canvasW: number, canvasH: number, fill = 0.88) {
  const bw = Math.max(1, box.x1 - box.x0);
  const bh = Math.max(1, box.y1 - box.y0);
  const z = Math.min((canvasW * fill) / bw, (canvasH * fill) / bh);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return {
    z,
    ox: canvasW / 2 - cx * z,
    oy: canvasH / 2 - cy * z,
  };
}

export interface RigWorldBounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  headTopY: number;
  anklesY: number;
}

/**
 * Computes the live world-space bounding box of the puppet plus exact head-top and ankle Y coordinates.
 */
export function computeRigWorldBounds(
  by: Record<string, RigNode>,
  pieces: RigPiece[],
  wingPop = 0,
): RigWorldBounds | null {
  let x0 = 1e9;
  let x1 = -1e9;
  let y0 = 1e9;
  let y1 = -1e9;
  let headTopY = 1e9;
  let hasBounds = false;

  for (const p of pieces) {
    hasBounds = true;
    const w = p.node ? getPieceWorldMatrix(p, wingPop, TMP_MAT) : null;
    if (w && (w[0] !== 0 || w[1] !== 0 || w[2] !== 0 || w[3] !== 0)) {
      const corners: Array<[number, number]> = [
        [p.x, p.y],
        [p.x + p.w, p.y],
        [p.x, p.y + p.h],
        [p.x + p.w, p.y + p.h],
      ];
      for (const [cx, cy] of corners) {
        const wx = w[0] * cx + w[2] * cy + w[4];
        const wy = w[1] * cx + w[3] * cy + w[5];
        x0 = Math.min(x0, wx);
        x1 = Math.max(x1, wx);
        y0 = Math.min(y0, wy);
        y1 = Math.max(y1, wy);
        if (p.node?.id === 'head') {
          headTopY = Math.min(headTopY, wy);
        }
      }
    } else {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x + p.w);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y + p.h);
      if (p.node?.id === 'head') {
        headTopY = Math.min(headTopY, p.y);
      }
    }
  }

  for (const id in by) {
    const n = by[id];
    const p = pos(n, by);
    if (Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      hasBounds = true;
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
  }

  if (!hasBounds || x1 <= x0 || y1 <= y0) return null;

  if (headTopY > 1e8) {
    headTopY = by.head ? pos(by.head, by)[1] - 320 : y0;
  }
  const footYs: number[] = [];
  if (by.footL) footYs.push(pos(by.footL, by)[1]);
  if (by.footR) footYs.push(pos(by.footR, by)[1]);
  const anklesY = footYs.length ? Math.max(...footYs) : y1 - 240;

  return { x0, x1, y0, y1, headTopY, anklesY };
}

/**
 * Fits the full figure cleanly head-to-toe inside the unobstructed stage box
 * with a balanced buffer above the crown and below the feet, centered on MX = 1257 at rest.
 */
export function computeModelFrame(
  by: Record<string, RigNode>,
  pieces: RigPiece[],
  W: number,
  H: number,
  canvasW: number,
  canvasH: number,
  dpr = 1,
  wingPop = 0,
  safeInset?: { left?: number; right?: number; top?: number; bottom?: number; alwaysFitSafeBox?: boolean },
): { z: number; ox: number; oy: number } {
  const bounds = computeRigWorldBounds(by, pieces, wingPop);

  if (bounds) {
    const { x0, x1, y0, y1 } = bounds;
    const figH = Math.max(1, y1 - y0);
    const centerX = W === 2500 ? 1257 : (x0 + x1) / 2;
    const figW =
      W === 2500
        ? Math.max(1, 2 * Math.max(centerX - x0, x1 - centerX))
        : Math.max(1, x1 - x0);

    const fitRect = (boxLeft: number, boxTop: number, boxW: number, boxH: number) => {
      const topPad = Math.max(16 * dpr, boxH * 0.055);
      const bottomPad = Math.max(16 * dpr, boxH * 0.055);
      const sidePad = Math.max(14 * dpr, boxW * 0.04);
      const availW = Math.max(48, boxW - 2 * sidePad);
      const availH = Math.max(48, boxH - topPad - bottomPad);
      const z = Math.min(availW / figW, availH / figH);
      const ox = boxLeft + boxW / 2 - centerX * z;
      // Exact vertical centering within the buffered viewport box (equal crown & sole buffers)
      const oy = boxTop + topPad + (availH - figH * z) * 0.5 - y0 * z;
      return { z, ox, oy };
    };

    const safeL = Math.max(0, safeInset?.left ?? 0);
    const safeR = Math.max(0, safeInset?.right ?? 0);
    const safeT = Math.max(0, safeInset?.top ?? 0);
    const safeB = Math.max(0, safeInset?.bottom ?? 0);
    const effW = Math.max(100 * dpr, canvasW - safeL - safeR);
    const effH = Math.max(100 * dpr, canvasH - safeT - safeB);

    if (safeInset?.alwaysFitSafeBox) {
      return fitRect(safeL, safeT, effW, effH);
    }

    const full = fitRect(0, 0, canvasW, canvasH);
    if (safeL > 0 || safeR > 0 || safeT > 0 || safeB > 0) {
      const margin = 16 * dpr;
      const figLeft = x0 * full.z + full.ox;
      const figRight = x1 * full.z + full.ox;
      const figTop = y0 * full.z + full.oy;
      const figBottom = y1 * full.z + full.oy;
      const hitsLeft = safeL > 0 && figLeft < safeL + margin;
      const hitsRight = safeR > 0 && figRight > canvasW - safeR - margin;
      const hitsTop = safeT > 0 && figTop < safeT + margin;
      const hitsBottom = safeB > 0 && figBottom > canvasH - safeB - margin;
      if (hitsLeft || hitsRight || hitsTop || hitsBottom) {
        return fitRect(
          hitsLeft ? safeL : 0,
          hitsTop ? safeT : 0,
          hitsLeft || hitsRight ? effW : canvasW,
          hitsTop || hitsBottom ? effH : canvasH,
        );
      }
    }
    return full;
  }

  const topPad = Math.max(18 * dpr, canvasH * 0.055);
  const bottomPad = Math.max(18 * dpr, canvasH * 0.055);
  const sidePad = Math.max(16 * dpr, canvasW * 0.04);
  const availW = Math.max(60, canvasW - 2 * sidePad);
  const availH = Math.max(60, canvasH - topPad - bottomPad);
  const fallback = fitBoxParams({ x0: 0, y0: 0, x1: W, y1: H }, availW, availH, 0.96);
  return {
    z: fallback.z,
    ox: fallback.ox + sidePad,
    oy: fallback.oy + topPad,
  };
}

/**
 * Enforces the studio invariant that the puppet body can never leave the unobstructed canvas,
 * even when panning, zooming, moving the root, or adjusting popup/panel room sliders.
 */
export function clampCameraToKeepBodyVisible(
  cam: { z: number; ox: number; oy: number },
  bounds: RigWorldBounds | null,
  canvasW: number,
  canvasH: number,
  dpr = 1,
  safeInset?: { left?: number; right?: number; top?: number; bottom?: number },
): { z: number; ox: number; oy: number } {
  if (!bounds || canvasW <= 0 || canvasH <= 0) return cam;
  const margin = 10 * dpr;
  const vL = Math.max(0, safeInset?.left ?? 0) + margin;
  const vR = Math.max(vL + 80 * dpr, canvasW - Math.max(0, safeInset?.right ?? 0) - margin);
  const vT = Math.max(0, safeInset?.top ?? 0) + margin;
  const vB = Math.max(vT + 80 * dpr, canvasH - Math.max(0, safeInset?.bottom ?? 0) - margin);
  const vW = vR - vL;
  const vH = vB - vT;

  const bwRaw = Math.max(1, bounds.x1 - bounds.x0);
  const bhRaw = Math.max(1, bounds.y1 - bounds.y0);
  const fitZ = Math.min(vW / bwRaw, vH / bhRaw);
  const z = Math.max(Math.max(0.015, fitZ * 0.45), Math.min(Math.max(fitZ * 12, 2.5), cam.z));

  const bw = bwRaw * z;
  const bh = bhRaw * z;
  let ox = cam.ox;
  let oy = cam.oy;

  if (bw <= vW) {
    const minOx = vL - bounds.x0 * z;
    const maxOx = vR - bounds.x1 * z;
    ox = Math.max(minOx, Math.min(maxOx, ox));
  } else {
    const keepX = Math.min(vW * 0.42, 180 * dpr);
    const minOx = vL + keepX - bounds.x1 * z;
    const maxOx = vR - keepX - bounds.x0 * z;
    ox = Math.max(minOx, Math.min(maxOx, ox));
  }

  if (bh <= vH) {
    const minOy = vT - bounds.y0 * z;
    const maxOy = vB - bounds.y1 * z;
    oy = Math.max(minOy, Math.min(maxOy, oy));
  } else {
    const keepY = Math.min(vH * 0.42, 180 * dpr);
    const minOy = vT + keepY - bounds.y1 * z;
    const maxOy = vB - keepY - bounds.y0 * z;
    oy = Math.max(minOy, Math.min(maxOy, oy));
  }

  return { z, ox, oy };
}

export function capturePoseSnapshot(
  nodes: RigNode[],
  by: Record<string, RigNode>,
  root: RigNode,
  keys: Keyframe[],
  instMap: Record<string, PartRigInstance>,
  abc?: PoseSnapshot['abc'],
  prometheusWings?: boolean,
  bodyView?: BodyTurnView,
): PoseSnapshot {
  const pose: Record<string, number> = {};
  const coords: Record<string, [number, number]> = {};
  const flipX: Record<string, boolean> = {};
  nodes.forEach((n) => {
    pose[n.id] = Math.round(n.ang * 10) / 10;
    const p = pos(n, by);
    coords[n.id] = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    if (n.flipX) flipX[n.id] = true;
  });
  const parts: NonNullable<PoseSnapshot['parts']> = {};
  for (const id in instMap) {
    const I = instMap[id];
    if (I.touched) {
      parts[id] = {
        flip: I.flip,
        on: Array.from(I.on),
        ang: Array.from(I.ang),
        dx: Array.from(I.dx),
        dy: Array.from(I.dy),
        ...(I.gotz ? { gotz: cloneGotzState(I.gotz) } : {}),
      };
    }
  }
  const snap: PoseSnapshot = {
    pose,
    coords,
    keys: keys.map((k) => ({ f: k.f, a: k.a.slice(), x: k.x, y: k.y, s: k.s })),
    root: [root.tx, root.ty],
    parts,
  };
  if (Object.keys(flipX).length) {
    snap.flipX = flipX;
  }
  if (abc) {
    const hasAnyAbc = !!(abc.poses.A || abc.poses.B || abc.poses.C);
    if (hasAnyAbc) snap.abc = abc;
  }
  if (prometheusWings) {
    snap.prometheusWings = true;
  }
  if (bodyView && bodyView !== 'front') {
    snap.bodyView = bodyView;
  }
  return snap;
}

export function applyPoseSnapshot(
  o: Partial<PoseSnapshot>,
  nodes: RigNode[],
  root: RigNode,
  instMap: Record<string, PartRigInstance>,
  rebakeFn: (I: PartRigInstance) => void,
): Keyframe[] | null {
  nodes.forEach((n) => {
    if (o.pose && n.id in o.pose) {
      n.ang = o.pose[n.id];
    }
    n.flipX = !!(o.flipX && o.flipX[n.id]);
  });
  if (o.root) {
    root.tx = o.root[0];
    root.ty = o.root[1];
  }
  if (o.parts) {
    for (const id in o.parts) {
      const I = instMap[id];
      const q = o.parts[id];
      if (I && q) {
        I.on.set(q.on);
        I.ang.set(q.ang);
        I.dx.set(q.dx || []);
        I.dy.set(q.dy || []);
        I.flip = q.flip | 0;
        if (q.gotz && I.gotz) {
          I.gotz = cloneGotzState(q.gotz);
        }
        I.touched = 1;
        rebakeFn(I);
      }
    }
  }
  if (o.keys) {
    return o.keys.map((k) => ({
      f: k.f,
      a: k.a,
      x: k.x ?? 0,
      y: k.y ?? 0,
      s: k.s,
    }));
  }
  return null;
}

export function parseBskJson(d: { bones?: Array<{ name: string; parent?: string; x?: number; y?: number; rotation?: number }> }): RawRigDef {
  const bs = d.bones;
  if (!bs || !bs.length) throw new Error('no bones');
  const m: Record<string, NonNullable<typeof bs>[number]> = {};
  bs.forEach((b) => {
    m[b.name] = b;
  });
  const pv: Record<string, [number, number]> = {};
  const get = (b: NonNullable<typeof bs>[number]): [number, number] => {
    if (pv[b.name]) return pv[b.name];
    if (b.parent && m[b.parent]) {
      const p = get(m[b.parent]);
      pv[b.name] = [p[0] + (b.x || 0), p[1] + (b.y || 0)];
    } else {
      pv[b.name] = [b.x || 0, b.y || 0];
    }
    return pv[b.name];
  };
  bs.forEach(get);

  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (const k in pv) {
    x0 = Math.min(x0, pv[k][0]);
    x1 = Math.max(x1, pv[k][0]);
    y0 = Math.min(y0, pv[k][1]);
    y1 = Math.max(y1, pv[k][1]);
  }
  const S = Math.max(x1 - x0, y1 - y0, 1);
  const pad = S * 0.25;
  return {
    W: x1 - x0 + 2 * pad,
    H: y1 - y0 + 2 * pad,
    nodes: bs.map((b) => ({
      id: b.name,
      name: b.name,
      parent: b.parent || null,
      pivot: [pv[b.name][0] - x0 + pad, pv[b.name][1] - y0 + pad],
      ang: b.rotation || 0,
      pieces: [],
    })),
  };
}

export function exportBskJson(nodes: RigNode[], by: Record<string, RigNode>, W: number, H: number) {
  const bones = nodes.map((n) => {
    const p = n.parent && by[n.parent] ? by[n.parent].rest : [0, 0];
    return {
      name: n.id,
      ...(n.parent ? { parent: n.parent } : {}),
      x: Math.round((n.rest[0] - p[0]) * 100) / 100,
      y: Math.round((n.rest[1] - p[1]) * 100) / 100,
      rotation: Math.round(n.ang * 100) / 100,
    };
  });
  return {
    id: 'bitruvius',
    name: 'Bitruvius',
    version: '1.0',
    width: W,
    height: H,
    bones,
    slots: [],
    ik: [],
  };
}

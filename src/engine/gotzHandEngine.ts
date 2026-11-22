/**
 * Feature Notes (Plain English):
 * - Gotz 5-Digit Hand Engine: Builds an interactive hand with a connected forearm
 *   above the wrist, a wrist carpal hub, and 5 articulated fingers solved by 14-pass IK.
 * - Live Body Baking: Converts every finger/wrist adjustment into Bitruvius's matching
 *   purple-and-black hand sprite and keeps finger/thumb IK tips synced on the body.
 */
import { mkCanvas } from './fkEngine';

export type GotzDigitId = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export type GotzBuild = 'standard' | 'claw' | 'trident' | 'mickey';
export type GotzLimitsMode = 'realistic' | 'elastic' | 'expert';
export type GotzLayerOrder = 'free' | 'rigid' | 'rigid-reverse';
export type GotzStyle = 'hand-app-1' | 'hand-app-2' | 'legacy';

export interface GotzProps {
  bones: Record<GotzDigitId, number[]>;
  kn: Record<GotzDigitId, number>;
  width: number;
}

export interface GotzHandPresetData {
  splay: number;
  tilt: number;
  wrist: number;
  thumb: number;
  fs: Record<'index' | 'ring' | 'pinky', number>;
  rot: Record<GotzDigitId, number>;
  cj: Record<GotzDigitId, number[]>;
}

export interface GotzHandState extends GotzHandPresetData {
  mirror: boolean;
  build: GotzBuild;
  limits: GotzLimitsMode;
  layerOrder: GotzLayerOrder;
  wholeIk: boolean;
  guides: boolean;
  style: GotzStyle;
  /** Optional forearm angle above the wrist (degrees, synced with body forearm when open) */
  forearm?: number;
}

export interface GotzForearmSolved {
  pts: [[number, number], [number, number]];
  elbowPt: [number, number];
  wristPt: [number, number];
  angRad: number;
  angleDeg: number;
  len: number;
}

export interface GotzSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  len: number;
  ang: number;
  boneIdx: number;
  name: string;
}

export interface GotzSolvedDigit {
  digit: GotzDigitId;
  pts: Array<[number, number]>;
  segs: GotzSegment[];
}

export interface GotzHierarchyBone {
  id: string;
  digit: GotzDigitId | 'wrist' | 'forearm';
  boneIdx: number;
  label: string;
  depth: number;
  parentId: string | null;
  angleDeg: number;
}

export const GOTZ_DIGITS: GotzDigitId[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export const GOTZ_TE: Record<GotzDigitId, number> = {
  thumb: -120,
  index: -30,
  middle: 0,
  ring: 30,
  pinky: 60,
};

export const GOTZ_SIGN: Record<GotzDigitId, number> = {
  thumb: -1,
  index: 1,
  middle: 1,
  ring: 1,
  pinky: 1,
};

export const GOTZ_BUILDS: Record<GotzBuild, GotzDigitId[]> = {
  standard: ['thumb', 'index', 'middle', 'ring', 'pinky'],
  claw: ['thumb', 'middle'],
  trident: ['thumb', 'middle', 'ring'],
  mickey: ['thumb', 'index', 'middle', 'ring'],
};

const D_REAL: Record<GotzDigitId, Array<[number, number]>> = {
  index: [
    [-35, 90],
    [0, 110],
    [-5, 85],
  ],
  middle: [
    [-35, 90],
    [0, 110],
    [-5, 85],
  ],
  ring: [
    [-35, 90],
    [0, 120],
    [-5, 85],
  ],
  pinky: [
    [-35, 90],
    [0, 135],
    [-5, 90],
  ],
  thumb: [
    [0, 77.5],
    [-7.5, 77.5],
  ],
};

const F_REAL: Record<GotzDigitId, [number, number]> = {
  index: [-30, 30],
  middle: [-22.5, 22.5],
  ring: [-22.5, 22.5],
  pinky: [-25, 25],
  thumb: [-26.25, 26.25],
};

const F_ELAS: Record<GotzDigitId, [number, number]> = {
  index: [-75, 75],
  middle: [-75, 75],
  ring: [-75, 75],
  pinky: [-24, 90],
  thumb: [-90, 90],
};

export const GOTZ_PROPS_ANAT: GotzProps = {
  bones: {
    middle: [3.25, 2.95, 2.0, 1.1],
    ring: [3.05, 2.8, 1.9, 1.0],
    index: [3.05, 2.8, 1.9, 1.0],
    pinky: [2.8, 2.55, 1.7, 0.9],
    thumb: [2.35, 1.9, 1.1],
  },
  kn: { middle: 0.72, ring: 0.72, index: 0.72, pinky: 0.68, thumb: 0.42 },
  width: 1.32,
};

export const GOTZ_PROPS_LEG: GotzProps = {
  bones: {
    middle: [4, 2, 1, 1],
    ring: [3.75, 1.875, 0.9375, 0.9375],
    index: [3.75, 1.875, 0.9375, 0.9375],
    pinky: [3.5, 1.75, 0.875, 0.875],
    thumb: [3, 1.5, 1],
  },
  kn: { middle: 0.75, ring: 0.75, index: 0.75, pinky: 0.75, thumb: 0.4 },
  width: 1.55,
};

export const GOTZ_PRESETS: Record<string, GotzHandPresetData> = {
  Neutral: {
    splay: 45,
    tilt: 0,
    wrist: 0,
    thumb: 0,
    fs: { index: 0, ring: 0, pinky: 0 },
    rot: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
    cj: { thumb: [10, 12], index: [8, 12, 8], middle: [6, 10, 6], ring: [10, 14, 8], pinky: [14, 18, 10] },
  },
  Grip: {
    splay: 28,
    tilt: 0,
    wrist: 0,
    thumb: 6,
    fs: { index: 0, ring: 2, pinky: 5 },
    rot: { thumb: -6, index: 6, middle: 0, ring: -3, pinky: -6 },
    cj: { thumb: [38, 44], index: [48, 66, 42], middle: [54, 72, 46], ring: [60, 78, 50], pinky: [66, 84, 54] },
  },
  Open: {
    splay: 72,
    tilt: 0,
    wrist: 0,
    thumb: 12,
    fs: { index: -10, ring: 8, pinky: 18 },
    rot: { thumb: -6, index: -3, middle: 0, ring: 3, pinky: 6 },
    cj: { thumb: [0, 0], index: [-10, 0, 0], middle: [-8, 0, 0], ring: [-10, 0, 0], pinky: [-12, 0, 0] },
  },
  Fist: {
    splay: 28,
    tilt: 0,
    wrist: 0,
    thumb: 6,
    fs: { index: 0, ring: 2, pinky: 5 },
    rot: {
      thumb: -6,
      index: 18.085173986193276,
      middle: 8.53075642630238,
      ring: 5.530756426302371,
      pinky: 2.5307564263023776,
    },
    cj: {
      thumb: [38, 44],
      index: [42.44750338490305, 85.35048419431823, 31.82359492199626],
      middle: [54, 72, 46],
      ring: [60, 78, 50],
      pinky: [66, 84, 54],
    },
  },
  Point: {
    splay: 35,
    tilt: 0,
    wrist: 0,
    thumb: -10,
    fs: { index: -12, ring: 0, pinky: 0 },
    rot: { thumb: 12, index: -4, middle: 0, ring: -2, pinky: -4 },
    cj: { thumb: [45, 40], index: [0, 0, 0], middle: [86, 102, 75], ring: [88, 108, 78], pinky: [88, 118, 80] },
  },
  Peace: {
    splay: 50,
    tilt: 0,
    wrist: 0,
    thumb: -15,
    fs: { index: -25, ring: 0, pinky: 0 },
    rot: { thumb: 16, index: -10, middle: 6, ring: -4, pinky: -8 },
    cj: { thumb: [52, 48], index: [0, 0, 0], middle: [0, 0, 0], ring: [88, 110, 78], pinky: [88, 120, 82] },
  },
  Rock: {
    splay: 48,
    tilt: 0,
    wrist: 0,
    thumb: 10,
    fs: { index: -15, ring: 0, pinky: 20 },
    rot: { thumb: -8, index: -6, middle: 0, ring: -4, pinky: 10 },
    cj: { thumb: [12, 18], index: [0, 0, 0], middle: [88, 105, 78], ring: [88, 112, 78], pinky: [0, 0, 0] },
  },
  Pinch: {
    splay: 30,
    tilt: 0,
    wrist: 0,
    thumb: -20,
    fs: { index: 15, ring: -5, pinky: -5 },
    rot: { thumb: 24, index: 14, middle: 0, ring: -4, pinky: -6 },
    cj: { thumb: [42, 50], index: [52, 65, 42], middle: [22, 26, 15], ring: [32, 38, 20], pinky: [42, 50, 28] },
  },
  Flat: {
    splay: 0,
    tilt: 0,
    wrist: 0,
    thumb: -45,
    fs: { index: 0, ring: 0, pinky: 0 },
    rot: { thumb: 20, index: 0, middle: 0, ring: 0, pinky: 0 },
    cj: { thumb: [0, 0], index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], pinky: [0, 0, 0] },
  },
  Don: {
    splay: 30,
    tilt: 0,
    wrist: 12,
    thumb: 10,
    fs: { index: 0, ring: 0, pinky: 0 },
    rot: { thumb: 0, index: 2, middle: -1, ring: -10, pinky: -22 },
    cj: { thumb: [0, 0], index: [78, -9, 74], middle: [0, 0, 0], ring: [78, 80, 68], pinky: [82, 92, 72] },
  },
};

const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function cloneGotzState(st: GotzHandState): GotzHandState {
  return JSON.parse(JSON.stringify(st)) as GotzHandState;
}

export function createDefaultGotzHandState(mirror: boolean, presetName = 'Fist'): GotzHandState {
  const base = GOTZ_PRESETS[presetName] ?? GOTZ_PRESETS.Fist;
  return {
    splay: base.splay,
    tilt: base.tilt,
    wrist: base.wrist,
    thumb: base.thumb,
    fs: { ...base.fs },
    rot: { ...base.rot },
    cj: {
      thumb: base.cj.thumb.slice(),
      index: base.cj.index.slice(),
      middle: base.cj.middle.slice(),
      ring: base.cj.ring.slice(),
      pinky: base.cj.pinky.slice(),
    },
    mirror,
    build: 'standard',
    limits: 'realistic',
    layerOrder: 'free',
    wholeIk: true,
    guides: true,
    style: 'hand-app-1',
    forearm: 0,
  };
}

export function applyGotzPreset(st: GotzHandState, presetName: string): GotzHandState {
  const base = GOTZ_PRESETS[presetName];
  if (!base) return st;
  return {
    ...st,
    splay: base.splay,
    tilt: base.tilt,
    wrist: base.wrist,
    thumb: base.thumb,
    fs: { ...base.fs },
    rot: { ...base.rot },
    cj: {
      thumb: base.cj.thumb.slice(),
      index: base.cj.index.slice(),
      middle: base.cj.middle.slice(),
      ring: base.cj.ring.slice(),
      pinky: base.cj.pinky.slice(),
    },
  };
}

export function gotzCurlBounds(d: GotzDigitId, j: number, lim: GotzLimitsMode): [number, number] {
  if (lim === 'expert') return [-90, 90];
  return D_REAL[d]?.[j] ?? [-35, 90];
}

export function gotzRotBounds(d: GotzDigitId, lim: GotzLimitsMode): [number, number] {
  if (lim === 'expert') return [-90, 90];
  if (lim === 'elastic') return F_ELAS[d] ?? [-75, 75];
  return F_REAL[d] ?? [-30, 30];
}

export function gotzSplayAngle(d: GotzDigitId, st: GotzHandState): number {
  const spreadOff = d === 'thumb' ? st.thumb : d === 'middle' ? 0 : st.fs[d] || 0;
  const effSpread = clamp(st.splay + spreadOff, -100, 100);
  return GOTZ_TE[d] * (effSpread / 100) + st.tilt + (st.rot[d] || 0);
}

const METACARPAL_BASE_ANG: Record<GotzDigitId, number> = {
  thumb: -34,
  index: -9.5,
  middle: 0,
  ring: 9,
  pinky: 18,
};

const CARPAL_BASE_X: Record<GotzDigitId, number> = {
  thumb: -0.22,
  index: -0.14,
  middle: 0,
  ring: 0.13,
  pinky: 0.25,
};

export function enforceGotzLayerOrder(changedDigit: GotzDigitId, st: GotzHandState): void {
  if (st.layerOrder === 'free') return;
  const order = GOTZ_BUILDS[st.build] || GOTZ_DIGITS;
  const list = st.layerOrder === 'rigid-reverse' ? [...order].reverse() : order;
  const idx = list.indexOf(changedDigit);
  if (idx < 0) return;
  const minGap = 4;
  for (let i = idx - 1; i >= 0; i--) {
    const dPrev = list[i];
    const dNext = list[i + 1];
    const diff = gotzSplayAngle(dNext, st) - gotzSplayAngle(dPrev, st);
    if (diff < minGap) {
      const [lo, hi] = gotzRotBounds(dPrev, st.limits);
      st.rot[dPrev] = clamp(st.rot[dPrev] - (minGap - diff), lo, hi);
    }
  }
  for (let i = idx + 1; i < list.length; i++) {
    const dPrev = list[i - 1];
    const dNext = list[i];
    const diff = gotzSplayAngle(dNext, st) - gotzSplayAngle(dPrev, st);
    if (diff < minGap) {
      const [lo, hi] = gotzRotBounds(dNext, st.limits);
      st.rot[dNext] = clamp(st.rot[dNext] + (minGap - diff), lo, hi);
    }
  }
}

const BONE_NAMES_4 = ['Metacarpal', 'Proximal', 'Middle', 'Distal'];
const BONE_NAMES_3 = ['Metacarpal', 'Proximal', 'Distal'];

export function solveGotzDigit(
  d: GotzDigitId,
  st: GotzHandState,
  props: GotzProps = GOTZ_PROPS_ANAT,
): GotzSolvedDigit {
  const lens = props.bones[d] || GOTZ_PROPS_ANAT.bones[d];
  const kn = props.kn?.[d] ?? GOTZ_PROPS_ANAT.kn[d];
  const wristDeg = st.mirror ? -st.wrist : st.wrist;
  const fingerSplay = gotzSplayAngle(d, st);
  // Metacarpals stay closely clustered together (body of the hand) with bounded stretch/splay;
  // finger phalanges carry the expressive fan spread beyond the MCP knuckles.
  const spreadOff = d === 'thumb' ? st.thumb : d === 'middle' ? 0 : st.fs[d] || 0;
  const effSpread = clamp(st.splay + spreadOff, -100, 100);
  const mcFan = d === 'thumb' ? METACARPAL_BASE_ANG.thumb * (0.65 + 0.35 * (effSpread / 100)) : METACARPAL_BASE_ANG[d] * (0.72 + 0.28 * clamp(st.splay / 100, 0, 1));
  const mcDeg = wristDeg + mcFan + st.tilt * 0.45 + (st.rot[d] || 0) * 0.22;
  const mcpBreakDeg = fingerSplay - mcFan - st.tilt * 0.45 - (st.rot[d] || 0) * 0.22;

  let x = CARPAL_BASE_X[d] ?? 0;
  let y = 0;
  let a = mcDeg * RAD;
  const pts: Array<[number, number]> = [[x, y]];
  const segs: GotzSegment[] = [];
  const names = lens.length === 3 ? BONE_NAMES_3 : BONE_NAMES_4;

  for (let l = 0; l < lens.length; l++) {
    const rawL = lens[l];
    const segLen = Math.max(0.18, (l === 1 ? -kn / 2 : 0) + rawL - (l === 0 ? kn : 0) / 2);
    const nx = x + Math.sin(a) * segLen;
    const ny = y - Math.cos(a) * segLen;
    segs.push({ x1: x, y1: y, x2: nx, y2: ny, len: segLen, ang: a, boneIdx: l, name: names[l] || `Phalanx ${l}` });
    x = nx;
    y = ny;
    pts.push([x, y]);
    const cur = st.cj[d] || [];
    if (l === 0) {
      // Transition from compact metacarpal arch into expressive splayed proximal finger phalanx
      a += mcpBreakDeg * RAD * 0.52;
    }
    if (l < cur.length) {
      a += -GOTZ_SIGN[d] * (cur[l] || 0) * RAD;
    }
  }
  return { digit: d, pts, segs };
}

export function solveGotzHand(
  st: GotzHandState,
  props: GotzProps = GOTZ_PROPS_ANAT,
): Record<GotzDigitId, GotzSolvedDigit> {
  return {
    thumb: solveGotzDigit('thumb', st, props),
    index: solveGotzDigit('index', st, props),
    middle: solveGotzDigit('middle', st, props),
    ring: solveGotzDigit('ring', st, props),
    pinky: solveGotzDigit('pinky', st, props),
  };
}

/**
 * Solves the proximal forearm bone extending above the carpal wrist hub [0, 0] toward the elbow.
 */
export function solveGotzForearm(st: GotzHandState): GotzForearmSolved {
  const angleDeg = clamp(st.forearm ?? 0, -65, 65);
  const signedDeg = st.mirror ? -angleDeg : angleDeg;
  const angRad = signedDeg * RAD;
  const len = 3.85;
  const elbowPt: [number, number] = [-Math.sin(angRad) * len, Math.cos(angRad) * len];
  return {
    pts: [elbowPt, [0, 0]],
    elbowPt,
    wristPt: [0, 0],
    angRad,
    angleDeg,
    len,
  };
}

function softElastic(val: number, lo: number, hi: number): number {
  if (val >= lo && val <= hi) return val;
  const over = val < lo ? val - lo : val - hi;
  const bound = val < lo ? lo : hi;
  return bound + Math.tanh(over / 18) * 6;
}

/**
 * 14-Pass CCD IK solver targeting pts[endPtIdx] -> (tx, ty) in un-mirrored Gotz space.
 */
export function solveGotzDigitIk(
  d: GotzDigitId,
  endPtIdx: number,
  tx: number,
  ty: number,
  st: GotzHandState,
  props: GotzProps = GOTZ_PROPS_ANAT,
): void {
  const lens = props.bones[d] || GOTZ_PROPS_ANAT.bones[d];
  const maxEnd = clamp(endPtIdx, 1, lens.length);

  for (let pass = 0; pass < 14; pass++) {
    for (let k = maxEnd - 1; k >= -1; k--) {
      const { pts } = solveGotzDigit(d, st, props);
      const pv = k === -1 ? pts[0] : pts[k + 1];
      const ef = pts[maxEnd];
      const vxE = ef[0] - pv[0];
      const vyE = ef[1] - pv[1];
      const vxT = tx - pv[0];
      const vyT = ty - pv[1];
      if (Math.hypot(vxE, vyE) < 1e-4 || Math.hypot(vxT, vyT) < 1e-4) continue;
      let da = Math.atan2(vyT, vxT) - Math.atan2(vyE, vxE);
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const dDeg = da / RAD;

      if (k === -1) {
        const r0 = st.rot[d] || 0;
        const [lo, hi] = gotzRotBounds(d, st.limits);
        st.rot[d] = st.limits === 'realistic' ? softElastic(r0 + dDeg, lo, hi) : clamp(r0 + dDeg, lo, hi);
        const dv = st.rot[d] - r0;
        if (st.wholeIk && Math.abs(dv) > 1e-4) {
          for (const o of GOTZ_BUILDS[st.build] || GOTZ_DIGITS) {
            if (o === d) continue;
            const [olo, ohi] = gotzRotBounds(o, st.limits);
            const weight = d === 'thumb' || o === 'thumb' ? 0.12 : 0.35;
            st.rot[o] = clamp((st.rot[o] || 0) + weight * dv, olo, ohi);
          }
        }
        enforceGotzLayerOrder(d, st);
      } else {
        const cArr = st.cj[d];
        if (k < cArr.length) {
          const [cLo, cHi] = gotzCurlBounds(d, k, st.limits);
          cArr[k] = clamp(cArr[k] + -GOTZ_SIGN[d] * dDeg, cLo, cHi);
        }
      }
    }
  }
}

export function getGotzPoseCode(st: GotzHandState): string {
  const active = GOTZ_BUILDS[st.build] || GOTZ_DIGITS;
  const map: Record<GotzDigitId, string> = {
    thumb: 'Thumb',
    index: 'Index',
    middle: 'Bird',
    ring: 'Ring',
    pinky: 'Pinky',
  };
  return active
    .map((d) => {
      const c = st.cj[d] || [];
      const avg = c.length ? c.reduce((s, v) => s + Math.abs(v), 0) / c.length : 0;
      const glyph = avg < 18 ? '|' : avg < 58 ? '\\' : ']';
      return `${map[d]} ${glyph}`;
    })
    .join(' · ');
}

export function buildGotzHierarchyTree(st: GotzHandState): GotzHierarchyBone[] {
  const active = GOTZ_BUILDS[st.build] || GOTZ_DIGITS;
  const forearmDeg = Math.round((st.forearm ?? 0) * 10) / 10;
  const out: GotzHierarchyBone[] = [
    {
      id: 'forearm',
      digit: 'forearm',
      boneIdx: -2,
      label: 'Forearm (Above Wrist)',
      depth: 0,
      parentId: null,
      angleDeg: forearmDeg,
    },
    {
      id: 'wrist',
      digit: 'wrist',
      boneIdx: -1,
      label: 'Wrist / Carpal Hub',
      depth: 1,
      parentId: 'forearm',
      angleDeg: Math.round(st.wrist * 10) / 10,
    },
  ];

  for (const d of active) {
    const cap = d[0].toUpperCase() + d.slice(1);
    const metaId = `${d}:0`;
    out.push({
      id: metaId,
      digit: d,
      boneIdx: 0,
      label: `${cap} Metacarpal`,
      depth: 2,
      parentId: 'wrist',
      angleDeg: Math.round(gotzSplayAngle(d, st) * 10) / 10,
    });

    const cur = st.cj[d] || [];
    const subNames = d === 'thumb' ? ['Proximal', 'Distal'] : ['Proximal', 'Middle', 'Distal'];
    let prevId = metaId;
    for (let j = 0; j < subNames.length; j++) {
      const boneId = `${d}:${j + 1}`;
      out.push({
        id: boneId,
        digit: d,
        boneIdx: j + 1,
        label: `${cap} ${subNames[j]}`,
        depth: 3 + j,
        parentId: prevId,
        angleDeg: Math.round((cur[j] ?? 0) * 10) / 10,
      });
      prevId = boneId;
    }
  }
  return out;
}

export function lerpGotzHandState(a: GotzHandState, b: GotzHandState, t: number): GotzHandState {
  const k = clamp(t, 0, 1);
  const lerp = (x: number, y: number) => x + (y - x) * k;
  const target = k >= 0.5 ? b : a;
  const out = cloneGotzState(target);
  out.wrist = lerp(a.wrist, b.wrist);
  out.forearm = lerp(a.forearm ?? 0, b.forearm ?? 0);
  out.splay = lerp(a.splay, b.splay);
  out.tilt = lerp(a.tilt, b.tilt);
  out.thumb = lerp(a.thumb, b.thumb);
  out.fs = {
    index: lerp(a.fs.index, b.fs.index),
    ring: lerp(a.fs.ring, b.fs.ring),
    pinky: lerp(a.fs.pinky, b.fs.pinky),
  };
  for (const d of GOTZ_DIGITS) {
    out.rot[d] = lerp(a.rot[d] || 0, b.rot[d] || 0);
    const ca = a.cj[d] || [];
    const cb = b.cj[d] || [];
    out.cj[d] = ca.map((v, i) => lerp(v, cb[i] ?? v));
  }
  return out;
}

export function gotzForearmSvgPath(len: number, widthMul: number, style: GotzStyle): string {
  const halfWrist = 0.44 * widthMul;
  const halfElbow = 0.72 * widthMul;
  const ch = Math.min(len * 0.16, 0.36);
  if (style === 'legacy') {
    return `M ${-halfWrist * 0.7} 0 L ${halfWrist * 0.7} 0 L ${halfWrist} ${ch} L ${halfElbow} ${len - ch} L ${halfElbow * 0.65} ${len} L ${-halfElbow * 0.65} ${len} L ${-halfElbow} ${len - ch} L ${-halfWrist} ${ch} Z`;
  }
  if (style === 'hand-app-2') {
    const belly = halfElbow * 0.96;
    return `M 0 0 C ${halfWrist} 0 ${belly} ${len * 0.35} ${belly} ${len * 0.6} C ${halfElbow} ${len * 0.85} ${halfElbow * 0.8} ${len} 0 ${len} C ${-halfElbow * 0.8} ${len} ${-halfElbow} ${len * 0.85} ${-belly} ${len * 0.6} C ${-belly} ${len * 0.35} ${-halfWrist} 0 0 0 Z`;
  }
  return `M ${-halfWrist * 0.75} ${-ch * 0.1} Q 0 ${-ch * 0.32} ${halfWrist * 0.75} ${-ch * 0.1} C ${halfWrist * 1.05} ${ch} ${halfElbow * 1.04} ${len * 0.56} ${halfElbow * 0.9} ${len - ch} Q 0 ${len + ch * 0.35} ${-halfElbow * 0.9} ${len - ch} C ${-halfElbow * 1.04} ${len * 0.56} ${-halfWrist * 1.05} ${ch} ${-halfWrist * 0.75} ${-ch * 0.1} Z`;
}

export function gotzBoneSvgPath(seg: GotzSegment, boneIdx: number, totalBones: number, widthMul: number, style: GotzStyle): string {
  const L = seg.len;
  const baseW = (style === 'legacy' ? 0.54 : 0.58) * widthMul;
  const taper = [0.92, 0.72, 0.56, 0.44][boneIdx] ?? 0.42;
  const w1 = baseW * taper * (boneIdx === 0 ? 0.84 : 0.9);
  const w2 = baseW * taper * (boneIdx === totalBones - 1 ? 0.58 : 0.92);
  const half1 = w1 * 0.5;
  const half2 = w2 * 0.5;
  const ch = Math.min(L * 0.22, Math.max(half1, half2) * 0.62);

  if (style === 'legacy') {
    return `M ${-half1 * 0.6} 0 L ${half1 * 0.6} 0 L ${half1} ${-ch} L ${half2} ${-(L - ch)} L ${half2 * 0.6} ${-L} L ${-half2 * 0.6} ${-L} L ${-half2} ${-(L - ch)} L ${-half1} ${-ch} Z`;
  }
  if (style === 'hand-app-2') {
    const waist = Math.min(half1, half2) * 0.76;
    return `M 0 0 C ${half1} 0 ${half1} ${-L * 0.2} ${waist} ${-L * 0.5} C ${half2} ${-L * 0.8} ${half2} ${-L} 0 ${-L} C ${-half2} ${-L} ${-half2} ${-L * 0.8} ${-waist} ${-L * 0.5} C ${-half1} ${-L * 0.2} ${-half1} 0 0 0 Z`;
  }
  const neck = Math.min(half1, half2) * 0.84;
  return `M ${-half1 * 0.55} ${ch * 0.18} Q 0 ${ch * 0.45} ${half1 * 0.55} ${ch * 0.18} C ${half1} ${-ch * 0.35} ${neck} ${-L * 0.45} ${half2 * 0.95} ${-(L - ch)} Q ${half2 * 0.6} ${-L - ch * 0.22} 0 ${-L - ch * 0.22} Q ${-half2 * 0.6} ${-L - ch * 0.22} ${-half2 * 0.95} ${-(L - ch)} C ${-neck} ${-L * 0.45} ${-half1} ${-ch * 0.35} ${-half1 * 0.55} ${ch * 0.18} Z`;
}

// World-space mapping constants for Handkit piece on the main Bitruvius puppet
export const GOTZ_STAGE_BOX = {
  halfW: 460,
  topPad: 105,
  w: 920,
  h: 960,
  scale: 84, // world units per Gotz bone unit (middle total ~9.5u * 84 = ~798px, matching 878px Handkit!)
};

/**
 * Converts a Gotz local point [gx, gy] (where fingers grow toward -Y, wrist at [0,0])
 * into main Puppet world space relative to wristPivot [wx, wy] (fingers point +Y downward).
 */
export function gotzToPuppetOffset(gx: number, gy: number, mirror: boolean): [number, number] {
  const sx = mirror ? -gx : gx;
  return [sx * GOTZ_STAGE_BOX.scale, -gy * GOTZ_STAGE_BOX.scale];
}

function traceGotzBoneCanvas(
  g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  L: number,
  boneIdx: number,
  totalBones: number,
  widthMul: number,
  style: GotzStyle,
): void {
  const baseW = (style === 'legacy' ? 0.54 : 0.58) * widthMul;
  const taper = [0.92, 0.72, 0.56, 0.44][boneIdx] ?? 0.42;
  const w1 = baseW * taper * (boneIdx === 0 ? 0.84 : 0.9);
  const w2 = baseW * taper * (boneIdx === totalBones - 1 ? 0.58 : 0.92);
  const half1 = w1 * 0.5;
  const half2 = w2 * 0.5;
  const ch = Math.min(L * 0.22, Math.max(half1, half2) * 0.62);

  g.beginPath();
  if (style === 'legacy') {
    g.moveTo(-half1 * 0.6, 0);
    g.lineTo(half1 * 0.6, 0);
    g.lineTo(half1, -ch);
    g.lineTo(half2, -(L - ch));
    g.lineTo(half2 * 0.6, -L);
    g.lineTo(-half2 * 0.6, -L);
    g.lineTo(-half2, -(L - ch));
    g.lineTo(-half1, -ch);
    g.closePath();
    return;
  }
  if (style === 'hand-app-2') {
    const waist = Math.min(half1, half2) * 0.76;
    g.moveTo(0, 0);
    g.bezierCurveTo(half1, 0, half1, -L * 0.2, waist, -L * 0.5);
    g.bezierCurveTo(half2, -L * 0.8, half2, -L, 0, -L);
    g.bezierCurveTo(-half2, -L, -half2, -L * 0.8, -waist, -L * 0.5);
    g.bezierCurveTo(-half1, -L * 0.2, -half1, 0, 0, 0);
    g.closePath();
    return;
  }
  const neck = Math.min(half1, half2) * 0.84;
  g.moveTo(-half1 * 0.55, ch * 0.18);
  g.quadraticCurveTo(0, ch * 0.45, half1 * 0.55, ch * 0.18);
  g.bezierCurveTo(half1, -ch * 0.35, neck, -L * 0.45, half2 * 0.95, -(L - ch));
  g.quadraticCurveTo(half2 * 0.6, -L - ch * 0.22, 0, -L - ch * 0.22);
  g.quadraticCurveTo(-half2 * 0.6, -L - ch * 0.22, -half2 * 0.95, -(L - ch));
  g.bezierCurveTo(-neck, -L * 0.45, -half1, -ch * 0.35, -half1 * 0.55, ch * 0.18);
  g.closePath();
}

/**
 * Renders the articulated 5-digit Gotz Hand Rig v2 directly onto a high-DPI offscreen canvas
 * matching Bitruvius Puppyt's black cutout + purple bone contour palette (#000000 + #5d03b4),
 * with wrist hub placed cleanly at (halfW, topPad) and digits pointing downward (+Y).
 */
export function bakeGotzHandToCanvas(
  st: GotzHandState,
  props: GotzProps = GOTZ_PROPS_ANAT,
): { canvas: OffscreenCanvas | HTMLCanvasElement; middleTipOffset: [number, number]; thumbTipOffset: [number, number] } {
  const pxScale = 0.5; // 460x480 bitmap maps crisply to 920x960 world units
  const cw = Math.ceil(GOTZ_STAGE_BOX.w * pxScale);
  const ch = Math.ceil(GOTZ_STAGE_BOX.h * pxScale);
  const c = mkCanvas(cw, ch);
  const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const active = GOTZ_BUILDS[st.build] || GOTZ_DIGITS;
  const wMul = props.width || 0.75;
  const uScale = GOTZ_STAGE_BOX.scale * pxScale;
  const originX = GOTZ_STAGE_BOX.halfW * pxScale;
  const originY = GOTZ_STAGE_BOX.topPad * pxScale;

  g.save();
  g.translate(originX, originY);
  // Mirror horizontally when requested, and flip Y so Gotz's -Y upward digits point +Y downward on puppet
  g.scale(st.mirror ? -uScale : uScale, -uScale);

  const solved = solveGotzHand(st, props);

  // Sculpted anatomical palmar arch connecting wrist radiocarpal joint through MCP knuckles
  const fingerDigits = active.filter((d) => d !== 'thumb');
  const mcpPts = fingerDigits.map((d) => solved[d].pts[1]);
  if (mcpPts.length >= 2) {
    const firstMcp = mcpPts[0];
    const lastMcp = mcpPts[mcpPts.length - 1];
    const thumbBase = active.includes('thumb') ? solved.thumb.pts[1] : firstMcp;
    g.beginPath();
    g.moveTo(-0.34, 0.08);
    g.quadraticCurveTo(
      (thumbBase[0] - 0.34) * 0.55 - 0.16,
      (thumbBase[1] + 0.08) * 0.5,
      firstMcp[0],
      firstMcp[1],
    );
    for (let i = 1; i < mcpPts.length; i++) {
      const prev = mcpPts[i - 1];
      const cur = mcpPts[i];
      g.quadraticCurveTo((prev[0] + cur[0]) * 0.5, (prev[1] + cur[1]) * 0.5 - 0.12, cur[0], cur[1]);
    }
    g.quadraticCurveTo(lastMcp[0] * 0.82 + 0.24, lastMcp[1] * 0.48, 0.34, 0.08);
    g.closePath();
    g.fillStyle = '#5d03b4';
    g.fill();
    g.lineWidth = 0.068;
    g.lineJoin = 'round';
    g.strokeStyle = '#000000';
    g.stroke();
  }

  // Draw digits back-to-front
  const drawOrder = (['middle', 'ring', 'index', 'pinky', 'thumb'] as GotzDigitId[]).filter((d) =>
    active.includes(d),
  );
  for (const d of drawOrder) {
    const { pts, segs } = solved[d];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      g.save();
      g.translate(seg.x1, seg.y1);
      g.rotate(seg.ang);
      traceGotzBoneCanvas(g, seg.len, i, segs.length, wMul, st.style);
      g.fillStyle = '#5d03b4';
      g.fill();
      g.lineWidth = 0.068;
      g.lineJoin = 'round';
      g.strokeStyle = '#000000';
      g.stroke();

      // Subtle anatomical highlight ridge
      g.beginPath();
      g.moveTo(0, -seg.len * 0.2);
      g.lineTo(0, -seg.len * 0.8);
      g.lineWidth = 0.032;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255, 255, 255, 0.32)';
      g.stroke();
      g.restore();
    }

    // Crisp minimal knuckle articulation pins (no bulbous fingertip dots)
    for (let j = 1; j < pts.length - 1; j++) {
      const [px, py] = pts[j];
      g.beginPath();
      g.arc(px, py, 0.044, 0, Math.PI * 2);
      g.fillStyle = '#181024';
      g.fill();
      g.lineWidth = 0.025;
      g.strokeStyle = '#000000';
      g.stroke();
    }
  }

  // Slim carpal / wrist socket hub matching forearm distal taper
  g.beginPath();
  g.ellipse(0, 0, 0.34, 0.24, 0, 0, Math.PI * 2);
  g.fillStyle = '#5d03b4';
  g.fill();
  g.lineWidth = 0.068;
  g.strokeStyle = '#000000';
  g.stroke();

  g.restore();

  const midPts = solved.middle.pts;
  const midTip = midPts[midPts.length - 1] || [0, -8];
  const thPts = solved.thumb.pts;
  const thTip = thPts[thPts.length - 1] || [-2, -3];

  return {
    canvas: c,
    middleTipOffset: gotzToPuppetOffset(midTip[0], midTip[1], st.mirror),
    thumbTipOffset: gotzToPuppetOffset(thTip[0], thTip[1], st.mirror),
  };
}

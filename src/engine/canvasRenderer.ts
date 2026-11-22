/**
 * Feature Notes (Plain English):
 * - Stage Renderer & Digital X-Ray: Draws Bitruvius in crisp purple-and-black Analog mode
 *   or softened blurred Digital mode with green bone overlays and hidden-layer X-ray cutouts.
 * - Canvas Backdrop Text & Complementary Green Filter: Places "Welcome Bitruvius." and the
 *   drag-hands guidance behind the figure between head-top and ankles, constrained to canvas
 *   width, turning any colliding letters over the model into our complementary studio green.
 * - Perspective Grid & Elastic Pin Tethers: Renders Horizon, Ground, Vanishing Point, and
 *   live rubber-band tethers when effectors pull away from full-rig pin anchors.
 */
import {
  computeRigWorldBounds,
  evalCoreTriangleState,
  getPieceWorldMatrix,
  getTensionRatio,
  mkCanvas,
  parentOf,
  pos,
  samplePieceWorldMask,
  solveRig,
  type RibAnchorMode,
} from './fkEngine';
import {
  GOTZ_BUILDS,
  GOTZ_DIGITS,
  GOTZ_PROPS_ANAT,
  GOTZ_PROPS_LEG,
  type GotzHandState,
  gotzToPuppetOffset,
  solveGotzHand,
} from './gotzHandEngine';
import {
  EFFECTOR_IDS,
  FBIK_CHAIN_NODES,
  PIN_DIAMOND_RADIUS_PX,
  PIN_MAGNETIC_SNAP_RADIUS_PX,
  distToPinDiamondPx,
  findLimbChainForNode,
  footContactInfo,
  skelFocalX,
} from './ikEngine';
import {
  captureHeadTurnRenderSnapshot,
  previewHeadTurnStepSync,
  resolvePoseHeadTurnStep,
  restoreHeadTurnRenderSnapshot,
} from './skullKitModels';
import { applyBodyViewPivots, sortPiecesForBodyView } from './turnaround';
import type {
  AbcPoseRecord,
  AbcSlot,
  BodyTurnView,
  IKOverlayState,
  PerspHandle,
  PerspectiveState,
  RenderMode,
  RigNode,
  RigPiece,
} from './types';

const GREEN = '#22c55e';
const RED = '#ef4444';
const MAGENTA = '#ff3b6b';
const PURPLE_GUIDE = 'rgba(168, 85, 247, 0.72)';
const PURPLE_GUIDE_TEXT = 'rgba(192, 132, 252, 0.92)';
const SK: Array<[number, number]> = [
  [1006, 140],
  [1511, 140],
  [1259, 890],
];

const ABC_TINT: Record<AbcSlot, { fill: string; stroke: string; badge: string }> = {
  A: { fill: 'rgba(168, 85, 247, 0.36)', stroke: 'rgba(192, 132, 252, 0.88)', badge: '#c084fc' },
  B: { fill: 'rgba(16, 185, 129, 0.34)', stroke: 'rgba(52, 211, 153, 0.88)', badge: '#34d399' },
  C: { fill: 'rgba(255, 59, 107, 0.34)', stroke: 'rgba(255, 107, 143, 0.88)', badge: '#ff6b8f' },
};

export interface AbcGhostItem {
  slot: AbcSlot;
  pose: AbcPoseRecord;
  isPrimary: boolean;
  opacity: number;
}

export interface RenderContextState {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  nodes: RigNode[];
  by: Record<string, RigNode>;
  pieces: RigPiece[];
  sel: RigNode | null;
  hov: RigNode | null;
  W: number;
  H: number;
  z: number;
  ox: number;
  oy: number;
  dpr: number;
  mode: RenderMode;
  showBones: boolean;
  showGuides: boolean;
  constrainLimits: boolean;
  bondOn?: boolean;
  isActiveMotion: boolean;
  actUntil: number;
  bgColor: string;
  wingPop?: number;
  bodyView?: BodyTurnView;
  ribAnchor?: RibAnchorMode;
  abcGhosts?: AbcGhostItem[];
  ikOverlay?: IKOverlayState;
  handRGotz?: GotzHandState;
  handLGotz?: GotzHandState;
  handRProps?: 'anat' | 'leg';
  handLProps?: 'anat' | 'leg';
  persp?: PerspectiveState;
  hoverPersp?: PerspHandle;
  draggingPersp?: PerspHandle;
  hidePerspLabels?: boolean;
  backdropWelcome?: string;
  backdropHint?: string;
  hideBackdropText?: boolean;
  safeRightPx?: number;
  safeBottomPx?: number;
  hideCanvasControls?: boolean;
  showVitruvianGuides?: boolean;
  showLineOfAction?: boolean;
  showGestureRibs?: boolean;
  silhouetteMode?: boolean;
  footToeBreakR?: number;
  footToeBreakL?: number;
}

/**
 * Reusable hollow outline + translucent tint overlay for stacked X-Ray cutouts and chain clusters.
 */
export function renderTintedCutoutOverlay(
  ctx: CanvasRenderingContext2D,
  silBuf: OffscreenCanvas | HTMLCanvasElement,
  outBuf: OffscreenCanvas | HTMLCanvasElement,
  w: number,
  h: number,
  dpr: number,
  color: string,
  fillAlpha: number,
  outlineAlpha: number,
  drawShape: (g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void,
): void {
  if (silBuf.width !== w || silBuf.height !== h) {
    silBuf.width = w;
    silBuf.height = h;
  }
  if (outBuf.width !== w || outBuf.height !== h) {
    outBuf.width = w;
    outBuf.height = h;
  }
  const sctx = silBuf.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  const octx = outBuf.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!sctx || !octx) return;

  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  drawShape(sctx);

  // Convert sprite cutout into a solid colored mask
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = color;
  sctx.fillRect(0, 0, w, h);
  sctx.globalCompositeOperation = 'source-over';

  // Dilate radially into outBuf, then punch out interior to leave crisp hollow outline
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, w, h);
  const r = Math.max(1.5, 2.2 * dpr);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    octx.drawImage(silBuf, Math.cos(a) * r, Math.sin(a) * r);
  }
  octx.globalCompositeOperation = 'destination-out';
  octx.drawImage(silBuf, 0, 0);
  octx.globalCompositeOperation = 'source-over';

  // Composite tint + crisp outline on target canvas
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = fillAlpha;
  ctx.drawImage(silBuf, 0, 0);
  ctx.globalAlpha = outlineAlpha;
  ctx.drawImage(outBuf, 0, 0);
  ctx.restore();
}

export function renderGreenXRayCutout(
  ctx: CanvasRenderingContext2D,
  silBuf: OffscreenCanvas | HTMLCanvasElement,
  outBuf: OffscreenCanvas | HTMLCanvasElement,
  w: number,
  h: number,
  dpr: number,
  drawShape: (g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void,
): void {
  renderTintedCutoutOverlay(ctx, silBuf, outBuf, w, h, dpr, GREEN, 0.24, 0.94, drawShape);
}

export class StageRenderer {
  private glowGreen: OffscreenCanvas | HTMLCanvasElement | null = null;
  private glowMagenta: OffscreenCanvas | HTMLCanvasElement | null = null;
  private glowWingHint: OffscreenCanvas | HTMLCanvasElement | null = null;
  private lo: OffscreenCanvas | HTMLCanvasElement | null = null;
  private loc: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private ghostBuf: OffscreenCanvas | HTMLCanvasElement | null = null;
  private xraySilBuf: OffscreenCanvas | HTMLCanvasElement | null = null;
  private xrayOutBuf: OffscreenCanvas | HTMLCanvasElement | null = null;
  private backdropTextBuf: OffscreenCanvas | HTMLCanvasElement | null = null;
  private modelMaskBuf: OffscreenCanvas | HTMLCanvasElement | null = null;
  private collisionTextBuf: OffscreenCanvas | HTMLCanvasElement | null = null;
  private tmpMat = new Float64Array(6);
  private SKP = [0, 0, 0, 0, 0, 0];

  public drawn = 0;
  public culled = 0;

  private mkGlow(rgb: string) {
    const c = mkCanvas(64, 64);
    const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, `rgba(${rgb},.95)`);
    r.addColorStop(0.35, `rgba(${rgb},.3)`);
    r.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  private mkSoftHintGlow() {
    const c = mkCanvas(64, 64);
    const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    r.addColorStop(0, 'rgba(52, 211, 153, 0.34)');
    r.addColorStop(0.45, 'rgba(52, 211, 153, 0.14)');
    r.addColorStop(1, 'rgba(52, 211, 153, 0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  private drawArt(
    c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    f: number,
    w: number,
    h: number,
    state: RenderContextState,
  ) {
    this.drawn = 0;
    this.culled = 0;
    const k = state.z * f;
    const X0 = state.ox * f;
    const Y0 = state.oy * f;

    const wingPop = state.wingPop ?? 0;

    for (const p of state.pieces) {
      const bm = p.bm;
      if (!bm || !p.node) continue;
      const q = getPieceWorldMatrix(p, wingPop, this.tmpMat);
      const m0 = k * q[0];
      const m1 = k * q[1];
      const m2 = k * q[2];
      const m3 = k * q[3];
      const m4 = k * q[4] + X0;
      const m5 = k * q[5] + Y0;
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const X = m0 * cx + m2 * cy + m4;
      const Y = m1 * cx + m3 * cy + m5;
      const r = 0.5 * Math.hypot(p.w, p.h) * Math.hypot(m0, m1);

      if (X + r < 0 || Y + r < 0 || X - r > w || Y - r > h) {
        this.culled++;
        continue;
      }
      c.setTransform(m0, m1, m2, m3, m4, m5);
      c.drawImage(bm, p.x, p.y, p.w, p.h);
      this.drawn++;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  private computeSkull(state: RenderContextState): boolean {
    const hd = state.by.head;
    if (!hd || !hd.pieces.length) return false;
    const w = hd.w;
    const hp = hd.pieces[0];
    const headShiftY = (hp.restBox ? hp.restBox.y : hp.y) - 18;
    for (let i = 0; i < 2; i++) {
      const x = SK[i][0];
      const y = SK[i][1] + headShiftY;
      this.SKP[i * 2] = (w[0] * x + w[2] * y + w[4]) * state.z + state.ox;
      this.SKP[i * 2 + 1] = (w[1] * x + w[3] * y + w[5]) * state.z + state.oy;
    }
    const ct = state.by.chinTip;
    if (ct) {
      const q = pos(ct, state.by);
      this.SKP[4] = q[0] * state.z + state.ox;
      this.SKP[5] = q[1] * state.z + state.oy;
    } else {
      const x = SK[2][0];
      const y = SK[2][1];
      this.SKP[4] = (w[0] * x + w[2] * y + w[4]) * state.z + state.ox;
      this.SKP[5] = (w[1] * x + w[3] * y + w[5]) * state.z + state.oy;
    }
    return true;
  }

  private forEachSegment(
    state: RenderContextState,
    sk: boolean,
    fn: (x0: number, y0: number, x1: number, y1: number, passKind: number) => void,
  ) {
    const { nodes, by, z, ox, oy } = state;
    const hideDigitSticks = !!(state.handRGotz || state.handLGotz);
    for (const n of nodes) {
      if (
        (hideDigitSticks &&
          (n.id === 'thumbR' ||
            n.id === 'thumbTipR' ||
            n.id === 'fingerR' ||
            n.id === 'fingerTipR' ||
            n.id === 'thumbL' ||
            n.id === 'thumbTipL' ||
            n.id === 'fingerL' ||
            n.id === 'fingerTipL')) ||
        n.id === 'toeR' ||
        n.id === 'toeL'
      ) {
        continue;
      }
      const par = parentOf(n, by);
      if (par) {
        const a = pos(par, by);
        const b = pos(n, by);
        fn(a[0] * z + ox, a[1] * z + oy, b[0] * z + ox, b[1] * z + oy, n.ghost ? 2 : 0);
      }
      if (n.at) {
        const a = pos(n, by);
        const w = n.w;
        const t = n.at;
        fn(
          a[0] * z + ox,
          a[1] * z + oy,
          (w[0] * t[0] + w[2] * t[1] + w[4]) * z + ox,
          (w[1] * t[0] + w[3] * t[1] + w[5]) * z + oy,
          0,
        );
      }
      if (n.bar && by[n.bar[0]] && by[n.bar[1]]) {
        const a = pos(by[n.bar[0]], by);
        const b = pos(by[n.bar[1]], by);
        fn(a[0] * z + ox, a[1] * z + oy, b[0] * z + ox, b[1] * z + oy, 0);
      }
      if (n.bond && n.bond.aim && by[n.bond.aim.to]) {
        const A = pos(by[n.bond.aim.to], by);
        const Q = pos(n.bond, by);
        const strained = Math.abs(n.eff - n.ang) > 0.05;
        fn(Q[0] * z + ox, Q[1] * z + oy, A[0] * z + ox, A[1] * z + oy, strained ? 1 : 0);
      }
    }
    if (sk) {
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        fn(this.SKP[i * 2], this.SKP[i * 2 + 1], this.SKP[j * 2], this.SKP[j * 2 + 1], 0);
      }
    }
  }

  private drawDigitalAngularGeometry(state: RenderContextState) {
    const { ctx, by, z, ox, oy, dpr } = state;
    const toPt = (id: string): [number, number] | null => {
      const n = by[id];
      if (!n) return null;
      const p = pos(n, by);
      return [p[0] * z + ox, p[1] * z + oy];
    };
    const isSimpleConvexQuad = (pts: [[number, number], [number, number], [number, number], [number, number]]) => {
      let sign = 0;
      let area2 = 0;
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        const c = pts[(i + 2) % 4];
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cross) < 4) return false;
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (sign !== s) return false;
        area2 += a[0] * b[1] - b[0] * a[1];
      }
      return Math.abs(area2) > 120 * dpr * dpr;
    };

    const drawPoly = (
      pts: Array<[number, number]>,
      fill: string,
      stroke: string,
      lw = 0.75,
    ) => {
      if (pts.length < 3) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw * dpr;
      ctx.stroke();
    };

    const pAcroR = toPt('acromionR');
    const pAcroL = toPt('acromionL');
    const pHipR = toPt('hipR');
    const pHipL = toPt('hipL');
    const pLumbar = toPt('lumbar');
    const pHead = toPt('head');
    const pElbR = toPt('forearmR');
    const pElbL = toPt('forearmL');
    const pHandR = toPt('handR');
    const pHandL = toPt('handL');
    const pFemR = toPt('femurR');
    const pFemL = toPt('femurL');
    const pKneeR = toPt('shinR');
    const pKneeL = toPt('shinL');
    const pFootR = toPt('footR');
    const pFootL = toPt('footL');
    const pPelvis = toPt('pelvis');

    ctx.save();
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'square';

    // 1. Quadrilaterals / Trapezoids / Squares (emerald & mint green shades)
    if (pAcroR && pAcroL && pHipL && pHipR && isSimpleConvexQuad([pAcroR, pAcroL, pHipL, pHipR])) {
      drawPoly(
        [pAcroR, pAcroL, pHipL, pHipR],
        'rgba(16, 185, 129, 0.085)',
        'rgba(52, 211, 153, 0.34)',
        0.85,
      );
    }
    if (pFemR && pFemL && pKneeL && pKneeR && isSimpleConvexQuad([pFemR, pFemL, pKneeL, pKneeR])) {
      drawPoly(
        [pFemR, pFemL, pKneeL, pKneeR],
        'rgba(22, 163, 74, 0.065)',
        'rgba(74, 222, 128, 0.24)',
        0.7,
      );
    }
    if (pKneeR && pKneeL && pFootL && pFootR && isSimpleConvexQuad([pKneeR, pKneeL, pFootL, pFootR])) {
      drawPoly(
        [pKneeR, pKneeL, pFootL, pFootR],
        'rgba(21, 128, 61, 0.06)',
        'rgba(34, 197, 94, 0.22)',
        0.68,
      );
    }

    // 2. Triangles (lighter/brighter chartreuse-green & forest-green shades)
    if (pAcroR && pAcroL && pHead) {
      drawPoly(
        [pAcroR, pAcroL, pHead],
        'rgba(74, 222, 128, 0.065)',
        'rgba(134, 239, 172, 0.28)',
        0.7,
      );
    }
    if (pAcroR && pAcroL && pLumbar) {
      drawPoly(
        [pAcroR, pAcroL, pLumbar],
        'rgba(34, 197, 94, 0.08)',
        'rgba(74, 222, 128, 0.26)',
        0.7,
      );
    }
    for (const tri of [
      pAcroR && pElbR && pHandR ? [pAcroR, pElbR, pHandR] : null,
      pAcroL && pElbL && pHandL ? [pAcroL, pElbL, pHandL] : null,
      pFemR && pKneeR && pFootR ? [pFemR, pKneeR, pFootR] : null,
      pFemL && pKneeL && pFootL ? [pFemL, pKneeL, pFootL] : null,
      pPelvis && pFootR && pFootL ? [pPelvis, pFootR, pFootL] : null,
    ]) {
      if (!tri) continue;
      const area = Math.abs(
        (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) -
          (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]),
      );
      if (area > 180 * dpr * dpr) {
        drawPoly(tri, 'rgba(34, 197, 94, 0.075)', 'rgba(134, 239, 172, 0.25)', 0.65);
      }
    }

    // 3. Opposite Arm & Leg Parallel (Subtle Purple Glow) / Perpendicular (Red Glow) Relationship Halos
    const pairs: Array<[[string, string], [string, string]]> = [
      [['humerusR', 'forearmR'], ['humerusL', 'forearmL']],
      [['forearmR', 'handR'], ['forearmL', 'handL']],
      [['femurR', 'shinR'], ['femurL', 'shinL']],
      [['shinR', 'footR'], ['shinL', 'footL']],
    ];
    for (const [[rAId, rBId], [lAId, lBId]] of pairs) {
      const rA = toPt(rAId);
      const rB = toPt(rBId);
      const lA = toPt(lAId);
      const lB = toPt(lBId);
      if (!rA || !rB || !lA || !lB) continue;
      const rDx = rB[0] - rA[0];
      const rDy = rB[1] - rA[1];
      const lDx = lB[0] - lA[0];
      const lDy = lB[1] - lA[1];
      const rLen = Math.hypot(rDx, rDy);
      const lLen = Math.hypot(lDx, lDy);
      if (rLen < 6 * dpr || lLen < 6 * dpr) continue;
      const absDot = Math.abs((rDx / rLen) * (lDx / lLen) + (rDy / rLen) * (lDy / lLen));

      if (absDot >= 0.9) {
        // Opposite limbs are near-parallel -> subtle purple glow halo around the beams
        const strength = Math.min(1, (absDot - 0.9) / 0.1);
        ctx.save();
        ctx.lineCap = 'butt';
        ctx.strokeStyle = `rgba(168, 85, 247, ${(0.18 + 0.24 * strength).toFixed(3)})`;
        ctx.lineWidth = (3.6 + 1.4 * strength) * dpr;
        ctx.shadowBlur = (4.5 + 2.5 * strength) * dpr;
        ctx.shadowColor = 'rgba(168, 85, 247, 0.72)';
        ctx.beginPath();
        ctx.moveTo(rA[0], rA[1]);
        ctx.lineTo(rB[0], rB[1]);
        ctx.moveTo(lA[0], lA[1]);
        ctx.lineTo(lB[0], lB[1]);
        ctx.stroke();
        ctx.restore();
      } else if (absDot <= 0.22) {
        // Opposite limbs are near-perpendicular -> red glow halo around the beams + angular square tick
        const strength = Math.min(1, (0.22 - absDot) / 0.22);
        ctx.save();
        ctx.lineCap = 'butt';
        ctx.strokeStyle = `rgba(239, 68, 68, ${(0.2 + 0.26 * strength).toFixed(3)})`;
        ctx.lineWidth = (3.6 + 1.5 * strength) * dpr;
        ctx.shadowBlur = (4.5 + 2.5 * strength) * dpr;
        ctx.shadowColor = 'rgba(239, 68, 68, 0.76)';
        ctx.beginPath();
        ctx.moveTo(rA[0], rA[1]);
        ctx.lineTo(rB[0], rB[1]);
        ctx.moveTo(lA[0], lA[1]);
        ctx.lineTo(lB[0], lB[1]);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();
  }

  private drawBonesLayer(state: RenderContextState, analog: boolean) {
    const { ctx, nodes, by, sel, z, ox, oy, dpr } = state;
    const sk = this.computeSkull(state);
    this.glowGreen = this.glowGreen || this.mkGlow('34,197,94');
    this.glowMagenta = this.glowMagenta || this.mkGlow('255,59,107');

    if (!analog) {
      this.drawDigitalAngularGeometry(state);
    }

    if (analog) {
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.16)';
      ctx.lineWidth = 0.65 * dpr;
      ctx.shadowBlur = 1.5 * dpr;
      ctx.shadowColor = 'rgba(34, 197, 94, 0.12)';
      ctx.beginPath();
      this.forEachSegment(state, sk, (a, b, c, e, kind) => {
        if (kind !== 2) {
          ctx.moveTo(a, b);
          ctx.lineTo(c, e);
        }
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    } else {
      // Crisp angular "Lightsaber Toothpick" beams: thin slight feather outer halo + razor-thin bright core
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      for (let pass = 0; pass < 3; pass++) {
        const isStrained = pass === 1;
        const isGhost = pass === 2;
        const featherStroke = isStrained
          ? 'rgba(239, 68, 68, 0.22)'
          : isGhost
          ? 'rgba(34, 197, 94, 0.10)'
          : 'rgba(34, 197, 94, 0.28)';
        const featherGlow = isStrained ? 'rgba(239, 68, 68, 0.35)' : 'rgba(34, 197, 94, 0.56)';
        const coreStroke = isStrained
          ? 'rgba(239, 68, 68, 0.48)'
          : isGhost
          ? 'rgba(134, 239, 172, 0.34)'
          : '#dcfce7';
        const coreGlow = isStrained ? 'rgba(239, 68, 68, 0.42)' : 'rgba(134, 239, 172, 0.88)';

        // 1. Slight outer feather
        ctx.strokeStyle = featherStroke;
        ctx.lineWidth = (isStrained ? 1.15 : isGhost ? 1.5 : 2.15) * dpr;
        ctx.shadowBlur = (isStrained ? 1.4 : isGhost ? 1.8 : 3.2) * dpr;
        ctx.shadowColor = featherGlow;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        this.forEachSegment(state, sk, (a, b, c, e, kind) => {
          if (kind === pass) {
            ctx.moveTo(a, b);
            ctx.lineTo(c, e);
          }
        });
        ctx.stroke();

        // 2. Razor-thin inner toothpick core
        ctx.strokeStyle = coreStroke;
        ctx.lineWidth = (isStrained ? 0.65 : isGhost ? 0.55 : 0.8) * dpr;
        ctx.shadowBlur = (isStrained ? 0.8 : isGhost ? 0.8 : 1.5) * dpr;
        ctx.shadowColor = coreGlow;
        ctx.beginPath();
        this.forEachSegment(state, sk, (a, b, c, e, kind) => {
          if (kind === pass) {
            ctx.moveTo(a, b);
            ctx.lineTo(c, e);
          }
        });
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }

    const drawDot = (x: number, y: number, isTension: boolean, ghost: boolean, scale = 1) => {
      const m = ghost ? 0.35 : 1;
      if (analog) {
        const r = 4.6 * scale * dpr;
        const g = isTension ? this.glowMagenta! : this.glowGreen!;
        ctx.globalAlpha = 0.25 * m;
        ctx.drawImage(g, x - r, y - r, 2 * r, 2 * r);
        return;
      }
      const rHalo = 3.8 * scale * dpr;
      const g = isTension ? this.glowMagenta! : this.glowGreen!;
      ctx.globalAlpha = 0.45 * m;
      ctx.drawImage(g, x - rHalo, y - rHalo, 2 * rHalo, 2 * rHalo);
      // Angular 4-point diamond joint marker favoring sharp geometry
      const d = Math.max(1.1 * dpr, 1.75 * scale * dpr);
      ctx.globalAlpha = 0.94 * m;
      ctx.fillStyle = isTension ? '#fda4af' : '#dcfce7';
      ctx.beginPath();
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
      ctx.fill();
    };

    const hideDigitDots = !!(state.handRGotz || state.handLGotz);
    for (const n of nodes) {
      if (n.id === 'wingL' || n.id === 'wingR') continue;
      if (
        (hideDigitDots &&
          (n.id === 'thumbR' ||
            n.id === 'thumbTipR' ||
            n.id === 'fingerR' ||
            n.id === 'fingerTipR' ||
            n.id === 'thumbL' ||
            n.id === 'thumbTipL' ||
            n.id === 'fingerL' ||
            n.id === 'fingerTipL')) ||
        n.id === 'toeR' ||
        n.id === 'toeL'
      ) {
        continue;
      }
      if (n.ghost && analog) continue;
      const q = pos(n, by);
      const tension = getTensionRatio(n);
      const strainedBond = n.bond && Math.abs(n.eff - n.ang) > 0.05;
      if (n.id === 'lip') {
        const [ux, uy] = this.getHeadAxis(by);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = analog ? 0.36 : 0.92;
        ctx.strokeStyle = n === sel ? MAGENTA : '#dcfce7';
        ctx.lineWidth = (analog ? 0.95 : 1.05) * dpr;
        if (!analog) {
          ctx.shadowBlur = 2.8 * dpr;
          ctx.shadowColor = n === sel ? 'rgba(255, 59, 107, 0.7)' : 'rgba(34, 197, 94, 0.65)';
        }
        this.strokeFaceSwivelArrows(
          ctx,
          q[0] * z + ox,
          q[1] * z + oy,
          (analog ? 5.5 : 7.2) * dpr,
          (analog ? 2.4 : 3.2) * dpr,
          (analog ? 2.0 : 2.6) * dpr,
          ux,
          uy,
        );
        ctx.restore();
        continue;
      }
      const isSwivel = n.id.startsWith('swivel');
      drawDot(
        q[0] * z + ox,
        q[1] * z + oy,
        n === sel || tension.atLimit || !!strainedBond,
        n.ghost || isSwivel,
        isSwivel ? 0.65 : 0.92,
      );
    }

    for (const n of nodes) {
      if (!n.at) continue;
      const w = n.w;
      const t = n.at;
      drawDot(
        (w[0] * t[0] + w[2] * t[1] + w[4]) * z + ox,
        (w[1] * t[0] + w[3] * t[1] + w[5]) * z + oy,
        false,
        false,
        0.85,
      );
    }

    // Draw articulated collapsed side-foot truss on both ankles (heel spur -> ball -> articulated toe)
    for (const [footId, toeId, toeBreak] of [
      ['footR', 'toeR', state.footToeBreakR ?? 0],
      ['footL', 'toeL', state.footToeBreakL ?? 0],
    ] as const) {
      const fn = by[footId];
      if (!fn) continue;
      const fw = fn.w;
      const sideSign = footId === 'footR' ? -1 : 1; // R points -X locally, L points +X locally
      const ax = fn.piv[0];
      const ay = fn.piv[1];
      const heelL: [number, number] = [ax - sideSign * 145, ay + 470];
      const ballL: [number, number] = [ax + sideSign * 425, ay + 500];
      const toeNode = by[toeId];
      const breakRad = ((toeBreak || -(toeNode?.ang ?? 0) * 0.45) * Math.PI) / 180;
      const rawToeDx = sideSign * 215;
      const rawToeDy = -12;
      const bc = Math.cos(-sideSign * breakRad);
      const bs = Math.sin(-sideSign * breakRad);
      const tipL: [number, number] = [
        ballL[0] + bc * rawToeDx - bs * rawToeDy,
        ballL[1] + bs * rawToeDx + bc * rawToeDy,
      ];
      const toScreenFoot = (lx: number, ly: number): [number, number] => [
        (fw[0] * lx + fw[2] * ly + fw[4]) * z + ox,
        (fw[1] * lx + fw[3] * ly + fw[5]) * z + oy,
      ];
      const sAnkle = toScreenFoot(ax, ay);
      const sHeel = toScreenFoot(heelL[0], heelL[1]);
      const sBall = toScreenFoot(ballL[0], ballL[1]);
      const sTip = toScreenFoot(tipL[0], tipL[1]);

      const traceFootTruss = () => {
        ctx.beginPath();
        ctx.moveTo(sAnkle[0], sAnkle[1]);
        ctx.lineTo(sHeel[0], sHeel[1]);
        ctx.lineTo(sBall[0], sBall[1]);
        ctx.lineTo(sTip[0], sTip[1]);
        ctx.moveTo(sAnkle[0], sAnkle[1]);
        ctx.lineTo(sBall[0], sBall[1]);
      };

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (analog) {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.16)';
        ctx.lineWidth = 0.65 * dpr;
        traceFootTruss();
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.28)';
        ctx.lineWidth = 1.9 * dpr;
        ctx.shadowBlur = 2.8 * dpr;
        ctx.shadowColor = 'rgba(34, 197, 94, 0.52)';
        traceFootTruss();
        ctx.stroke();

        ctx.strokeStyle = '#dcfce7';
        ctx.lineWidth = 0.72 * dpr;
        ctx.shadowBlur = 1.4 * dpr;
        ctx.shadowColor = 'rgba(134, 239, 172, 0.85)';
        traceFootTruss();
        ctx.stroke();
      }
      ctx.restore();

      drawDot(sHeel[0], sHeel[1], false, false, 0.58);
      drawDot(sBall[0], sBall[1], false, false, 0.65);
      drawDot(sTip[0], sTip[1], false, false, 0.54);
    }

    // Draw articulated 5-digit Gotz hand bones & crisp pinpoint knuckle dots
    for (const [handId, gotz, pModel] of [
      ['handR', state.handRGotz, state.handRProps],
      ['handL', state.handLGotz, state.handLProps],
    ] as const) {
      const hn = by[handId];
      if (!hn || !gotz) continue;
      const hw = hn.w;
      const props = pModel === 'leg' ? GOTZ_PROPS_LEG : GOTZ_PROPS_ANAT;
      const solved = solveGotzHand(gotz, props);
      const active = GOTZ_BUILDS[gotz.build] || GOTZ_DIGITS;
      const toScreen = (gx: number, gy: number): [number, number] => {
        const off = gotzToPuppetOffset(gx, gy, gotz.mirror);
        const rx = hn.piv[0] + off[0];
        const ry = hn.piv[1] + off[1];
        return [(hw[0] * rx + hw[2] * ry + hw[4]) * z + ox, (hw[1] * rx + hw[3] * ry + hw[5]) * z + oy];
      };

      const traceHand = () => {
        ctx.beginPath();
        for (const d of active) {
          const pts = solved[d].pts;
          for (let j = 0; j < pts.length - 1; j++) {
            const [sx0, sy0] = toScreen(pts[j][0], pts[j][1]);
            const [sx1, sy1] = toScreen(pts[j + 1][0], pts[j + 1][1]);
            ctx.moveTo(sx0, sy0);
            ctx.lineTo(sx1, sy1);
          }
        }
      };

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (analog) {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.16)';
        ctx.lineWidth = 0.55 * dpr;
        traceHand();
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.28)';
        ctx.lineWidth = 1.65 * dpr;
        ctx.shadowBlur = 2.4 * dpr;
        ctx.shadowColor = 'rgba(34, 197, 94, 0.48)';
        traceHand();
        ctx.stroke();

        ctx.strokeStyle = '#dcfce7';
        ctx.lineWidth = 0.62 * dpr;
        ctx.shadowBlur = 1.1 * dpr;
        ctx.shadowColor = 'rgba(134, 239, 172, 0.85)';
        traceHand();
        ctx.stroke();
      }
      ctx.restore();

      for (const d of active) {
        const pts = solved[d].pts;
        for (let j = 1; j < pts.length; j++) {
          const [sx, sy] = toScreen(pts[j][0], pts[j][1]);
          drawDot(sx, sy, false, false, j === pts.length - 1 ? 0.45 : 0.36);
        }
      }
    }

    if (sk) {
      for (let i = 0; i < 3; i++) {
        drawDot(this.SKP[i * 2], this.SKP[i * 2 + 1], false, false, 0.72);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawActiveBars(state: RenderContextState, act: number) {
    const { ctx, dpr } = state;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    const sk = this.computeSkull(state);
    const softAct = act * 0.65;

    for (const [wd, al] of [
      [4.5, 0.06],
      [2.2, 0.12],
      [1.0, 0.24],
    ]) {
      ctx.lineWidth = wd * dpr;
      ctx.strokeStyle = GREEN;
      ctx.globalAlpha = al * softAct;
      ctx.beginPath();
      this.forEachSegment(state, sk, (a, b, c, e, kind) => {
        if (kind === 0) {
          ctx.moveTo(a, b);
          ctx.lineTo(c, e);
        }
      });
      ctx.stroke();

      // Tension-strained bond bars glow magenta-red when active
      ctx.strokeStyle = MAGENTA;
      ctx.globalAlpha = Math.min(1, al * 1.45) * softAct;
      ctx.beginPath();
      this.forEachSegment(state, sk, (a, b, c, e, kind) => {
        if (kind === 1) {
          ctx.moveTo(a, b);
          ctx.lineTo(c, e);
        }
      });
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  private drawSelectedLimitArc(state: RenderContextState) {
    const { ctx, sel, by, z, ox, oy, dpr, constrainLimits, mode } = state;
    if (!sel || sel.id === 'lip' || sel.id === 'chinTip' || (!constrainLimits && mode !== 'D')) return;
    const [min, max] = sel.limits;
    if (min <= -179 && max >= 179) return;
    const p = pos(sel, by);
    const sx = p[0] * z + ox;
    const sy = p[1] * z + oy;
    const par = parentOf(sel, by);
    const pw = par ? par.w : [1, 0, 0, 1, 0, 0];
    const parDet = pw[0] * pw[3] - pw[1] * pw[2];
    const flipSign = parDet < 0 ? -1 : 1;
    const baseRad = Math.atan2(pw[1], pw[0]) - Math.PI / 2;
    const tension = getTensionRatio(sel);
    const r = 22 * dpr;

    ctx.save();
    ctx.lineWidth = 1.75 * dpr;
    ctx.strokeStyle = tension.atLimit || tension.nearLimit ? MAGENTA : 'rgba(168, 85, 247, 0.55)';
    ctx.beginPath();
    const aStart = baseRad + (min * flipSign * Math.PI) / 180;
    const aEnd = baseRad + (max * flipSign * Math.PI) / 180;
    ctx.arc(sx, sy, r, Math.min(aStart, aEnd), Math.max(aStart, aEnd));
    ctx.stroke();

    // Current angle needle
    const curRad = baseRad + (sel.ang * flipSign * Math.PI) / 180;
    ctx.strokeStyle = tension.atLimit ? MAGENTA : GREEN;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(curRad) * (r + 5 * dpr), sy + Math.sin(curRad) * (r + 5 * dpr));
    ctx.stroke();
    ctx.restore();
  }

  private drawStageGuides(state: RenderContextState) {
    if (!state.showGuides) return;
    const { ctx, ox, oy, W, H, z, dpr } = state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = PURPLE_GUIDE;
    ctx.fillStyle = PURPLE_GUIDE_TEXT;
    ctx.lineWidth = dpr;
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.strokeRect(ox, oy, W * z, H * z);

    if (W === 2500) {
      ctx.beginPath();
      ctx.moveTo(1257 * z + ox, oy);
      ctx.lineTo(1257 * z + ox, H * z + oy);
      for (let k = 1; k <= 7; k++) {
        ctx.moveTo(ox, k * 1240 * z + oy);
        ctx.lineTo(W * z + ox, k * 1240 * z + oy);
      }
      ctx.stroke();
      ctx.font = `${11 * dpr}px "JetBrains Mono", monospace`;
      for (let k = 1; k <= 7; k++) {
        ctx.fillText(`${k}H`, ox + 6 * dpr, k * 1240 * z + oy - 4 * dpr);
      }
      ctx.fillText('MX 1257', 1257 * z + ox + 6 * dpr, oy + 14 * dpr);
    }
    ctx.setLineDash([]);
  }

  private drawPerspectiveSystem(state: RenderContextState) {
    const persp = state.persp;
    if (!persp || !persp.enabled) return;
    const { ctx, cv, by, nodes, z, ox, oy, dpr, hoverPersp, draggingPersp } = state;
    const root = nodes.find((n) => !n.parent) || nodes[0];
    const xMin = -ox / z - 300;
    const xMax = (cv.width - ox) / z + 300;
    const yMin = -oy / z - 300;
    const yMax = (cv.height - oy) / z + 300;
    const vx = persp.vpX;
    const vy = persp.horizonY;
    const gy = persp.groundY;
    const fx = skelFocalX(by, root);
    const dHG = gy - vy;
    const safeHG = Math.abs(dHG) < 18 ? (dHG >= 0 ? 18 : -18) : dHG;
    const cell = persp.floorScale;
    const raysN = 7;

    const toScreen = (wx: number, wy: number): [number, number] => [wx * z + ox, wy * z + oy];

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 1. Subtle purple 1-point perspective floor rays converging to VP, anchored on skeleton focal X
    const halfSpan = raysN * cell;
    for (let i = -raysN; i <= raysN; i++) {
      const gx = fx + i * cell;
      const dx = gx - vx;
      const dy = safeHG;
      const tEnd =
        dHG >= 0
          ? Math.max(1.8, (yMax - vy) / (dy || 1))
          : Math.max(1.8, (vy - yMin) / (Math.abs(dy) || 1));
      const ex = vx + dx * Math.min(8, tEnd);
      const ey = vy + dy * Math.min(8, tEnd);
      const [sx0, sy0] = toScreen(vx, vy);
      const [sx1, sy1] = toScreen(ex, ey);
      const isCore = Math.abs(i) <= 1;
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.strokeStyle = isCore ? 'rgba(168, 85, 247, 0.25)' : 'rgba(168, 85, 247, 0.12)';
      ctx.lineWidth = (isCore ? 1.15 : 0.85) * dpr;
      ctx.stroke();
    }

    // 2. Depth transversals projected along (groundY - horizonY) including foreground feet depth
    const kSteps = [-0.42, -0.28, -0.15, 0, 0.35, 0.85, 1.55, 2.55, 4.0, 6.2, 9.5, 15.0];
    for (const k of kSteps) {
      if (Math.abs(k) < 0.01) continue; // k = 0 is the main ground line
      const yk = vy + safeHG / (1 + k * 0.55);
      const ykScreen = yk * z + oy;
      if (ykScreen < -40 || ykScreen > cv.height + 40) continue;
      const scale = (yk - vy) / safeHG;
      if (scale <= 0.02) continue;
      const xl = vx + (fx - halfSpan - vx) * scale;
      const xr = vx + (fx + halfSpan - vx) * scale;
      const [sxL, syL] = toScreen(xl, yk);
      const [sxR, syR] = toScreen(xr, yk);
      ctx.beginPath();
      ctx.moveTo(sxL, syL);
      ctx.lineTo(sxR, syR);
      ctx.strokeStyle =
        k < 0
          ? 'rgba(168, 85, 247, 0.17)'
          : `rgba(168, 85, 247, ${(0.2 / (1 + k * 0.18)).toFixed(3)})`;
      ctx.lineWidth = 0.85 * dpr;
      ctx.stroke();
    }

    // 3. Skeleton focal plumb & sightline tying skeleton center -> ground anchor -> vanishing point
    const [skx, sky] = toScreen(fx, root ? pos(root, by)[1] : (vy + gy) * 0.5);
    const [fgx, fgy] = toScreen(fx, gy);
    const [vpx, vpy] = toScreen(vx, vy);
    ctx.save();
    ctx.setLineDash([3 * dpr, 5 * dpr]);
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.28)';
    ctx.lineWidth = 1.0 * dpr;
    ctx.beginPath();
    ctx.moveTo(skx, sky);
    ctx.lineTo(fgx, fgy);
    ctx.lineTo(vpx, vpy);
    ctx.stroke();
    ctx.restore();

    // 4. Subtle foot contact ground ellipses when feet rest on/near groundY
    for (const fid of ['footL', 'footR'] as const) {
      const f = by[fid];
      if (!f) continue;
      const sole = footContactInfo(f, by);
      const gap = Math.abs(gy - sole.maxY);
      if (gap < 480) {
        const alpha = Math.max(0, 1 - gap / 480) * 0.28;
        const rx = Math.max(12 * dpr, 210 * z * (1 - gap / 700));
        const [cx_, cy_] = toScreen(sole.midX, gy);
        ctx.beginPath();
        ctx.ellipse(cx_, cy_, rx, Math.max(2.5 * dpr, rx * 0.14), 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(168, 85, 247, ${alpha.toFixed(3)})`;
        ctx.fill();
      }
    }

    // 5. Firmer GROUND line
    const gHot = hoverPersp === 'ground' || draggingPersp === 'ground';
    const [gxL, gyS] = toScreen(xMin, gy);
    const [gxR] = toScreen(xMax, gy);
    ctx.save();
    if (gHot) {
      ctx.shadowColor = 'rgba(34, 197, 94, 0.88)';
      ctx.shadowBlur = 10 * dpr;
    }
    ctx.beginPath();
    ctx.moveTo(gxL, gyS);
    ctx.lineTo(gxR, gyS);
    ctx.strokeStyle = gHot ? GREEN : 'rgba(168, 85, 247, 0.56)';
    ctx.lineWidth = (gHot ? 2.4 : 1.55) * dpr;
    ctx.stroke();
    ctx.restore();

    // 6. Thinner HORIZON line (+ tactile mechanical pitch grip near figure centerline when active)
    const hHot = hoverPersp === 'horizon' || draggingPersp === 'horizon';
    const [hxL, hyS] = toScreen(xMin, vy);
    const [hxR] = toScreen(xMax, vy);
    ctx.save();
    if (hHot) {
      ctx.shadowColor = 'rgba(34, 197, 94, 0.88)';
      ctx.shadowBlur = 10 * dpr;
    }
    ctx.beginPath();
    ctx.moveTo(hxL, hyS);
    ctx.lineTo(hxR, hyS);
    ctx.strokeStyle = hHot ? GREEN : 'rgba(192, 132, 252, 0.42)';
    ctx.lineWidth = (hHot ? 1.65 : 0.85) * dpr;
    ctx.stroke();

    if (hHot) {
      const [hcx] = toScreen(fx, vy);
      ctx.beginPath();
      ctx.moveTo(hcx - 12 * dpr, hyS - 3.5 * dpr);
      ctx.lineTo(hcx + 12 * dpr, hyS - 3.5 * dpr);
      ctx.moveTo(hcx - 12 * dpr, hyS + 3.5 * dpr);
      ctx.lineTo(hcx + 12 * dpr, hyS + 3.5 * dpr);
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1.35 * dpr;
      ctx.stroke();
    }
    ctx.restore();

    // 7. Perspective vanishing point marker on the horizon line
    if (!state.hideCanvasControls) {
      const vpHot = hoverPersp === 'vp' || draggingPersp === 'vp';
      ctx.save();
      if (vpHot) {
        ctx.shadowColor = 'rgba(34, 197, 94, 0.95)';
        ctx.shadowBlur = 14 * dpr;
      }
      ctx.beginPath();
      ctx.arc(vpx, vpy, (vpHot ? 8.5 : 6.0) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = vpHot ? 'rgba(34, 197, 94, 0.28)' : 'rgba(168, 85, 247, 0.22)';
      ctx.fill();
      ctx.strokeStyle = vpHot ? GREEN : 'rgba(192, 132, 252, 0.78)';
      ctx.lineWidth = 1.35 * dpr;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(vpx, vpy, 2.4 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = vpHot ? GREEN : 'rgba(216, 180, 254, 0.9)';
      ctx.fill();
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(vpx - 6 * dpr, vpy);
      ctx.lineTo(vpx + 6 * dpr, vpy);
      ctx.moveTo(vpx, vpy - 6 * dpr);
      ctx.lineTo(vpx, vpy + 6 * dpr);
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.6)';
      ctx.lineWidth = 1.1 * dpr;
      ctx.stroke();
      ctx.restore();
    }

    // 8. Micro architectural edge labels (skipped on live stage when StageHud overlays them cleanly)
    if (!state.hidePerspLabels) {
      ctx.font = `${Math.round(10 * dpr)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = hHot ? '#34d399' : 'rgba(192, 132, 252, 0.68)';
      ctx.fillText('HORIZON', 10 * dpr, Math.max(12 * dpr, hyS - 4 * dpr));
      ctx.fillStyle = gHot ? '#34d399' : 'rgba(192, 132, 252, 0.74)';
      ctx.fillText('GROUND', 10 * dpr, Math.min(cv.height - 6 * dpr, gyS - 5 * dpr));
    }

    ctx.restore();
  }

  private drawAbcGhosts(state: RenderContextState) {
    const ghosts = state.abcGhosts;
    if (!ghosts || !ghosts.length) return;
    const { ctx, cv, nodes, by, pieces, z, ox, oy, dpr } = state;
    const root = nodes.find((n) => !n.parent) || nodes[0];
    if (!root) return;

    if (!this.ghostBuf) {
      this.ghostBuf = mkCanvas(cv.width, cv.height);
    } else if (this.ghostBuf.width !== cv.width || this.ghostBuf.height !== cv.height) {
      this.ghostBuf.width = cv.width;
      this.ghostBuf.height = cv.height;
    }
    const gctx = this.ghostBuf.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!gctx) return;

    // Save exact live angles, flipX, skull view + root offsets before evaluating ghost poses
    const savedAng = nodes.map((n) => n.ang);
    const savedFlip = nodes.map((n) => !!n.flipX);
    const savedHeadTurn = captureHeadTurnRenderSnapshot(by.head);
    const savedTx = root.tx;
    const savedTy = root.ty;

    const wingPop = state.wingPop ?? 0;
    const liveBodyView: BodyTurnView = state.bodyView ?? 'front';
    const ribAnchor: RibAnchorMode = state.ribAnchor ?? 'upper';

    for (const item of ghosts) {
      const ghostView: BodyTurnView = item.pose.bodyView ?? 'front';
      applyBodyViewPivots(nodes, by, ghostView, ribAnchor);
      sortPiecesForBodyView(pieces, ghostView, wingPop > 0.05);
      for (const n of nodes) {
        if (n.id in item.pose.nodes) {
          n.ang = item.pose.nodes[n.id];
        }
        n.flipX = !!(item.pose.flipX && item.pose.flipX[n.id]);
      }
      previewHeadTurnStepSync(by.head, resolvePoseHeadTurnStep(item.pose));
      root.tx = item.pose.root?.[0] ?? 0;
      root.ty = item.pose.root?.[1] ?? 0;
      solveRig(nodes, by, state.bondOn ?? true, wingPop, ribAnchor);

      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of pieces) {
        const bm = p.bm;
        if (!bm || !p.node) continue;
        const q = getPieceWorldMatrix(p, wingPop, this.tmpMat);
        gctx.setTransform(z * q[0], z * q[1], z * q[2], z * q[3], z * q[4] + ox, z * q[5] + oy);
        gctx.drawImage(bm, p.x, p.y, p.w, p.h);
      }

      const tint = ABC_TINT[item.slot];
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.globalCompositeOperation = 'source-atop';
      gctx.fillStyle = tint.fill;
      gctx.fillRect(0, 0, cv.width, cv.height);
      gctx.globalCompositeOperation = 'source-over';

      const alpha = item.isPrimary ? item.opacity : item.opacity * 0.52;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.ghostBuf, 0, 0);

      // Dashed skeleton ghost lines
      ctx.globalAlpha = Math.min(0.7, alpha * 1.45);
      ctx.strokeStyle = tint.stroke;
      ctx.lineWidth = (item.isPrimary ? 1.45 : 1.0) * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      const sk = this.computeSkull(state);
      ctx.beginPath();
      this.forEachSegment(state, sk, (a, b, c, e, kind) => {
        if (kind !== 2) {
          ctx.moveTo(a, b);
          ctx.lineTo(c, e);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Slot tag near ghost head
      const hd = by.head;
      if (hd) {
        const hp = pos(hd, by);
        ctx.font = `700 ${11 * dpr}px "JetBrains Mono", monospace`;
        ctx.fillStyle = tint.badge;
        ctx.globalAlpha = Math.min(0.9, alpha * 1.8);
        ctx.fillText(item.slot, hp[0] * z + ox + 10 * dpr, hp[1] * z + oy - 14 * dpr);
      }
      ctx.restore();
    }

    // Restore live view pivots, piece depth stack, pose & skull view before painting active puppet
    applyBodyViewPivots(nodes, by, liveBodyView, ribAnchor);
    sortPiecesForBodyView(pieces, liveBodyView, wingPop > 0.05);
    nodes.forEach((n, i) => {
      n.ang = savedAng[i];
      n.flipX = savedFlip[i];
    });
    restoreHeadTurnRenderSnapshot(by.head, savedHeadTurn);
    root.tx = savedTx;
    root.ty = savedTy;
    solveRig(nodes, by, state.bondOn ?? true, wingPop, ribAnchor);
  }

  private getPieceWorldAabb(p: RigPiece, wingPop: number): [number, number, number, number] | null {
    if (!p.node) return null;
    const w = getPieceWorldMatrix(p, wingPop, this.tmpMat);
    const x0 = p.x;
    const y0 = p.y;
    const x1 = p.x + p.w;
    const y1 = p.y + p.h;
    const corners: Array<[number, number]> = [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ];
    let minX = 1e9;
    let minY = 1e9;
    let maxX = -1e9;
    let maxY = -1e9;
    for (const [cx, cy] of corners) {
      const wx = w[0] * cx + w[2] * cy + w[4];
      const wy = w[1] * cx + w[3] * cy + w[5];
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
    }
    return [minX, minY, maxX, maxY];
  }

  private isPieceOccludedInStack(targetPiece: RigPiece, targetIdx: number, pieces: RigPiece[], wingPop: number): boolean {
    const aabb = this.getPieceWorldAabb(targetPiece, wingPop);
    if (!aabb) return false;
    for (let j = targetIdx + 1; j < pieces.length; j++) {
      const front = pieces[j];
      if (!front.bm || front.node === targetPiece.node) continue;
      const fa = this.getPieceWorldAabb(front, wingPop);
      if (!fa) continue;
      const ix0 = Math.max(aabb[0], fa[0]);
      const iy0 = Math.max(aabb[1], fa[1]);
      const ix1 = Math.min(aabb[2], fa[2]);
      const iy1 = Math.min(aabb[3], fa[3]);
      if (ix0 >= ix1 || iy0 >= iy1) continue;

      if (targetPiece.m && front.m) {
        const steps = 12;
        for (let sx = 0; sx <= steps; sx++) {
          const wx = ix0 + ((ix1 - ix0) * (sx + 0.5)) / (steps + 1);
          for (let sy = 0; sy <= steps; sy++) {
            const wy = iy0 + ((iy1 - iy0) * (sy + 0.5)) / (steps + 1);
            if (samplePieceWorldMask(targetPiece, wx, wy, wingPop) && samplePieceWorldMask(front, wx, wy, wingPop)) {
              return true;
            }
          }
        }
      } else {
        return true;
      }
    }
    return false;
  }

  private isNodePointOccluded(targetNode: RigNode, wx: number, wy: number, pieces: RigPiece[], wingPop: number): boolean {
    const owner = targetNode.pieces.length ? targetNode : targetNode.parent ? null : targetNode;
    let lowestOwnerIdx = -1;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.node === targetNode || (owner === null && p.node?.id === targetNode.parent)) {
        lowestOwnerIdx = i;
        break;
      }
    }
    if (lowestOwnerIdx < 0) return false;
    for (let j = lowestOwnerIdx + 1; j < pieces.length; j++) {
      const front = pieces[j];
      if (!front.bm || front.node === targetNode || front.node?.id === targetNode.parent) continue;
      if (samplePieceWorldMask(front, wx, wy, wingPop)) return true;
    }
    return false;
  }

  private getClusterSpec(
    hov: RigNode | null,
  ): {
    kind: 'shoulder' | 'hip';
    side: 'L' | 'R';
    nodeIds: string[];
    edges: Array<[string, string]>;
  } | null {
    if (!hov) return null;
    const id = hov.id;
    const side: 'L' | 'R' | null = id.endsWith('L') ? 'L' : id.endsWith('R') ? 'R' : null;
    if (!side) return null;

    if (
      id === 'acromion' + side ||
      id === 'brace' + side ||
      id === 'wing' + side ||
      id === 'swivel' + side ||
      id === 'swivelTip' + side
    ) {
      return {
        kind: 'shoulder',
        side,
        nodeIds: ['swivel' + side, 'acromion' + side, 'brace' + side],
        edges: [
          ['lumbar', 'swivel' + side],
          ['swivel' + side, 'acromion' + side],
          ['thorax', 'brace' + side],
          ['brace' + side, 'acromion' + side],
        ],
      };
    }

    if (id === 'hip' + side) {
      return {
        kind: 'hip',
        side,
        nodeIds: ['hip' + side, 'femur' + side, 'shin' + side, 'foot' + side],
        edges: [
          ['pelvis', 'hip' + side],
          ['hip' + side, 'femur' + side],
          ['femur' + side, 'shin' + side],
          ['shin' + side, 'foot' + side],
        ],
      };
    }

    return null;
  }

  private drawClusterHighlight(state: RenderContextState): boolean {
    const { hov, pieces, ctx, cv, z, ox, oy, dpr, by } = state;
    const spec = this.getClusterSpec(hov);
    if (!spec || !hov) return false;

    const wingPop = state.wingPop ?? 0;
    const isWingHover = hov.id === 'wingL' || hov.id === 'wingR';
    const clusterNodeSet = new Set(spec.nodeIds);

    // 1. If hovering faint green wing hint, expose hidden Backshoulder silhouette clearly first
    if (isWingHover && hov.parent && by[hov.parent]) {
      const brace = by[hov.parent];
      const wingPieces = pieces.filter((p) => p.node === brace && p.wing && p.bm);
      if (wingPieces.length) {
        if (!this.xraySilBuf) this.xraySilBuf = mkCanvas(cv.width, cv.height);
        if (!this.xrayOutBuf) this.xrayOutBuf = mkCanvas(cv.width, cv.height);
        renderTintedCutoutOverlay(ctx, this.xraySilBuf, this.xrayOutBuf, cv.width, cv.height, dpr, GREEN, 0.34, 0.96, (g) => {
          for (const p of wingPieces) {
            const w = getPieceWorldMatrix(p, wingPop, this.tmpMat);
            g.setTransform(z * w[0], z * w[1], z * w[2], z * w[3], z * w[4] + ox, z * w[5] + oy);
            g.drawImage(p.bm!, p.x, p.y, p.w, p.h);
          }
        });
      }
    }

    // 2. Highlight entire chain cluster pieces in RED so user knows dragging sets off a chain
    const clusterPieces = pieces.filter((p) => {
      if (!p.bm || !p.node || !clusterNodeSet.has(p.node.id)) return false;
      if (p.wing && wingPop <= 0.05 && isWingHover) return false;
      return true;
    });

    if (clusterPieces.length) {
      if (!this.xraySilBuf) this.xraySilBuf = mkCanvas(cv.width, cv.height);
      if (!this.xrayOutBuf) this.xrayOutBuf = mkCanvas(cv.width, cv.height);
      renderTintedCutoutOverlay(ctx, this.xraySilBuf, this.xrayOutBuf, cv.width, cv.height, dpr, RED, 0.16, 0.88, (g) => {
        for (const p of clusterPieces) {
          const w = getPieceWorldMatrix(p, wingPop, this.tmpMat);
          g.setTransform(z * w[0], z * w[1], z * w[2], z * w[3], z * w[4] + ox, z * w[5] + oy);
          g.drawImage(p.bm!, p.x, p.y, p.w, p.h);
        }
      });
    }

    // 3. Red dashed chain links & joint markers connecting every bone in the cluster
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.86)';
    ctx.lineWidth = 2 * dpr;
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath();
    for (const [idA, idB] of spec.edges) {
      const a = by[idA];
      const b = by[idB];
      if (!a || !b) continue;
      const pa = pos(a, by);
      const pb = pos(b, by);
      ctx.moveTo(pa[0] * z + ox, pa[1] * z + oy);
      ctx.lineTo(pb[0] * z + ox, pb[1] * z + oy);
    }
    // For hip cluster, also draw chain indicator up to the iliac upper round handle + swivel arc
    let hipHandleScreen: [number, number] | null = null;
    if (spec.kind === 'hip') {
      const hipNode = by['hip' + spec.side];
      if (hipNode && hipNode.at) {
        const w = hipNode.w;
        const hp = pos(hipNode, by);
        const tx = (w[0] * hipNode.at[0] + w[2] * hipNode.at[1] + w[4]) * z + ox;
        const ty = (w[1] * hipNode.at[0] + w[3] * hipNode.at[1] + w[5]) * z + oy;
        hipHandleScreen = [tx, ty];
        ctx.moveTo(hp[0] * z + ox, hp[1] * z + oy);
        ctx.lineTo(tx, ty);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (hipHandleScreen) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.lineWidth = 1.75 * dpr;
      ctx.beginPath();
      ctx.arc(hipHandleScreen[0], hipHandleScreen[1], 11 * dpr, -Math.PI * 0.85, -Math.PI * 0.15);
      ctx.stroke();
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.arc(hipHandleScreen[0], hipHandleScreen[1], 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = RED;
    for (const id of spec.nodeIds) {
      const n = by[id];
      if (!n) continue;
      const q = pos(n, by);
      ctx.beginPath();
      ctx.arc(q[0] * z + ox, q[1] * z + oy, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Core Triangle (Collarbone + Swivel + Spine) closed edge & elastic/mechanical buffer zone ring
    if (spec.kind === 'shoulder') {
      const ct = evalCoreTriangleState(spec.side, by, wingPop > 0.05);
      const thNode = by.thorax;
      const luNode = by.lumbar;
      if (thNode && luNode) {
        const pTh = pos(thNode, by);
        const pLu = pos(luNode, by);
        ctx.strokeStyle = ct.strained ? 'rgba(239, 68, 68, 0.88)' : 'rgba(168, 85, 247, 0.65)';
        ctx.lineWidth = (ct.strained ? 2.1 : 1.4) * dpr;
        ctx.beginPath();
        ctx.moveTo(pLu[0] * z + ox, pLu[1] * z + oy);
        ctx.lineTo(pTh[0] * z + ox, pTh[1] * z + oy);
        ctx.stroke();
      }
      const bufR = (14.5 + ct.bufferFactor * 6.5) * dpr;
      ctx.strokeStyle = ct.mode === 'elastic' ? 'rgba(192, 132, 252, 0.88)' : 'rgba(52, 211, 153, 0.78)';
      ctx.lineWidth = 1.4 * dpr;
      ctx.setLineDash([3.5 * dpr, 3 * dpr]);
      for (const bId of ['swivel' + spec.side, 'brace' + spec.side, 'acromion' + spec.side]) {
        const bn = by[bId];
        if (!bn) continue;
        const bp = pos(bn, by);
        ctx.beginPath();
        ctx.arc(bp[0] * z + ox, bp[1] * z + oy, bufR, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.restore();

    return true;
  }

  private drawXRayStackOverlay(state: RenderContextState): boolean {
    const { hov, pieces, ctx, cv, z, ox, oy, dpr, by } = state;
    if (!hov) return false;
    if (this.drawClusterHighlight(state)) {
      return true;
    }

    const wingPop = state.wingPop ?? 0;

    const occludedPieces: RigPiece[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.node === hov && p.bm && this.isPieceOccludedInStack(p, i, pieces, wingPop)) {
        occludedPieces.push(p);
      }
    }

    const q = pos(hov, by);
    const pointOccluded = !occludedPieces.length && this.isNodePointOccluded(hov, q[0], q[1], pieces, wingPop);
    if (!occludedPieces.length && !pointOccluded) return false;

    if (occludedPieces.length) {
      if (!this.xraySilBuf) this.xraySilBuf = mkCanvas(cv.width, cv.height);
      if (!this.xrayOutBuf) this.xrayOutBuf = mkCanvas(cv.width, cv.height);

      renderGreenXRayCutout(ctx, this.xraySilBuf, this.xrayOutBuf, cv.width, cv.height, dpr, (g) => {
        for (const p of occludedPieces) {
          const bm = p.bm;
          if (!bm || !p.node) continue;
          const w = getPieceWorldMatrix(p, wingPop, this.tmpMat);
          g.setTransform(z * w[0], z * w[1], z * w[2], z * w[3], z * w[4] + ox, z * w[5] + oy);
          g.drawImage(bm, p.x, p.y, p.w, p.h);
        }
      });

      // Subtle green X-ray bone axis through occluding front layers
      const par = parentOf(hov, by);
      if (par) {
        const a = pos(par, by);
        const b = pos(hov, by);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.68)';
        ctx.lineWidth = 1.6 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(a[0] * z + ox, a[1] * z + oy);
        ctx.lineTo(b[0] * z + ox, b[1] * z + oy);
        ctx.stroke();
        ctx.restore();
      }
    }

    return true;
  }

  private drawWingCircles(state: RenderContextState) {
    const { ctx, by, z, ox, oy, dpr, sel, hov } = state;
    const wingPop = state.wingPop ?? 0;
    const active = wingPop > 0.05;
    this.glowWingHint = this.glowWingHint || this.mkSoftHintGlow();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const id of ['wingL', 'wingR'] as const) {
      const wn = by[id];
      if (!wn) continue;
      const p = pos(wn, by);
      const sx = p[0] * z + ox;
      const sy = p[1] * z + oy;
      const isDirectHover = hov === wn || sel === wn;

      if (!active && !isDirectHover) {
        // Subtle, blurred faint emerald hint at rest (no crisp ring or solid dot)
        const rHint = 17 * dpr;
        ctx.globalAlpha = 0.55;
        ctx.drawImage(this.glowWingHint!, sx - rHint, sy - rHint, 2 * rHint, 2 * rHint);
        continue;
      }

      const r = (active ? 9.5 : 8.5) * dpr;
      ctx.globalAlpha = 1;
      ctx.fillStyle = active ? 'rgba(168, 85, 247, 0.24)' : 'rgba(239, 68, 68, 0.16)';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 1.9 * dpr;
      ctx.strokeStyle = active ? '#c084fc' : RED;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = active ? '#e9d5ff' : 'rgba(52, 211, 153, 0.9)';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private isNodeOutOfView(hov: RigNode, state: RenderContextState): boolean {
    const { cv, by, z, ox, oy } = state;
    const wingPop = state.wingPop ?? 0;
    const q = pos(hov, by);
    const sx = q[0] * z + ox;
    const sy = q[1] * z + oy;
    if (sx < 0 || sy < 0 || sx > cv.width || sy > cv.height) {
      return true;
    }
    for (const p of hov.pieces) {
      if (!p.bm) continue;
      const box = this.getPieceWorldAabb(p, wingPop);
      if (!box) continue;
      const bx0 = box[0] * z + ox;
      const by0 = box[1] * z + oy;
      const bx1 = box[2] * z + ox;
      const by1 = box[3] * z + oy;
      if (bx1 <= 0 || by1 <= 0 || bx0 >= cv.width || by0 >= cv.height) {
        return true;
      }
      const totalArea = Math.max(1, (bx1 - bx0) * (by1 - by0));
      const ix0 = Math.max(0, bx0);
      const iy0 = Math.max(0, by0);
      const ix1 = Math.min(cv.width, bx1);
      const iy1 = Math.min(cv.height, by1);
      const visibleArea = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
      if (visibleArea / totalArea < 0.45) {
        return true;
      }
    }
    return false;
  }

  public render(state: RenderContextState) {
    const { ctx, cv, mode, showBones, isActiveMotion, actUntil, hov, sel, by, z, ox, oy, dpr } = state;
    const w = cv.width;
    const h = cv.height;
    const now = performance.now();
    const live = mode === 'A' && showBones && (isActiveMotion || now < actUntil);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, w, h);

    this.drawPerspectiveSystem(state);
    this.drawVitruvianOverlay(state);
    this.drawAbcGhosts(state);

    const hasBackdropText = !state.hideBackdropText && this.prepareBackdropTextMask(state, w, h);
    if (hasBackdropText && this.backdropTextBuf) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.22;
      ctx.drawImage(this.backdropTextBuf, 0, 0);
      ctx.restore();
    }

    if (state.silhouetteMode) {
      if (!this.xraySilBuf) this.xraySilBuf = mkCanvas(w, h);
      if (this.xraySilBuf.width !== w || this.xraySilBuf.height !== h) {
        this.xraySilBuf.width = w;
        this.xraySilBuf.height = h;
      }
      const sctx = this.xraySilBuf.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (sctx) {
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, w, h);
        this.drawArt(sctx, 1, w, h, state);
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.globalCompositeOperation = 'source-in';
        sctx.fillStyle = '#e4e4e7';
        sctx.fillRect(0, 0, w, h);
        sctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.xraySilBuf, 0, 0);
        ctx.restore();
      }
      if (showBones) this.drawBonesLayer(state, false);
    } else if (mode === 'A') {
      if (showBones) this.drawBonesLayer(state, true);
      this.drawArt(ctx, 1, w, h, state);
      if (hasBackdropText) {
        this.drawComplementaryCollisionText(ctx, w, h, state, false);
      }
      if (showBones && live) {
        this.drawActiveBars(state, isActiveMotion ? 1 : Math.max(0, Math.min(1, (actUntil - now) / 700)));
      }
    } else {
      // Digital Skeleton mode: clean razor-sharp vector bones with zero blur pass
      if (hasBackdropText) {
        this.drawComplementaryCollisionText(ctx, w, h, state, false);
      }
      this.drawBonesLayer(state, false);
    }

    const isObscured = state.hideCanvasControls ? false : this.drawXRayStackOverlay(state);
    if (!state.hideCanvasControls) {
      this.drawWingCircles(state);
    }

    if (hov) {
      const q = pos(hov, by);
      const sx = q[0] * z + ox;
      const sy = q[1] * z + oy;
      const outOfView = this.isNodeOutOfView(hov, state);
      const isRedXRay = isObscured || outOfView;
      const pad = 18 * dpr;
      const clampedX = Math.max(pad, Math.min(w - pad, sx));
      const clampedY = Math.max(pad, Math.min(h - pad, sy));
      const pivotOffscreen = sx < 0 || sy < 0 || sx > w || sy > h;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const isFaceSwivel = hov.id === 'lip' || hov.id === 'chinTip';
      if (isFaceSwivel) {
        const [ux, uy] = this.getHeadAxis(by);
        const halfSpan = 14 * dpr;
        const barbLen = 5.5 * dpr;
        const barbHalfH = 4.6 * dpr;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isRedXRay) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.24)';
          ctx.lineWidth = 6 * dpr;
          this.strokeFaceSwivelArrows(ctx, clampedX, clampedY, halfSpan, barbLen, barbHalfH, ux, uy);
        } else {
          ctx.strokeStyle = 'rgba(14, 15, 17, 0.72)';
          ctx.lineWidth = 4.2 * dpr;
          this.strokeFaceSwivelArrows(ctx, clampedX, clampedY, halfSpan, barbLen, barbHalfH, ux, uy);
        }
        ctx.lineWidth = (isRedXRay ? 2.25 : 2.1) * dpr;
        ctx.strokeStyle = isRedXRay ? RED : hov === sel ? MAGENTA : GREEN;
        this.strokeFaceSwivelArrows(ctx, clampedX, clampedY, halfSpan, barbLen, barbHalfH, ux, uy);
      } else {
        if (isRedXRay) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
          ctx.beginPath();
          ctx.arc(clampedX, clampedY, 12 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.lineWidth = (isRedXRay ? 2.25 : 2) * dpr;
        ctx.strokeStyle = isRedXRay ? RED : hov === sel ? MAGENTA : GREEN;
        ctx.beginPath();
        ctx.arc(clampedX, clampedY, 12 * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (pivotOffscreen) {
        const ang = Math.atan2(sy - clampedY, sx - clampedX);
        const tx = clampedX + Math.cos(ang) * (15 * dpr);
        const ty = clampedY + Math.sin(ang) * (15 * dpr);
        ctx.fillStyle = RED;
        ctx.beginPath();
        ctx.arc(tx, ty, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (!state.hideCanvasControls) {
      this.drawSelectedLimitArc(state);
      this.drawStageGuides(state);
      this.drawIkOverlays(state);
    }

    this.drawGestureRibs(state);
    this.drawLineOfAction(state);
  }

  private drawLineOfAction(state: RenderContextState) {
    if (!state.showLineOfAction) return;
    const { ctx, by, z, ox, oy, dpr } = state;
    const pel = by.pelvis;
    const lum = by.lumbar;
    const th = by.thorax;
    const nk = by.neck;
    const hd = by.head;
    const fL = by.footL;
    const fR = by.footR;
    if (!pel || !th || !hd) return;

    const pPel = pos(pel, by);
    const pLum = lum ? pos(lum, by) : pPel;
    const pTh = pos(th, by);
    const pNk = nk ? pos(nk, by) : pTh;
    const pHd = pos(hd, by);

    // Crown estimate slightly above head pivot along head axis
    const hLen = Math.hypot(hd.w[0], hd.w[1]) || 1;
    const crownW: [number, number] = [pHd[0] - (hd.w[2] / hLen) * 540, pHd[1] - (hd.w[3] / hLen) * 540];

    // Weighted foot anchor (lowest/planted foot)
    let footPt: [number, number] = pPel;
    if (fL && fR) {
      const pL = pos(fL, by);
      const pR = pos(fR, by);
      footPt = pL[1] >= pR[1] ? pL : pR;
    } else if (fL || fR) {
      footPt = pos((fL || fR)!, by);
    }

    const ptsWorld: Array<[number, number]> = [crownW, pNk, pTh, pLum, pPel, footPt];
    const pts = ptsWorld.map(([wx, wy]): [number, number] => [wx * z + ox, wy * z + oy]);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const traceSpline = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
        const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
        const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
        const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
      }
    };

    // Razor-thin semi-transparent red Line of Action matching perspective ray thickness
    traceSpline();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.42)';
    ctx.lineWidth = 0.9 * dpr;
    ctx.stroke();

    // Fine semi-transparent arrowhead at crown end
    const dx = pts[0][0] - pts[1][0];
    const dy = pts[0][1] - pts[1][1];
    const dLen = Math.hypot(dx, dy) || 1;
    const ux = dx / dLen;
    const uy = dy / dLen;
    const nx = -uy;
    const ny = ux;
    const tipX = pts[0][0];
    const tipY = pts[0][1];
    ctx.beginPath();
    ctx.moveTo(tipX - ux * 7.5 * dpr + nx * 3.5 * dpr, tipY - uy * 7.5 * dpr + ny * 3.5 * dpr);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX - ux * 7.5 * dpr - nx * 3.5 * dpr, tipY - uy * 7.5 * dpr - ny * 3.5 * dpr);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.48)';
    ctx.lineWidth = 0.9 * dpr;
    ctx.stroke();

    ctx.restore();
  }

  private drawGestureRibs(state: RenderContextState) {
    if (!state.showGestureRibs) return;
    const { ctx, by, z, ox, oy, dpr } = state;
    const th = by.thorax;
    const nk = by.neck;
    const pel = by.pelvis;
    const acL = by.acromionL;
    const acR = by.acromionR;
    const feL = by.femurL;
    const feR = by.femurR;
    if (!th || !pel) return;

    const toS = (wx: number, wy: number): [number, number] => [wx * z + ox, wy * z + oy];
    const pTh = pos(th, by);
    const pNk = nk ? pos(nk, by) : [pTh[0], pTh[1] - 1100];
    const pPel = pos(pel, by);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 1. Ribcage Bean/Egg Oval aligned along thorax -> neck axis in strong studio green
    const ribMidX = (pTh[0] + pNk[0]) * 0.5;
    const ribMidY = (pTh[1] + pNk[1]) * 0.5;
    const [rCx, rCy] = toS(ribMidX, ribMidY);
    const ribAng = Math.atan2(pNk[1] - pTh[1], pNk[0] - pTh[0]) + Math.PI / 2;
    const ribH = Math.hypot(pNk[0] - pTh[0], pNk[1] - pTh[1]) * 0.52 * z;
    const ribW = Math.max(18 * dpr, ribH * 0.72);

    ctx.save();
    ctx.translate(rCx, rCy);
    ctx.rotate(ribAng);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.75 * dpr;
    ctx.beginPath();
    ctx.ellipse(0, 0, ribW, Math.max(18 * dpr, ribH), 0, 0, Math.PI * 2);
    ctx.stroke();

    // Rib center vertical & transverse rhythm cross
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.52)';
    ctx.lineWidth = 1.15 * dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(-ribW * 0.9, 0);
    ctx.lineTo(ribW * 0.9, 0);
    ctx.moveTo(0, -ribH * 0.92);
    ctx.lineTo(0, ribH * 0.92);
    ctx.stroke();
    ctx.restore();

    // 2. Shoulder Tilt Line (acromionR <-> acromionL)
    if (acL && acR) {
      const sL = toS(...pos(acL, by));
      const sR = toS(...pos(acR, by));
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.8 * dpr;
      ctx.beginPath();
      ctx.moveTo(sR[0], sR[1]);
      ctx.lineTo(sL[0], sL[1]);
      ctx.stroke();
    }

    // 3. Pelvis Wedge / Tilt Ellipse & Hip Line (femurR <-> femurL)
    if (feL && feR) {
      const hL = toS(...pos(feL, by));
      const hR = toS(...pos(feR, by));
      const hipAng = Math.atan2(hL[1] - hR[1], hL[0] - hR[0]);
      const hipSpan = Math.hypot(hL[0] - hR[0], hL[1] - hR[1]);
      const [pCx, pCy] = toS(pPel[0], pPel[1]);

      ctx.save();
      ctx.translate(pCx, pCy);
      ctx.rotate(hipAng);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.7 * dpr;
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(16 * dpr, hipSpan * 0.65), Math.max(10 * dpr, hipSpan * 0.34), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.8 * dpr;
      ctx.beginPath();
      ctx.moveTo(hR[0], hR[1]);
      ctx.lineTo(hL[0], hL[1]);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawVitruvianOverlay(state: RenderContextState) {
    if (!state.showVitruvianGuides) return;
    const { ctx, by, z, ox, oy, dpr } = state;
    const pel = by.pelvis;
    const th = by.thorax;
    if (!pel || !th) return;
    const pPel = pos(pel, by);
    const pTh = pos(th, by);
    // Vitruvian stature is ~7000px in 2500x8742 world units; navel sits ~55% above sole
    const stature = 7020;
    const halfS = stature * 0.5;
    const cx = pPel[0];
    const squareBottomY = pPel[1] + halfS;
    const squareTopY = squareBottomY - stature;
    const navelY = pPel[1] - (pPel[1] - pTh[1]) * 0.42;
    const circleR = stature * 0.606;

    const toS = (wx: number, wy: number): [number, number] => [wx * z + ox, wy * z + oy];
    const [sxC, syN] = toS(cx, navelY);
    const [sqL, sqT] = toS(cx - halfS, squareTopY);
    const sqSize = stature * z;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.34)';
    ctx.lineWidth = 1.15 * dpr;
    ctx.beginPath();
    ctx.arc(sxC, syN, circleR * z, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(168, 85, 247, 0.28)';
    ctx.strokeRect(sqL, sqT, sqSize, sqSize);

    // Center plumb & pelvic horizon
    ctx.setLineDash([4 * dpr, 5 * dpr]);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.32)';
    ctx.beginPath();
    ctx.moveTo(sxC, sqT);
    ctx.lineTo(sxC, sqT + sqSize);
    const [pelSx, pelSy] = toS(cx, pPel[1]);
    ctx.moveTo(sqL, pelSy);
    ctx.lineTo(sqL + sqSize, pelSy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(34, 197, 94, 0.68)';
    ctx.beginPath();
    ctx.arc(sxC, syN, 2.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawIkOverlays(state: RenderContextState) {
    const ik = state.ikOverlay;
    if (!ik || !ik.active) return;
    const { ctx, cv, by, z, ox, oy, dpr, hov } = state;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 1. Fallback subtle Floor Line at groundY when Foot Gravity is active & Perspective Grid is hidden
    if (ik.footGravity && !state.persp?.enabled) {
      const gy = ik.groundY * z + oy;
      if (gy >= 0 && gy <= cv.height) {
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
        ctx.lineWidth = 1 * dpr;
        ctx.setLineDash([8 * dpr, 6 * dpr]);
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(cv.width, gy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 2. Active FABRIK / IK chain overlay lines + target reticle
    if (ik.activeChainIds && ik.activeChainIds.length >= 2) {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
      ctx.lineWidth = 2.25 * dpr;
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.beginPath();
      let started = false;
      for (const id of ik.activeChainIds) {
        const n = by[id];
        if (!n) continue;
        const p = pos(n, by);
        const sx = p[0] * z + ox;
        const sy = p[1] * z + oy;
        if (!started) {
          ctx.moveTo(sx, sy);
          started = true;
        } else {
          ctx.lineTo(sx, sy);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      for (const id of ik.activeChainIds) {
        const n = by[id];
        if (!n) continue;
        const p = pos(n, by);
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.arc(p[0] * z + ox, p[1] * z + oy, 3.8 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      if (ik.targetPos) {
        const tx = ik.targetPos[0] * z + ox;
        const ty = ik.targetPos[1] * z + oy;
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1.8 * dpr;
        ctx.beginPath();
        ctx.arc(tx, ty, 9 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tx - 13 * dpr, ty);
        ctx.lineTo(tx + 13 * dpr, ty);
        ctx.moveTo(tx, ty - 13 * dpr);
        ctx.lineTo(tx, ty + 13 * dpr);
        ctx.stroke();
      }
    }

    // 3. Pinned Effector Diamond Handles
    const showPinIds: string[] = [];
    for (const id of EFFECTOR_IDS) {
      const modePinned =
        (ik.mode === 'pinFeet' && (id === 'footL' || id === 'footR')) ||
        (ik.mode === 'pinAll' && id !== 'head') ||
        ik.mode === 'pinFull';
      if (modePinned || ik.pins[id]?.pinned) {
        showPinIds.push(id);
      }
    }
    for (const id of showPinIds) {
      const pin = ik.pins[id];
      const n = by[id];
      const pt = pin ? pin.pos : n ? pos(n, by) : null;
      if (!pt) continue;
      const sx = pt[0] * z + ox;
      const sy = pt[1] * z + oy;
      const r = PIN_DIAMOND_RADIUS_PX * dpr;

      // 1.25x joint-circle-radius magnetic capture halo around the pin diamond
      const magR = (PIN_DIAMOND_RADIUS_PX + PIN_MAGNETIC_SNAP_RADIUS_PX) * dpr;
      const targetInsideHalo =
        ik.targetPos != null && distToPinDiamondPx(ik.targetPos, pt, z, dpr) <= PIN_MAGNETIC_SNAP_RADIUS_PX * dpr;
      const hovInsideHalo =
        hov != null && distToPinDiamondPx(pos(hov, by), pt, z, dpr) <= PIN_MAGNETIC_SNAP_RADIUS_PX * dpr;
      const magHot = targetInsideHalo || hovInsideHalo;

      ctx.save();
      ctx.strokeStyle = magHot
        ? 'rgba(52, 211, 153, 0.88)'
        : pin?.pinned
        ? 'rgba(239, 68, 68, 0.34)'
        : 'rgba(16, 185, 129, 0.24)';
      ctx.lineWidth = (magHot ? 1.65 : 1.0) * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.arc(sx, sy, magR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.fillStyle = pin?.pinned ? 'rgba(239, 68, 68, 0.85)' : 'rgba(16, 185, 129, 0.78)';
      ctx.strokeStyle = '#0e0f11';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r, sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 4. Outer dashed Emerald IK ring on hovered IK-capable effector
    if (hov && !ik.activeChainIds) {
      const isLimbEff = !!findLimbChainForNode(hov.id);
      const isFbEff = FBIK_CHAIN_NODES.has(hov.id);
      if (isLimbEff || isFbEff) {
        const q = pos(hov, by);
        const sx = q[0] * z + ox;
        const sy = q[1] * z + oy;
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
        ctx.lineWidth = 1.6 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.arc(sx, sy, 16.5 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 5. Hold-for-IK radial progress arc
    if (ik.holdProgress !== null && ik.holdPos) {
      const sx = ik.holdPos[0] * z + ox;
      const sy = ik.holdPos[1] * z + oy;
      const u = Math.max(0, Math.min(1, ik.holdProgress));
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2.6 * dpr;
      ctx.beginPath();
      ctx.arc(sx, sy, 18 * dpr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * u);
      ctx.stroke();
    }

    // 6. Elastic Pin Full Rig rubber-band tethers showing stretch back toward pin anchors
    if (ik.elasticTethers && ik.elasticTethers.length) {
      for (const tether of ik.elasticTethers) {
        const ax = tether.anchor[0] * z + ox;
        const ay = tether.anchor[1] * z + oy;
        const cx = tether.current[0] * z + ox;
        const cy = tether.current[1] * z + oy;
        ctx.save();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
        ctx.lineWidth = 2.2 * dpr;
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1.8 * dpr;
        ctx.beginPath();
        ctx.arc(ax, ay, 8 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();
  }

  /**
   * Renders "Welcome Bitruvius." and the drag-hands guidance into a crisp mask constrained
   * horizontally to the unobstructed canvas width and vertically between top of head and ankles.
   */
  private prepareBackdropTextMask(state: RenderContextState, w: number, h: number): boolean {
    if (w < 60 || h < 60) return false;
    if (!this.backdropTextBuf) this.backdropTextBuf = mkCanvas(w, h);
    if (this.backdropTextBuf.width !== w || this.backdropTextBuf.height !== h) {
      this.backdropTextBuf.width = w;
      this.backdropTextBuf.height = h;
    }
    const g = this.backdropTextBuf.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!g) return false;

    const { dpr, z, ox, oy, by, pieces, wingPop } = state;
    const padX = 20 * dpr;
    const rightBlock = (state.safeRightPx ?? 0) * dpr;
    const bottomBlock = (state.safeBottomPx ?? 0) * dpr;
    const availW = Math.max(120 * dpr, w - rightBlock - padX * 2);
    const centerX = padX + availW * 0.5;

    const bounds = computeRigWorldBounds(by, pieces, wingPop ?? 0);
    const rawHeadTop = bounds ? bounds.headTopY * z + oy : 28 * dpr;
    const rawAnkles = bounds ? bounds.anklesY * z + oy : h - bottomBlock - 28 * dpr;

    const bandTop = Math.max(16 * dpr, Math.min(h - bottomBlock - 76 * dpr, rawHeadTop));
    const bandBottom = Math.max(bandTop + 60 * dpr, Math.min(h - bottomBlock - 14 * dpr, rawAnkles));
    const bandH = bandBottom - bandTop;

    const welcome = state.backdropWelcome ?? 'Welcome Bitruvius.';
    const hint =
      state.backdropHint ??
      'Drag hands, feet, knees, or spine for FABRIK IK (Alt = pure FK) · double-click head, hand, foot or wing circle · double right-click copies JSON';

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // 1. Welcome headline in crisp digital monospace scaled cleanly to fit availW & upper chest band
    let titleSize = Math.max(15 * dpr, Math.min(48 * dpr, bandH * 0.135));
    const applyTitleFont = (px: number) => {
      g.font = `700 ${px}px "JetBrains Mono", ui-monospace, monospace`;
    };
    applyTitleFont(titleSize);
    const measuredTitleW = g.measureText(welcome).width;
    if (measuredTitleW > availW * 0.9 && measuredTitleW > 1) {
      titleSize = Math.max(12 * dpr, titleSize * ((availW * 0.9) / measuredTitleW));
      applyTitleFont(titleSize);
    }
    const welcomeY = bandTop + Math.max(titleSize * 0.65, bandH * 0.28);
    g.fillText(welcome, centerX, welcomeY);

    // 2. Drag-hands guidance in digital monospace word-wrapped cleanly inside availW * 0.88 above ankles
    let hintSize = Math.max(10 * dpr, Math.min(16 * dpr, bandH * 0.038));
    const maxHintW = availW * 0.88;
    const words = hint.split(' ');
    const wrapLines = (fontPx: number): string[] => {
      g.font = `500 ${fontPx}px "JetBrains Mono", ui-monospace, monospace`;
      const lines: string[] = [];
      let cur = '';
      for (const word of words) {
        const cand = cur ? `${cur} ${word}` : word;
        if (g.measureText(cand).width <= maxHintW || !cur) {
          cur = cand;
        } else {
          lines.push(cur);
          cur = word;
        }
      }
      if (cur) lines.push(cur);
      return lines;
    };

    let lines = wrapLines(hintSize);
    while (lines.length > 3 && hintSize > 9.5 * dpr) {
      hintSize *= 0.9;
      lines = wrapLines(hintSize);
    }
    const lineH = hintSize * 1.38;
    const totalHintH = lines.length * lineH;
    const desiredCenterY = Math.max(welcomeY + titleSize * 0.95 + totalHintH * 0.5, bandTop + bandH * 0.72);
    const clampedCenterY = Math.min(bandBottom - totalHintH * 0.5 - 4 * dpr, desiredCenterY);
    const startY = clampedCenterY - ((lines.length - 1) * lineH) * 0.5;
    lines.forEach((line, idx) => {
      g.fillText(line, centerX, startY + idx * lineH);
    });

    return true;
  }

  /**
   * Complementary Green Collision Filter: intersects the backdrop typography mask with the live
   * purple-and-black model silhouette so overlapping letters glow cleanly in our studio green (#22c55e).
   */
  private drawComplementaryCollisionText(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: RenderContextState,
    useBlurredDigital: boolean,
  ): void {
    if (!this.backdropTextBuf) return;
    const scale = 0.5;
    const cw = Math.max(1, Math.ceil(w * scale));
    const ch = Math.max(1, Math.ceil(h * scale));

    if (!this.modelMaskBuf) this.modelMaskBuf = mkCanvas(cw, ch);
    if (this.modelMaskBuf.width !== cw || this.modelMaskBuf.height !== ch) {
      this.modelMaskBuf.width = cw;
      this.modelMaskBuf.height = ch;
    }
    if (!this.collisionTextBuf) this.collisionTextBuf = mkCanvas(cw, ch);
    if (this.collisionTextBuf.width !== cw || this.collisionTextBuf.height !== ch) {
      this.collisionTextBuf.width = cw;
      this.collisionTextBuf.height = ch;
    }

    const mctx = this.modelMaskBuf.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    const cctx = this.collisionTextBuf.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!mctx || !cctx) return;

    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, cw, ch);
    if (useBlurredDigital && this.lo) {
      mctx.drawImage(this.lo, 0, 0, cw, ch);
    } else {
      this.drawArt(mctx, scale, cw, ch, state);
    }

    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.globalCompositeOperation = 'source-over';
    cctx.clearRect(0, 0, cw, ch);
    cctx.drawImage(this.backdropTextBuf, 0, 0, cw, ch);
    cctx.globalCompositeOperation = 'source-in';
    cctx.drawImage(this.modelMaskBuf, 0, 0, cw, ch);
    cctx.globalCompositeOperation = 'source-in';
    cctx.fillStyle = GREEN;
    cctx.fillRect(0, 0, cw, ch);
    cctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = useBlurredDigital ? 0.56 : 0.72;
    ctx.drawImage(this.collisionTextBuf, 0, 0, w, h);
    ctx.restore();
  }

  private getHeadAxis(by: Record<string, RigNode>): [number, number] {
    const hd = by.head || by.neck;
    if (!hd) return [1, 0];
    const len = Math.hypot(hd.w[0], hd.w[1]);
    if (!Number.isFinite(len) || len < 1e-4) return [1, 0];
    return [hd.w[0] / len, hd.w[1] / len];
  }

  private strokeFaceSwivelArrows(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    halfSpan: number,
    barbLen: number,
    barbHalfH: number,
    ux: number,
    uy: number,
  ): void {
    const nx = -uy;
    const ny = ux;
    const lx = cx - ux * halfSpan;
    const ly = cy - uy * halfSpan;
    const rx = cx + ux * halfSpan;
    const ry = cy + uy * halfSpan;

    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(rx, ry);

    // Left arrowhead (<)
    ctx.moveTo(lx + ux * barbLen + nx * barbHalfH, ly + uy * barbLen + ny * barbHalfH);
    ctx.lineTo(lx, ly);
    ctx.lineTo(lx + ux * barbLen - nx * barbHalfH, ly + uy * barbLen - ny * barbHalfH);

    // Right arrowhead (>)
    ctx.moveTo(rx - ux * barbLen + nx * barbHalfH, ry - uy * barbLen + ny * barbHalfH);
    ctx.lineTo(rx, ry);
    ctx.lineTo(rx - ux * barbLen - nx * barbHalfH, ry - uy * barbLen - ny * barbHalfH);
    ctx.stroke();
  }
}

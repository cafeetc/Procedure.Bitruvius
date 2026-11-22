/**
 * Feature Notes (Plain English):
 * - Inverse Kinematics (IK) & FABRIK: Pulls limbs, knees, spine, and head smoothly toward
 *   your pointer while keeping grounded/pinned feet planted and joints within anatomical limits.
 * - Balance & Pin Modes: Shifts body counterweight or locks feet/hands/head in place.
 * - Dual-Spine Perspective Bend: Subtly counter-curves lower (lumbar) and upper (thorax)
 *   spine relative to the vanishing point and horizon without fighting manual posing.
 */
import {
  DEG,
  clampAnatomicalAngle,
  clampRealisticShoulder,
  normalizeDeg,
  parentOf,
  pos,
  solveRig,
} from './fkEngine';
import {
  DEFAULT_GROUND_Y,
  DEFAULT_SPATIAL_ENV,
  GROUND_TOL,
  type PostureRegime,
  applyGroundAndBalance,
  applyMovingCounterBalance,
  computeCanonicalProportionMetrics,
  evaluateFootAnkleAwareness,
  inferPostureRegime,
} from './groundSystem';
import {
  CANONICAL_PROPORTIONS,
  VECTOR_EPSILON_PX,
  dampAngleWithStiffness,
  safeFinite,
  snapAngularEpsilon,
} from './jointLimits';
import { LIMB_CHAINS } from './rigMetadata';
import type {
  BodyTurnView,
  IKConfig,
  IKMode,
  IKPinEntry,
  LimbChainDef,
  PerspHandle,
  PerspectiveState,
  RigNode,
} from './types';

export { DEFAULT_GROUND_Y, GROUND_TOL, computeCanonicalProportionMetrics };
export type { PostureRegime };
export const LONG_IK_MS = 260;

export const JOINT_CIRCLE_RADIUS_PX = 12;
export const PIN_DIAMOND_RADIUS_PX = 6.5;
export const PIN_MAGNETIC_MULTIPLIER = 1.25;
export const PIN_MAGNETIC_SNAP_RADIUS_PX = JOINT_CIRCLE_RADIUS_PX * PIN_MAGNETIC_MULTIPLIER; // 15 px at 1x dpr

export const PERSP_DEFAULT: PerspectiveState = { ...DEFAULT_SPATIAL_ENV };

export const DEFAULT_IK_CONFIG: IKConfig = {
  mode: 'fluid',
  solver: 'fabrik',
  trigger: 'direct',
  iterations: 10,
  tolerance: 1.5,
  softness: 0.1,
  swivelFollow: 0.65,
  spineStiffness: 0.34,
  footGravity: true,
  groundY: DEFAULT_GROUND_Y,
  allowStretch: false,
  elasticPinFull: true,
  bendOverrides: {},
};

export const IK_MODE_LABELS: Record<IKMode, string> = {
  fk: 'Pure FK',
  fluid: 'Fluid FABRIK',
  balance: 'Balance + IK',
  pinFeet: 'Pin Feet',
  pinAll: 'Pin Feet + Hands',
  pinFull: 'Pin Full Rig',
};

export const EFFECTOR_IDS = ['footL', 'footR', 'handL', 'handR', 'head'] as const;
export const FBIK_CHAIN_NODES = new Set(['head', 'neck', 'thorax', 'lumbar', 'pelvis', 'shinL', 'shinR']);

const IDENTITY = [1, 0, 0, 1, 0, 0];

/**
 * Returns world direction (radians) from node pivot to a local tip point.
 */
export function getWorldDir(
  n: RigNode,
  localTip: [number, number] | null,
  by: Record<string, RigNode>,
): number {
  const a = pos(n, by);
  const t = localTip ?? [n.piv[0], n.piv[1] + 200];
  const w = n.w;
  const bx = w[0] * t[0] + w[2] * t[1] + w[4];
  const byp = w[1] * t[0] + w[3] * t[1] + w[5];
  const dx = bx - a[0];
  const dy = byp - a[1];
  if (Math.hypot(dx, dy) <= VECTOR_EPSILON_PX) {
    return safeFinite(Math.atan2(w[1], w[0]), 0);
  }
  return safeFinite(Math.atan2(dy, dx), 0);
}

/**
 * Sets node's local angle so its localTip vector points toward targetWorldRad,
 * accurately accounting for parent determinant sign and node.flipX.
 */
export function setWorldDirExact(
  n: RigNode,
  localTip: [number, number],
  targetWorldRad: number,
  by: Record<string, RigNode>,
): void {
  const par = parentOf(n, by);
  const pW = par ? par.w : IDENTITY;
  const rawDet = pW[0] * pW[3] - pW[1] * pW[2];
  const det = Math.abs(rawDet) > 1e-8 ? rawDet : 1;
  const safeRad = safeFinite(targetWorldRad, 0);
  const wx = Math.cos(safeRad);
  const wy = Math.sin(safeRad);
  const lx = (pW[3] * wx - pW[2] * wy) / det;
  const ly = (-pW[1] * wx + pW[0] * wy) / det;
  const fx = n.flipX ? -1 : 1;
  const effDx = fx * (localTip[0] - n.piv[0]);
  const effDy = localTip[1] - n.piv[1];
  const tipLen = Math.hypot(effDx, effDy);
  const tipLocalRad = tipLen > VECTOR_EPSILON_PX ? Math.atan2(effDy, effDx) : 0;
  const localTargetRad = Math.hypot(lx, ly) > VECTOR_EPSILON_PX ? Math.atan2(ly, lx) : safeRad;
  n.ang = snapAngularEpsilon(normalizeDeg((localTargetRad - tipLocalRad) / DEG));
}

/**
 * Resolves any clicked child extremity (digits, toe tips, chin) to its controlling IK chain.
 */
export function findLimbChainForNode(nodeId: string): LimbChainDef | null {
  const mapped =
    nodeId.startsWith('thumb') || nodeId.startsWith('finger')
      ? 'hand' + nodeId.slice(-1)
      : nodeId.startsWith('toe')
      ? 'foot' + nodeId.slice(-1)
      : nodeId;
  return LIMB_CHAINS.find((c) => c.effector === mapped) ?? null;
}

export function limbLengths(c: LimbChainDef, by: Record<string, RigNode>): [number, number] {
  const U = by[c.upper];
  const L = by[c.lower];
  const E = by[c.effector];
  if (!U || !L || !E) return [1000, 1000];
  return [
    Math.hypot(L.piv[0] - U.piv[0], L.piv[1] - U.piv[1]),
    Math.hypot(E.piv[0] - L.piv[0], E.piv[1] - L.piv[1]),
  ];
}

/**
 * Determines bend sign (+1 / -1) for a 2-bone limb, preserving natural knee/elbow direction.
 */
function resolveBendSign(
  c: LimbChainDef,
  U: RigNode,
  L: RigNode,
  _tx: number,
  _P1: [number, number],
  config: IKConfig,
  bendHint = 0,
): number {
  const override = config.bendOverrides[c.id];
  if (override) return Math.sign(override);
  if (bendHint) return Math.sign(bendHint);
  if (Math.abs(L.ang) > 4) {
    return (L.ang > 0 ? 1 : -1) * (U.flipX ? -1 : 1);
  }
  return c.bendSign;
}

/**
 * 2-Bone Analytical Limb Solver (Law of Cosines + C1 Soft-IK Reach Damping).
 */
export function solveAnalyticalLimbIK(
  c: LimbChainDef,
  target: [number, number],
  nodes: RigNode[],
  by: Record<string, RigNode>,
  bondOn: boolean,
  wingPop: number,
  config: IKConfig,
  constrainLimits: boolean,
  bendHint = 0,
): void {
  solveRig(nodes, by, bondOn, wingPop);
  const U = by[c.upper];
  const L = by[c.lower];
  const E = by[c.effector];
  if (!U || !L || !E) return;

  const par = parentOf(U, by);
  const pW = par ? par.w : IDENTITY;
  const det = pW[0] * pW[3] - pW[1] * pW[2] || 1;
  const dx = target[0] - pW[4];
  const dy = target[1] - pW[5];
  const tx = (pW[3] * dx - pW[2] * dy) / det;
  const ty = (-pW[1] * dx + pW[0] * dy) / det;

  const fx = U.flipX ? -1 : 1;
  const P1: [number, number] = [U.piv[0], U.piv[1]];
  const P2: [number, number] = [U.flipX ? 2 * P1[0] - L.piv[0] : L.piv[0], L.piv[1]];
  const P3: [number, number] = [U.flipX ? 2 * P1[0] - E.piv[0] : E.piv[0], E.piv[1]];

  const len1Raw = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]);
  const len2Raw = Math.hypot(P3[0] - P2[0], P3[1] - P2[1]);
  const L1 = len1Raw > VECTOR_EPSILON_PX ? len1Raw : 1;
  const L2 = len2Raw > VECTOR_EPSILON_PX ? len2Raw : 1;
  const base1 = len1Raw > VECTOR_EPSILON_PX ? Math.atan2(P2[1] - P1[1], P2[0] - P1[0]) : Math.PI / 2;
  const base2 = len2Raw > VECTOR_EPSILON_PX ? Math.atan2(P3[1] - P2[1], P3[0] - P2[0]) : base1;
  const restDiff = normalizeDeg((base2 - base1) / DEG);

  const rx = safeFinite(tx, P1[0]) - P1[0];
  const ry = safeFinite(ty, P1[1]) - P1[1];
  const rawDist = Math.hypot(rx, ry);
  const dist = rawDist > VECTOR_EPSILON_PX ? rawDist : 1;
  const aim = rawDist > VECTOR_EPSILON_PX ? Math.atan2(ry, rx) : base1;

  // Ground max reach ceiling in Vitruvian/Leonardo arm-span and leg-length proportions
  const canonMetrics = computeCanonicalProportionMetrics(by, pos);
  const canonCap = c.id.startsWith('arm')
    ? canonMetrics.armMaxReachPx * CANONICAL_PROPORTIONS.leonardo.armSpanToHeight
    : canonMetrics.legMaxReachPx;
  const hardMax = constrainLimits && !config.allowStretch
    ? Math.min(L1 + L2 - 4, Math.max(L1 + L2 - 4, canonCap))
    : L1 + L2 - 4;
  const softness = (L1 + L2) * Math.max(0, Math.min(0.3, safeFinite(config.softness, 0.1)));
  const softStart = hardMax - softness;
  const hardInput = softStart + 1.4 * softness;

  if (dist >= hardInput) {
    U.ang = clampAnatomicalAngle(U, (aim - base1) / DEG, constrainLimits);
    L.ang = clampAnatomicalAngle(L, -restDiff * fx, constrainLimits);
  } else {
    const minFold = Math.abs(L1 - L2) + 12;
    let d = Math.max(minFold, dist);
    if (softness > 1 && dist > softStart) {
      const u = Math.min(1, (dist - softStart) / (1.4 * softness));
      d = softStart + softness * (-0.6 * u * u + 0.2 * u + 1.4) * u;
    }
    // Procedural singularity epsilon: keep Law-of-Cosines away from ±1 derivative spikes
    const safeCosMax = 0.99985;
    const cosA = Math.max(-safeCosMax, Math.min(safeCosMax, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
    const cosB = Math.max(-safeCosMax, Math.min(safeCosMax, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)));
    const alpha = Math.acos(cosA);
    const beta = Math.acos(cosB);
    const bs = resolveBendSign(c, U, L, tx, P1, config, bendHint);

    U.ang = clampAnatomicalAngle(U, (aim - bs * alpha - base1) / DEG, constrainLimits);
    L.ang = clampAnatomicalAngle(L, fx * (bs * ((Math.PI - beta) / DEG) - restDiff), constrainLimits);
  }

  solveRig(nodes, by, bondOn, wingPop);
}

/**
 * Multi-bone FABRIK (Forward And Backward Reaching Inverse Kinematics) Solver.
 * Works seamlessly on 2-bone limbs, spine+head chains, or custom sub-chains.
 * Zero per-iteration heap churn; respects soft-IK damping, pole bias, and optional limits.
 */
export function solveFABRIKChain(
  chainIds: string[],
  targetWorld: [number, number],
  nodes: RigNode[],
  by: Record<string, RigNode>,
  bondOn: boolean,
  wingPop: number,
  config: IKConfig,
  constrainLimits: boolean,
  opts?: {
    poleBias?: [number, number];
    softDamp?: boolean;
    clampEachStep?: boolean;
    allowRootShift?: boolean;
    rootShiftWeight?: number;
    rootNode?: RigNode;
  },
): void {
  const chain: RigNode[] = [];
  for (const id of chainIds) {
    if (by[id]) chain.push(by[id]);
  }
  if (chain.length < 2) return;

  solveRig(nodes, by, bondOn, wingPop);

  const nCount = chain.length;
  const pts: Array<[number, number]> = chain.map((n) => pos(n, by));
  const lengths: number[] = [];
  let totalLen = 0;

  for (let i = 0; i < nCount - 1; i++) {
    const rawSeg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const d = rawSeg > VECTOR_EPSILON_PX ? rawSeg : 1;
    lengths.push(d);
    totalLen += d;
  }

  const rootOrigin: [number, number] = [safeFinite(pts[0][0], 0), safeFinite(pts[0][1], 0)];

  // Apply Soft-IK damping so reaching max extension eases smoothly
  let effTarget: [number, number] = [safeFinite(targetWorld[0], rootOrigin[0]), safeFinite(targetWorld[1], rootOrigin[1])];
  const toTx = effTarget[0] - rootOrigin[0];
  const toTy = effTarget[1] - rootOrigin[1];
  const rawMag = Math.hypot(toTx, toTy);
  const rawDist = rawMag > VECTOR_EPSILON_PX ? rawMag : 1;

  if ((opts?.softDamp ?? true) && !config.allowStretch && config.softness > 0.001) {
    const hardMax = totalLen - 4;
    const softness = totalLen * Math.max(0, Math.min(0.28, safeFinite(config.softness, 0.1)));
    const softStart = hardMax - softness;
    if (rawMag > softStart && rawMag < softStart + 1.4 * softness) {
      const u = (rawMag - softStart) / (1.4 * softness);
      const dampedDist = softStart + softness * (-0.6 * u * u + 0.2 * u + 1.4) * u;
      effTarget = [
        rootOrigin[0] + (toTx / rawDist) * dampedDist,
        rootOrigin[1] + (toTy / rawDist) * dampedDist,
      ];
    }
  }

  // Nudge middle joints toward anatomical poleBias so FABRIK bends in natural direction even from straight rest
  if (opts?.poleBias && nCount >= 3) {
    const [pbx, pby] = opts.poleBias;
    for (let i = 1; i < nCount - 1; i++) {
      pts[i][0] += safeFinite(pbx, 0) * 64;
      pts[i][1] += safeFinite(pby, 0) * 64;
    }
  }

  const iters = Math.max(2, Math.min(32, Math.round(config.iterations)));
  const tol = Math.max(0.25, config.tolerance);

  const distTarget = Math.hypot(effTarget[0] - rootOrigin[0], effTarget[1] - rootOrigin[1]);

  if (!config.allowStretch && distTarget >= totalLen - 0.5 && !opts?.allowRootShift) {
    // Fully extended toward target
    const safeDen = distTarget > VECTOR_EPSILON_PX ? distTarget : 1;
    const ux = distTarget > VECTOR_EPSILON_PX ? (effTarget[0] - rootOrigin[0]) / safeDen : 0;
    const uy = distTarget > VECTOR_EPSILON_PX ? (effTarget[1] - rootOrigin[1]) / safeDen : 1;
    pts[0] = [rootOrigin[0], rootOrigin[1]];
    for (let i = 0; i < nCount - 1; i++) {
      pts[i + 1] = [pts[i][0] + ux * lengths[i], pts[i][1] + uy * lengths[i]];
    }
  } else {
    for (let iter = 0; iter < iters; iter++) {
      const endErr = Math.hypot(
        pts[nCount - 1][0] - effTarget[0],
        pts[nCount - 1][1] - effTarget[1],
      );
      if (endErr <= tol) break;

      // 1. Backward pass: pull end effector to target
      pts[nCount - 1] = [effTarget[0], effTarget[1]];
      for (let i = nCount - 2; i >= 0; i--) {
        const dx = pts[i][0] - pts[i + 1][0];
        const dy = pts[i][1] - pts[i + 1][1];
        const dRaw = Math.hypot(dx, dy);
        const d = dRaw > VECTOR_EPSILON_PX ? dRaw : 1;
        const r = lengths[i] / d;
        pts[i] = dRaw > VECTOR_EPSILON_PX
          ? [pts[i + 1][0] + dx * r, pts[i + 1][1] + dy * r]
          : [pts[i + 1][0], pts[i + 1][1] - lengths[i]];
      }

      // 2. Forward pass: anchor root (or blend root shift for full-body spine drag)
      if (opts?.allowRootShift) {
        const w = opts.rootShiftWeight ?? 0.35;
        pts[0] = [
          rootOrigin[0] + (pts[0][0] - rootOrigin[0]) * w,
          rootOrigin[1] + (pts[0][1] - rootOrigin[1]) * w,
        ];
      } else {
        pts[0] = [rootOrigin[0], rootOrigin[1]];
      }

      for (let i = 0; i < nCount - 1; i++) {
        const dx = pts[i + 1][0] - pts[i][0];
        const dy = pts[i + 1][1] - pts[i][1];
        const dRaw = Math.hypot(dx, dy);
        const d = dRaw > VECTOR_EPSILON_PX ? dRaw : 1;
        const r = lengths[i] / d;
        pts[i + 1] = dRaw > VECTOR_EPSILON_PX
          ? [pts[i][0] + dx * r, pts[i][1] + dy * r]
          : [pts[i][0], pts[i][1] + lengths[i]];
      }
    }
  }

  // Convert solved world points sequentially into local joint angles
  const shiftTarget = opts?.rootNode ?? (chain[0] && !chain[0].parent ? chain[0] : null);
  if (opts?.allowRootShift && shiftTarget) {
    const dxRoot = pts[0][0] - rootOrigin[0];
    const dyRoot = pts[0][1] - rootOrigin[1];
    shiftTarget.tx += dxRoot;
    shiftTarget.ty += dyRoot;
    solveRig(nodes, by, bondOn, wingPop);
  }

  for (let i = 0; i < nCount - 1; i++) {
    const curr = chain[i];
    const next = chain[i + 1];
    if (curr.lock) continue;

    const prevAng = curr.ang;
    solveRig(nodes, by, bondOn, wingPop);
    const currWorld = pos(curr, by);
    const targetDir = Math.atan2(pts[i + 1][1] - currWorld[1], pts[i + 1][0] - currWorld[0]);
    setWorldDirExact(curr, next.piv, targetDir, by);

    if (constrainLimits) {
      const clamped = clampAnatomicalAngle(curr, curr.ang, true);
      curr.ang =
        opts?.softDamp === false
          ? clamped
          : dampAngleWithStiffness(
              curr.id,
              prevAng,
              clamped,
              true,
              opts?.allowRootShift ? config.spineStiffness : 0.35,
            );
    }
    curr.ang = clampRealisticShoulder(curr, curr.ang, by, wingPop > 0.05);
  }

  solveRig(nodes, by, bondOn, wingPop);
}

/**
 * Unified Limb Chain Solver: dispatches to FABRIK or 2-Bone Analytical solver,
 * plus optional clavicle/swivel follow when reaching far.
 */
export function solveLimbChain(
  c: LimbChainDef,
  target: [number, number],
  nodes: RigNode[],
  by: Record<string, RigNode>,
  bondOn: boolean,
  wingPop: number,
  config: IKConfig,
  constrainLimits: boolean,
  bendHint = 0,
  softDamp = true,
): void {
  const U = by[c.upper];
  const L = by[c.lower];
  const E = by[c.effector];
  if (!U || !L || !E) return;

  if (config.solver === 'analytical') {
    solveAnalyticalLimbIK(c, target, nodes, by, bondOn, wingPop, config, constrainLimits, bendHint);
    return;
  }

  // Compute anatomical perpendicular pole bias matching analytical -bs * alpha convention (+Y down => (vy, -vx))
  solveRig(nodes, by, bondOn, wingPop);
  const pRoot = pos(U, by);
  const vx = target[0] - pRoot[0];
  const vy = target[1] - pRoot[1];
  const dist = Math.hypot(vx, vy) || 1;
  const perpX = vy / dist;
  const perpY = -vx / dist;
  const bs = resolveBendSign(c, U, L, target[0], U.piv, config, bendHint);

  // Account for horizontal mirroring on either limb U or ancestor hip (hipR/hipL flipX)
  const par = parentOf(U, by);
  const pDet = par ? par.w[0] * par.w[3] - par.w[1] * par.w[2] : 1;
  const flipMul = (U.flipX ? -1 : 1) * (pDet < 0 ? -1 : 1);
  const pole: [number, number] = [perpX * bs * flipMul, perpY * bs * flipMul];

  solveFABRIKChain(
    [c.upper, c.lower, c.effector],
    target,
    nodes,
    by,
    bondOn,
    wingPop,
    config,
    constrainLimits,
    {
      poleBias: pole,
      softDamp,
    },
  );
}

/**
 * Foot Ground Contact & Floor Lock helpers
 */
export function footContactInfo(f: RigNode, by: Record<string, RigNode>): { maxY: number; midX: number } {
  const info = evaluateFootAnkleAwareness(f, by, DEFAULT_GROUND_Y);
  return {
    maxY: info.soleMaxY,
    midX: info.midX,
  };
}

export function figureLowestFootY(by: Record<string, RigNode>): number {
  let m = -1e9;
  for (const id of ['footL', 'footR'] as const) {
    const f = by[id];
    if (!f) continue;
    m = Math.max(m, footContactInfo(f, by).maxY);
  }
  return m;
}

export function isFootOnGround(id: 'footL' | 'footR', by: Record<string, RigNode>, groundY: number): boolean {
  const f = by[id];
  if (!f) return false;
  return Math.abs(footContactInfo(f, by).maxY - groundY) <= GROUND_TOL;
}

export function enforceGroundContact(
  nodes: RigNode[],
  by: Record<string, RigNode>,
  root: RigNode,
  bondOn: boolean,
  wingPop: number,
  groundY: number,
  pullDownToo = false,
  opts?: {
    regime?: PostureRegime;
    balanceWeight?: number;
    constrainLimits?: boolean;
    pins?: Record<string, IKPinEntry>;
    rootVelocity?: [number, number];
    isKeyframedMotion?: boolean;
    lockedJoints?: ReadonlySet<string>;
  },
): boolean {
  return applyGroundAndBalance(
    nodes,
    by,
    root,
    { groundY },
    opts?.regime === 'moving' ? 'balance' : 'pinFeet',
    solveRig,
    pos,
    bondOn,
    wingPop,
    {
      pullDownToo,
      regime: opts?.regime,
      balanceWeight: opts?.balanceWeight,
      constrainLimits: opts?.constrainLimits,
      pins: opts?.pins,
      rootVelocity: opts?.rootVelocity,
      isKeyframedMotion: opts?.isKeyframedMotion,
      lockedJoints: opts?.lockedJoints,
    },
  );
}

/**
 * Anchors perspective focal X strictly to the figure root so moving a single limb (like a leg)
 * never shifts the perspective grid unless the whole model translates.
 */
export function skelFocalX(by: Record<string, RigNode>, root?: RigNode): number {
  return root ? pos(root, by)[0] : 1257;
}

/**
 * Hit-tests the 1-point perspective handles: vanishing point dot first, then horizon and ground lines.
 */
export function hitPerspHandle(
  q: [number, number],
  persp: PerspectiveState,
  cam: { z: number; ox: number; oy: number; dpr: number },
): PerspHandle {
  if (!persp.enabled) return null;
  const tol = (11 * cam.dpr) / Math.max(0.001, cam.z);
  const sx = q[0] * cam.z + cam.ox;
  const sy = q[1] * cam.z + cam.oy;
  const vpx = persp.vpX * cam.z + cam.ox;
  const vpy = persp.horizonY * cam.z + cam.oy;
  if (Math.hypot(sx - vpx, sy - vpy) <= 13 * cam.dpr) return 'vp';
  if (Math.abs(q[1] - persp.horizonY) <= tol) return 'horizon';
  if (Math.abs(q[1] - persp.groundY) <= tol * 1.15) return 'ground';
  return null;
}

export const SLOUCH_QUARTER_JOINT_SCREEN_PX = JOINT_CIRCLE_RADIUS_PX * 0.5; // 6 px at 1x dpr (1/4 of 24 px joint diameter)

export interface PerspectiveSpineBias {
  lumbar: number;
  thorax: number;
  neck: number;
  head: number;
  ribR: number;
  ribL: number;
  swivelR: number;
  swivelL: number;
  braceR: number;
  braceL: number;
  acromionR: number;
  acromionL: number;
  femurR: number;
  femurL: number;
  shinR: number;
  shinL: number;
  footR: number;
  footL: number;
  pelvisTy: number;
  stanceRatio: number;
  slouchFactor: number;
  jointDropY: Record<string, number>;
  jointDropPivDelta: Record<string, [number, number]>;
}

export const ZERO_PERSP_SPINE_BIAS: PerspectiveSpineBias = {
  lumbar: 0,
  thorax: 0,
  neck: 0,
  head: 0,
  ribR: 0,
  ribL: 0,
  swivelR: 0,
  swivelL: 0,
  braceR: 0,
  braceL: 0,
  acromionR: 0,
  acromionL: 0,
  femurR: 0,
  femurL: 0,
  shinR: 0,
  shinL: 0,
  footR: 0,
  footL: 0,
  pelvisTy: 0,
  stanceRatio: 0,
  slouchFactor: 0,
  jointDropY: {},
  jointDropPivDelta: {},
};

/**
 * Computes mechanical stance & dual-spine perspective bias from VP & horizon elevation:
 * - Note screen Y grows downward:
 *   - Low horizon (larger horizonY near feet/ground): negative stanceRatio (-1..0) -> braced upright
 *     spinal extension, compact shoulder rotation, tall straight legs.
 *   - High horizon (smaller horizonY above shoulders/crown): positive stanceRatio (0..+1) -> progressive
 *     mechanical compressive flexion in lumbar/thorax/neck, forward scapular hang, & weight-settled knees.
 */
export function computeHorizonStanceMetrics(
  by: Record<string, RigNode>,
  root: RigNode | undefined,
  persp: PerspectiveState,
  bodyView: BodyTurnView = 'front',
): { stanceRatio: number; hFactor: number; vFactor: number; turnDir: -1 | 0 | 1 } {
  const neutralHorizonY = persp.groundY - (DEFAULT_GROUND_Y - PERSP_DEFAULT.horizonY);
  // Signed horizon shift: < 0 when horizon is lowered toward groundY, > 0 when horizon is raised above crown
  const rawShift = (neutralHorizonY - persp.horizonY) / 3400;
  const stanceRatio = Math.max(-1.15, Math.min(1.25, Math.tanh(rawShift * 1.15) * 1.25));
  const fx = skelFocalX(by, root);
  const dx = fx - persp.vpX;
  const thY = by.thorax ? pos(by.thorax, by)[1] : 2099.5;
  const hFactor = Math.tanh(dx / 1400);
  const vFactor = Math.tanh((persp.horizonY - thY) / 2200);
  const turnDir: -1 | 0 | 1 =
    bodyView === 'threeQuarterR' || bodyView === 'sideR'
      ? 1
      : bodyView === 'threeQuarterL' || bodyView === 'sideL'
      ? -1
      : 0;
  return { stanceRatio, hFactor, vFactor, turnDir };
}

const SLOUCH_COMPENSATORY_WEIGHTS: Readonly<Record<string, number>> = {
  thorax: 0.34,
  neck: 0.42,
  head: 0.36,
  swivelR: 0.48,
  swivelL: 0.48,
  braceR: 0.24,
  braceL: 0.24,
  acromionR: 0.42,
  acromionL: 0.42,
  humerusR: 0.28,
  humerusL: 0.28,
  forearmR: 0.32,
  forearmL: 0.32,
  handR: 0.26,
  handL: 0.26,
  hipR: 0.22,
  hipL: 0.22,
  femurR: 0.28,
  femurL: 0.28,
  shinR: 0.22,
  shinL: 0.22,
};

/**
 * Computes normalized mechanical slouch loosening (0..1) from high horizon elevation.
 */
export function computeHorizonSlouchFactor(persp: PerspectiveState): number {
  if (!persp.enabled) return 0;
  const neutralHorizonY = persp.groundY - (DEFAULT_GROUND_Y - PERSP_DEFAULT.horizonY);
  const rawShift = (neutralHorizonY - persp.horizonY) / 3400;
  const stanceRatio = Math.max(-1.15, Math.min(1.25, Math.tanh(rawShift * 1.15) * 1.25));
  return stanceRatio > 0 ? Math.max(0, Math.min(1, stanceRatio / 1.15)) : 0;
}

/**
 * Computes world-Y compensatory gravity drop per suspended joint (~1/4 joint shape total settle)
 * when high horizon mechanically loosens joint tension.
 */
export function computeSlouchCompensatoryDrops(
  stanceRatio: number,
  camZ = 0.1,
): { slouchFactor: number; quarterJointWorldPx: number; jointDropY: Record<string, number> } {
  const slouchFactor = stanceRatio > 0 ? Math.max(0, Math.min(1, stanceRatio / 1.15)) : 0;
  const safeZ = Math.max(0.05, Math.min(1.5, safeFinite(camZ, 0.1)));
  // Quarter of the 24px screen joint shape (6 screen px), clamped in world coordinates so zoom never distorts segments
  const quarterJointWorldPx = Math.max(18, Math.min(64, SLOUCH_QUARTER_JOINT_SCREEN_PX / safeZ));
  if (slouchFactor <= 0.005) {
    return { slouchFactor: 0, quarterJointWorldPx, jointDropY: {} };
  }
  // Smooth ease-in-out curve for progressive joint loosening
  const eased = slouchFactor * slouchFactor * (3 - 2 * slouchFactor);
  const baseDrop = quarterJointWorldPx * eased;
  const jointDropY: Record<string, number> = {};
  for (const id in SLOUCH_COMPENSATORY_WEIGHTS) {
    jointDropY[id] = Math.round(baseDrop * SLOUCH_COMPENSATORY_WEIGHTS[id] * 100) / 100;
  }
  return {
    slouchFactor: Math.round(slouchFactor * 1000) / 1000,
    quarterJointWorldPx,
    jointDropY,
  };
}

/**
 * Computes a purely mechanical dual-spine + girdle + weight-transfer bias driven by
 * vanishing-point perspective and camera horizon elevation.
 */
export function computePerspectiveSpineBend(
  by: Record<string, RigNode>,
  root: RigNode | undefined,
  persp: PerspectiveState,
  bodyView: BodyTurnView = 'front',
  camZ = 0.1,
): PerspectiveSpineBias {
  if (!persp.enabled) {
    return { ...ZERO_PERSP_SPINE_BIAS, jointDropY: {}, jointDropPivDelta: {} };
  }
  const { stanceRatio, hFactor, vFactor, turnDir } = computeHorizonStanceMetrics(by, root, persp, bodyView);

  const highMag = Math.max(0, stanceRatio); // 0..1.25 compressive high-horizon flexion
  const lowMag = Math.max(0, -stanceRatio); // 0..1.15 braced low-horizon extension
  const slouch = computeSlouchCompensatoryDrops(stanceRatio, camZ);
  // Lightly loosen compensatory resistance across spine and girdle when slouched
  const slackGain = 1 + 0.16 * slouch.slouchFactor;

  // Asymmetric perspective S-curve from VP X offset
  const baseLumbar = hFactor * 5.2 + hFactor * vFactor * 2.2;
  const baseThorax = -baseLumbar * 0.72 + vFactor * hFactor * 1.4;

  // Facing sign for spinal pitch when turned, or gentle VP-guided asymmetry in front/back view
  const frontPitchBias = turnDir !== 0 ? turnDir : hFactor >= 0 ? 1 : -1;

  // High horizon: lumbar & thorax flex progressively; neck/head pitch down beneath chest; shoulders hang inward
  // Low horizon: lumbar & thorax extend erect; shoulders brace tightly & lift cleanly
  const lumbarFlex = turnDir !== 0 ? turnDir * (highMag * 20 * slackGain - lowMag * 11) : frontPitchBias * highMag * 8 * slackGain;
  const thoraxFlex = turnDir !== 0 ? turnDir * (highMag * 22 * slackGain - lowMag * 9) : frontPitchBias * (highMag * 10 * slackGain - lowMag * 3);
  const neckFlex = turnDir !== 0 ? turnDir * (highMag * 14 * slackGain - lowMag * 6) : frontPitchBias * highMag * 6 * slackGain;
  const headFlex = turnDir !== 0 ? turnDir * (highMag * 12 * slackGain - lowMag * 7) : frontPitchBias * highMag * 5 * slackGain;

  const ribDrop = highMag * 7 * slackGain - lowMag * 3;
  const shoulderRoll = highMag * 12 * slackGain - lowMag * 5;
  const braceCompact = highMag * 6 * slackGain - lowMag * 3.5;
  const acroRoll = highMag * 11 * slackGain - lowMag * 4;

  // Weight settle on lower body when horizon rises (pelvis settles downward + knee flex),
  // tall straight bracing when horizon drops low
  const pelvisTy = Math.round((highMag * 220 * slackGain - lowMag * 40) * 100) / 100;
  const kneeDir = turnDir !== 0 ? turnDir : 1;
  const femurFlex = turnDir !== 0 ? kneeDir * (highMag * 11 * slackGain - lowMag * 4) : 0;
  const shinFlex = turnDir !== 0 ? -kneeDir * (highMag * 18 * slackGain - lowMag * 5) : 0;
  const footComp = turnDir !== 0 ? kneeDir * (highMag * 7 * slackGain - lowMag * 1) : 0;

  // Bilateral frontal knee compression/extension when facing front/back
  const biFemur = turnDir === 0 ? highMag * 11 * slackGain - lowMag * 3.5 : 0;
  const biShin = turnDir === 0 ? highMag * 19 * slackGain - lowMag * 5.5 : 0;
  const biFoot = turnDir === 0 ? highMag * 8 * slackGain - lowMag * 2 : 0;

  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    lumbar: r2(baseLumbar + lumbarFlex),
    thorax: r2(baseThorax + thoraxFlex),
    neck: r2(neckFlex),
    head: r2(headFlex),
    ribR: r2(turnDir !== 0 ? turnDir * ribDrop : -ribDrop),
    ribL: r2(turnDir !== 0 ? turnDir * ribDrop : ribDrop),
    swivelR: r2(turnDir !== 0 ? -turnDir * shoulderRoll : shoulderRoll),
    swivelL: r2(turnDir !== 0 ? -turnDir * shoulderRoll : -shoulderRoll),
    braceR: r2(turnDir !== 0 ? -turnDir * braceCompact : braceCompact),
    braceL: r2(turnDir !== 0 ? -turnDir * braceCompact : -braceCompact),
    acromionR: r2(turnDir !== 0 ? turnDir * acroRoll : -acroRoll),
    acromionL: r2(turnDir !== 0 ? turnDir * acroRoll : acroRoll),
    femurR: r2(turnDir !== 0 ? femurFlex : -biFemur),
    femurL: r2(turnDir !== 0 ? femurFlex * 0.78 : biFemur),
    shinR: r2(turnDir !== 0 ? shinFlex : biShin),
    shinL: r2(turnDir !== 0 ? -shinFlex * 0.72 : -biShin),
    footR: r2(turnDir !== 0 ? footComp : -biFoot),
    footL: r2(turnDir !== 0 ? -footComp * 0.65 : biFoot),
    pelvisTy,
    stanceRatio: r2(stanceRatio),
    slouchFactor: slouch.slouchFactor,
    jointDropY: slouch.jointDropY,
    jointDropPivDelta: {},
  };
}

/**
 * Applies only the incremental delta of the dual-spine perspective, horizon stance bias,
 * and compensatory quarter-joint-shape slouch drops cleanly and reversibly.
 */
export function applyPerspectiveSpineDelta(
  by: Record<string, RigNode>,
  root: RigNode | undefined,
  persp: PerspectiveState,
  prevBias: PerspectiveSpineBias,
  constrainLimits: boolean,
  bodyView: BodyTurnView = 'front',
  camZ = 0.1,
): PerspectiveSpineBias {
  const next = computePerspectiveSpineBend(by, root, persp, bodyView, camZ);
  const jointKeys = [
    'lumbar',
    'thorax',
    'neck',
    'head',
    'ribR',
    'ribL',
    'swivelR',
    'swivelL',
    'braceR',
    'braceL',
    'acromionR',
    'acromionL',
    'femurR',
    'femurL',
    'shinR',
    'shinL',
    'footR',
    'footL',
  ] as const;

  for (const id of jointKeys) {
    const node = by[id];
    const delta = next[id] - prevBias[id];
    if (node && !node.lock && Math.abs(delta) > 1e-4) {
      node.ang = clampAnatomicalAngle(node, node.ang + delta, constrainLimits);
    }
  }
  if (root) {
    const dTy = next.pelvisTy - prevBias.pelvisTy;
    if (Math.abs(dTy) > 1e-3) {
      root.ty += dTy;
    }
  }

  // Reversibly restore prior compensatory slouch pivot deltas before applying updated world-Y drops
  const prevPivMap = prevBias.jointDropPivDelta ?? {};
  for (const id in prevPivMap) {
    const node = by[id];
    const prevD = prevPivMap[id];
    if (node && prevD) {
      node.piv = [node.piv[0] - prevD[0], node.piv[1] - prevD[1]];
    }
  }

  const nextPivDelta: Record<string, [number, number]> = {};
  const allNodes = Object.values(by);
  if (allNodes.length > 0 && Object.keys(next.jointDropY).length > 0) {
    solveRig(allNodes, by, true, 0);
    for (const id in next.jointDropY) {
      const node = by[id];
      const dropY = next.jointDropY[id];
      if (!node || !dropY) continue;
      const par = parentOf(node, by);
      const pw = par ? par.w : IDENTITY;
      const rawDet = pw[0] * pw[3] - pw[1] * pw[2];
      const det = Math.abs(rawDet) > 1e-8 ? rawDet : 1;
      // Map world (0, +dropY) through parent inverse affine matrix into local pivot space
      const dpx = (-pw[2] * dropY) / det;
      const dpy = (pw[0] * dropY) / det;
      if (Number.isFinite(dpx) && Number.isFinite(dpy)) {
        node.piv = [node.piv[0] + dpx, node.piv[1] + dpy];
        nextPivDelta[id] = [dpx, dpy];
      }
    }
    solveRig(allNodes, by, true, 0);
  }
  next.jointDropPivDelta = nextPivDelta;
  return next;
}

/**
 * Preserves planted lowest foot contact position across view/turnaround shifts.
 */
export function anchorFigureOnPerspectiveShift(
  nodes: RigNode[],
  by: Record<string, RigNode>,
  root: RigNode,
  bondOn: boolean,
  wingPop: number,
  groundY: number,
  fn: () => void,
): void {
  if (!by.footL || !by.footR) {
    fn();
    return;
  }
  solveRig(nodes, by, bondOn, wingPop);
  const onL = isFootOnGround('footL', by, groundY);
  const onR = isFootOnGround('footR', by, groundY);
  let anchorId: 'footL' | 'footR' = 'footL';
  if (onL && onR) {
    anchorId = Math.abs(pos(by.footL, by)[0] - 1257) <= Math.abs(pos(by.footR, by)[0] - 1257) ? 'footL' : 'footR';
  } else if (onL) {
    anchorId = 'footL';
  } else if (onR) {
    anchorId = 'footR';
  } else {
    const yL = footContactInfo(by.footL, by).maxY;
    const yR = footContactInfo(by.footR, by).maxY;
    anchorId = yL >= yR ? 'footL' : 'footR';
  }
  const fNode = by[anchorId];
  const p0 = pos(fNode, by);
  const prevMaxY = footContactInfo(fNode, by).maxY;

  fn();

  solveRig(nodes, by, bondOn, wingPop);
  const p1 = pos(fNode, by);
  const info1 = footContactInfo(fNode, by);
  root.tx += p0[0] - p1[0];
  root.ty += prevMaxY - info1.maxY;
  solveRig(nodes, by, bondOn, wingPop);
  if (onL || onR) {
    enforceGroundContact(nodes, by, root, bondOn, wingPop, groundY, false);
  }
}

export function syncPinsFromRig(
  nodes: RigNode[],
  by: Record<string, RigNode>,
  bondOn: boolean,
  wingPop: number,
  prevPins: Record<string, IKPinEntry>,
): Record<string, IKPinEntry> {
  solveRig(nodes, by, bondOn, wingPop);
  const next: Record<string, IKPinEntry> = {};
  for (const id of EFFECTOR_IDS) {
    const n = by[id];
    if (!n) continue;
    const tipNode =
      id === 'footL'
        ? by.toeL
        : id === 'footR'
        ? by.toeR
        : id === 'handL'
        ? by.fingerTipL
        : id === 'handR'
        ? by.fingerTipR
        : by.chinTip;
    next[id] = {
      pos: pos(n, by),
      endDir: getWorldDir(n, tipNode ? tipNode.piv : null, by),
      pinned: prevPins[id]?.pinned ?? false,
    };
  }
  return next;
}

export interface PoseIKSnapshot {
  root: [number, number];
  limbs: Record<
    string,
    {
      Udir: number;
      Epos: [number, number];
      Edir: number;
      straight: boolean;
    }
  >;
}

export function capturePoseIKSnapshot(
  nodes: RigNode[],
  by: Record<string, RigNode>,
  root: RigNode,
  bondOn: boolean,
  wingPop: number,
): PoseIKSnapshot {
  solveRig(nodes, by, bondOn, wingPop);
  const limbs: PoseIKSnapshot['limbs'] = {};
  for (const c of LIMB_CHAINS) {
    const U = by[c.upper];
    const L = by[c.lower];
    const E = by[c.effector];
    if (!U || !L || !E) continue;
    const tipNode =
      E.id === 'footL'
        ? by.toeL
        : E.id === 'footR'
        ? by.toeR
        : E.id === 'handL'
        ? by.fingerTipL
        : by.fingerTipR;
    limbs[c.id] = {
      Udir: getWorldDir(U, c.id.startsWith('leg') ? E.piv : L.piv, by),
      Epos: pos(E, by),
      Edir: getWorldDir(E, tipNode ? tipNode.piv : null, by),
      straight: Math.abs(L.ang) < 4,
    };
  }
  return { root: [root.tx, root.ty], limbs };
}

function isChainAffectedByChange(c: LimbChainDef, changedId: string): boolean {
  if (!changedId || changedId === 'pelvis') return true;
  if (changedId === 'lumbar' || changedId === 'thorax') return c.id.startsWith('arm');
  if (c.id.startsWith('leg')) return changedId === 'hipL' || changedId === 'hipR';
  return (
    changedId === 'swivelL' ||
    changedId === 'swivelR' ||
    changedId === 'wingL' ||
    changedId === 'wingR' ||
    changedId === 'acromionL' ||
    changedId === 'acromionR'
  );
}

/**
 * Applies Balance counterweight, Moving-regime contralateral arm-to-leg counter-swing,
 * or Pinned Effectors after upper-body/root changes.
 */
export function applyBalanceAndPins(
  changedId: string,
  snap: PoseIKSnapshot | null,
  nodes: RigNode[],
  by: Record<string, RigNode>,
  bondOn: boolean,
  wingPop: number,
  config: IKConfig,
  pins: Record<string, IKPinEntry>,
  constrainLimits: boolean,
  skipChainId: string | null = null,
  regimeOpts?: {
    regime?: PostureRegime;
    rootVelocity?: [number, number];
    isKeyframedMotion?: boolean;
  },
): void {
  if (config.mode === 'fk') return;

  const isChainPinned = (c: LimbChainDef) => {
    const isModePinned =
      (config.mode === 'pinFeet' && c.id.startsWith('leg')) ||
      config.mode === 'pinAll' ||
      config.mode === 'pinFull';
    return isModePinned || !!pins[c.effector]?.pinned;
  };

  const solvePinnedChain = (c: LimbChainDef) => {
    const E = by[c.effector];
    const pin = E ? pins[E.id] : undefined;
    if (!E || !pin) return;
    for (let pass = 0; pass < 3; pass++) {
      const cur = pos(E, by);
      if (Math.hypot(cur[0] - pin.pos[0], cur[1] - pin.pos[1]) <= 0.5) break;
      solveLimbChain(c, pin.pos, nodes, by, bondOn, wingPop, config, constrainLimits, 0, false);
    }
    const tipNode =
      E.id === 'footL'
        ? by.toeL
        : E.id === 'footR'
        ? by.toeR
        : E.id === 'handL'
        ? by.fingerTipL
        : by.fingerTipR;
    if (tipNode) {
      setWorldDirExact(E, tipNode.piv, pin.endDir, by);
      E.ang = clampAnatomicalAngle(E, E.ang, constrainLimits);
    }
    solveRig(nodes, by, bondOn, wingPop);
  };

  for (const c of LIMB_CHAINS) {
    if (c.id === skipChainId) continue;
    const U = by[c.upper];
    const L = by[c.lower];
    const E = by[c.effector];
    if (!U || !L || !E) continue;
    if (changedId === U.id || changedId === L.id || changedId === E.id) continue;

    if (isChainPinned(c) && pins[E.id]) {
      solvePinnedChain(c);
      continue;
    }

    if (snap && isChainAffectedByChange(c, changedId) && (config.mode === 'balance' || config.mode === 'pinFeet')) {
      const sl = snap.limbs[c.id];
      if (!sl) continue;
      if (c.id.startsWith('leg')) {
        // When pelvis changes (putting weight down / squatting), legs must flex naturally under load rather than forcing straight
        if (sl.straight && changedId !== 'pelvis') {
          L.ang = 0;
          setWorldDirExact(U, E.piv, sl.Udir, by);
        } else {
          solveLimbChain(c, sl.Epos, nodes, by, bondOn, wingPop, config, constrainLimits);
        }
      } else {
        setWorldDirExact(U, L.piv, sl.Udir, by);
      }
      const tipNode =
        E.id === 'footL'
          ? by.toeL
          : E.id === 'footR'
          ? by.toeR
          : E.id === 'handL'
          ? by.fingerTipL
          : by.fingerTipR;
      if (tipNode) {
        setWorldDirExact(E, tipNode.piv, sl.Edir, by);
      }
      solveRig(nodes, by, bondOn, wingPop);
    }
  }

  // Engage Muybridge contralateral arm-to-leg swing ONLY in 'moving' posture regime
  // while keeping pinned or directly dragged limbs locked out of interference.
  if (config.mode === 'balance' || regimeOpts?.regime === 'moving' || regimeOpts?.isKeyframedMotion) {
    const { regime } = inferPostureRegime({
      by,
      posFn: pos,
      explicitRegime: regimeOpts?.regime,
      rootVelocity: regimeOpts?.rootVelocity,
      isKeyframedMotion: regimeOpts?.isKeyframedMotion,
    });
    if (regime === 'moving') {
      const skipJoints = new Set<string>([changedId]);
      if (skipChainId) {
        const sc = LIMB_CHAINS.find((ch) => ch.id === skipChainId);
        if (sc) {
          skipJoints.add(sc.upper);
          skipJoints.add(sc.lower);
          skipJoints.add(sc.effector);
        }
      }
      if (
        applyMovingCounterBalance(by, pos, {
          constrainLimits,
          pins,
          lockedJoints: skipJoints,
          strideStrength: config.mode === 'balance' ? 0.58 : 0.42,
        })
      ) {
        solveRig(nodes, by, bondOn, wingPop);
        // Re-anchor any pinned chains so thorax counter-rotation never moves a pinned effector off its anchor
        for (const c of LIMB_CHAINS) {
          if (c.id === skipChainId) continue;
          if (changedId === c.upper || changedId === c.lower || changedId === c.effector) continue;
          if (isChainPinned(c) && pins[c.effector]) {
            solvePinnedChain(c);
          }
        }
      }
    }
  }
}

/**
 * Clamps pelvis so planted/pinned feet never slip beyond leg reach.
 */
export function clampPelvisToPlantedFeet(
  plantL: IKPinEntry | null,
  plantR: IKPinEntry | null,
  pullBiasX: number,
  nodes: RigNode[],
  by: Record<string, RigNode>,
  root: RigNode,
  bondOn: boolean,
  wingPop: number,
  groundY: number,
): void {
  if (!plantL && !plantR) return;
  const cL = LIMB_CHAINS[2]; // legL
  const cR = LIMB_CHAINS[3]; // legR
  const [L1L, L2L] = limbLengths(cL, by);
  const [L1R, L2R] = limbLengths(cR, by);
  const maxL = L1L + L2L - 4;
  const maxR = L1R + L2R - 4;

  const primary =
    plantL && plantR
      ? Math.abs(pullBiasX - plantL.pos[0]) <= Math.abs(pullBiasX - plantR.pos[0])
        ? 'L'
        : 'R'
      : plantL
      ? 'L'
      : 'R';

  const relaxStep = (plant: IKPinEntry | null, chain: LimbChainDef, maxLen: number, weight: number) => {
    if (!plant) return;
    solveRig(nodes, by, bondOn, wingPop);
    const H = pos(by[chain.upper], by);
    const vx = plant.pos[0] - H[0];
    const vy = plant.pos[1] - H[1];
    const d = Math.hypot(vx, vy) || 1;
    if (d > maxLen) {
      const ex = (d - maxLen) * weight;
      root.tx += (vx / d) * ex;
      root.ty += (vy / d) * ex;
    }
  };

  const sep = plantL && plantR ? Math.hypot(plantL.pos[0] - plantR.pos[0], plantL.pos[1] - plantR.pos[1]) : 0;
  const bothReachableMax = maxL + maxR - 420;

  for (let it = 0; it < 4; it++) {
    if (plantL && plantR && sep <= bothReachableMax) {
      relaxStep(plantL, cL, maxL, 0.55);
      relaxStep(plantR, cR, maxR, 0.55);
    } else if (plantL && plantR) {
      if (primary === 'L') {
        relaxStep(plantR, cR, maxR, 0.28);
        relaxStep(plantL, cL, maxL, 0.9);
      } else {
        relaxStep(plantL, cL, maxL, 0.28);
        relaxStep(plantR, cR, maxR, 0.9);
      }
    } else {
      relaxStep(plantL, cL, maxL, 1.0);
      relaxStep(plantR, cR, maxR, 1.0);
    }
  }

  solveRig(nodes, by, bondOn, wingPop);
  const hMaxY = Math.max(
    plantL && by.femurL ? pos(by.femurL, by)[1] : -1e9,
    plantR && by.femurR ? pos(by.femurR, by)[1] : -1e9,
  );
  if (hMaxY > groundY - 120) {
    root.ty -= hMaxY - (groundY - 120);
  }

  const pPlant = primary === 'L' ? plantL : plantR;
  const pChain = primary === 'L' ? cL : cR;
  const pMax = primary === 'L' ? maxL : maxR;
  if (pPlant) {
    solveRig(nodes, by, bondOn, wingPop);
    const H = pos(by[pChain.upper], by);
    const vx = pPlant.pos[0] - H[0];
    const vy = pPlant.pos[1] - H[1];
    const d = Math.hypot(vx, vy) || 1;
    if (d > pMax) {
      root.tx += (vx / d) * (d - pMax);
      root.ty += (vy / d) * (d - pMax);
    }
  }
  solveRig(nodes, by, bondOn, wingPop);
}

/**
 * Full-Body IK Drag Solver (Head, Neck, Thorax, Lumbar, Pelvis, Knees).
 * Uses FABRIK down the spine chain with planted-foot preservation + pelvis clamping.
 */
export interface FBIKDragBaseline {
  fbNodeId: string;
  q0: [number, number];
  fbPos0: [number, number];
  nodeAngs: Record<string, number>;
  rootTx: number;
  rootTy: number;
  wasGrounded: boolean;
  plantL: IKPinEntry | null;
  plantR: IKPinEntry | null;
  snap: PoseIKSnapshot;
  headDir0: number;
  shinDir0: number;
  footDir0: number;
}

function solveGroundedOrGravityLegs(
  pullBiasX: number,
  base: FBIKDragBaseline,
  nodes: RigNode[],
  by: Record<string, RigNode>,
  root: RigNode,
  bondOn: boolean,
  wingPop: number,
  config: IKConfig,
  constrainLimits: boolean,
): void {
  solveRig(nodes, by, bondOn, wingPop);

  if (base.wasGrounded) {
    clampPelvisToPlantedFeet(base.plantL, base.plantR, pullBiasX, nodes, by, root, bondOn, wingPop, config.groundY);
    if (base.plantL) {
      solveLimbChain(LIMB_CHAINS[2], base.plantL.pos, nodes, by, bondOn, wingPop, config, constrainLimits, 1);
      if (by.footL && by.toeL) setWorldDirExact(by.footL, by.toeL.piv, base.plantL.endDir, by);
    }
    if (base.plantR) {
      solveLimbChain(LIMB_CHAINS[3], base.plantR.pos, nodes, by, bondOn, wingPop, config, constrainLimits, -1);
      if (by.footR && by.toeR) setWorldDirExact(by.footR, by.toeR.piv, base.plantR.endDir, by);
    }
    enforceGroundContact(nodes, by, root, bondOn, wingPop, config.groundY, false);
    return;
  }

  if (config.footGravity) {
    // Even if feet started in the air, if lowering pelvis touches groundY, bend knees naturally instead of penetrating floor
    const fL = by.footL;
    const fR = by.footR;
    const pL = fL ? pos(fL, by) : null;
    const pR = fR ? pos(fR, by) : null;
    const hitL = !!(pL && pL[1] >= config.groundY - 4);
    const hitR = !!(pR && pR[1] >= config.groundY - 4);
    if (hitL || hitR) {
      const tempL: IKPinEntry | null = hitL && pL ? { pos: [pL[0], config.groundY], endDir: base.snap.limbs.legL?.Edir ?? 0, pinned: true } : null;
      const tempR: IKPinEntry | null = hitR && pR ? { pos: [pR[0], config.groundY], endDir: base.snap.limbs.legR?.Edir ?? 0, pinned: true } : null;
      clampPelvisToPlantedFeet(tempL, tempR, pullBiasX, nodes, by, root, bondOn, wingPop, config.groundY);
      if (tempL) {
        solveLimbChain(LIMB_CHAINS[2], tempL.pos, nodes, by, bondOn, wingPop, config, constrainLimits, 1);
        if (by.footL && by.toeL) setWorldDirExact(by.footL, by.toeL.piv, tempL.endDir, by);
      }
      if (tempR) {
        solveLimbChain(LIMB_CHAINS[3], tempR.pos, nodes, by, bondOn, wingPop, config, constrainLimits, -1);
        if (by.footR && by.toeR) setWorldDirExact(by.footR, by.toeR.piv, tempR.endDir, by);
      }
    }
    enforceGroundContact(nodes, by, root, bondOn, wingPop, config.groundY, false);
  }
}

export function captureFBIKBaseline(
  fbNode: RigNode,
  q0: [number, number],
  nodes: RigNode[],
  by: Record<string, RigNode>,
  root: RigNode,
  bondOn: boolean,
  wingPop: number,
  config: IKConfig,
  pins: Record<string, IKPinEntry>,
): FBIKDragBaseline {
  solveRig(nodes, by, bondOn, wingPop);
  const nodeAngs: Record<string, number> = {};
  nodes.forEach((n) => {
    nodeAngs[n.id] = n.ang;
  });

  const onL = isFootOnGround('footL', by, config.groundY) || !!pins.footL?.pinned || config.mode === 'pinFeet' || config.mode === 'pinAll' || config.mode === 'pinFull';
  const onR = isFootOnGround('footR', by, config.groundY) || !!pins.footR?.pinned || config.mode === 'pinFeet' || config.mode === 'pinAll' || config.mode === 'pinFull';
  const wasGrounded = config.footGravity ? onL || onR : (!!pins.footL?.pinned || !!pins.footR?.pinned);

  const footLNode = by.footL;
  const footRNode = by.footR;
  const toeLNode = by.toeL;
  const toeRNode = by.toeR;

  const plantL: IKPinEntry | null = onL && footLNode
    ? {
        pos: pins.footL?.pinned ? [...pins.footL.pos] : [pos(footLNode, by)[0], config.footGravity && isFootOnGround('footL', by, config.groundY) ? config.groundY : pos(footLNode, by)[1]],
        endDir: getWorldDir(footLNode, toeLNode ? toeLNode.piv : null, by),
        pinned: true,
      }
    : null;

  const plantR: IKPinEntry | null = onR && footRNode
    ? {
        pos: pins.footR?.pinned ? [...pins.footR.pos] : [pos(footRNode, by)[0], config.footGravity && isFootOnGround('footR', by, config.groundY) ? config.groundY : pos(footRNode, by)[1]],
        endDir: getWorldDir(footRNode, toeRNode ? toeRNode.piv : null, by),
        pinned: true,
      }
    : null;

  const headDir0 = by.head && by.chinTip ? getWorldDir(by.head, by.chinTip.piv, by) : 0;
  const isKnee = fbNode.id === 'shinL' || fbNode.id === 'shinR';
  const side = fbNode.id === 'shinL' ? 'L' : 'R';
  const shinNode = by['shin' + side];
  const footNode = by['foot' + side];
  const toeNode = by['toe' + side];

  return {
    fbNodeId: fbNode.id,
    q0: [q0[0], q0[1]],
    fbPos0: pos(fbNode, by),
    nodeAngs,
    rootTx: root.tx,
    rootTy: root.ty,
    wasGrounded,
    plantL,
    plantR,
    snap: capturePoseIKSnapshot(nodes, by, root, bondOn, wingPop),
    headDir0,
    shinDir0: isKnee && shinNode && footNode ? getWorldDir(shinNode, footNode.piv, by) : 0,
    footDir0: isKnee && footNode && toeNode ? getWorldDir(footNode, toeNode.piv, by) : 0,
  };
}

export function solveFullBodyIKDrag(
  q: [number, number],
  base: FBIKDragBaseline,
  nodes: RigNode[],
  by: Record<string, RigNode>,
  root: RigNode,
  bondOn: boolean,
  wingPop: number,
  config: IKConfig,
  pins: Record<string, IKPinEntry>,
  constrainLimits: boolean,
): string[] {
  // Restore baseline cleanly for drift-free iterative solving
  nodes.forEach((n) => {
    if (n.id in base.nodeAngs) n.ang = base.nodeAngs[n.id];
  });
  root.tx = base.rootTx;
  root.ty = base.rootTy;
  solveRig(nodes, by, bondOn, wingPop);

  const fnId = base.fbNodeId;
  const dx = q[0] - base.q0[0];
  const dy = q[1] - base.q0[1];

  // 1. Pelvis Drag: translate root while knees flex naturally on grounded/pinned feet (never snapping sideways)
  if (fnId === 'pelvis') {
    root.tx += dx;
    root.ty += dy;
    root.ang = clampAnatomicalAngle(
      root,
      (base.nodeAngs.pelvis ?? 0) + Math.max(-10, Math.min(10, dx * 0.008)),
      constrainLimits,
    );
    solveGroundedOrGravityLegs(q[0], base, nodes, by, root, bondOn, wingPop, config, constrainLimits);
    const dragVelocity: [number, number] = Math.abs(dx) >= 24 ? [dx * 0.1, dy * 0.1] : [0, 0];
    applyBalanceAndPins('pelvis', base.snap, nodes, by, bondOn, wingPop, config, pins, constrainLimits, null, {
      rootVelocity: dragVelocity,
    });
    return ['pelvis', 'femurL', 'shinL', 'footL', 'femurR', 'shinR', 'footR'];
  }

  // 1b. Lumbar Drag (directly above hips): unlocked weight shift & spine flexion WITHOUT 0-length pelvis->lumbar 90deg snap
  if (fnId === 'lumbar') {
    const lu = by.lumbar;
    if (lu && !lu.lock) {
      lu.ang = clampAnatomicalAngle(
        lu,
        (base.nodeAngs.lumbar ?? 0) + Math.max(-68, Math.min(68, dx * 0.044)),
        constrainLimits,
      );
    }
    root.tx += dx * 0.68;
    root.ty += dy * 0.86;
    root.ang = clampAnatomicalAngle(
      root,
      (base.nodeAngs.pelvis ?? 0) + Math.max(-14, Math.min(14, dx * 0.008)),
      constrainLimits,
    );
    solveGroundedOrGravityLegs(q[0], base, nodes, by, root, bondOn, wingPop, config, constrainLimits);
    applyBalanceAndPins('pelvis', base.snap, nodes, by, bondOn, wingPop, config, pins, constrainLimits);
    return ['pelvis', 'lumbar', 'femurL', 'shinL', 'footL', 'femurR', 'shinR', 'footR'];
  }

  // 2. Knee Drag (shinL / shinR): orient thigh toward knee target while keeping foot planted if grounded
  if (fnId === 'shinL' || fnId === 'shinR') {
    const side = fnId === 'shinL' ? 'L' : 'R';
    const otherSide = side === 'L' ? 'R' : 'L';
    const cDrag = LIMB_CHAINS.find((c) => c.id === 'leg' + side)!;
    const cOther = LIMB_CHAINS.find((c) => c.id === 'leg' + otherSide)!;
    const U = by[cDrag.upper];
    const L = by[cDrag.lower];
    const E = by[cDrag.effector];
    if (!U || !L || !E) return [];

    const plantSelf = side === 'L' ? base.plantL : base.plantR;
    const plantOther = side === 'L' ? base.plantR : base.plantL;
    const kneeTarget: [number, number] = [
      q[0],
      base.wasGrounded ? Math.min(config.groundY - 50, q[1]) : q[1],
    ];
    const [L1, L2] = limbLengths(cDrag, by);
    const H0 = pos(U, by);
    const hx = H0[0] - kneeTarget[0];
    const hy = H0[1] - kneeTarget[1];
    const dHK = Math.hypot(hx, hy) || 1;
    if (dHK > L1) {
      const excess = dHK - L1;
      root.tx += (-hx / dHK) * excess * 0.7;
      root.ty += (-hy / dHK) * excess * 0.7;
    }

    if (base.wasGrounded && plantOther) {
      clampPelvisToPlantedFeet(
        side === 'L' ? null : plantOther,
        side === 'R' ? null : plantOther,
        kneeTarget[0],
        nodes,
        by,
        root,
        bondOn,
        wingPop,
        config.groundY,
      );
    }

    solveRig(nodes, by, bondOn, wingPop);
    const HL = pos(U, by);
    if (plantSelf && base.wasGrounded) {
      const cross = (plantSelf.pos[0] - HL[0]) * (kneeTarget[1] - HL[1]) - (plantSelf.pos[1] - HL[1]) * (kneeTarget[0] - HL[0]);
      const bend = Math.abs(cross) > 40 ? Math.sign(cross) : cDrag.bendSign;
      solveLimbChain(cDrag, plantSelf.pos, nodes, by, bondOn, wingPop, config, constrainLimits, bend);
      const toeSelf = by['toe' + side];
      if (toeSelf) setWorldDirExact(E, toeSelf.piv, plantSelf.endDir, by);
    } else {
      setWorldDirExact(U, L.piv, Math.atan2(kneeTarget[1] - HL[1], kneeTarget[0] - HL[0]), by);
      U.ang = clampAnatomicalAngle(U, U.ang, constrainLimits);
      solveRig(nodes, by, bondOn, wingPop);
      const knActual = pos(L, by);
      const gravAng = Math.PI / 2;
      const dA = ((gravAng - base.shinDir0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      let targetShinDir = base.shinDir0 + dA * 0.65;
      if (base.wasGrounded && knActual[1] + L2 * Math.sin(targetShinDir) > config.groundY - 4) {
        const maxSin = Math.max(-0.98, Math.min(0.98, (config.groundY - 4 - knActual[1]) / (L2 || 1)));
        const sideFwd = Math.cos(targetShinDir) >= 0 ? 1 : -1;
        targetShinDir = Math.atan2(maxSin, sideFwd * Math.sqrt(Math.max(0.01, 1 - maxSin * maxSin)));
      }
      setWorldDirExact(L, E.piv, targetShinDir, by);
      L.ang = clampAnatomicalAngle(L, L.ang, constrainLimits);
      solveRig(nodes, by, bondOn, wingPop);
      const toeSelf = by['toe' + side];
      if (toeSelf) setWorldDirExact(E, toeSelf.piv, base.footDir0, by);
    }

    if (base.wasGrounded && plantOther) {
      const Eo = by[cOther.effector];
      const toeOther = by['toe' + otherSide];
      solveLimbChain(cOther, plantOther.pos, nodes, by, bondOn, wingPop, config, constrainLimits);
      if (Eo && toeOther) setWorldDirExact(Eo, toeOther.piv, plantOther.endDir, by);
    }
    solveRig(nodes, by, bondOn, wingPop);
    applyBalanceAndPins('pelvis', base.snap, nodes, by, bondOn, wingPop, config, pins, constrainLimits, cDrag.id);
    return [cDrag.upper, cDrag.lower, cDrag.effector];
  }

  // 3. Spine / Head FABRIK Chain Drag starting at lumbar (excludes 0-length pelvis->lumbar segment)
  // Uses delta from initial joint position so starting IK anywhere above the hips never jumps sideways
  const spineChain =
    fnId === 'head'
      ? ['lumbar', 'thorax', 'neck', 'head']
      : fnId === 'neck'
      ? ['lumbar', 'thorax', 'neck']
      : ['lumbar', 'thorax'];

  const fbTarget: [number, number] = [base.fbPos0[0] + dx, base.fbPos0[1] + dy];
  const shiftWeight = Math.max(0.05, Math.min(0.65, 1 - config.spineStiffness * 0.75));
  solveFABRIKChain(spineChain, fbTarget, nodes, by, bondOn, wingPop, config, constrainLimits, {
    softDamp: false,
    allowRootShift: true,
    rootShiftWeight: shiftWeight,
    rootNode: root,
  });

  solveGroundedOrGravityLegs(fbTarget[0], base, nodes, by, root, bondOn, wingPop, config, constrainLimits);
  applyBalanceAndPins('thorax', base.snap, nodes, by, bondOn, wingPop, config, pins, constrainLimits);
  solveRig(nodes, by, bondOn, wingPop);
  return spineChain;
}

export interface ActivePinEntry {
  id: string;
  pos: [number, number];
  endDir: number;
}

/**
 * Collects all currently active pin diamonds (manual effector pins + mode-pinned effectors).
 */
export function getActivePinEntries(
  config: IKConfig,
  pins: Record<string, IKPinEntry>,
  by: Record<string, RigNode>,
): ActivePinEntry[] {
  const out: ActivePinEntry[] = [];
  for (const id of EFFECTOR_IDS) {
    const modePinned =
      (config.mode === 'pinFeet' && (id === 'footL' || id === 'footR')) ||
      (config.mode === 'pinAll' && id !== 'head') ||
      config.mode === 'pinFull';
    if (!modePinned && !pins[id]?.pinned) continue;
    const pin = pins[id];
    const n = by[id];
    const pt = pin ? pin.pos : n ? pos(n, by) : null;
    if (!pt) continue;
    out.push({
      id,
      pos: [pt[0], pt[1]],
      endDir: pin?.endDir ?? 0,
    });
  }
  return out;
}

/**
 * Exact screen-pixel Euclidean distance from a world-space point to the rotated-square
 * pin diamond shape `{ |dx| + |dy| <= PIN_DIAMOND_RADIUS_PX * dpr }`.
 */
export function distToPinDiamondPx(
  jointWorld: [number, number],
  pinWorld: [number, number],
  z: number,
  dpr = 1,
): number {
  const safeZ = Math.max(0.001, safeFinite(z, 0.1));
  const safeDpr = Math.max(0.5, safeFinite(dpr, 1));
  const dx = Math.abs((jointWorld[0] - pinWorld[0]) * safeZ);
  const dy = Math.abs((jointWorld[1] - pinWorld[1]) * safeZ);
  const R = PIN_DIAMOND_RADIUS_PX * safeDpr;
  // Rotate 45° into square's axis-aligned coordinates
  const halfSide = R * Math.SQRT1_2;
  const u = (dx + dy) * Math.SQRT1_2;
  const v = Math.abs(dx - dy) * Math.SQRT1_2;
  const du = Math.max(0, u - halfSide);
  const dv = Math.max(0, v - halfSide);
  return Math.hypot(du, dv);
}

/**
 * Magnetically snaps an IK drag target onto any active pin diamond within `1.25×` the joint circle radius.
 */
export function snapTargetToNearestPin(
  targetWorld: [number, number],
  config: IKConfig,
  pins: Record<string, IKPinEntry>,
  by: Record<string, RigNode>,
  z: number,
  dpr = 1,
  excludePinId?: string,
): { snapped: boolean; target: [number, number]; pinId: string | null; distPx: number } {
  const activePins = getActivePinEntries(config, pins, by);
  const thresholdPx = PIN_MAGNETIC_SNAP_RADIUS_PX * Math.max(0.5, dpr);
  let bestPin: ActivePinEntry | null = null;
  let bestDistPx = Infinity;

  for (const pin of activePins) {
    if (excludePinId && pin.id === excludePinId) continue;
    const dPx = distToPinDiamondPx(targetWorld, pin.pos, z, dpr);
    if (dPx <= thresholdPx && dPx < bestDistPx) {
      bestDistPx = dPx;
      bestPin = pin;
    }
  }

  if (bestPin) {
    return {
      snapped: true,
      target: [bestPin.pos[0], bestPin.pos[1]],
      pinId: bestPin.id,
      distPx: bestDistPx,
    };
  }
  return {
    snapped: false,
    target: targetWorld,
    pinId: null,
    distPx: bestDistPx,
  };
}

export interface MagneticJointSnapHit {
  jointId: string;
  pinId: string;
  pinPos: [number, number];
}

/**
 * Magnetically snaps all non-locked joints that fall within a `1.25×` joint circle radius
 * (`15 * dpr` px) of any active pin diamond shape onto that pin.
 */
export function snapJointsWithinMagneticPinRadius(
  nodes: RigNode[],
  by: Record<string, RigNode>,
  _root: RigNode,
  bondOn: boolean,
  wingPop: number,
  config: IKConfig,
  pins: Record<string, IKPinEntry>,
  constrainLimits: boolean,
  cam: { z: number; dpr: number },
  opts?: {
    excludeJointIds?: ReadonlySet<string>;
    excludePinId?: string;
    onlyJointIds?: ReadonlySet<string>;
  },
): MagneticJointSnapHit[] {
  const activePins = getActivePinEntries(config, pins, by);
  if (!activePins.length) return [];

  solveRig(nodes, by, bondOn, wingPop);
  const thresholdPx = PIN_MAGNETIC_SNAP_RADIUS_PX * Math.max(0.5, cam.dpr);
  const hits: MagneticJointSnapHit[] = [];

  for (const n of nodes) {
    if (n.ghost || n.id === 'pelvis' || n.id === 'wingL' || n.id === 'wingR' || n.id.startsWith('swivelTip')) {
      continue;
    }
    if (opts?.excludeJointIds?.has(n.id)) continue;
    if (opts?.onlyJointIds && !opts.onlyJointIds.has(n.id)) continue;

    const jp = pos(n, by);
    let bestPin: ActivePinEntry | null = null;
    let bestDistPx = Infinity;
    for (const pin of activePins) {
      if (opts?.excludePinId && pin.id === opts.excludePinId) continue;
      if (pin.id === n.id) {
        // An effector already owned by its own pin uses snapTargetToNearestPin during drag; still allow post-release alignment
      }
      const dPx = distToPinDiamondPx(jp, pin.pos, cam.z, cam.dpr);
      if (dPx <= thresholdPx && dPx < bestDistPx) {
        bestDistPx = dPx;
        bestPin = pin;
      }
    }
    if (!bestPin) continue;

    const worldDist = Math.hypot(bestPin.pos[0] - jp[0], bestPin.pos[1] - jp[1]);
    if (worldDist <= 0.6) {
      hits.push({ jointId: n.id, pinId: bestPin.id, pinPos: bestPin.pos });
      continue;
    }

    const effChain = findLimbChainForNode(n.id);
    if (effChain && effChain.effector === n.id) {
      solveLimbChain(effChain, bestPin.pos, nodes, by, bondOn, wingPop, config, constrainLimits, 0, false);
      solveRig(nodes, by, bondOn, wingPop);
      hits.push({ jointId: n.id, pinId: bestPin.id, pinPos: bestPin.pos });
      continue;
    }

    const lowerChain = LIMB_CHAINS.find((c) => c.lower === n.id);
    if (lowerChain) {
      const U = by[lowerChain.upper];
      if (U && !U.lock) {
        const upPos = pos(U, by);
        const dir = Math.atan2(bestPin.pos[1] - upPos[1], bestPin.pos[0] - upPos[0]);
        setWorldDirExact(U, n.piv, dir, by);
        U.ang = clampAnatomicalAngle(U, U.ang, constrainLimits);
        solveRig(nodes, by, bondOn, wingPop);
        hits.push({ jointId: n.id, pinId: bestPin.id, pinPos: bestPin.pos });
      }
      continue;
    }

    if (n.id === 'head' || n.id === 'neck' || n.id === 'thorax') {
      const subChain =
        n.id === 'head'
          ? ['lumbar', 'thorax', 'neck', 'head']
          : n.id === 'neck'
          ? ['lumbar', 'thorax', 'neck']
          : ['lumbar', 'thorax'];
      solveFABRIKChain(subChain, bestPin.pos, nodes, by, bondOn, wingPop, config, constrainLimits, {
        softDamp: false,
      });
      solveRig(nodes, by, bondOn, wingPop);
      hits.push({ jointId: n.id, pinId: bestPin.id, pinPos: bestPin.pos });
      continue;
    }

    if (n.parent && by[n.parent] && !by[n.parent].lock) {
      const par = by[n.parent];
      const parPos = pos(par, by);
      const d = Math.hypot(bestPin.pos[0] - parPos[0], bestPin.pos[1] - parPos[1]);
      if (d > VECTOR_EPSILON_PX) {
        setWorldDirExact(par, n.piv, Math.atan2(bestPin.pos[1] - parPos[1], bestPin.pos[0] - parPos[0]), by);
        par.ang = clampRealisticShoulder(par, clampAnatomicalAngle(par, par.ang, constrainLimits), by, wingPop > 0.05);
        solveRig(nodes, by, bondOn, wingPop);
        hits.push({ jointId: n.id, pinId: bestPin.id, pinPos: bestPin.pos });
      }
    }
  }
  return hits;
}

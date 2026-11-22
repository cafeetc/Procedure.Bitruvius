import {
  CANONICAL_PROPORTIONS,
  clampJointAngle,
  safeFinite,
  snapAngularEpsilon,
  VECTOR_EPSILON_PX,
} from './jointLimits';
import type { JointId } from './motionFormat';
import { CONTRALATERAL_LIMB_PAIRS } from './rigRoles';
import type { IKMode, IKPinEntry, PerspectiveState, RigNode } from './types';

export type SolverMode = IKMode;
export type PostureRegime = 'standing' | 'moving';

export interface SpatialEnvironment {
  groundY: number;
  horizonY: number;
  vpX: number;
  floorScale: number;
}

export const ANKLE_REST_Y = 7013.5;
export const FOOT_SOLE_HEIGHT_PX = 500;
export const DEFAULT_GROUND_Y = ANKLE_REST_Y + FOOT_SOLE_HEIGHT_PX; // 7513.5 — exact bottom of collapsed sole
export const GROUND_TOL = 46;

export const DEFAULT_SPATIAL_ENV: PerspectiveState = {
  enabled: true,
  groundY: DEFAULT_GROUND_Y,
  horizonY: 3170,
  vpX: 1257,
  floorScale: 420,
};

export interface LocomotionDiagnostics {
  regime: PostureRegime;
  strideAsymmetryDeg: number;
  hipSplayDeg: number;
  legSplayDropPx: number;
  armSpanToHeightRatio: number;
  naturalArmReachPx: number;
  stanceSide: 'L' | 'R' | 'balanced';
}

export type FootContactMode = 'airborne' | 'flat' | 'heel' | 'toeBall';

export interface FootAnkleAwareness {
  side: 'L' | 'R';
  ankle: [number, number];
  heel: [number, number];
  ball: [number, number];
  toe: [number, number];
  soleMaxY: number;
  midX: number;
  ankleHeightAboveFloor: number;
  heelLiftPx: number;
  toeDorsiflexDeg: number;
  grounded: boolean;
  contactMode: FootContactMode;
  supportSpanX: [number, number];
}

export interface PoseCenterOfGravity {
  cog: [number, number];
  plumbGroundX: number;
  supportLeftX: number;
  supportRightX: number;
  supportCenterX: number;
  hasSupport: boolean;
  stabilityOffsetPx: number;
  isBalanced: boolean;
  weightShareL: number;
  weightShareR: number;
  cogHeightAboveFloor: number;
  kneeBendDeg: number;
  feet: {
    L: FootAnkleAwareness;
    R: FootAnkleAwareness;
  };
}

export type PosReader = (n: RigNode, map: Record<string, RigNode>) => [number, number];

function dist2(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const d = Math.hypot(dx, dy);
  return d > VECTOR_EPSILON_PX ? d : 0;
}

function transformLocal(w: Float64Array | number[], lx: number, ly: number): [number, number] {
  return [
    safeFinite(w[0] * lx + w[2] * ly + w[4], lx),
    safeFinite(w[1] * lx + w[3] * ly + w[5], ly),
  ];
}

/**
 * Evaluates full Heel-Ankle-Ball-Toe geometry & ground awareness for one foot.
 * Accounts for foot roll (plantarflexion/dorsiflexion) and MTP toe-break dorsiflexion:
 * when toes stay braced against the floor plane and the heel lifts, the ankle pivot rises cleanly.
 */
export function evaluateFootAnkleAwareness(
  f: RigNode,
  by: Record<string, RigNode>,
  groundY = DEFAULT_GROUND_Y,
  toeBreakDegOverride?: number,
): FootAnkleAwareness {
  const side: 'L' | 'R' = f.id === 'footL' ? 'L' : 'R';
  const sideSign = side === 'L' ? 1 : -1;
  const ankle = [
    safeFinite(f.w[0] * f.piv[0] + f.w[2] * f.piv[1] + f.w[4], f.piv[0]),
    safeFinite(f.w[1] * f.piv[0] + f.w[3] * f.piv[1] + f.w[5], f.piv[1]),
  ] as [number, number];

  const toeNode = by[side === 'L' ? 'toeL' : 'toeR'];
  // Measure plantarflexion lift from foot angle if no explicit toeBreak supplied
  const inferredLift = Math.max(0, side === 'R' ? -f.ang : f.ang);
  const toeDorsiflexDeg = Math.max(
    -15,
    Math.min(68, toeBreakDegOverride !== undefined ? toeBreakDegOverride : Math.min(58, inferredLift * 0.95)),
  );

  const ax = f.piv[0];
  const ay = f.piv[1];
  const heelLocal: [number, number] = [ax - sideSign * 145, ay + 470];
  const ballLocal: [number, number] = [ax + sideSign * 425, ay + 500];

  // Rotate distal toe phalanges around MTP ball joint opposite plantarflexion so toes hug ground plane
  const breakRad = (toeDorsiflexDeg * Math.PI) / 180;
  const bc = Math.cos(-sideSign * breakRad);
  const bs = Math.sin(-sideSign * breakRad);
  const rawToeDx = sideSign * 215;
  const rawToeDy = -12;
  const tipLocal: [number, number] = [
    ballLocal[0] + bc * rawToeDx - bs * rawToeDy,
    ballLocal[1] + bs * rawToeDx + bc * rawToeDy,
  ];

  const heel = transformLocal(f.w, heelLocal[0], heelLocal[1]);
  const ball = transformLocal(f.w, ballLocal[0], ballLocal[1]);
  const toe = toeNode && (!toeBreakDegOverride && Math.abs(toeDorsiflexDeg) < 1)
    ? transformLocal(f.w, tipLocal[0], tipLocal[1])
    : transformLocal(f.w, tipLocal[0], tipLocal[1]);

  const soleMaxY = Math.max(heel[1], ball[1], toe[1]);
  const grounded = Math.abs(soleMaxY - groundY) <= GROUND_TOL;
  const ankleHeightAboveFloor = groundY - ankle[1];
  const ballOrToeY = Math.max(ball[1], toe[1]);
  const heelLiftPx = Math.max(0, ballOrToeY - heel[1]);

  let contactMode: FootContactMode = 'airborne';
  let spanMin = Math.min(heel[0], ball[0], toe[0]);
  let spanMax = Math.max(heel[0], ball[0], toe[0]);

  if (grounded) {
    const heelNear = Math.abs(heel[1] - soleMaxY) <= GROUND_TOL * 1.1;
    const foreNear = Math.abs(ballOrToeY - soleMaxY) <= GROUND_TOL * 1.1;
    if (heelNear && foreNear) {
      contactMode = 'flat';
    } else if (foreNear) {
      contactMode = 'toeBall';
      spanMin = Math.min(ball[0], toe[0]);
      spanMax = Math.max(ball[0], toe[0]);
    } else {
      contactMode = 'heel';
      spanMin = Math.min(heel[0], ankle[0]);
      spanMax = Math.max(heel[0], ankle[0]);
    }
  }

  const midX =
    contactMode === 'toeBall'
      ? ball[0] * 0.65 + toe[0] * 0.35
      : contactMode === 'heel'
      ? heel[0]
      : heel[0] * 0.42 + ball[0] * 0.58;

  return {
    side,
    ankle,
    heel,
    ball,
    toe,
    soleMaxY,
    midX,
    ankleHeightAboveFloor,
    heelLiftPx,
    toeDorsiflexDeg,
    grounded,
    contactMode,
    supportSpanX: [Math.min(spanMin, spanMax), Math.max(spanMin, spanMax)],
  };
}

/**
 * Computes true biomechanical whole-body Center of Gravity (CoG) from live joint positions
 * weighted by anatomical segment mass proportions, plus Base-of-Support & Ankle awareness.
 */
export function computePoseCenterOfGravity(
  by: Record<string, RigNode>,
  posFn: PosReader,
  groundY = DEFAULT_GROUND_Y,
  footToeBreak?: { R?: number; L?: number },
): PoseCenterOfGravity {
  const get = (id: string): [number, number] | null => (by[id] ? posFn(by[id], by) : null);
  const lerpPt = (a: [number, number] | null, b: [number, number] | null, t: number): [number, number] | null =>
    a && b ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] : a ?? b;

  const pPel = get('pelvis') ?? [1257, 3382];
  const pLum = get('lumbar') ?? pPel;
  const pThx = get('thorax') ?? [1257, 2100];
  const pNck = get('neck') ?? [1257, 862];
  const pHd = get('head') ?? [1257, 595];

  const segments: Array<{ pt: [number, number] | null; weight: number }> = [
    { pt: pPel, weight: 0.14 },
    { pt: lerpPt(pLum, pThx, 0.5), weight: 0.14 },
    { pt: lerpPt(pThx, pNck, 0.42), weight: 0.21 },
    { pt: lerpPt(pNck, pHd, 0.72), weight: 0.082 },
    { pt: lerpPt(get('humerusL'), get('forearmL'), 0.45), weight: 0.028 },
    { pt: lerpPt(get('humerusR'), get('forearmR'), 0.45), weight: 0.028 },
    { pt: lerpPt(get('forearmL'), get('handL'), 0.52), weight: 0.022 },
    { pt: lerpPt(get('forearmR'), get('handR'), 0.52), weight: 0.022 },
    { pt: lerpPt(get('femurL'), get('shinL'), 0.44), weight: 0.10 },
    { pt: lerpPt(get('femurR'), get('shinR'), 0.44), weight: 0.10 },
    { pt: lerpPt(get('shinL'), get('footL'), 0.44), weight: 0.047 },
    { pt: lerpPt(get('shinR'), get('footR'), 0.44), weight: 0.047 },
    { pt: get('footL'), weight: 0.017 },
    { pt: get('footR'), weight: 0.017 },
  ];

  let sumX = 0;
  let sumY = 0;
  let totalW = 0;
  for (const s of segments) {
    if (!s.pt || !Number.isFinite(s.pt[0]) || !Number.isFinite(s.pt[1])) continue;
    sumX += s.pt[0] * s.weight;
    sumY += s.pt[1] * s.weight;
    totalW += s.weight;
  }

  const cog: [number, number] =
    totalW > 1e-4 ? [sumX / totalW, sumY / totalW] : [pPel[0], pPel[1] - 420];

  const fallbackFoot = (side: 'L' | 'R'): FootAnkleAwareness => ({
    side,
    ankle: [side === 'L' ? 1658 : 833, ANKLE_REST_Y],
    heel: [side === 'L' ? 1513 : 978, DEFAULT_GROUND_Y - 30],
    ball: [side === 'L' ? 2083 : 408, DEFAULT_GROUND_Y],
    toe: [side === 'L' ? 2298 : 193, DEFAULT_GROUND_Y - 12],
    soleMaxY: DEFAULT_GROUND_Y,
    midX: side === 'L' ? 1840 : 650,
    ankleHeightAboveFloor: FOOT_SOLE_HEIGHT_PX,
    heelLiftPx: 0,
    toeDorsiflexDeg: 0,
    grounded: true,
    contactMode: 'flat',
    supportSpanX: side === 'L' ? [1513, 2298] : [193, 978],
  });

  const footL = by.footL
    ? evaluateFootAnkleAwareness(by.footL, by, groundY, footToeBreak?.L)
    : fallbackFoot('L');
  const footR = by.footR
    ? evaluateFootAnkleAwareness(by.footR, by, groundY, footToeBreak?.R)
    : fallbackFoot('R');

  const groundedFeet = [footL, footR].filter((ft) => ft.grounded);
  const hasSupport = groundedFeet.length > 0;
  let supportLeftX = Math.min(footL.supportSpanX[0], footR.supportSpanX[0]);
  let supportRightX = Math.max(footL.supportSpanX[1], footR.supportSpanX[1]);
  let supportCenterX = (footL.midX + footR.midX) * 0.5;

  if (groundedFeet.length === 1) {
    supportLeftX = groundedFeet[0].supportSpanX[0];
    supportRightX = groundedFeet[0].supportSpanX[1];
    supportCenterX = groundedFeet[0].midX;
  } else if (groundedFeet.length === 2) {
    supportLeftX = Math.min(footL.supportSpanX[0], footR.supportSpanX[0]);
    supportRightX = Math.max(footL.supportSpanX[1], footR.supportSpanX[1]);
    supportCenterX = (footL.midX + footR.midX) * 0.5;
  }

  const stabilityOffsetPx = cog[0] - supportCenterX;
  const isBalanced =
    hasSupport && cog[0] >= supportLeftX - 45 && cog[0] <= supportRightX + 45;

  // Weight share L vs R across foot midpoints
  const spanLR = footL.midX - footR.midX;
  let weightShareL = 0.5;
  if (groundedFeet.length === 1) {
    weightShareL = groundedFeet[0].side === 'L' ? 0.92 : 0.08;
  } else if (Math.abs(spanLR) > 40) {
    weightShareL = Math.max(0.05, Math.min(0.95, (cog[0] - footR.midX) / spanLR));
  }
  const weightShareR = 1 - weightShareL;

  const kneeBendDeg = Math.max(
    Math.abs(by.shinL?.ang ?? 0),
    Math.abs(by.shinR?.ang ?? 0),
  );

  return {
    cog,
    plumbGroundX: cog[0],
    supportLeftX,
    supportRightX,
    supportCenterX,
    hasSupport,
    stabilityOffsetPx,
    isBalanced,
    weightShareL,
    weightShareR,
    cogHeightAboveFloor: groundY - cog[1],
    kneeBendDeg,
    feet: { L: footL, R: footR },
  };
}

/**
 * Computes canonical Vitruvian & Leonardo da Vinci proportional metrics from the
 * live solved rig (arm span vs. height, limb segment lengths, leg-splay 1/14 height drop).
 */
export function computeCanonicalProportionMetrics(
  by: Record<string, RigNode>,
  posFn: PosReader,
): {
  standingHeightPx: number;
  armSpanPx: number;
  armSpanToHeightRatio: number;
  armMaxReachPx: number;
  legMaxReachPx: number;
  hipSplayDeg: number;
  legSplayDropPx: number;
} {
  const headP = by.head ? posFn(by.head, by) : ([1257, 595.5] as [number, number]);
  const footLP = by.footL ? posFn(by.footL, by) : ([1658, ANKLE_REST_Y] as [number, number]);
  const footRP = by.footR ? posFn(by.footR, by) : ([833, ANKLE_REST_Y] as [number, number]);
  const crownY = headP[1] - 580;
  const soleY = Math.max(footLP[1], footRP[1]) + FOOT_SOLE_HEIGHT_PX;
  const standingHeightPx = Math.max(2400, safeFinite(soleY - crownY, 7900));

  const humLP = by.humerusL ? posFn(by.humerusL, by) : null;
  const forLP = by.forearmL ? posFn(by.forearmL, by) : null;
  const handLP = by.handL ? posFn(by.handL, by) : null;
  const humRP = by.humerusR ? posFn(by.humerusR, by) : null;
  const forRP = by.forearmR ? posFn(by.forearmR, by) : null;
  const handRP = by.handR ? posFn(by.handR, by) : null;

  const armReachL =
    humLP && forLP && handLP
      ? dist2(humLP, forLP) + dist2(forLP, handLP) + standingHeightPx * CANONICAL_PROPORTIONS.vitruvius.handToHeight
      : standingHeightPx * (CANONICAL_PROPORTIONS.leonardo.upperArmToHeight + CANONICAL_PROPORTIONS.leonardo.forearmHandToHeight);
  const armReachR =
    humRP && forRP && handRP
      ? dist2(humRP, forRP) + dist2(forRP, handRP) + standingHeightPx * CANONICAL_PROPORTIONS.vitruvius.handToHeight
      : armReachL;
  const armMaxReachPx = Math.max(1200, (armReachL + armReachR) * 0.5);

  const femLP = by.femurL ? posFn(by.femurL, by) : null;
  const femRP = by.femurR ? posFn(by.femurR, by) : null;
  const shLP = by.shinL ? posFn(by.shinL, by) : null;
  const legMaxReachPx =
    femLP && shLP
      ? dist2(femLP, shLP) + dist2(shLP, footLP)
      : standingHeightPx * (CANONICAL_PROPORTIONS.vitruvius.thighToHeight + CANONICAL_PROPORTIONS.vitruvius.lowerLegToHeight);

  const shoulderSpan = humLP && humRP ? dist2(humLP, humRP) : standingHeightPx * 0.175;
  const armSpanPx = shoulderSpan + armReachL + armReachR;
  const armSpanToHeightRatio = armSpanPx / standingHeightPx;

  let halfSplayRad = 0;
  if (femLP && femRP) {
    const dirL = Math.atan2(footLP[0] - femLP[0], Math.max(VECTOR_EPSILON_PX, footLP[1] - femLP[1]));
    const dirR = Math.atan2(femRP[0] - footRP[0], Math.max(VECTOR_EPSILON_PX, footRP[1] - footRP[1] || footRP[1] - femRP[1]));
    const outwardL = Math.max(0, dirL);
    const outwardR = Math.max(0, dirR);
    halfSplayRad = Math.min(Math.PI * 0.44, (outwardL + outwardR) * 0.5);
  }
  const hipSplayDeg = snapAngularEpsilon((halfSplayRad * 2 * 180) / Math.PI);
  const eqHalfRad = (CANONICAL_PROPORTIONS.leonardo.equilateralSplayHalfDeg * Math.PI) / 180;
  const cosDiffEq = Math.max(1e-4, 1 - Math.cos(eqHalfRad));
  const cosDiffCur = Math.max(0, 1 - Math.cos(halfSplayRad));
  const normalizedSplay = Math.min(1.25, cosDiffCur / cosDiffEq);
  const legSplayDropPx =
    standingHeightPx * CANONICAL_PROPORTIONS.leonardo.legSplayHeightDrop * normalizedSplay;

  return {
    standingHeightPx,
    armSpanPx,
    armSpanToHeightRatio,
    armMaxReachPx,
    legMaxReachPx,
    hipSplayDeg,
    legSplayDropPx,
  };
}

/**
 * Classifies whether the puppet is in a static Standing pose or an active Moving locomotion regime.
 */
export function inferPostureRegime(options: {
  by: Record<string, RigNode>;
  posFn: PosReader;
  explicitRegime?: PostureRegime;
  rootVelocity?: [number, number];
  isKeyframedMotion?: boolean;
}): { regime: PostureRegime; strideAsymmetryDeg: number } {
  const femL = options.by.femurL;
  const shinL = options.by.shinL;
  const femR = options.by.femurR;
  const shinR = options.by.shinR;
  let strideAsymmetryDeg = 0;
  if (femL && shinL && femR && shinR) {
    const pFL = options.posFn(femL, options.by);
    const pSL = options.posFn(shinL, options.by);
    const pFR = options.posFn(femR, options.by);
    const pSR = options.posFn(shinR, options.by);
    const aL = Math.atan2(pSL[0] - pFL[0], pSL[1] - pFL[1]);
    const aR = Math.atan2(pSR[0] - pFR[0], pSR[1] - pFR[1]);
    strideAsymmetryDeg = Math.abs(((aL - aR) * 180) / Math.PI);
  }

  if (options.explicitRegime) {
    return { regime: options.explicitRegime, strideAsymmetryDeg };
  }
  const speed = options.rootVelocity
    ? Math.hypot(safeFinite(options.rootVelocity[0]), safeFinite(options.rootVelocity[1]))
    : 0;
  const movingByVel = speed >= CANONICAL_PROPORTIONS.muybridge.movingVelocityThresholdPx;
  const movingByStride =
    !!options.isKeyframedMotion &&
    strideAsymmetryDeg >= CANONICAL_PROPORTIONS.muybridge.movingStrideAngleThresholdDeg;

  return {
    regime: movingByVel || movingByStride ? 'moving' : 'standing',
    strideAsymmetryDeg,
  };
}

/**
 * Muybridge-grounded moving-regime contralateral arm-to-leg counter-swing and gentle
 * torso counter-rotation.
 */
export function applyMovingCounterBalance(
  by: Record<string, RigNode>,
  posFn: PosReader,
  options: {
    constrainLimits: boolean;
    strideStrength?: number;
    pins?: Record<string, IKPinEntry>;
    lockedJoints?: ReadonlySet<string>;
  },
): boolean {
  const femL = by.femurL;
  const shinL = by.shinL;
  const femR = by.femurR;
  const shinR = by.shinR;
  if (!femL || !shinL || !femR || !shinR) return false;

  const pFL = posFn(femL, by);
  const pSL = posFn(shinL, by);
  const pFR = posFn(femR, by);
  const pSR = posFn(shinR, by);
  const legSwingL = (Math.atan2(pSL[0] - pFL[0], Math.max(VECTOR_EPSILON_PX, pSL[1] - pFL[1])) * 180) / Math.PI;
  const legSwingR = (Math.atan2(pSR[0] - pFR[0], Math.max(VECTOR_EPSILON_PX, pSR[1] - pFR[1])) * 180) / Math.PI;
  const strideDiff = legSwingR - legSwingL;
  if (Math.abs(strideDiff) < 1.5) return false;

  const strength = Math.max(0, Math.min(1, safeFinite(options.strideStrength ?? 0.55, 0.55)));
  const coupling = CANONICAL_PROPORTIONS.muybridge.contralateralArmLegCoupling * strength;
  const elbowFollow = CANONICAL_PROPORTIONS.muybridge.forearmSwingFollow * strength;
  let changed = false;

  for (const pair of CONTRALATERAL_LIMB_PAIRS) {
    const legSwing = pair.legSide === 'R' ? legSwingR : legSwingL;
    const armPinned = !!(options.pins?.[pair.armSide === 'L' ? 'handL' : 'handR']?.pinned);
    const armLocked =
      !!options.lockedJoints?.has(pair.humerus) ||
      !!options.lockedJoints?.has(pair.forearm);
    if (armPinned || armLocked) continue;

    const hum = by[pair.humerus];
    const fore = by[pair.forearm];
    if (hum && !hum.lock) {
      const armSign = pair.armSide === 'L' ? -1 : 1;
      const targetBias = snapAngularEpsilon(legSwing * coupling * armSign);
      const next = clampJointAngle(hum.id, hum.ang + (targetBias - hum.ang) * 0.32 * strength, options.constrainLimits);
      if (Math.abs(next - hum.ang) > 0.05) {
        hum.ang = next;
        changed = true;
      }
    }
    if (fore && !fore.lock) {
      const foreBendSign = pair.armSide === 'L' ? -1 : 1;
      const flexAmt = Math.max(0, Math.abs(legSwing) * elbowFollow);
      const nextFore = clampJointAngle(
        fore.id,
        fore.ang + (flexAmt * foreBendSign - fore.ang) * 0.25 * strength,
        options.constrainLimits,
      );
      if (Math.abs(nextFore - fore.ang) > 0.05) {
        fore.ang = nextFore;
        changed = true;
      }
    }
  }

  const thorax = by.thorax;
  if (thorax && !thorax.lock && !options.lockedJoints?.has('thorax')) {
    const counter = snapAngularEpsilon(-strideDiff * CANONICAL_PROPORTIONS.muybridge.spineCounterRotationGain * strength);
    const nextTx = clampJointAngle('thorax', thorax.ang + (counter - thorax.ang) * 0.2, options.constrainLimits);
    if (Math.abs(nextTx - thorax.ang) > 0.05) {
      thorax.ang = nextTx;
      changed = true;
    }
  }

  return changed;
}

export function getPinnedJoints(
  mode: SolverMode,
  customPins?: Record<string, IKPinEntry>,
): JointId[] {
  const pinned = new Set<JointId>();
  if (mode === 'pinFeet') {
    pinned.add('footL');
    pinned.add('footR');
  } else if (mode === 'pinAll') {
    pinned.add('footL');
    pinned.add('footR');
    pinned.add('handL');
    pinned.add('handR');
  } else if (mode === 'pinFull') {
    pinned.add('footL');
    pinned.add('footR');
    pinned.add('handL');
    pinned.add('handR');
    pinned.add('head');
  }
  if (customPins) {
    for (const [id, entry] of Object.entries(customPins)) {
      if (entry?.pinned) pinned.add(id as JointId);
    }
  }
  return Array.from(pinned);
}

/**
 * Computes average horizontal support center across Heel/Ball/Toe grounded spans.
 */
export function computeSupportCenterX(
  by: Record<string, RigNode>,
  _posFn: PosReader,
  groundY: number,
  pins?: Record<string, IKPinEntry>,
  footToeBreak?: { R?: number; L?: number },
): number | null {
  const xs: number[] = [];
  for (const id of ['footL', 'footR'] as const) {
    const fn = by[id];
    if (!fn) continue;
    const tb = id === 'footL' ? footToeBreak?.L : footToeBreak?.R;
    const info = evaluateFootAnkleAwareness(fn, by, groundY, tb);
    if (pins?.[id]?.pinned || info.grounded) {
      xs.push(info.midX);
    }
  }
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Enforces floor contact using true Heel–Ball–Toe sole contact (not just ankle pivot),
 * raising ankles when toes dorsiflex under heel lift and shifting CoG over grounded support.
 */
export function applyGroundAndBalance(
  nodes: RigNode[],
  by: Record<string, RigNode>,
  root: RigNode,
  env: Pick<SpatialEnvironment, 'groundY'>,
  mode: SolverMode,
  solveFn: (n: RigNode[], b: Record<string, RigNode>, bondOn: boolean, wingPop: number) => void,
  posFn: PosReader,
  bondOn: boolean,
  wingPop: number,
  options?: {
    pullDownToo?: boolean;
    balanceWeight?: number;
    pins?: Record<string, IKPinEntry>;
    regime?: PostureRegime;
    rootVelocity?: [number, number];
    isKeyframedMotion?: boolean;
    constrainLimits?: boolean;
    lockedJoints?: ReadonlySet<string>;
    footToeBreak?: { R?: number; L?: number };
  },
): boolean {
  solveFn(nodes, by, bondOn, wingPop);

  let maxSoleY = -1e9;
  for (const id of ['footL', 'footR'] as const) {
    const fn = by[id];
    if (!fn) continue;
    const tb = id === 'footL' ? options?.footToeBreak?.L : options?.footToeBreak?.R;
    const info = evaluateFootAnkleAwareness(fn, by, env.groundY, tb);
    maxSoleY = Math.max(maxSoleY, info.soleMaxY);
  }
  if (maxSoleY < -1e8) return false;

  const { regime } = inferPostureRegime({
    by,
    posFn,
    explicitRegime: options?.regime,
    rootVelocity: options?.rootVelocity,
    isKeyframedMotion: options?.isKeyframedMotion,
  });

  const metrics = computeCanonicalProportionMetrics(by, posFn);
  let adjusted = false;
  const diffY = env.groundY - maxSoleY;
  const splayFloorWindow = Math.max(GROUND_TOL, metrics.legSplayDropPx + GROUND_TOL);
  const shouldPullToFloor =
    !!options?.pullDownToo ||
    (regime === 'standing' &&
      metrics.hipSplayDeg >= 8 &&
      diffY > 0.5 &&
      diffY <= splayFloorWindow);
  if (diffY < -0.5 || (shouldPullToFloor && diffY > 0.5)) {
    root.ty = safeFinite(root.ty + diffY, root.ty);
    adjusted = true;
  }

  if (regime === 'moving') {
    const swung = applyMovingCounterBalance(by, posFn, {
      constrainLimits: !!options?.constrainLimits,
      pins: options?.pins,
      lockedJoints: options?.lockedJoints,
      strideStrength: mode === 'balance' ? 0.65 : 0.42,
    });
    if (swung) adjusted = true;
  }

  if ((mode === 'balance' || regime === 'moving') && (options?.balanceWeight ?? 0) > 0) {
    solveFn(nodes, by, bondOn, wingPop);
    const supportX = computeSupportCenterX(by, posFn, env.groundY, options?.pins, options?.footToeBreak);
    if (supportX !== null) {
      const cog = computePoseCenterOfGravity(by, posFn, env.groundY, options?.footToeBreak).cog;
      const w = Math.max(0, Math.min(0.4, safeFinite(options?.balanceWeight ?? 0, 0)));
      const shiftX = (supportX - cog[0]) * w;
      if (Math.abs(shiftX) > 0.5) {
        root.tx = safeFinite(root.tx + shiftX, root.tx);
        adjusted = true;
      }
    }
  }

  if (adjusted) solveFn(nodes, by, bondOn, wingPop);
  return adjusted;
}

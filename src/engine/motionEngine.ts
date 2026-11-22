import {
  type RibAnchorMode,
  clampAnatomicalAngle,
  clampChungusRibAngle,
  clampRealisticShoulder,
  normalizeDeg,
  pos,
  solveRig,
} from './fkEngine';
import { cloneGotzState, lerpGotzHandState } from './gotzHandEngine';
import { applyGroundAndBalance, inferPostureRegime } from './groundSystem';
import { CANONICAL_PROPORTIONS } from './jointLimits';
import {
  HEAD_TURN_SEQUENCE,
  type HeadTurnSpec,
  applyHeadTurnStep,
  inferHeadTurnStepFromNode,
  midpointHeadTurnStep,
  preloadSkullAssets,
  resolvePoseHeadTurnStep,
} from './skullKitModels';
import { applyBodyViewPivots, sortPiecesForBodyView } from './turnaround';
import type {
  AbcLoopMode,
  AbcPoseRecord,
  AbcSerializedState,
  AbcSlot,
  BodyTurnView,
  HeadTurnStep,
  MotionFeel,
  MotionSettings,
  PartRigInstance,
  PartSerializedState,
  RigNode,
  RigPiece,
  SkullTurnTiming,
  SkullViewMode,
} from './types';

function synthesizeMidBodyView(a: BodyTurnView, c: BodyTurnView): BodyTurnView {
  if (a === c) return a;
  const pair = [a, c].sort().join('|');
  if (pair === 'front|sideR') return 'threeQuarterR';
  if (pair === 'front|sideL') return 'threeQuarterL';
  if (pair === 'back|threeQuarterR') return 'sideR';
  if (pair === 'back|threeQuarterL') return 'sideL';
  if (pair === 'back|front') return 'threeQuarterR';
  if (pair === 'threeQuarterL|threeQuarterR' || pair === 'sideL|sideR') return 'front';
  return a;
}

export const ABC_SLOTS: AbcSlot[] = ['A', 'B', 'C'];
export const FPS_PRESETS = [6, 8, 12, 24, 30, 60] as const;

export const DEFAULT_MOTION_SETTINGS: MotionSettings = {
  easing: 0.55,
  anticipation: 0.16,
  stagger: 0.16,
  bounce: 0.62,
  damping: 0.42,
  torque: 0.72,
  teeth: 8,
  pawlSnap: 0.7,
};

export function createDefaultAbcState(): AbcSerializedState {
  return {
    poses: { A: null, B: null, C: null },
    activeSlot: 'A',
    loopMode: 'pingpong',
    feel: 'snap',
    snapFrames: 6,
    fps: 12,
    steppedFps: true,
    ghostVisible: true,
    ghostOpacity: 0.34,
    skullTurnTiming: 'halfway',
    settings: { ...DEFAULT_MOTION_SETTINGS },
  };
}

export function getAbcNodeLag(id: string): number {
  if (
    id === 'head' ||
    id === 'lip' ||
    id === 'handL' ||
    id === 'handR' ||
    id === 'thumbL' ||
    id === 'thumbR' ||
    id === 'fingerL' ||
    id === 'fingerR' ||
    id === 'footL' ||
    id === 'footR' ||
    id === 'braceL' ||
    id === 'braceR'
  ) {
    return 0.085;
  }
  if (
    id === 'shinL' ||
    id === 'shinR' ||
    id === 'forearmL' ||
    id === 'forearmR' ||
    id === 'acromionL' ||
    id === 'acromionR'
  ) {
    return 0.045;
  }
  if (
    id === 'humerusL' ||
    id === 'humerusR' ||
    id === 'femurL' ||
    id === 'femurR' ||
    id === 'swivelL' ||
    id === 'swivelR' ||
    id === 'ribL' ||
    id === 'ribR'
  ) {
    return 0.022;
  }
  return 0;
}

export function evalCubicBezier(u: number, cx1: number, cy1: number, cx2: number, cy2: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * cx1 + 3 * (1 - t) * t * t * cx2 + t * t * t;
  const dbx = (t: number) => 3 * (1 - t) * (1 - t) * cx1 + 6 * (1 - t) * t * (cx2 - cx1) + 3 * t * t * (1 - cx2);
  const by = (t: number) => 3 * (1 - t) * (1 - t) * t * cy1 + 3 * (1 - t) * t * t * cy2 + t * t * t;

  let t = u;
  for (let i = 0; i < 5; i++) {
    const err = bx(t) - u;
    if (Math.abs(err) < 1e-4) return by(t);
    const d = dbx(t);
    if (Math.abs(d) < 1e-5) break;
    t = Math.max(0, Math.min(1, t - err / d));
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) * 0.5;
    if (bx(mid) < u) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) * 0.5);
}

/**
 * Precision brass gear & escapement pawl ratchet curve.
 * Each tooth engages briskly during `0..engageEnd`, then seats against the pawl with a micro-tick.
 */
export function evalClockGearCurve(kNode: number, teeth: number, pawlSnap = 0.7): number {
  if (kNode <= 0) return 0;
  if (kNode >= 1) return 1;
  const nTeeth = Math.max(2, Math.round(teeth));
  const p = kNode * nTeeth;
  const idx = Math.floor(p);
  const sub = p - idx;
  const engageEnd = 0.58 - pawlSnap * 0.32; // 0.26..0.58
  const tickAmp = 0.014 + pawlSnap * 0.048;
  const toothFrac =
    sub < engageEnd
      ? 1 - Math.pow(1 - sub / engageEnd, 3)
      : 1 + Math.sin(Math.min(1, (sub - engageEnd) / 0.34) * Math.PI) * tickAmp;
  return Math.min(1.03, (idx + toothFrac) / nTeeth);
}

export function captureAbcPose(
  nodes: RigNode[],
  root: RigNode,
  instMap: Record<string, PartRigInstance>,
  headMeta?: { headStep?: HeadTurnStep; skullView?: SkullViewMode; bodyView?: BodyTurnView },
): AbcPoseRecord {
  const nodeAngles: Record<string, number> = {};
  const flipX: Record<string, boolean> = {};
  let headNode: RigNode | undefined;
  for (const n of nodes) {
    nodeAngles[n.id] = n.ang;
    if (n.flipX) flipX[n.id] = true;
    if (n.id === 'head') headNode = n;
  }
  const headStep: HeadTurnStep =
    headMeta?.headStep !== undefined
      ? headMeta.headStep
      : headMeta?.skullView
      ? resolvePoseHeadTurnStep({ skullView: headMeta.skullView, flipX })
      : inferHeadTurnStepFromNode(headNode);
  const skullView: SkullViewMode = headMeta?.skullView ?? HEAD_TURN_SEQUENCE[headStep].view;
  if (HEAD_TURN_SEQUENCE[headStep].flipX) flipX.head = true;
  else delete flipX.head;

  const parts: Record<string, PartSerializedState> = {};
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
  return {
    nodes: nodeAngles,
    root: [root.tx, root.ty],
    headStep,
    skullView,
    ...(headMeta?.bodyView && headMeta.bodyView !== 'front' ? { bodyView: headMeta.bodyView } : {}),
    ...(Object.keys(flipX).length ? { flipX } : {}),
    ...(Object.keys(parts).length ? { parts } : {}),
  };
}

export function applyAbcPoseInstant(
  pose: AbcPoseRecord,
  nodes: RigNode[],
  root: RigNode,
  instMap: Record<string, PartRigInstance>,
  rebakeFn: (I: PartRigInstance) => void,
  onHeadTurn?: (step: HeadTurnStep, spec: HeadTurnSpec) => void,
  onWake?: () => void,
  onBodyView?: (view: BodyTurnView) => void,
): void {
  let headNode: RigNode | undefined;
  for (const n of nodes) {
    if (pose.nodes && n.id in pose.nodes) {
      n.ang = pose.nodes[n.id];
    }
    n.flipX = !!(pose.flipX && pose.flipX[n.id]);
    if (n.id === 'head') headNode = n;
  }
  root.tx = pose.root?.[0] ?? 0;
  root.ty = pose.root?.[1] ?? 0;

  onBodyView?.(pose.bodyView ?? 'front');

  if (headNode) {
    const step = resolvePoseHeadTurnStep(pose);
    if (step !== 0) preloadSkullAssets();
    const spec = applyHeadTurnStep(headNode, step, onWake);
    onHeadTurn?.(step, spec);
  }

  for (const id in instMap) {
    const I = instMap[id];
    const saved = pose.parts?.[id];
    if (saved) {
      I.on.set(saved.on);
      I.ang.set(saved.ang);
      I.dx.set(saved.dx || []);
      I.dy.set(saved.dy || []);
      I.flip = saved.flip | 0;
      if (saved.gotz && I.gotz) {
        I.gotz = cloneGotzState(saved.gotz);
      } else if (I.gotzDefault) {
        I.gotz = cloneGotzState(I.gotzDefault);
      }
      I.touched = 1;
      rebakeFn(I);
    } else if (I.touched) {
      I.reset();
    }
  }
}

export function getFilledAbcSlots(poses: Record<AbcSlot, AbcPoseRecord | null>): AbcSlot[] {
  return ABC_SLOTS.filter((s) => !!poses[s]);
}

export function nextAbcSlot(
  poses: Record<AbcSlot, AbcPoseRecord | null>,
  activeSlot: AbcSlot,
  loopMode: AbcLoopMode,
  loopDir: 1 | -1,
  mutateDir?: (dir: 1 | -1) => void,
): AbcSlot | null {
  const filled = getFilledAbcSlots(poses);
  if (filled.length < 2) return filled[0] ?? null;

  const idx = filled.indexOf(activeSlot);
  if (idx === -1) {
    mutateDir?.(1);
    return filled[0];
  }

  if (loopMode === 'cycle' || filled.length === 2) {
    return filled[(idx + 1) % filled.length];
  }

  // Ping-pong cleanly across filled A/B/C poses
  if (idx <= 0) {
    mutateDir?.(1);
    return filled[1];
  }
  if (idx >= filled.length - 1) {
    mutateDir?.(-1);
    return filled[filled.length - 2];
  }
  return filled[idx + loopDir];
}

export function getAbcCycleSequence(
  poses: Record<AbcSlot, AbcPoseRecord | null>,
  loopMode: AbcLoopMode,
): Array<[AbcSlot, AbcSlot]> {
  const filled = getFilledAbcSlots(poses);
  if (filled.length < 2) return [];
  if (filled.length === 2) {
    return [
      [filled[0], filled[1]],
      [filled[1], filled[0]],
    ];
  }
  if (loopMode === 'cycle') {
    return filled.map((slot, i) => [slot, filled[(i + 1) % filled.length]]);
  }
  const seq: Array<[AbcSlot, AbcSlot]> = [];
  for (let i = 0; i < filled.length - 1; i++) {
    seq.push([filled[i], filled[i + 1]]);
  }
  for (let i = filled.length - 1; i > 0; i--) {
    seq.push([filled[i], filled[i - 1]]);
  }
  return seq;
}

function getEffectiveAnticipation(feel: MotionFeel, settings: MotionSettings): number {
  if (
    feel === 'flow' ||
    feel === 'easeIn' ||
    feel === 'easeOut' ||
    feel === 'doubleEase' ||
    feel === 'proceduralEase'
  ) {
    return 0;
  }
  if (feel === 'snap') {
    return settings.easing > 0.06 ? Math.min(0.35, settings.anticipation * (0.4 + 0.9 * settings.easing)) : 0;
  }
  return Math.max(0, Math.min(0.35, settings.anticipation));
}

/**
 * Evaluates a normalized curve value (where 0 = fromPose, 1 = toPose) for preview SVG & pose blending.
 */
export function evalMotionScalar(
  tRaw: number,
  feel: MotionFeel,
  settings: MotionSettings,
  nodeLag = 0,
  nodeIndex = 0,
): { s: number; ease: number; jitterDeg: number; inAnticipation: boolean; antBell: number; antPull: number } {
  const t = Math.max(0, Math.min(1, tRaw));
  const antFrac = getEffectiveAnticipation(feel, settings);

  if (antFrac > 0.005 && t < antFrac) {
    const u = t / antFrac;
    const bell = Math.pow(Math.sin(u * Math.PI), 0.68);
    const strength =
      feel === 'elastic'
        ? 0.14 + settings.bounce * 0.22
        : feel === 'clockwork'
        ? 0.1 + settings.pawlSnap * 0.16
        : feel === 'mechanical'
        ? 0.08 + settings.torque * 0.14
        : 0.08 + settings.easing * 0.24;
    const pull = -strength * bell;
    return { s: pull, ease: pull, jitterDeg: 0, inAnticipation: true, antBell: bell, antPull: pull };
  }

  const k = t >= 1 ? 1 : Math.min(1, (t - antFrac) / Math.max(0.01, 1 - antFrac));

  let scaledLag = 0;
  if (feel === 'snap') {
    scaledLag = nodeLag * 0.45 * settings.easing;
  } else if (feel === 'elastic') {
    scaledLag = Math.min(0.55, nodeLag * (1 + settings.stagger * 3.8));
  } else if (feel === 'mechanical') {
    scaledLag = Math.min(0.55, nodeLag * (0.6 + settings.stagger * 4.5));
  } else if (feel === 'clockwork') {
    scaledLag = Math.min(0.55, nodeLag * (0.45 + settings.stagger * 4.2));
  } else if (feel === 'proceduralEase') {
    scaledLag = Math.min(0.45, nodeLag * (0.8 + settings.stagger * 3.2));
  }

  const kNode = k >= 1 ? 1 : Math.max(0, Math.min(1, (k - scaledLag) / Math.max(0.05, 1 - scaledLag)));

  if (k >= 1) {
    return { s: 1, ease: 1, jitterDeg: 0, inAnticipation: false, antBell: 0, antPull: 0 };
  }

  let eNode = kNode;
  let over = 0;
  let jitterDeg = 0;

  if (feel === 'flow') {
    eNode = kNode;
  } else if (feel === 'easeIn') {
    const e = settings.easing;
    eNode = evalCubicBezier(kNode, 0.32 + 0.58 * e, 0.0, 0.94 - 0.06 * e, 0.48 - 0.28 * e);
  } else if (feel === 'easeOut') {
    const e = settings.easing;
    eNode = evalCubicBezier(kNode, 0.06 + 0.08 * e, 0.52 + 0.28 * e, 0.34 * (1 - e * 0.65), 1.0);
  } else if (feel === 'doubleEase') {
    const e = settings.easing;
    eNode = evalCubicBezier(kNode, 0.35 + 0.48 * e, 0.0, 0.65 - 0.48 * e, 1.0);
  } else if (feel === 'proceduralEase') {
    // Smooth quintic S-curve (zero jerk & acceleration at both ends) for effortless clean paths
    eNode = kNode * kNode * kNode * (kNode * (kNode * 6 - 15) + 10);
  } else if (feel === 'snap') {
    const e = settings.easing;
    eNode = evalCubicBezier(kNode, 0.16 + 0.68 * e, 0.0, 0.14 + 0.14 * (1 - e), 1.0);
    over = Math.sin(kNode * Math.PI * 2.1) * Math.exp(-3.8 * kNode) * (0.015 + 0.105 * e);
  } else if (feel === 'elastic') {
    const b = settings.bounce;
    const d = settings.damping;
    eNode = 1 - Math.pow(1 - kNode, 3.35);
    const amp = (0.06 + b * 0.28) * (1 + nodeLag * 3.6);
    const cycles = 2.0 + b * 2.1;
    const decay = 5.4 - (1 - d) * 2.9;
    over =
      (Math.sin(kNode * Math.PI * cycles) + 0.24 * Math.sin(kNode * Math.PI * cycles * 1.85)) *
      Math.exp(-decay * kNode) *
      amp;
  } else if (feel === 'mechanical') {
    const tq = settings.torque;
    eNode = evalCubicBezier(kNode, 0.7 + 0.18 * tq, 0.0, 0.3 - 0.16 * tq, 1.0);
    // Crisp detent latch micro-rebound near end of stroke
    if (kNode > 0.82) {
      const dU = (kNode - 0.82) / 0.18;
      over = -Math.sin(dU * Math.PI) * (0.012 + tq * 0.035);
    }
    const env = Math.sin(kNode * Math.PI);
    jitterDeg = Math.sin(k * Math.PI * (8 + tq * 10) + nodeIndex * 1.17) * env * (0.45 + tq * 1.65);
  } else if (feel === 'clockwork') {
    eNode = evalClockGearCurve(kNode, settings.teeth, settings.pawlSnap);
  }

  return {
    s: eNode + over,
    ease: eNode,
    jitterDeg,
    inAnticipation: false,
    antBell: 0,
    antPull: 0,
  };
}

export function applyAbcTweenPose(
  fromPose: AbcPoseRecord,
  toPose: AbcPoseRecord,
  tRaw: number,
  feel: MotionFeel,
  settings: MotionSettings,
  nodes: RigNode[],
  root: RigNode,
  instMap: Record<string, PartRigInstance>,
  rebakeFn: (I: PartRigInstance) => void,
  constrainLimits: boolean,
  by?: Record<string, RigNode>,
  prometheusWings = false,
  extras?: {
    skullTurnTiming?: SkullTurnTiming;
    ribAnchor?: RibAnchorMode;
    pieces?: RigPiece[];
    onHeadTurn?: (step: HeadTurnStep, spec: HeadTurnSpec) => void;
    onBodyView?: (view: BodyTurnView) => void;
    onWake?: () => void;
  },
): void {
  const t = Math.max(0, Math.min(1, tRaw));

  if (t >= 1) {
    applyAbcPoseInstant(toPose, nodes, root, instMap, rebakeFn, extras?.onHeadTurn, extras?.onWake, extras?.onBodyView);
    if (by) {
      const v = toPose.bodyView ?? 'front';
      applyBodyViewPivots(nodes, by, v, extras?.ribAnchor ?? 'upper');
      if (extras?.pieces) sortPiecesForBodyView(extras.pieces, v, prometheusWings);
      if (!prometheusWings) {
        nodes.forEach((n) => {
          n.ang = clampRealisticShoulder(n, n.ang, by, false);
        });
      }
    }
    return;
  }
  if (t <= 0) {
    applyAbcPoseInstant(fromPose, nodes, root, instMap, rebakeFn, extras?.onHeadTurn, extras?.onWake, extras?.onBodyView);
    if (by) {
      const v = fromPose.bodyView ?? 'front';
      applyBodyViewPivots(nodes, by, v, extras?.ribAnchor ?? 'upper');
      if (extras?.pieces) sortPiecesForBodyView(extras.pieces, v, prometheusWings);
      if (!prometheusWings) {
        nodes.forEach((n) => {
          n.ang = clampRealisticShoulder(n, n.ang, by, false);
        });
      }
    }
    return;
  }

  const antScale =
    feel === 'elastic'
      ? 0.65 + settings.bounce * 0.7
      : feel === 'clockwork'
      ? 0.5 + settings.pawlSnap * 0.6
      : feel === 'mechanical'
      ? 0.45 + settings.torque * 0.55
      : 0.45 + settings.easing * 0.85;

  const rx0 = fromPose.root?.[0] ?? 0;
  const ry0 = fromPose.root?.[1] ?? 0;
  const rx1 = toPose.root?.[0] ?? 0;
  const ry1 = toPose.root?.[1] ?? 0;
  const dxRoot = rx1 - rx0;
  const isProcedural = feel === 'proceduralEase';
  const strideTravel =
    Math.abs((toPose.nodes.femurL ?? 0) - (fromPose.nodes.femurL ?? 0)) +
    Math.abs((toPose.nodes.femurR ?? 0) - (fromPose.nodes.femurR ?? 0));

  const skullTiming: SkullTurnTiming = extras?.skullTurnTiming ?? 'halfway';
  const fromHeadStep = resolvePoseHeadTurnStep(fromPose);
  const toHeadStep = resolvePoseHeadTurnStep(toPose);
  if (fromHeadStep !== 0 || toHeadStep !== 0) preloadSkullAssets();
  const activateNextSkull = skullTiming === 'nextLetter' ? t >= 1 : t >= 0.5;
  const activeHeadStep = activateNextSkull ? toHeadStep : fromHeadStep;
  const activeHeadSpec = HEAD_TURN_SEQUENCE[activeHeadStep];

  nodes.forEach((n, ni) => {
    const a = fromPose.nodes[n.id] ?? 0;
    const b = toPose.nodes[n.id] ?? 0;
    const da = normalizeDeg(b - a);
    const sample = evalMotionScalar(t, feel, settings, getAbcNodeLag(n.id), ni);

    if (n.id === 'head') {
      n.flipX = activeHeadSpec.flipX;
    } else {
      n.flipX = t >= 0.5 ? !!(toPose.flipX && toPose.flipX[n.id]) : !!(fromPose.flipX && fromPose.flipX[n.id]);
    }

    if (sample.inAnticipation) {
      let extra = 0;
      if (n.id === 'lumbar') extra = 3.6 * sample.antBell;
      else if (n.id === 'thorax') extra = -4.8 * sample.antBell;
      else if (n.id === 'neck') extra = 3.0 * sample.antBell;
      const next = clampAnatomicalAngle(n, a + da * sample.antPull + extra * antScale, constrainLimits);
      n.ang = by ? clampRealisticShoulder(n, next, by, prometheusWings) : next;
    } else {
      let procArc = 0;
      if (isProcedural && Math.abs(da) > 4) {
        const bell = Math.sin(Math.min(1, Math.max(0, sample.ease)) * Math.PI);
        if (n.id === 'shinL') procArc = bell * Math.min(10, Math.abs(da) * 0.12);
        else if (n.id === 'shinR') procArc = -bell * Math.min(10, Math.abs(da) * 0.12);
        else if (n.id === 'lumbar') procArc = -bell * Math.sign(dxRoot || da) * Math.min(3.5, Math.abs(da) * 0.06);
        else if (n.id === 'thorax') procArc = bell * Math.sign(dxRoot || da) * Math.min(2.8, Math.abs(da) * 0.05);
      }
      const next = clampAnatomicalAngle(n, a + da * sample.s + sample.jitterDeg + procArc, constrainLimits);
      n.ang = by ? clampRealisticShoulder(n, next, by, prometheusWings) : next;
    }
  });

  const activeBodyView: BodyTurnView = t >= 0.5 ? (toPose.bodyView ?? 'front') : (fromPose.bodyView ?? 'front');
  extras?.onBodyView?.(activeBodyView);
  if (by) {
    applyBodyViewPivots(nodes, by, activeBodyView, extras?.ribAnchor ?? 'upper');
    if (extras?.pieces) sortPiecesForBodyView(extras.pieces, activeBodyView, prometheusWings);
  }

  const headNode = by?.head ?? nodes.find((n) => n.id === 'head');
  if (headNode) {
    const spec = applyHeadTurnStep(headNode, activeHeadStep, extras?.onWake);
    extras?.onHeadTurn?.(activeHeadStep, spec);
  }

  const rootSample = evalMotionScalar(t, feel, settings, 0, 0);

  if (rootSample.inAnticipation) {
    root.tx = rx0 + (rx1 - rx0) * rootSample.antPull;
    root.ty = ry0 + (ry1 - ry0) * rootSample.antPull + 28 * antScale * rootSample.antBell;
  } else {
    const tScale = Math.max(-0.22, Math.min(1.16, rootSample.s));
    const bell = isProcedural ? Math.sin(Math.min(1, Math.max(0, rootSample.ease)) * Math.PI) : 0;
    const procLift =
      isProcedural && (Math.abs(dxRoot) >= 16 || strideTravel >= 10)
        ? -bell * Math.min(120, (Math.abs(dxRoot) + strideTravel * 5) * CANONICAL_PROPORTIONS.muybridge.pelvisStrideDropMaxRatio)
        : 0;
    root.tx = rx0 + dxRoot * tScale;
    root.ty = ry0 + (ry1 - ry0) * tScale + procLift;
  }

  // Interpolate sub-rig parts (head/hand/foot) cleanly
  for (const id in instMap) {
    const I = instMap[id];
    const pa = fromPose.parts?.[id];
    const pb = toPose.parts?.[id];
    if (!pa && !pb) continue;
    const len = I.ang.length;
    const angA = pa?.ang ?? new Array(len).fill(0);
    const angB = pb?.ang ?? new Array(len).fill(0);
    const blend = Math.max(0, Math.min(1, rootSample.inAnticipation ? 0 : rootSample.s));
    for (let k = 0; k < len; k++) {
      const a0 = angA[k] ?? 0;
      const a1 = angB[k] ?? 0;
      I.ang[k] = a0 + normalizeDeg(a1 - a0) * blend;
    }
    const useToMask = id === 'head' ? activateNextSkull : t >= 0.5;
    const targetMask = useToMask ? pb : pa;
    if (targetMask) {
      I.on.set(targetMask.on);
      I.flip = targetMask.flip | 0;
    }
    if (I.gotz && (pa?.gotz || pb?.gotz)) {
      const ga = pa?.gotz ?? I.gotzDefault ?? I.gotz;
      const gb = pb?.gotz ?? I.gotzDefault ?? I.gotz;
      I.gotz = lerpGotzHandState(ga, gb, blend);
    }
    I.touched = 1;
    rebakeFn(I);
  }
}

export function sampleMotionCurvePath(
  feel: MotionFeel,
  settings: MotionSettings,
  steps = 64,
): Array<{ u: number; y: number }> {
  const pts: Array<{ u: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const res = evalMotionScalar(u, feel, settings, 0, 0);
    pts.push({ u, y: res.s });
  }
  return pts;
}

/**
 * Synthesizes a procedural in-between breakdown pose B from keyframes A and C.
 * Combines hierarchical core-to-distal overlapping action, Muybridge passing-step arcs
 * for moving transitions (or gentle center-of-mass settle for standing weight shifts),
 * anatomical shoulder/rib clamps, and ground-contact preservation.
 */
export function synthesizeProceduralInBetween(
  poseA: AbcPoseRecord,
  poseC: AbcPoseRecord,
  nodes: RigNode[],
  root: RigNode,
  instMap: Record<string, PartRigInstance>,
  rebakeFn: (I: PartRigInstance) => void,
  options: {
    by: Record<string, RigNode>;
    bondOn: boolean;
    wingPop: number;
    ribAnchor?: RibAnchorMode;
    pieces?: RigPiece[];
    constrainLimits: boolean;
    prometheusWings?: boolean;
    groundY?: number;
    footGravity?: boolean;
  },
): AbcPoseRecord {
  const rx0 = poseA.root?.[0] ?? 0;
  const ry0 = poseA.root?.[1] ?? 0;
  const rx1 = poseC.root?.[0] ?? 0;
  const ry1 = poseC.root?.[1] ?? 0;
  const dxRoot = rx1 - rx0;
  const dyRoot = ry1 - ry0;
  const horizontalTravel = Math.abs(dxRoot);

  const strideDelta =
    Math.abs((poseC.nodes.femurL ?? 0) - (poseA.nodes.femurL ?? 0)) +
    Math.abs((poseC.nodes.femurR ?? 0) - (poseA.nodes.femurR ?? 0));
  const isMovingPassing =
    horizontalTravel >= CANONICAL_PROPORTIONS.muybridge.movingVelocityThresholdPx * 12 ||
    strideDelta >= CANONICAL_PROPORTIONS.muybridge.movingStrideAngleThresholdDeg;

  const stepA = resolvePoseHeadTurnStep(poseA);
  const stepC = resolvePoseHeadTurnStep(poseC);
  const midHeadStep = midpointHeadTurnStep(stepA, stepC);
  const midHeadSpec = HEAD_TURN_SEQUENCE[midHeadStep];
  if (midHeadStep !== 0) preloadSkullAssets();

  const viewA: BodyTurnView = poseA.bodyView ?? 'front';
  const viewC: BodyTurnView = poseC.bodyView ?? 'front';
  const midBodyView = synthesizeMidBodyView(viewA, viewC);
  const keepSideFlip = midBodyView === 'sideR' || midBodyView === 'sideL';

  // Core-to-distal overlap: pelvis & spine lead slightly (~0.54) while extremities lag (~0.42)
  for (const n of nodes) {
    const a = poseA.nodes[n.id] ?? 0;
    const c = poseC.nodes[n.id] ?? 0;
    const da = normalizeDeg(c - a);
    const lag = getAbcNodeLag(n.id);
    const uNode = Math.max(0.32, Math.min(0.62, 0.54 - lag * 1.45));
    let ang = a + da * uNode;

    // Muybridge passing-frame knee flexion & spine counter-cushion
    if (isMovingPassing && Math.abs(da) > 6) {
      const swingKneeBend = Math.min(18, Math.abs(da) * 0.22);
      if (n.id === 'shinL') ang += swingKneeBend;
      else if (n.id === 'shinR') ang -= swingKneeBend;
      else if (n.id === 'lumbar') ang -= Math.sign(dxRoot || da) * Math.min(4.5, Math.abs(da) * 0.08);
      else if (n.id === 'thorax') ang += Math.sign(dxRoot || da) * Math.min(3.5, Math.abs(da) * 0.06);
    } else if (!isMovingPassing && (n.id === 'lumbar' || n.id === 'thorax')) {
      // Subtle counter-twist cushion during standing breakdown
      const sign = n.id === 'lumbar' ? -1 : 1;
      ang += sign * Math.sin(da * (Math.PI / 180)) * 2.5;
    }

    const clamped = clampAnatomicalAngle(n, ang, options.constrainLimits);
    const shoulderSafe = clampRealisticShoulder(n, clamped, options.by, !!options.prometheusWings);
    n.ang = clampChungusRibAngle(
      n.id,
      shoulderSafe,
      options.ribAnchor ?? 'upper',
      options.by,
      !!options.prometheusWings,
    );
    n.flipX =
      n.id === 'head'
        ? midHeadSpec.flipX
        : keepSideFlip
        ? !!(poseA.flipX?.[n.id] || poseC.flipX?.[n.id])
        : !!(poseA.flipX?.[n.id] && poseC.flipX?.[n.id]);
  }

  applyBodyViewPivots(nodes, options.by, midBodyView, options.ribAnchor ?? 'upper');
  if (options.pieces) {
    sortPiecesForBodyView(options.pieces, midBodyView, !!options.prometheusWings);
  }

  if (options.by.head) {
    applyHeadTurnStep(options.by.head, midHeadStep);
  }

  // Midpoint root with vertical passing crest (moving) or subtle weight-transfer settle (standing)
  const midX = (rx0 + rx1) * 0.5;
  const midY = (ry0 + ry1) * 0.5;
  const arcOffsetY = isMovingPassing
    ? -Math.min(165, Math.max(24, (horizontalTravel + strideDelta * 6) * CANONICAL_PROPORTIONS.muybridge.pelvisStrideDropMaxRatio))
    : Math.min(36, Math.abs(dyRoot) * 0.05 + strideDelta * 0.45);
  root.tx = Math.round(midX * 10) / 10;
  root.ty = Math.round((midY + arcOffsetY) * 10) / 10;

  // Interpolate sub-rig extremities cleanly at midpoint
  for (const id in instMap) {
    const I = instMap[id];
    const pa = poseA.parts?.[id];
    const pc = poseC.parts?.[id];
    if (!pa && !pc) {
      if (I.touched) I.reset();
      continue;
    }
    const len = I.ang.length;
    const angA = pa?.ang ?? new Array(len).fill(0);
    const angC = pc?.ang ?? new Array(len).fill(0);
    for (let k = 0; k < len; k++) {
      const a0 = angA[k] ?? 0;
      const a1 = angC[k] ?? 0;
      I.ang[k] = a0 + normalizeDeg(a1 - a0) * 0.46;
    }
    const mask = pa ?? pc;
    if (mask) {
      I.on.set(mask.on);
      I.flip = mask.flip | 0;
    }
    if (I.gotz && (pa?.gotz || pc?.gotz)) {
      const ga = pa?.gotz ?? I.gotzDefault ?? I.gotz;
      const gc = pc?.gotz ?? I.gotzDefault ?? I.gotz;
      I.gotz = lerpGotzHandState(ga, gc, 0.46);
    }
    I.touched = 1;
    rebakeFn(I);
  }

  solveRig(nodes, options.by, options.bondOn, options.wingPop, options.ribAnchor ?? 'upper');
  if (options.footGravity !== false && options.groundY !== undefined) {
    const { regime } = inferPostureRegime({
      by: options.by,
      posFn: pos,
      explicitRegime: isMovingPassing ? 'moving' : 'standing',
      isKeyframedMotion: isMovingPassing,
    });
    applyGroundAndBalance(
      nodes,
      options.by,
      root,
      { groundY: options.groundY },
      isMovingPassing ? 'balance' : 'pinFeet',
      (n, b, bond, wp) => solveRig(n, b, bond, wp, options.ribAnchor ?? 'upper'),
      pos,
      options.bondOn,
      options.wingPop,
      {
        pullDownToo: false,
        regime,
        isKeyframedMotion: isMovingPassing,
        constrainLimits: options.constrainLimits,
      },
    );
  }

  return captureAbcPose(nodes, root, instMap, {
    headStep: midHeadStep,
    skullView: midHeadSpec.view,
    bodyView: midBodyView,
  });
}


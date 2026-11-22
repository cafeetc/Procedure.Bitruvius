/**
 * Feature Notes (Plain English):
 * - Body Turnaround Views (Front, 3/4 L/R, Side L/R, Back):
 *   Provides reversible foreshortening offsets, contrapposto Side poses (where legs,
 *   ribs, and spinal bending favor the facing side while hips counter-face opposite),
 *   and Near/Far limb depth sorting across the 43-joint rig.
 * - Strict Shoulder Girdle Depth Contract:
 *   Always enforces Ribs (foreground) -> Swivel (middle, obscured by ribs) ->
 *   Back Shoulderbone / Prometheus Wings (behind swivel) on both L and R sides.
 */
import type { RibAnchorMode } from './fkEngine';
import { applyRibAnchorMode } from './fkEngine';
import type { BodyTurnView, HeadTurnStep, RigNode, RigPiece } from './types';

export interface BodyTurnViewSpec {
  id: BodyTurnView;
  label: string;
  defaultHeadStep: HeadTurnStep;
  hint: string;
}

export const BODY_TURN_VIEWS: readonly BodyTurnViewSpec[] = [
  { id: 'front', label: 'Front', defaultHeadStep: 0, hint: 'Neutral anatomical front stance' },
  { id: 'threeQuarterL', label: '3/4 L', defaultHeadStep: 0, hint: '3/4 Left · near L / far R depth & foreshortening' },
  { id: 'threeQuarterR', label: '3/4 R', defaultHeadStep: 0, hint: '3/4 Right · near R / far L depth & foreshortening' },
  { id: 'sideL', label: 'Side L', defaultHeadStep: 3, hint: 'Side Left · legs, ribs & bend favor Left; hips face Right' },
  { id: 'sideR', label: 'Side R', defaultHeadStep: 1, hint: 'Side Right · legs, ribs & bend favor Right; hips face Left' },
  { id: 'back', label: 'Back', defaultHeadStep: 2, hint: 'Dorsal back view' },
] as const;

const CENTERLINE_X = 1257;

const basePieceX = new WeakMap<RigPiece, number>();
const baseAimFrom = new WeakMap<RigNode, [number, number]>();

function ensureBaseRestAndPieces(nodes: RigNode[]): void {
  for (const n of nodes) {
    if (!n.baseRest) {
      n.baseRest = [n.rest[0], n.rest[1]];
    }
    if (n.aim && !baseAimFrom.has(n)) {
      baseAimFrom.set(n, [n.aim.from[0], n.aim.from[1]]);
    }
    for (const p of n.pieces) {
      if (!basePieceX.has(p)) {
        basePieceX.set(p, p.x);
      }
      if (p.i0 === undefined) {
        p.i0 = p.i;
      }
    }
  }
}

export function getDefaultHeadStepForBodyView(view: BodyTurnView): HeadTurnStep {
  const found = BODY_TURN_VIEWS.find((v) => v.id === view);
  return found ? found.defaultHeadStep : 0;
}

/**
 * Computes view-aware layer order (`pieces.sort((a, b) => b.i - a.i)`, where smaller `i`
 * renders closer to the viewer) while keeping the strict per-side invariant:
 * Ribs (front) -> Swivel (middle) -> Back Shoulderbone / Prometheus Wings (behind).
 */
export function sortPiecesForBodyView(
  pieces: RigPiece[],
  bodyView: BodyTurnView = 'front',
  _prometheusWings = false,
): void {
  const isTurnR = bodyView === 'threeQuarterR' || bodyView === 'sideR';
  const isTurnL = bodyView === 'threeQuarterL' || bodyView === 'sideL';

  for (const p of pieces) {
    if (p.i0 === undefined) p.i0 = p.i;
    const n = p.node;
    const id = n?.id ?? '';
    const pname = p.name;

    // Symmetric Front / Back view: enforce Ribs < Swivel < Backshoulder (smaller i = in front)
    if (!isTurnR && !isTurnL) {
      if (id === 'ribL') {
        p.i = 32;
      } else if (id === 'swivelL') {
        p.i = 33;
      } else if (p.wing && id === 'braceL') {
        p.i = 34;
      } else if (id === 'ribR') {
        p.i = 23;
      } else if (id === 'swivelR') {
        p.i = 24;
      } else if (p.wing && id === 'braceR') {
        p.i = 25;
      } else {
        p.i = p.i0;
      }
      continue;
    }

    const nearSide: 'L' | 'R' = isTurnR ? 'R' : 'L';
    const farSide: 'L' | 'R' = isTurnR ? 'L' : 'R';
    const pieceSide: 'L' | 'R' | 'C' =
      id.endsWith('L') ? 'L' : id.endsWith('R') ? 'R' : 'C';

    if (pieceSide === 'C') {
      if (id === 'lumbar') p.i = 9.0;
      else if (id === 'head') p.i = 11.0;
      else if (id === 'neck') p.i = p.i0 === 12 ? 12.0 : 14.0;
      else if (id === 'thorax') p.i = pname === 'Neckring' ? 16.0 : 15.0;
      else p.i = p.i0;
      continue;
    }

    const isNear = pieceSide === nearSide;
    if (isNear) {
      // Near-side foreground limbs & near rib/swivel/backshoulder stack (Ribs < Swivel < Backshoulder)
      if (id.startsWith('hand')) p.i = 1.6;
      else if (id.startsWith('forearm')) p.i = pname === 'Radius' ? 1.8 : 2.1;
      else if (id.startsWith('humerus')) p.i = 2.5;
      else if (id.startsWith('acromion')) p.i = 3.0;
      else if (id.startsWith('brace') && !p.wing) p.i = 3.5;
      else if (id.startsWith('foot')) p.i = 4.0;
      else if (id.startsWith('shin')) p.i = pname === 'Fibula' ? 4.2 : 4.4;
      else if (id.startsWith('femur')) p.i = 4.6;
      else if (id.startsWith('hip')) p.i = 5.0;
      else if (id.startsWith('rib')) p.i = 6.0;
      else if (id.startsWith('swivel')) p.i = 7.0;
      else if (p.wing) p.i = 8.0;
      else p.i = p.i0;
    } else if (pieceSide === farSide) {
      // Far-side limbs & far rib/swivel/backshoulder behind spine (Ribs < Swivel < Backshoulder)
      if (id.startsWith('hip')) p.i = 18.0;
      else if (id.startsWith('foot')) p.i = 19.0;
      else if (id.startsWith('shin')) p.i = pname === 'Fibula' ? 19.2 : 19.4;
      else if (id.startsWith('femur')) p.i = 19.6;
      else if (id.startsWith('rib')) p.i = 21.0;
      else if (id.startsWith('swivel')) p.i = 22.0;
      else if (p.wing) p.i = 23.0;
      else if (id.startsWith('acromion')) p.i = 24.0;
      else if (id.startsWith('brace') && !p.wing) p.i = 24.5;
      else if (id.startsWith('humerus')) p.i = 25.0;
      else if (id.startsWith('forearm')) p.i = pname === 'Radius' ? 25.5 : 26.0;
      else if (id.startsWith('hand')) p.i = 26.5;
      else p.i = p.i0;
    }
  }

  pieces.sort((a, b) => b.i - a.i);
}

/**
 * Reversibly updates lateral turnaround foreshortening pivots & piece offsets for
 * Front, 3/4 L/R, Side L/R, and Back without mutating canonical base geometry.
 */
export function applyBodyViewPivots(
  nodes: RigNode[],
  by: Record<string, RigNode>,
  view: BodyTurnView,
  ribAnchor: RibAnchorMode = 'upper',
): void {
  ensureBaseRestAndPieces(nodes);

  // Compute rigid horizontal subtree offsets (dx) for shoulders & legs from canonical Front rest
  const armSubtreeR = ['acromionR', 'humerusR', 'forearmR', 'handR', 'thumbR', 'thumbTipR', 'fingerR', 'fingerTipR'];
  const armSubtreeL = ['acromionL', 'humerusL', 'forearmL', 'handL', 'thumbL', 'thumbTipL', 'fingerL', 'fingerTipL'];
  const legSubtreeR = ['femurR', 'shinR', 'footR', 'toeR'];
  const legSubtreeL = ['femurL', 'shinL', 'footL', 'toeL'];

  let armDxR = 0;
  let armDxL = 0;
  let legDxR = 0;
  let legDxL = 0;
  let ribDxR = 0;
  let ribDxL = 0;
  let swTipDxR = 0;
  let swTipDxL = 0;

  const acroR = by.acromionR?.baseRest?.[0] ?? 688;
  const acroL = by.acromionL?.baseRest?.[0] ?? 1815;
  const femR = by.femurR?.baseRest?.[0] ?? 990;
  const femL = by.femurL?.baseRest?.[0] ?? 1521;
  const swTipR = by.swivelTipR?.baseRest?.[0] ?? 483;
  const swTipL = by.swivelTipL?.baseRest?.[0] ?? 2031;

  if (view === 'threeQuarterR') {
    // Facing +X: Near R stays open (~0.78x), Far L foreshortens behind chest (~0.42x)
    armDxR = (CENTERLINE_X + (acroR - CENTERLINE_X) * 0.78 + 30) - acroR;
    armDxL = (CENTERLINE_X + (acroL - CENTERLINE_X) * 0.42 + 12) - acroL;
    legDxR = (CENTERLINE_X + (femR - CENTERLINE_X) * 0.80 + 26) - femR;
    legDxL = (CENTERLINE_X + (femL - CENTERLINE_X) * 0.46 + 10) - femL;
    swTipDxR = (CENTERLINE_X + (swTipR - CENTERLINE_X) * 0.78 + 30) - swTipR;
    swTipDxL = (CENTERLINE_X + (swTipL - CENTERLINE_X) * 0.42 + 12) - swTipL;
    ribDxR = 26;
    ribDxL = -42;
  } else if (view === 'threeQuarterL') {
    // Facing -X: Near L stays open (~0.78x), Far R foreshortens behind chest (~0.42x)
    armDxL = (CENTERLINE_X + (acroL - CENTERLINE_X) * 0.78 - 30) - acroL;
    armDxR = (CENTERLINE_X + (acroR - CENTERLINE_X) * 0.42 - 12) - acroR;
    legDxL = (CENTERLINE_X + (femL - CENTERLINE_X) * 0.80 - 26) - femL;
    legDxR = (CENTERLINE_X + (femR - CENTERLINE_X) * 0.46 - 10) - femR;
    swTipDxL = (CENTERLINE_X + (swTipL - CENTERLINE_X) * 0.78 - 30) - swTipL;
    swTipDxR = (CENTERLINE_X + (swTipR - CENTERLINE_X) * 0.42 - 12) - swTipR;
    ribDxL = -26;
    ribDxR = 42;
  } else if (view === 'sideR') {
    // Facing +X: arms stay anchored to genuine shoulder swivels; subtle torso & leg stagger
    armDxR = 0;
    armDxL = 0;
    swTipDxR = 0;
    swTipDxL = 0;
    legDxR = 18;
    legDxL = 12;
    ribDxR = 26;
    ribDxL = -26;
  } else if (view === 'sideL') {
    // Facing -X: symmetrical genuine shoulder swivel profile
    armDxL = 0;
    armDxR = 0;
    swTipDxL = 0;
    swTipDxR = 0;
    legDxL = -18;
    legDxR = -12;
    ribDxL = -26;
    ribDxR = 26;
  }

  const dxMap: Record<string, number> = {};
  for (const id of armSubtreeR) dxMap[id] = armDxR;
  for (const id of armSubtreeL) dxMap[id] = armDxL;
  for (const id of legSubtreeR) dxMap[id] = legDxR;
  for (const id of legSubtreeL) dxMap[id] = legDxL;
  dxMap.swivelTipR = swTipDxR;
  dxMap.swivelTipL = swTipDxL;
  dxMap.ribR = ribDxR;
  dxMap.ribL = ribDxL;

  for (const n of nodes) {
    const base = n.baseRest ?? n.rest;
    const dx = dxMap[n.id] ?? 0;
    n.rest = [base[0] + dx, base[1]];
    if (n.id !== 'wingL' && n.id !== 'wingR') {
      n.piv = [base[0] + dx, base[1]];
    }
    if (n.aim) {
      const bf = baseAimFrom.get(n) ?? n.aim.from;
      const aimDx = n.id === 'braceR' ? armDxR : n.id === 'braceL' ? armDxL : 0;
      n.aim.from = [bf[0] + aimDx, bf[1]];
    }
    for (const p of n.pieces) {
      const bx = basePieceX.get(p) ?? p.x;
      // Do not overwrite Backshoulder's dynamic wing offset beyond its rest box
      p.x = bx + dx;
    }
  }

  applyRibAnchorMode(by, ribAnchor);
  if (ribDxR && by.ribR) {
    by.ribR.piv = [by.ribR.piv[0] + ribDxR, by.ribR.piv[1]];
    by.ribR.rest = [by.ribR.piv[0], by.ribR.piv[1]];
  }
  if (ribDxL && by.ribL) {
    by.ribL.piv = [by.ribL.piv[0] + ribDxL, by.ribL.piv[1]];
    by.ribL.rest = [by.ribL.piv[0], by.ribL.piv[1]];
  }
}

export interface BodyTurnPresetPose {
  angles: Record<string, number>;
  flipX: Record<string, boolean>;
}

/**
 * Generates canonical turnaround pose presets:
 * - Side R / Side L: contrapposto where legs, ribs, and spinal bend favor the facing direction,
 *   while hips (`hipR`, `hipL`) flip and counter-orient in the opposite direction.
 * - 3/4 R / 3/4 L: foreshortened balanced 3/4 stance.
 * - Front / Back: neutral unflipped base stance.
 */
export function getBodyViewPresetPose(
  view: BodyTurnView,
  sideArmsFavorOpposite = false,
): BodyTurnPresetPose {
  if (view === 'front' || view === 'back') {
    return {
      angles: {
        pelvis: 0, lumbar: 0, thorax: 0, neck: 0, head: 0,
        ribR: 0, ribL: 0,
        swivelR: 0, swivelL: 0, acromionR: 0, acromionL: 0, braceR: 0, braceL: 0,
        humerusR: 0, humerusL: 0, forearmR: 0, forearmL: 0, handR: 0, handL: 0,
        hipR: 0, hipL: 0, femurR: 0, femurL: 0, shinR: 0, shinL: 0, footR: 0, footL: 0,
      },
      flipX: {
        ribR: false, ribL: false, hipR: false, hipL: false, femurR: false, femurL: false,
      },
    };
  }

  if (view === 'threeQuarterR') {
    return {
      angles: {
        pelvis: -2,
        lumbar: 4,
        thorax: 5,
        neck: 3,
        head: 4,
        ribR: 7,
        ribL: 5,
        swivelR: 10,
        swivelL: -16,
        acromionR: -6,
        acromionL: 12,
        braceR: -4,
        braceL: -4,
        humerusR: 10,
        forearmR: 20,
        handR: -6,
        humerusL: -12,
        forearmL: -18,
        handL: 6,
        hipR: -4,
        hipL: -4,
        femurR: -8,
        shinR: 12,
        footR: -4,
        femurL: 10,
        shinL: -6,
        footL: 6,
      },
      flipX: {
        ribR: false, ribL: false, hipR: false, hipL: false, femurR: false, femurL: false,
      },
    };
  }

  if (view === 'threeQuarterL') {
    return {
      angles: {
        pelvis: 2,
        lumbar: -4,
        thorax: -5,
        neck: -3,
        head: -4,
        ribL: -7,
        ribR: -5,
        swivelL: -10,
        swivelR: 16,
        acromionL: 6,
        acromionR: -12,
        braceL: 4,
        braceR: 4,
        humerusL: -10,
        forearmL: -20,
        handL: 6,
        humerusR: 12,
        forearmR: 18,
        handR: -6,
        hipL: 4,
        hipR: 4,
        femurL: 8,
        shinL: -12,
        footL: 4,
        femurR: -10,
        shinR: 6,
        footR: -6,
      },
      flipX: {
        ribR: false, ribL: false, hipR: false, hipL: false, femurR: false, femurL: false,
      },
    };
  }

  if (view === 'sideR') {
    // Facing +X: Back rib (ribR) flips forward; shoulders swivel inward so arms are almost centered
    // while still favoring their own side (+X for L, -X for R), or crossed when favorOpposite = true.
    const swR = sideArmsFavorOpposite ? 31 : 23;
    const swL = sideArmsFavorOpposite ? -31 : -24;
    const acR = sideArmsFavorOpposite ? -23 : -17;
    const acL = sideArmsFavorOpposite ? 23 : 18;
    const humBias = sideArmsFavorOpposite ? -5 : 3;
    return {
      angles: {
        pelvis: -4,
        hipR: -5,
        hipL: 5,
        femurR: 15,
        shinR: -22,
        footR: 7,
        femurL: 12,
        shinL: 14,
        footL: -10,
        lumbar: 7,
        thorax: 8,
        ribR: 6,
        ribL: 8,
        neck: 5,
        head: 4,
        swivelR: swR,
        swivelL: swL,
        acromionR: acR,
        acromionL: acL,
        braceR: -6,
        braceL: 6,
        humerusR: -18 + humBias,
        forearmR: -28,
        handR: -6,
        humerusL: 12 - humBias,
        forearmL: -22,
        handL: 6,
      },
      flipX: {
        ribR: true,
        ribL: false,
        hipR: false,
        hipL: true,
        femurR: true,
        femurL: true,
      },
    };
  }

  // sideL: Facing -X: Back rib (ribL) flips forward toward -X; shoulders swivel inward almost centered
  const swL = sideArmsFavorOpposite ? -31 : -23;
  const swR = sideArmsFavorOpposite ? 31 : 24;
  const acL = sideArmsFavorOpposite ? 23 : 17;
  const acR = sideArmsFavorOpposite ? -23 : -18;
  const humBias = sideArmsFavorOpposite ? 5 : -3;
  return {
    angles: {
      pelvis: 4,
      hipL: 5,
      hipR: -5,
      femurL: -15,
      shinL: 22,
      footL: -7,
      femurR: -12,
      shinR: -14,
      footR: 10,
      lumbar: -7,
      thorax: -8,
      ribL: -6,
      ribR: -8,
      neck: -5,
      head: -4,
      swivelL: swL,
      swivelR: swR,
      acromionL: acL,
      acromionR: acR,
      braceL: 6,
      braceR: -6,
      humerusL: 18 + humBias,
      forearmL: 28,
      handL: 6,
      humerusR: -12 - humBias,
      forearmR: 22,
      handR: -6,
    },
    flipX: {
      ribL: true,
      ribR: false,
      hipL: false,
      hipR: true,
      femurR: true,
      femurL: true,
    },
  };
}

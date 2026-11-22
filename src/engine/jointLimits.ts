import type { JointId } from './motionFormat';

export interface AngleLimit {
  min: number;
  max: number;
  /** 0..1 biomechanical resistance weighting during FABRIK & soft IK passes */
  stiffness?: number;
}

/**
 * Canonical public-domain proportional & biomechanical constants:
 * - Vitruvius, De architectura (Book III, Ch. 1):
 *   "From the sole of the foot to below the knee will be the fourth part of the man" (1/4),
 *   "From below the knee to the beginning of the genitals will be the fourth part of the man" (1/4),
 *   foot ~ 1/6 stature, hand (wrist to middle fingertip) ~ 1/10 stature.
 * - Leonardo da Vinci, Vitruvian Man notes (c. 1490):
 *   "The length of the outspread arms is equal to the height of the man" (1.0),
 *   "From the elbow to the tip of the hand will be the fifth part of a man" (1/5),
 *   "From the elbow to the angle of the armpit will be the eighth part of the man" (1/8),
 *   "If you open your legs so wide that they reduce your height by 1/14... and the space
 *    between the legs is an equilateral triangle" (~60 deg full spread -> 1/14 vertical drop).
 * - Eadweard Muybridge, The Human Figure in Motion (1901):
 *   Sequential phase locomotion: ~62% stance vs. ~38% swing duration, contralateral
 *   arm-to-leg opposing swing (armL <-> legR, armR <-> legL), and pelvis/thorax
 *   center-of-mass transfer across support shifts.
 */
export const CANONICAL_PROPORTIONS = {
  vitruvius: {
    lowerLegToHeight: 1 / 4,
    thighToHeight: 1 / 4,
    footToHeight: 1 / 6,
    handToHeight: 1 / 10,
  },
  leonardo: {
    armSpanToHeight: 1.0,
    forearmHandToHeight: 1 / 5,
    upperArmToHeight: 1 / 8,
    legSplayHeightDrop: 1 / 14,
    equilateralSplayHalfDeg: 30,
  },
  muybridge: {
    stancePhaseRatio: 0.62,
    swingPhaseRatio: 0.38,
    contralateralArmLegCoupling: 0.42,
    forearmSwingFollow: 0.28,
    spineCounterRotationGain: 0.14,
    pelvisStrideDropMaxRatio: 0.045,
    movingVelocityThresholdPx: 1.5,
    movingStrideAngleThresholdDeg: 14,
  },
} as const;

export const ANGULAR_EPSILON_DEG = 1e-4;
export const VECTOR_EPSILON_PX = 1e-3;

export function safeFinite(val: number, fallback = 0): number {
  return Number.isFinite(val) ? val : fallback;
}

export function snapAngularEpsilon(deg: number): number {
  const safe = safeFinite(deg, 0);
  return Math.abs(safe) < ANGULAR_EPSILON_DEG ? 0 : safe;
}

/**
 * Unified anatomical rotation bounds & biomechanical stiffness weights across the 43-joint rig.
 * Angles are in degrees in parent-local space, tuned to the 2500x8742 puppet geometry.
 */
export const JOINT_LIMITS: Partial<Record<JointId, AngleLimit>> = {
  pelvis: { min: -180, max: 180, stiffness: 0.1 },
  hipR: { min: -145, max: 145, stiffness: 0.2 },
  hipL: { min: -145, max: 145, stiffness: 0.2 },
  lumbar: { min: -78, max: 78, stiffness: 0.28 },
  thorax: { min: -72, max: 72, stiffness: 0.32 },
  ribR: { min: -28, max: 28, stiffness: 0.35 },
  ribL: { min: -28, max: 28, stiffness: 0.35 },
  neck: { min: -45, max: 45, stiffness: 0.32 },
  head: { min: -65, max: 65, stiffness: 0.2 },
  lip: { min: -35, max: 18, stiffness: 0.25 },
  braceL: { min: -18, max: 18, stiffness: 0.65 },
  braceR: { min: -18, max: 18, stiffness: 0.65 },
  swivelL: { min: -42, max: 42, stiffness: 0.45 },
  swivelR: { min: -42, max: 42, stiffness: 0.45 },
  acromionL: { min: -45, max: 60, stiffness: 0.3 },
  acromionR: { min: -60, max: 45, stiffness: 0.3 },
  humerusL: { min: -175, max: 165, stiffness: 0.1 },
  humerusR: { min: -165, max: 175, stiffness: 0.1 },
  forearmL: { min: -155, max: 15, stiffness: 0.08 },
  forearmR: { min: -15, max: 155, stiffness: 0.08 },
  handL: { min: -85, max: 85, stiffness: 0.15 },
  handR: { min: -85, max: 85, stiffness: 0.15 },
  thumbL: { min: -75, max: 75, stiffness: 0.15 },
  thumbR: { min: -75, max: 75, stiffness: 0.15 },
  fingerL: { min: -95, max: 45, stiffness: 0.15 },
  fingerR: { min: -45, max: 95, stiffness: 0.15 },
  femurL: { min: -135, max: 120, stiffness: 0.12 },
  femurR: { min: -120, max: 135, stiffness: 0.12 },
  shinL: { min: -15, max: 150, stiffness: 0.08 },
  shinR: { min: -150, max: 15, stiffness: 0.08 },
  footL: { min: -65, max: 75, stiffness: 0.2 },
  footR: { min: -75, max: 65, stiffness: 0.2 },
};

export function clampJointAngle(joint: JointId | string, angleDeg: number, enforce: boolean): number {
  const safe = safeFinite(angleDeg, 0);
  const norm = snapAngularEpsilon(((((safe + 180) % 360) + 360) % 360) - 180);
  if (!enforce) return norm;
  const limit = JOINT_LIMITS[joint as JointId];
  if (!limit) return norm;
  return snapAngularEpsilon(Math.max(limit.min, Math.min(limit.max, norm)));
}

export function getJointStiffness(joint: JointId | string): number {
  return JOINT_LIMITS[joint as JointId]?.stiffness ?? 0.15;
}

/**
 * Soft biomechanical damping during iterative solvers: blends target angle against
 * prior angle proportionally to joint stiffness, avoiding brittle limit snapping.
 */
export function dampAngleWithStiffness(
  joint: JointId | string,
  prevDeg: number,
  targetDeg: number,
  enforce: boolean,
  strength = 1,
): number {
  const safePrev = safeFinite(prevDeg, 0);
  const safeTgt = safeFinite(targetDeg, safePrev);
  const delta = ((((safeTgt - safePrev + 180) % 360) + 360) % 360) - 180;
  const stiff = Math.max(0, Math.min(0.85, getJointStiffness(joint) * safeFinite(strength, 1)));
  const blended = safePrev + delta * (1 - stiff * 0.45);
  return clampJointAngle(joint, blended, enforce);
}

import poseCatalogRaw from '../data/poseCatalog.json';
import {
  type RibAnchorMode,
  clampAnatomicalAngle,
  clampChungusRibAngle,
  clampRealisticShoulder,
  normalizeDeg,
  pos,
  solveRig,
} from './fkEngine';
import {
  type GotzBuild,
  type GotzHandState,
  applyGotzPreset,
  cloneGotzState,
  createDefaultGotzHandState,
} from './gotzHandEngine';
import {
  applyGroundAndBalance,
  computeCanonicalProportionMetrics,
  computePoseCenterOfGravity,
  inferPostureRegime,
} from './groundSystem';
import { DEFAULT_GROUND_Y, PERSP_DEFAULT, computePerspectiveSpineBend } from './ikEngine';
import { mirrorPoseSide } from './motionFormat';
import { HEAD_TURN_SEQUENCE, getHeadTurnStep } from './skullKitModels';
import { applyBodyViewPivots, getBodyViewPresetPose } from './turnaround';
import type {
  BodyTurnView,
  HeadTurnStep,
  PerspectiveState,
  RawRigDef,
  RigNode,
  SkullViewMode,
} from './types';

export type PoseMood =
  | 'composed'
  | 'heroic'
  | 'exuberant'
  | 'melancholic'
  | 'guarded'
  | 'predatory'
  | 'inquisitive'
  | 'dramatic';

export type BuiltinPoseStance =
  | 'vitruvian'
  | 'contrapposto'
  | 'wideReady'
  | 'walkStride'
  | 'sprintDrive'
  | 'lungeReach'
  | 'airborne'
  | 'seatedPerched'
  | 'kneelingPoise'
  | 'deepCoil'
  | 'dynamicTwist'
  | 'promethean';

export type PoseStance = BuiltinPoseStance | (string & {});

export type PerspectiveElevation =
  | 'extremeLow'
  | 'wormsEye'
  | 'eyeLevel'
  | 'birdsEye'
  | 'extremeHigh';

export type PerspectiveVanishing = 'left' | 'center' | 'right';
export type SkullFacingChoice = 'auto' | 'front' | 'sideR' | 'back' | 'sideL';
export type IntensityLevel = 'subtle' | 'standard' | 'dramatic' | 'extreme';
export type SymmetryMode = 'procedural' | 'mirrorLtoR' | 'mirrorRtoL' | 'mirrorArms';
export type TorsoLeanChoice = 'auto' | 'upright' | 'forward' | 'archBack' | 'swayL' | 'swayR';
export type HeadPitchChoice = 'auto' | 'level' | 'chinUp' | 'chinTuck' | 'tiltL' | 'tiltR';
export type JawChoice = 'auto' | 'closed' | 'parted' | 'open';
export type ArmAttitudeChoice = 'auto' | 'relaxed' | 'guard' | 'spread' | 'overhead' | 'akimbo';
export type FootPlantChoice = 'auto' | 'flat' | 'heelLift' | 'tiptoe';
export type LegStanceChoice =
  | 'auto'
  | 'planted'
  | 'air'
  | 'single'
  | 'seated'
  | 'oneKnee'
  | 'twoKnee'
  | 'tiptoe';
export type LegStanceSide = 'L' | 'both' | 'R';
export type HandGestureChoice = 'auto' | 'Neutral' | 'Open' | 'Grip' | 'Fist' | 'Point' | 'Peace' | 'Pinch' | 'Don';

export interface StanceCamSpec {
  waveform: 'sine' | 'dwell' | 'pendulum' | 'ratchet';
  phaseLag: number;
  breathAmp: number;
}

export interface StanceSeedEntry {
  id: string;
  label: string;
  category: string;
  cue: string;
  regime: 'standing' | 'moving';
  airborne?: boolean;
  defaultRibAnchor?: RibAnchorMode;
  defaultWings?: boolean;
  rootOffset: [number, number];
  nodes: Record<string, number>;
  flipX?: Record<string, boolean>;
  cam?: StanceCamSpec;
}

export const STARTER_STANCE_CATALOG: StanceSeedEntry[] = (
  poseCatalogRaw as unknown as { stances: StanceSeedEntry[] }
).stances;

export interface ProceduralRecipe {
  mood: PoseMood;
  stance: PoseStance;
  bodyView: BodyTurnView;
  sideArmsFavorOpposite: boolean;
  elevation: PerspectiveElevation;
  vanishing: PerspectiveVanishing;
  skullFacing: SkullFacingChoice;
  intensity: IntensityLevel;
  symmetry: SymmetryMode;
  torsoLean: TorsoLeanChoice;
  headPitch: HeadPitchChoice;
  jaw: JawChoice;
  armAttitude: ArmAttitudeChoice;
  ribAnchor: RibAnchorMode;
  prometheusWings: boolean;
  handBuild: GotzBuild;
  handGestureL: HandGestureChoice;
  handGestureR: HandGestureChoice;
  footPlant: FootPlantChoice;
  legStanceMode: LegStanceChoice;
  legStanceSide: LegStanceSide;
  constrainLimits: boolean;
  bondOn: boolean;
  footGravity: boolean;
  balanceCounterweight: boolean;
  contralateralMotion: boolean;
  seedVariant: 0 | 1 | 2 | 3;
  initTwist?: number;
}

export const DEFAULT_PROCEDURAL_RECIPE: ProceduralRecipe = {
  mood: 'composed',
  stance: 'vitruvian',
  bodyView: 'front',
  sideArmsFavorOpposite: false,
  elevation: 'eyeLevel',
  vanishing: 'center',
  skullFacing: 'auto',
  intensity: 'standard',
  symmetry: 'procedural',
  torsoLean: 'auto',
  headPitch: 'auto',
  jaw: 'auto',
  armAttitude: 'auto',
  ribAnchor: 'upper',
  prometheusWings: false,
  handBuild: 'standard',
  handGestureL: 'auto',
  handGestureR: 'auto',
  footPlant: 'auto',
  legStanceMode: 'auto',
  legStanceSide: 'both',
  constrainLimits: true,
  bondOn: true,
  footGravity: true,
  balanceCounterweight: true,
  contralateralMotion: true,
  seedVariant: 0,
  initTwist: 0,
};

/**
 * Generates an opening Vitruvian recipe with a slight procedural twist so initial starts
 * are always grounded in Vitruvian poise yet never identical twice.
 */
export function createInitialSessionRecipe(): ProceduralRecipe {
  const angleSign = Math.random() < 0.5 ? -1 : 1;
  const twistMag = 0.45 + Math.random() * 0.55; // 0.45 .. 1.00
  const seedPick = Math.floor(Math.random() * 4) as 0 | 1 | 2 | 3;
  return {
    ...DEFAULT_PROCEDURAL_RECIPE,
    stance: 'vitruvian',
    bodyView: 'front',
    seedVariant: seedPick,
    initTwist: Math.round(angleSign * twistMag * 1000) / 1000,
  };
}

export interface ChoiceOption<T extends string | number> {
  id: T;
  label: string;
  cue: string;
  category?: string;
}

export const MOOD_OPTIONS: Array<ChoiceOption<PoseMood>> = [
  { id: 'composed', label: 'Composed', cue: 'Poised neutral axis, relaxed shoulders' },
  { id: 'heroic', label: 'Heroic', cue: 'Raised sternum, lifted chin, open shoulders' },
  { id: 'exuberant', label: 'Exuberant', cue: 'Expansive upward reach, flared ribcage' },
  { id: 'melancholic', label: 'Melancholic', cue: 'Compressive slump, dropped shoulders, bowed head' },
  { id: 'guarded', label: 'Guarded', cue: 'Tucked chin, raised clavicles, protective arms' },
  { id: 'predatory', label: 'Predatory', cue: 'Forward coiled thorax, aggressive jaw, claw tension' },
  { id: 'inquisitive', label: 'Inquisitive', cue: 'Tilted skull, asymmetric shoulder poise' },
  { id: 'dramatic', label: 'Dramatic', cue: 'High-contrast S-curve spine, theatrical sweep' },
];

export const STANCE_OPTIONS: Array<ChoiceOption<PoseStance>> = STARTER_STANCE_CATALOG.map((s) => ({
  id: s.id,
  label: s.label,
  cue: s.cue,
  category: s.category,
}));

export const ELEVATION_OPTIONS: Array<ChoiceOption<PerspectiveElevation>> = [
  { id: 'extremeLow', label: 'Extreme Low', cue: 'Horizon near ankles — towering heroic bias' },
  { id: 'wormsEye', label: "Worm's-Eye", cue: 'Low horizon — upright braced lumbar extension' },
  { id: 'eyeLevel', label: 'Eye-Level', cue: 'Neutral horizon — balanced natural posture' },
  { id: 'birdsEye', label: "Bird's-Eye", cue: 'High horizon — compressive upper-spine lean' },
  { id: 'extremeHigh', label: 'Extreme High', cue: 'Steep overhead horizon — deep scapular hang' },
];

export const VANISHING_OPTIONS: Array<ChoiceOption<PerspectiveVanishing>> = [
  { id: 'left', label: 'Left VP', cue: 'Horizon vanishing point offset left' },
  { id: 'center', label: 'Centered VP', cue: 'Vanishing point aligned on skeleton plumb' },
  { id: 'right', label: 'Right VP', cue: 'Horizon vanishing point offset right' },
];

export const SKULL_FACING_OPTIONS: Array<ChoiceOption<SkullFacingChoice>> = [
  { id: 'auto', label: 'Auto-Sync', cue: 'Follows body turnaround & mood look' },
  { id: 'front', label: 'Front', cue: 'Direct frontal cranium' },
  { id: 'sideR', label: 'Side R', cue: 'Right profile skull kit' },
  { id: 'back', label: 'Back', cue: 'Occipital rear skull kit' },
  { id: 'sideL', label: 'Side L', cue: 'Left profile skull kit' },
];

export const INTENSITY_OPTIONS: Array<ChoiceOption<IntensityLevel>> = [
  { id: 'subtle', label: 'Subtle', cue: '0.58× understated micro-expression' },
  { id: 'standard', label: 'Standard', cue: '1.00× balanced procedural phrasing' },
  { id: 'dramatic', label: 'Dramatic', cue: '1.35× heightened silhouette read' },
  { id: 'extreme', label: 'Extreme', cue: '1.68× maximum dynamic exaggeration' },
];

export const SYMMETRY_OPTIONS: Array<ChoiceOption<SymmetryMode>> = [
  { id: 'procedural', label: 'Natural Asym', cue: 'Organic left/right procedural offset' },
  { id: 'mirrorLtoR', label: 'Mirror L → R', cue: 'Mirrors left side onto right side' },
  { id: 'mirrorRtoL', label: 'Mirror R → L', cue: 'Mirrors right side onto left side' },
  { id: 'mirrorArms', label: 'Mirror Arms', cue: 'Locks symmetric upper-body arms only' },
];

export const TORSO_LEAN_OPTIONS: Array<ChoiceOption<TorsoLeanChoice>> = [
  { id: 'auto', label: 'Auto', cue: 'Driven by Mood & Stance' },
  { id: 'upright', label: 'Upright', cue: 'Aligned vertical spine stack' },
  { id: 'forward', label: 'Pitch', cue: 'Coiled forward inclination' },
  { id: 'archBack', label: 'Arch Back', cue: 'Lifted sternum & thoracic extension' },
  { id: 'swayL', label: 'Sway L', cue: 'Counter-curve toward left hip' },
  { id: 'swayR', label: 'Sway R', cue: 'Counter-curve toward right hip' },
];

export const HEAD_PITCH_OPTIONS: Array<ChoiceOption<HeadPitchChoice>> = [
  { id: 'auto', label: 'Auto', cue: 'Mood-driven gaze' },
  { id: 'level', label: 'Level', cue: 'Neutral horizon gaze' },
  { id: 'chinUp', label: 'Chin Up', cue: 'Lifted defiant crown' },
  { id: 'chinTuck', label: 'Chin Tuck', cue: 'Protected lowered brow' },
  { id: 'tiltL', label: 'Tilt L', cue: 'Curious left ear tilt' },
  { id: 'tiltR', label: 'Tilt R', cue: 'Curious right ear tilt' },
];

export const JAW_OPTIONS: Array<ChoiceOption<JawChoice>> = [
  { id: 'auto', label: 'Auto', cue: 'Matches emotional mood' },
  { id: 'closed', label: 'Closed', cue: 'Teeth & mandible sealed' },
  { id: 'parted', label: 'Parted', cue: 'Subtle breathing gap' },
  { id: 'open', label: 'Open', cue: 'Expressive wide mandible drop' },
];

export const ARM_ATTITUDE_OPTIONS: Array<ChoiceOption<ArmAttitudeChoice>> = [
  { id: 'auto', label: 'Auto', cue: 'Mood + stance procedural arms' },
  { id: 'relaxed', label: 'Relaxed', cue: 'Natural gravity hang' },
  { id: 'guard', label: 'Guard', cue: 'High defensive elbows & hands' },
  { id: 'spread', label: 'Open Spread', cue: 'Vitruvian lateral wing span' },
  { id: 'overhead', label: 'Overhead', cue: 'Ascendant raised reach' },
  { id: 'akimbo', label: 'On Hips', cue: 'Braced elbows on iliac crest' },
];

export const FOOT_PLANT_OPTIONS: Array<ChoiceOption<FootPlantChoice>> = [
  { id: 'auto', label: 'Auto', cue: 'Follows stance weight transfer' },
  { id: 'flat', label: 'Flat Plant', cue: 'Full sole grounded parallel' },
  { id: 'heelLift', label: 'Heel Lift', cue: 'Dynamic ball-of-foot poise' },
  { id: 'tiptoe', label: 'Tip-Toe', cue: 'Elevated plantar extension' },
];

export const LEG_STANCE_OPTIONS: Array<ChoiceOption<LegStanceChoice>> = [
  { id: 'auto', label: 'Auto', cue: 'Follows base Stance JSON legs' },
  { id: 'planted', label: 'Planted', cue: 'Grounded flat-sole weight support' },
  { id: 'air', label: 'Airborne', cue: 'Suspended off-ground leap arc' },
  { id: 'single', label: 'Single Leg', cue: 'Balanced on one support leg' },
  { id: 'seated', label: 'Seated', cue: '90° hip flexion plinth posture' },
  { id: 'oneKnee', label: '1-Knee', cue: 'Heroic single-knee crouch lunge' },
  { id: 'twoKnee', label: '2-Knee', cue: 'Grounded bilateral kneeling crouch' },
  { id: 'tiptoe', label: 'Tip-Toe', cue: 'Elevated plantarflexed ball stance' },
];

export const LEG_SIDE_OPTIONS: Array<ChoiceOption<LegStanceSide>> = [
  { id: 'L', label: 'Left Side', cue: 'Favor or emphasize Left leg' },
  { id: 'both', label: 'Both', cue: 'Apply across both legs together' },
  { id: 'R', label: 'Right Side', cue: 'Favor or emphasize Right leg' },
];

export const HAND_GESTURE_OPTIONS: HandGestureChoice[] = [
  'auto',
  'Neutral',
  'Open',
  'Grip',
  'Fist',
  'Point',
  'Peace',
  'Pinch',
  'Don',
];

export interface GeneratedPoseResult {
  angles: Record<string, number>;
  root: [number, number];
  flipX: Record<string, boolean>;
  bodyView: BodyTurnView;
  sideArmsFavorOpposite: boolean;
  headStep: HeadTurnStep;
  skullView: SkullViewMode;
  ribAnchor: RibAnchorMode;
  prometheusWings: boolean;
  perspective: PerspectiveState;
  footToeBreak: { R: number; L: number };
  handStates: {
    L: GotzHandState;
    R: GotzHandState;
  };
  camHint: StanceCamSpec;
  metrics: {
    regime: 'standing' | 'moving';
    armSpanRatio: number;
    legSplayDeg: number;
    pelvisShiftPx: [number, number];
    summary: string;
  };
}

interface JointDeltaMap {
  [jointId: string]: number;
}

const INTENSITY_GAIN: Record<IntensityLevel, number> = {
  subtle: 0.58,
  standard: 1.0,
  dramatic: 1.35,
  extreme: 1.68,
};

const MOOD_TEMPLATES: Record<
  PoseMood,
  {
    angles: JointDeltaMap;
    handL: string;
    handR: string;
    jawDeg: number;
    spineCounterWeight: number;
    clavicleFollowRatio: number;
  }
> = {
  composed: {
    angles: {
      lumbar: 0,
      thorax: 0,
      neck: 0,
      head: 0,
      swivelL: 2,
      swivelR: -2,
      acromionL: -2,
      acromionR: 2,
      braceL: 1,
      braceR: -1,
      humerusL: -6,
      humerusR: 6,
      forearmL: -12,
      forearmR: 12,
      handL: 4,
      handR: -4,
      ribL: 2,
      ribR: -2,
    },
    handL: 'Neutral',
    handR: 'Neutral',
    jawDeg: 0,
    spineCounterWeight: 0.58,
    clavicleFollowRatio: 0.22,
  },
  heroic: {
    angles: {
      lumbar: -6,
      thorax: 7,
      neck: -3,
      head: -5,
      swivelL: 14,
      swivelR: -14,
      acromionL: -12,
      acromionR: 12,
      braceL: 6,
      braceR: -6,
      humerusL: -28,
      humerusR: 28,
      forearmL: -26,
      forearmR: 26,
      handL: 12,
      handR: -12,
      ribL: 12,
      ribR: -12,
    },
    handL: 'Fist',
    handR: 'Fist',
    jawDeg: 0,
    spineCounterWeight: 0.65,
    clavicleFollowRatio: 0.34,
  },
  exuberant: {
    angles: {
      lumbar: 5,
      thorax: -8,
      neck: -5,
      head: -9,
      swivelL: 22,
      swivelR: -22,
      acromionL: -18,
      acromionR: 18,
      braceL: 9,
      braceR: -9,
      humerusL: -124,
      humerusR: 118,
      forearmL: -22,
      forearmR: 28,
      handL: -16,
      handR: 16,
      ribL: 14,
      ribR: -14,
    },
    handL: 'Open',
    handR: 'Open',
    jawDeg: 10,
    spineCounterWeight: 0.45,
    clavicleFollowRatio: 0.42,
  },
  melancholic: {
    angles: {
      lumbar: 10,
      thorax: 14,
      neck: 15,
      head: 18,
      swivelL: -14,
      swivelR: 14,
      acromionL: 14,
      acromionR: -14,
      braceL: -7,
      braceR: 7,
      humerusL: 8,
      humerusR: -8,
      forearmL: -18,
      forearmR: 18,
      handL: 14,
      handR: -14,
      ribL: -10,
      ribR: 10,
    },
    handL: 'Neutral',
    handR: 'Neutral',
    jawDeg: 3,
    spineCounterWeight: 0.25,
    clavicleFollowRatio: 0.18,
  },
  guarded: {
    angles: {
      lumbar: 7,
      thorax: 11,
      neck: 10,
      head: -8,
      swivelL: -22,
      swivelR: 22,
      acromionL: 12,
      acromionR: -12,
      braceL: -10,
      braceR: 10,
      humerusL: 16,
      humerusR: -22,
      forearmL: -112,
      forearmR: 106,
      handL: -18,
      handR: 18,
      ribL: -8,
      ribR: 8,
    },
    handL: 'Fist',
    handR: 'Fist',
    jawDeg: 0,
    spineCounterWeight: 0.35,
    clavicleFollowRatio: 0.28,
  },
  predatory: {
    angles: {
      lumbar: 12,
      thorax: 16,
      neck: -14,
      head: -12,
      swivelL: -16,
      swivelR: 16,
      acromionL: -10,
      acromionR: 10,
      braceL: -6,
      braceR: 6,
      humerusL: -42,
      humerusR: 34,
      forearmL: -74,
      forearmR: 66,
      handL: 28,
      handR: -28,
      ribL: 10,
      ribR: -10,
    },
    handL: 'Grip',
    handR: 'Grip',
    jawDeg: 13,
    spineCounterWeight: 0.48,
    clavicleFollowRatio: 0.36,
  },
  inquisitive: {
    angles: {
      lumbar: -5,
      thorax: 7,
      neck: 10,
      head: 16,
      swivelL: -10,
      swivelR: 6,
      acromionL: 8,
      acromionR: -6,
      braceL: -4,
      braceR: 3,
      humerusL: -14,
      humerusR: 28,
      forearmL: -16,
      forearmR: 118,
      handL: 8,
      handR: -22,
      ribL: 4,
      ribR: -6,
    },
    handL: 'Open',
    handR: 'Pinch',
    jawDeg: 2,
    spineCounterWeight: 0.52,
    clavicleFollowRatio: 0.25,
  },
  dramatic: {
    angles: {
      lumbar: -12,
      thorax: 16,
      neck: -10,
      head: -12,
      swivelL: 20,
      swivelR: -16,
      acromionL: -18,
      acromionR: 14,
      braceL: 8,
      braceR: -6,
      humerusL: -108,
      humerusR: 48,
      forearmL: -42,
      forearmR: 84,
      handL: -32,
      handR: 28,
      ribL: 16,
      ribR: -14,
    },
    handL: 'Don',
    handR: 'Open',
    jawDeg: 9,
    spineCounterWeight: 0.62,
    clavicleFollowRatio: 0.4,
  },
};

/**
 * Automaton Mechanical Linkage Couplings:
 * Propagates deterministic cable/gear counter-rotations from primary drivers
 * (pelvis -> spine/neck horizon leveling, humerus -> clavicle swivel/acromion elevation).
 */
function applyAutomatonLinkageCouplings(
  by: Record<string, RigNode>,
  spineCounterWeight: number,
  clavicleFollowRatio: number,
  skipHeadAutoLevel: boolean,
): void {
  const pel = by.pelvis;
  const lum = by.lumbar;
  const th = by.thorax;
  const nk = by.neck;
  const hd = by.head;

  if (pel && lum && th) {
    // Counter-balance cable: pelvis roll tilts lumbar & thorax oppositely by weighted ratio
    const pelTilt = pel.ang;
    lum.ang += -pelTilt * spineCounterWeight * 0.48;
    th.ang += -pelTilt * spineCounterWeight * 0.34;
    if (!skipHeadAutoLevel && nk && hd) {
      const accumTilt = pel.ang + lum.ang + th.ang;
      nk.ang += -accumTilt * 0.28;
      hd.ang += -accumTilt * 0.22;
    }
  }

  // Clavicle-Scapula Cable Linkage: raising upper arm elevates acromion & rotates swivel
  for (const side of ['L', 'R'] as const) {
    const hum = by['humerus' + side];
    const acro = by['acromion' + side];
    const swiv = by['swivel' + side];
    if (!hum || !acro || !swiv) continue;
    const armLiftMag = side === 'L' ? Math.max(0, -hum.ang - 25) : Math.max(0, hum.ang - 25);
    if (armLiftMag > 0) {
      const sign = side === 'L' ? -1 : 1;
      acro.ang += sign * armLiftMag * clavicleFollowRatio * 0.26;
      swiv.ang += -sign * armLiftMag * clavicleFollowRatio * 0.16;
    }
  }
}

export function buildPerspectiveFromToggles(
  elevation: PerspectiveElevation,
  vanishing: PerspectiveVanishing,
  enabled: boolean,
): PerspectiveState {
  const groundY = DEFAULT_GROUND_Y;
  const horizonMap: Record<PerspectiveElevation, number> = {
    extremeLow: groundY - 420,
    wormsEye: groundY - 1450,
    eyeLevel: PERSP_DEFAULT.horizonY,
    birdsEye: 620,
    extremeHigh: -1150,
  };
  const vpXMap: Record<PerspectiveVanishing, number> = {
    left: 240,
    center: 1257,
    right: 2274,
  };
  return {
    enabled,
    groundY,
    horizonY: horizonMap[elevation],
    vpX: vpXMap[vanishing],
    floorScale: PERSP_DEFAULT.floorScale,
  };
}

export function resolveProceduralHeadStep(
  bodyView: BodyTurnView,
  skullFacing: SkullFacingChoice,
  mood: PoseMood,
): HeadTurnStep {
  if (skullFacing !== 'auto') {
    const map: Record<Exclude<SkullFacingChoice, 'auto'>, HeadTurnStep> = {
      front: 0,
      sideR: 1,
      back: 2,
      sideL: 3,
    };
    return map[skullFacing];
  }
  if (bodyView === 'back') return 2;
  if (bodyView === 'sideR') return 1;
  if (bodyView === 'sideL') return 3;
  if (bodyView === 'threeQuarterR') {
    return mood === 'inquisitive' || mood === 'guarded' ? 0 : 1;
  }
  if (bodyView === 'threeQuarterL') {
    return mood === 'inquisitive' || mood === 'guarded' ? 0 : 3;
  }
  return 0;
}

function seedMicroDelta(seed: 0 | 1 | 2 | 3, jointId: string): number {
  if (seed === 0) return 0;
  let hash = seed * 2654435761;
  for (let i = 0; i < jointId.length; i++) {
    hash = ((hash << 5) - hash + jointId.charCodeAt(i)) | 0;
  }
  const norm = ((hash & 0xffff) / 0xffff) * 2 - 1;
  if (jointId === 'pelvis' || jointId === 'lumbar' || jointId === 'thorax') {
    return norm * 4.5;
  }
  if (jointId === 'neck' || jointId === 'head') {
    return norm * 6.5;
  }
  if (jointId.startsWith('humerus') || jointId.startsWith('forearm')) {
    return norm * 11;
  }
  if (jointId.startsWith('femur') || jointId.startsWith('shin')) {
    return norm * 7;
  }
  return norm * 4;
}

function buildHandStateFromToggles(
  side: 'L' | 'R',
  build: GotzBuild,
  gesture: HandGestureChoice,
  moodDefault: string,
  limits: boolean,
): GotzHandState {
  const base = createDefaultGotzHandState(side === 'L');
  const chosenPreset = gesture === 'auto' ? moodDefault : gesture;
  const withPreset = applyGotzPreset(base, chosenPreset);
  return {
    ...withPreset,
    build,
    limits: limits ? 'realistic' : 'elastic',
    mirror: side === 'L',
  };
}

export function generateProceduralPose(
  recipe: ProceduralRecipe,
  nodes: RigNode[],
  by: Record<string, RigNode>,
  options?: {
    perspGridVisible?: boolean;
    camZ?: number;
    customStances?: StanceSeedEntry[];
  },
): GeneratedPoseResult {
  const moodSpec = MOOD_TEMPLATES[recipe.mood];
  const allStances = options?.customStances?.length
    ? [...STARTER_STANCE_CATALOG, ...options.customStances]
    : STARTER_STANCE_CATALOG;
  const stanceSpec =
    allStances.find((s) => s.id === recipe.stance) ?? STARTER_STANCE_CATALOG[1];
  const gain = INTENSITY_GAIN[recipe.intensity];
  const isSculpturalPreset = stanceSpec.id === 'promethean';

  // 1. Load Base Stance JSON
  for (const n of nodes) {
    n.ang = stanceSpec.nodes[n.id] ?? 0;
    n.flipX = !!(stanceSpec.flipX && stanceSpec.flipX[n.id]);
  }
  const root = nodes.find((n) => !n.parent) || nodes[0];
  if (root) {
    root.tx = stanceSpec.rootOffset[0];
    root.ty = stanceSpec.rootOffset[1];
  }

  // 2. Apply Body View turnaround foundation & pivots
  const turnPreset = getBodyViewPresetPose(recipe.bodyView, recipe.sideArmsFavorOpposite);
  applyBodyViewPivots(nodes, by, recipe.bodyView, recipe.ribAnchor);

  const isSideView = recipe.bodyView === 'sideR' || recipe.bodyView === 'sideL';
  const baseTurnMix = isSculpturalPreset ? 0.35 : 0.76;
  for (const [id, ang] of Object.entries(turnPreset.angles)) {
    const n = by[id];
    if (!n || n.lock) continue;
    const isShoulderRibNode =
      id === 'ribR' ||
      id === 'ribL' ||
      id === 'swivelR' ||
      id === 'swivelL' ||
      id === 'acromionR' ||
      id === 'acromionL' ||
      id === 'braceR' ||
      id === 'braceL';
    const mix = isSideView && isShoulderRibNode ? 1.0 : baseTurnMix;
    if (isSideView && isShoulderRibNode) {
      // Commit side inward shoulder swivels & forward-flipped rib orientation decisively
      n.ang = ang + n.ang * 0.16;
    } else {
      n.ang += ang * mix;
    }
  }
  for (const [id, fx] of Object.entries(turnPreset.flipX)) {
    if (by[id]) by[id].flipX = fx;
  }

  // 3. Additive Mood Layering scaled by Intensity toggle
  const moodWeight = isSculpturalPreset ? 0.42 * gain : gain;
  for (const [id, ang] of Object.entries(moodSpec.angles)) {
    const n = by[id];
    if (!n || n.lock) continue;
    if (
      stanceSpec.id === 'vitruvian' &&
      recipe.armAttitude === 'auto' &&
      (id === 'humerusL' || id === 'humerusR' || id === 'forearmL' || id === 'forearmR')
    ) {
      n.ang += ang * 0.18 * gain;
      continue;
    }
    const dampSideSwivel =
      isSideView && (id === 'swivelL' || id === 'swivelR' || id === 'acromionL' || id === 'acromionR')
        ? 0.28
        : 1;
    n.ang += ang * moodWeight * dampSideSwivel;
  }

  // 4. Discrete Toggle Overrides (Torso, Head, Jaw, Arm Attitude, Consolidated Leg Stance)
  if (recipe.torsoLean !== 'auto') {
    const leanMap: Record<Exclude<TorsoLeanChoice, 'auto'>, JointDeltaMap> = {
      upright: { pelvis: 0, lumbar: 0, thorax: 0 },
      forward: { lumbar: 14 * gain, thorax: 16 * gain },
      archBack: { lumbar: -12 * gain, thorax: -14 * gain, ribL: 8, ribR: -8 },
      swayL: { pelvis: -8 * gain, lumbar: -11 * gain, thorax: -8 * gain },
      swayR: { pelvis: 8 * gain, lumbar: 11 * gain, thorax: 8 * gain },
    };
    const spec = leanMap[recipe.torsoLean];
    if (recipe.torsoLean === 'upright') {
      if (by.pelvis) by.pelvis.ang = 0;
      if (by.lumbar) by.lumbar.ang = 0;
      if (by.thorax) by.thorax.ang = 0;
    } else {
      for (const [id, d] of Object.entries(spec)) {
        if (by[id]) by[id].ang += d;
      }
    }
  }

  if (recipe.headPitch !== 'auto') {
    const pitchMap: Record<Exclude<HeadPitchChoice, 'auto'>, { neck: number; head: number }> = {
      level: { neck: 0, head: 0 },
      chinUp: { neck: -12 * gain, head: -16 * gain },
      chinTuck: { neck: 14 * gain, head: 18 * gain },
      tiltL: { neck: -8 * gain, head: -14 * gain },
      tiltR: { neck: 8 * gain, head: 14 * gain },
    };
    const pSpec = pitchMap[recipe.headPitch];
    if (recipe.headPitch === 'level') {
      if (by.neck) by.neck.ang = 0;
      if (by.head) by.head.ang = 0;
    } else {
      if (by.neck) by.neck.ang += pSpec.neck;
      if (by.head) by.head.ang += pSpec.head;
    }
  }

  if (by.lip) {
    const jawVal =
      recipe.jaw === 'auto'
        ? moodSpec.jawDeg * gain
        : recipe.jaw === 'closed'
        ? 0
        : recipe.jaw === 'parted'
        ? 6
        : 16;
    by.lip.ang = jawVal;
  }

  if (recipe.armAttitude !== 'auto') {
    const armMap: Record<Exclude<ArmAttitudeChoice, 'auto'>, JointDeltaMap> = {
      relaxed: {
        swivelL: 2,
        swivelR: -2,
        acromionL: -2,
        acromionR: 2,
        humerusL: -5,
        humerusR: 5,
        forearmL: -10,
        forearmR: 10,
        handL: 4,
        handR: -4,
      },
      guard: {
        swivelL: -16,
        swivelR: 16,
        acromionL: 8,
        acromionR: -8,
        humerusL: 18,
        humerusR: -24,
        forearmL: -122,
        forearmR: 118,
        handL: -16,
        handR: 16,
      },
      spread: {
        swivelL: 16,
        swivelR: -16,
        acromionL: -14,
        acromionR: 14,
        humerusL: -90,
        humerusR: 90,
        forearmL: -6,
        forearmR: 6,
        handL: -10,
        handR: 10,
      },
      overhead: {
        swivelL: 26,
        swivelR: -26,
        acromionL: -24,
        acromionR: 24,
        humerusL: -152,
        humerusR: 152,
        forearmL: -14,
        forearmR: 14,
        handL: -12,
        handR: 12,
      },
      akimbo: {
        swivelL: 10,
        swivelR: -10,
        acromionL: -8,
        acromionR: 8,
        humerusL: -46,
        humerusR: 46,
        forearmL: 92,
        forearmR: -92,
        handL: 24,
        handR: -24,
      },
    };
    const chosenArms = armMap[recipe.armAttitude];
    for (const [id, val] of Object.entries(chosenArms)) {
      if (!by[id]) continue;
      if (isSideView && (id === 'swivelL' || id === 'swivelR' || id === 'acromionL' || id === 'acromionR')) {
        // Keep inward side shoulder swivel while layering additive arm attitude reach
        by[id].ang += val * 0.25;
      } else {
        by[id].ang = val;
      }
    }
  }

  let footToeBreakR = 0;
  let footToeBreakL = 0;
  let forceAirborneLegs = !!stanceSpec.airborne;

  const legSide = recipe.legStanceSide;
  const favorTurnSide: 'L' | 'R' =
    legSide !== 'both'
      ? legSide
      : recipe.bodyView === 'sideL' || recipe.bodyView === 'threeQuarterL'
        ? 'L'
        : 'R';

  const setLegPose = (legs: JointDeltaMap, rootDy?: number) => {
    for (const [id, val] of Object.entries(legs)) {
      if (by[id]) by[id].ang = val;
    }
    if (root && typeof rootDy === 'number') {
      root.ty = rootDy;
    }
  };

  if (recipe.legStanceMode !== 'auto') {
    const mode = recipe.legStanceMode;
    if (mode === 'planted') {
      forceAirborneLegs = false;
      if (legSide === 'L') {
        setLegPose({ pelvis: -4, hipL: -10, femurL: 10, shinL: 0, hipR: 20, femurR: -12, shinR: -4 }, 45);
      } else if (legSide === 'R') {
        setLegPose({ pelvis: 4, hipR: 10, femurR: -10, shinR: 0, hipL: -20, femurL: 12, shinL: 4 }, 45);
      } else {
        setLegPose({ pelvis: 0, hipR: 16, femurR: -14, shinR: 0, hipL: -16, femurL: 14, shinL: 0 }, 40);
      }
      for (const side of ['R', 'L'] as const) {
        const f = by['foot' + side];
        const t = by['toe' + side];
        if (f && by['hip' + side] && by['femur' + side] && by['shin' + side]) {
          const chainSum =
            (by.pelvis?.ang ?? 0) +
            by['hip' + side].ang +
            by['femur' + side].ang +
            by['shin' + side].ang;
          f.ang = -chainSum;
        }
        if (t) t.ang = 0;
      }
    } else if (mode === 'air') {
      forceAirborneLegs = true;
      if (legSide === 'R') {
        setLegPose({
          pelvis: 6,
          hipR: 34, femurR: 54, shinR: -96, footR: -24, toeR: 12,
          hipL: -18, femurL: -34, shinL: 28, footL: 26, toeL: -12,
        }, -540);
      } else if (legSide === 'L') {
        setLegPose({
          pelvis: -6,
          hipL: -34, femurL: -54, shinL: 96, footL: 24, toeL: -12,
          hipR: 18, femurR: 34, shinR: -28, footR: -26, toeR: 12,
        }, -540);
      } else {
        setLegPose({
          pelvis: 4,
          hipR: 28, femurR: 46, shinR: -84, footR: -26, toeR: 14,
          hipL: -24, femurL: -42, shinL: 58, footL: 26, toeL: -14,
        }, -580);
      }
    } else if (mode === 'single') {
      forceAirborneLegs = false;
      if (favorTurnSide === 'L') {
        // Weight on Left pillar leg; Right leg lifted cleanly off ground
        setLegPose({
          pelvis: -5,
          hipL: -8, femurL: 12, shinL: 0, footL: 0, toeL: 0,
          hipR: 28, femurR: 48, shinR: -98, footR: -22, toeR: 12,
        }, 65);
      } else {
        // Weight on Right pillar leg; Left leg lifted cleanly off ground
        setLegPose({
          pelvis: 5,
          hipR: 8, femurR: -12, shinR: 0, footR: 0, toeR: 0,
          hipL: -28, femurL: -48, shinL: 98, footL: 22, toeL: -12,
        }, 65);
      }
    } else if (mode === 'seated') {
      forceAirborneLegs = false;
      if (legSide === 'R') {
        setLegPose({
          pelvis: -4,
          hipR: 48, femurR: 38, shinR: -56, footR: -14, toeR: 6,
          hipL: -40, femurL: -32, shinL: 94, footL: 10, toeL: -4,
        }, 1260);
      } else if (legSide === 'L') {
        setLegPose({
          pelvis: -4,
          hipL: -48, femurL: -38, shinL: 56, footL: 14, toeL: -6,
          hipR: 40, femurR: 32, shinR: -94, footR: -10, toeR: 4,
        }, 1260);
      } else {
        setLegPose({
          pelvis: -4,
          hipR: 44, femurR: 34, shinR: -78, footR: -8, toeR: 0,
          hipL: -44, femurL: -34, shinL: 78, footL: 8, toeL: 0,
        }, 1280);
      }
    } else if (mode === 'oneKnee') {
      forceAirborneLegs = false;
      if (favorTurnSide === 'R') {
        // Right knee grounded, Left knee up planted forward
        setLegPose({
          pelvis: 4,
          hipR: 14, femurR: 12, shinR: -98, footR: -26, toeR: 18,
          hipL: -28, femurL: -48, shinL: 76, footL: 0, toeL: 0,
        }, 1240);
        footToeBreakR = 26;
      } else {
        // Left knee grounded, Right knee up planted forward
        setLegPose({
          pelvis: -4,
          hipL: -14, femurL: -12, shinL: 98, footL: 26, toeL: -18,
          hipR: 28, femurR: 48, shinR: -76, footR: 0, toeR: 0,
        }, 1240);
        footToeBreakL = 26;
      }
    } else if (mode === 'twoKnee') {
      forceAirborneLegs = false;
      if (legSide === 'R') {
        setLegPose({
          pelvis: 6,
          hipR: 22, femurR: 12, shinR: -116, footR: -30, toeR: 20,
          hipL: -16, femurL: -6, shinL: 102, footL: 24, toeL: -16,
        }, 1460);
        footToeBreakR = 28;
        footToeBreakL = 22;
      } else if (legSide === 'L') {
        setLegPose({
          pelvis: -6,
          hipL: -22, femurL: -12, shinL: 116, footL: 30, toeL: -20,
          hipR: 16, femurR: 6, shinR: -102, footR: -24, toeR: 16,
        }, 1460);
        footToeBreakR = 22;
        footToeBreakL = 28;
      } else {
        setLegPose({
          pelvis: 0,
          hipR: 20, femurR: 8, shinR: -112, footR: -28, toeR: 18,
          hipL: -20, femurL: -8, shinL: 112, footL: 28, toeL: -18,
        }, 1480);
        footToeBreakR = 26;
        footToeBreakL = 26;
      }
    } else if (mode === 'tiptoe') {
      forceAirborneLegs = false;
      const doR = legSide === 'both' || legSide === 'R';
      const doL = legSide === 'both' || legSide === 'L';
      if (doR) {
        if (by.hipR) by.hipR.ang = 12;
        if (by.femurR) by.femurR.ang = -10;
        if (by.shinR) by.shinR.ang = -4;
        if (by.footR) by.footR.ang = -32;
        if (by.toeR) by.toeR.ang = 26;
        footToeBreakR = 34;
      }
      if (doL) {
        if (by.hipL) by.hipL.ang = -12;
        if (by.femurL) by.femurL.ang = 10;
        if (by.shinL) by.shinL.ang = 4;
        if (by.footL) by.footL.ang = 32;
        if (by.toeL) by.toeL.ang = -26;
        footToeBreakL = 34;
      }
      if (root) root.ty = Math.min(root.ty, -40);
    }
  } else if (recipe.footPlant !== 'auto') {
    if (recipe.footPlant === 'flat') {
      for (const side of ['R', 'L'] as const) {
        const f = by['foot' + side];
        const t = by['toe' + side];
        if (f && by['hip' + side] && by['femur' + side] && by['shin' + side]) {
          const chainSum =
            (by.pelvis?.ang ?? 0) +
            by['hip' + side].ang +
            by['femur' + side].ang +
            by['shin' + side].ang;
          f.ang = -chainSum;
        }
        if (t) t.ang = 0;
      }
    } else if (recipe.footPlant === 'heelLift') {
      if (by.footR) by.footR.ang -= 18;
      if (by.toeR) by.toeR.ang += 14;
      if (by.footL) by.footL.ang += 18;
      if (by.toeL) by.toeL.ang -= 14;
      footToeBreakR = 20;
      footToeBreakL = 20;
    } else if (recipe.footPlant === 'tiptoe') {
      if (by.footR) by.footR.ang -= 34;
      if (by.toeR) by.toeR.ang += 28;
      if (by.footL) by.footL.ang += 34;
      if (by.toeL) by.toeL.ang -= 28;
      footToeBreakR = 34;
      footToeBreakL = 34;
    }
  } else {
    // Infer natural foot toe-break from stance plantarflexion
    if ((by.footR?.ang ?? 0) < -10) footToeBreakR = Math.min(34, Math.abs(by.footR?.ang ?? 0));
    if ((by.footL?.ang ?? 0) > 10) footToeBreakL = Math.min(34, Math.abs(by.footL?.ang ?? 0));
  }

  // 5. Automaton Mechanical Linkage Couplings (Pelvis-to-Spine + Clavicle Follow)
  if (!isSculpturalPreset && recipe.torsoLean !== 'upright') {
    applyAutomatonLinkageCouplings(
      by,
      moodSpec.spineCounterWeight,
      moodSpec.clavicleFollowRatio,
      recipe.headPitch !== 'auto',
    );
  }

  // 6. Seed variation micro-offsets + subtle per-session Vitruvian procedural twist
  if (recipe.seedVariant > 0) {
    for (const n of nodes) {
      if (n.lock) continue;
      n.ang += seedMicroDelta(recipe.seedVariant, n.id) * Math.min(1.25, gain);
    }
  }
  const tw = recipe.initTwist ?? 0;
  if (Math.abs(tw) > 1e-4) {
    const tAdd = (id: string, deg: number) => {
      const n = by[id];
      if (n && !n.lock) n.ang += deg;
    };
    tAdd('pelvis', tw * 2.8);
    tAdd('lumbar', -tw * 2.2);
    tAdd('thorax', tw * 2.4);
    tAdd('neck', -tw * 1.6);
    tAdd('head', tw * 4.5);
    tAdd('swivelL', tw * 2.1);
    tAdd('swivelR', tw * 1.9);
    tAdd('humerusL', tw * 4.2);
    tAdd('humerusR', -tw * 3.1);
    tAdd('forearmL', tw * 4.8);
    tAdd('forearmR', tw * 3.4);
    tAdd('femurL', tw * 1.8);
    tAdd('femurR', -tw * 1.2);
    tAdd('shinL', -tw * 1.6);
  }

  // 7. Symmetry enforcement
  if (recipe.symmetry === 'mirrorLtoR') {
    mirrorPoseSide(nodes, 'LtoRSide');
  } else if (recipe.symmetry === 'mirrorRtoL') {
    mirrorPoseSide(nodes, 'RtoLArms');
    const fullBases = ['hip', 'femur', 'shin', 'foot', 'toe', 'rib'];
    for (const b of fullBases) {
      const src = by[b + 'R'];
      const dst = by[b + 'L'];
      if (src && dst) dst.ang = src.ang === 0 ? 0 : -src.ang;
    }
  } else if (recipe.symmetry === 'mirrorArms') {
    mirrorPoseSide(nodes, 'RtoLArms');
  }

  // 8. Perspective Horizon Fulcrum Bias
  const perspective = buildPerspectiveFromToggles(
    recipe.elevation,
    recipe.vanishing,
    options?.perspGridVisible ?? true,
  );
  const perspForMath: PerspectiveState = { ...perspective, enabled: true };
  solveRig(
    nodes,
    by,
    recipe.bondOn,
    recipe.prometheusWings ? 1 : 0,
    recipe.ribAnchor,
    recipe.bodyView,
    recipe.sideArmsFavorOpposite,
  );
  const perspBias = computePerspectiveSpineBend(
    by,
    root,
    perspForMath,
    recipe.bodyView,
    options?.camZ ?? 0.085,
  );
  const perspJoints = [
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
  ] as const;
  for (const id of perspJoints) {
    const n = by[id];
    if (n && !n.lock) {
      n.ang += perspBias[id] * 0.68;
    }
  }
  if (root && !forceAirborneLegs) {
    root.ty += perspBias.pelvisTy * 0.45;
  }

  // 9. Biomechanical Clamping
  const wingPop = recipe.prometheusWings ? 1.0 : 0;
  for (const n of nodes) {
    const lim = clampAnatomicalAngle(n, n.ang, recipe.constrainLimits);
    const sh = clampRealisticShoulder(
      n,
      lim,
      by,
      recipe.prometheusWings,
      recipe.bodyView,
      recipe.sideArmsFavorOpposite,
    );
    n.ang = clampChungusRibAngle(
      n.id,
      sh,
      recipe.ribAnchor,
      by,
      recipe.prometheusWings,
    );
  }

  // 10. Solve FK & apply Floor Gravity / Balance / Contralateral Gear
  solveRig(
    nodes,
    by,
    recipe.bondOn,
    wingPop,
    recipe.ribAnchor,
    recipe.bodyView,
    recipe.sideArmsFavorOpposite,
  );

  const { regime } = inferPostureRegime({
    by,
    posFn: pos,
    explicitRegime: recipe.contralateralMotion ? stanceSpec.regime : 'standing',
    isKeyframedMotion: stanceSpec.regime === 'moving',
  });

  if ((recipe.footGravity || recipe.balanceCounterweight) && !forceAirborneLegs) {
    applyGroundAndBalance(
      nodes,
      by,
      root,
      { groundY: perspective.groundY },
      recipe.balanceCounterweight ? 'balance' : 'pinFeet',
      (n, b, bond, wp) =>
        solveRig(
          n,
          b,
          bond,
          wp,
          recipe.ribAnchor,
          recipe.bodyView,
          recipe.sideArmsFavorOpposite,
        ),
      pos,
      recipe.bondOn,
      wingPop,
      {
        pullDownToo: recipe.footGravity,
        balanceWeight: recipe.balanceCounterweight ? 0.34 : 0,
        regime: recipe.contralateralMotion ? regime : 'standing',
        isKeyframedMotion: recipe.contralateralMotion && stanceSpec.regime === 'moving',
        constrainLimits: recipe.constrainLimits,
        footToeBreak: { R: footToeBreakR, L: footToeBreakL },
      },
    );
  }

  for (const n of nodes) {
    n.ang = clampAnatomicalAngle(n, n.ang, recipe.constrainLimits);
    n.ang = normalizeDeg(n.ang);
  }
  solveRig(
    nodes,
    by,
    recipe.bondOn,
    wingPop,
    recipe.ribAnchor,
    recipe.bodyView,
    recipe.sideArmsFavorOpposite,
  );

  // 11. Resolve 360° Skull & Gotz Hands
  const headStep = resolveProceduralHeadStep(recipe.bodyView, recipe.skullFacing, recipe.mood);
  const headSpec = HEAD_TURN_SEQUENCE[headStep];
  if (by.head) {
    by.head.flipX = headSpec.flipX;
  }

  const handL = buildHandStateFromToggles(
    'L',
    recipe.handBuild,
    recipe.handGestureL,
    moodSpec.handL,
    recipe.constrainLimits,
  );
  const handR = buildHandStateFromToggles(
    'R',
    recipe.handBuild,
    recipe.handGestureR,
    moodSpec.handR,
    recipe.constrainLimits,
  );

  const propMetrics = computeCanonicalProportionMetrics(by, pos);
  const angles: Record<string, number> = {};
  const flipX: Record<string, boolean> = {};
  for (const n of nodes) {
    angles[n.id] = Math.round(n.ang * 10) / 10;
    if (n.flipX) flipX[n.id] = true;
  }

  const moodLabel = MOOD_OPTIONS.find((m) => m.id === recipe.mood)?.label ?? recipe.mood;
  const elevLabel = ELEVATION_OPTIONS.find((e) => e.id === recipe.elevation)?.label ?? recipe.elevation;

  return {
    angles,
    root: [
      Math.round((root?.tx ?? 0) * 10) / 10,
      Math.round((root?.ty ?? 0) * 10) / 10,
    ],
    flipX,
    bodyView: recipe.bodyView,
    sideArmsFavorOpposite: recipe.sideArmsFavorOpposite,
    headStep,
    skullView: headSpec.view,
    ribAnchor: recipe.ribAnchor,
    prometheusWings: recipe.prometheusWings,
    perspective,
    footToeBreak: { R: footToeBreakR, L: footToeBreakL },
    handStates: {
      L: cloneGotzState(handL),
      R: cloneGotzState(handR),
    },
    camHint: stanceSpec.cam ?? { waveform: 'sine', phaseLag: 0.14, breathAmp: 2.0 },
    metrics: {
      regime,
      armSpanRatio: Math.round(propMetrics.armSpanToHeightRatio * 100) / 100,
      legSplayDeg: Math.round(propMetrics.hipSplayDeg * 10) / 10,
      pelvisShiftPx: [
        Math.round((root?.tx ?? 0) * 10) / 10,
        Math.round((root?.ty ?? 0) * 10) / 10,
      ],
      summary: `${moodLabel} · ${stanceSpec.label} · ${elevLabel}`,
    },
  };
}

export type LiveNudgeKind =
  | 'cogUp'
  | 'cogDown'
  | 'cogLeft'
  | 'cogRight'
  | 'perspUp'
  | 'perspDown'
  | 'perspLeft'
  | 'perspRight'
  | 'skullLeft'
  | 'skullRight'
  | 'skullUp'
  | 'skullDown'
  | 'turnLeft'
  | 'turnRight'
  | 'turnUp'
  | 'turnDown'
  | 'spineArch'
  | 'spineForward'
  | 'spineSwayL'
  | 'spineSwayR'
  | 'headUp'
  | 'headTuck'
  | 'headTiltL'
  | 'headTiltR'
  | 'jawOpen'
  | 'jawClose'
  | 'armSpreadOut'
  | 'armGuardIn'
  | 'legSplayOut'
  | 'legKneelDown'
  | 'plantHeelUp'
  | 'intensityUp'
  | 'intensityDown'
  | 'seedDrift';

export function nudgeLivePoseRuntime(
  nodes: RigNode[],
  root: RigNode,
  by: Record<string, RigNode>,
  perspective: PerspectiveState,
  kind: LiveNudgeKind,
  dtSec: number,
  options: {
    constrainLimits: boolean;
    bondOn: boolean;
    prometheusWings: boolean;
    ribAnchor: RibAnchorMode;
    bodyView: BodyTurnView;
    sideArmsFavorOpposite: boolean;
    footGravity?: boolean;
    footToeBreak?: { R: number; L: number };
  },
): {
  nextPerspective: PerspectiveState;
  perspChanged: boolean;
  nextFootToeBreak: { R: number; L: number };
  footToeChanged: boolean;
} {
  const dt = Math.min(0.08, Math.max(-0.08, dtSec));
  const stepDeg = dt * 34;
  const smallDeg = dt * 20;
  let nextPerspective = perspective;
  let perspChanged = false;
  const nextFootToeBreak = {
    R: options.footToeBreak?.R ?? 0,
    L: options.footToeBreak?.L ?? 0,
  };
  let footToeChanged = false;

  const add = (id: string, delta: number) => {
    const n = by[id];
    if (!n || n.lock) return;
    n.ang = clampAnatomicalAngle(n, n.ang + delta, options.constrainLimits);
    n.ang = normalizeDeg(n.ang);
  };

  const approachZero = (id: string, rateDeg: number) => {
    const n = by[id];
    if (!n || n.lock) return;
    if (Math.abs(n.ang) <= rateDeg) {
      n.ang = 0;
    } else {
      n.ang = normalizeDeg(n.ang - Math.sign(n.ang) * rateDeg);
    }
  };

  const cogInfo = computePoseCenterOfGravity(
    by,
    pos,
    perspective.groundY,
    nextFootToeBreak,
  );
  const groundedR = cogInfo.feet.R.grounded;
  const groundedL = cogInfo.feet.L.grounded;
  const hasGround = groundedR || groundedL;

  switch (kind) {
    case 'cogUp': {
      // Pose-derived vertical CoG elevation:
      // 1. If knees/hips are bent, unfold knees toward standing height;
      // 2. Once straight, plantarflex grounded ankles & dorsiflex toes onto Tip-Toe to lift ankles/CoG higher!
      const absDt = Math.abs(dt);
      const liftDir = dt >= 0 ? 1 : -1;
      if (liftDir < 0) {
        // Negative drag routes cleanly to cogDown semantics
        return nudgeLivePoseRuntime(nodes, root, by, perspective, 'cogDown', absDt, {
          ...options,
          footToeBreak: nextFootToeBreak,
        });
      }
      const bendRate = absDt * 42;
      if (cogInfo.kneeBendDeg > 8) {
        approachZero('femurR', bendRate * 0.72);
        approachZero('shinR', bendRate * 1.25);
        approachZero('femurL', bendRate * 0.72);
        approachZero('shinL', bendRate * 1.25);
        approachZero('lumbar', bendRate * 0.38);
        approachZero('thorax', bendRate * 0.38);
        // Un-dorsiflex ankles smoothly toward neutral as shins straighten
        if (by.footR && by.footR.ang > 0) approachZero('footR', bendRate * 0.65);
        if (by.footL && by.footL.ang < 0) approachZero('footL', bendRate * 0.65);
      } else if (hasGround) {
        // Transition seamlessly onto ball/tiptoe: toes dorsiflex to push ankles & CoG higher
        const ankleLiftStep = absDt * 34;
        if (groundedR || !groundedL) {
          add('footR', -ankleLiftStep);
          add('toeR', ankleLiftStep * 0.78);
          nextFootToeBreak.R = Math.max(0, Math.min(54, nextFootToeBreak.R + ankleLiftStep));
          footToeChanged = true;
        }
        if (groundedL || !groundedR) {
          add('footL', ankleLiftStep);
          add('toeL', -ankleLiftStep * 0.78);
          nextFootToeBreak.L = Math.max(0, Math.min(54, nextFootToeBreak.L + ankleLiftStep));
          footToeChanged = true;
        }
        add('thorax', -absDt * 5);
      } else {
        // Airborne elevation
        root.ty -= absDt * 540;
      }
      break;
    }

    case 'cogDown': {
      const absDt = Math.abs(dt);
      if (dt < 0) {
        return nudgeLivePoseRuntime(nodes, root, by, perspective, 'cogUp', absDt, {
          ...options,
          footToeBreak: nextFootToeBreak,
        });
      }
      // 1. If standing on toes (heel lift), unroll ankles back onto flat heel+ball contact first
      const toeMax = Math.max(nextFootToeBreak.R, nextFootToeBreak.L);
      if (toeMax > 2 || (by.footR && by.footR.ang < -4) || (by.footL && by.footL.ang > 4)) {
        const dropRate = absDt * 40;
        if (by.footR && by.footR.ang < 0) add('footR', Math.min(Math.abs(by.footR.ang), dropRate));
        if (by.footL && by.footL.ang > 0) add('footL', -Math.min(Math.abs(by.footL.ang), dropRate));
        approachZero('toeR', dropRate * 0.85);
        approachZero('toeL', dropRate * 0.85);
        nextFootToeBreak.R = Math.max(0, nextFootToeBreak.R - dropRate);
        nextFootToeBreak.L = Math.max(0, nextFootToeBreak.L - dropRate);
        footToeChanged = true;
      } else {
        // 2. Fold into athletic knee flexion & hip hinge while ankles dorsiflex cleanly to keep soles flat
        const squatRate = absDt * 38;
        add('femurR', squatRate * 0.78);
        add('shinR', -squatRate * 1.48);
        add('femurL', -squatRate * 0.78);
        add('shinL', squatRate * 1.48);
        add('footR', squatRate * 0.62);
        add('footL', -squatRate * 0.62);
        add('lumbar', squatRate * 0.25);
        add('thorax', squatRate * 0.22);
      }
      if (!hasGround && options.footGravity === false) {
        root.ty += absDt * 420;
      }
      break;
    }

    case 'cogLeft':
    case 'cogRight': {
      // Sway CoG Left (-1) or Right (+1) proportionally from current pose stability & support
      const dir = kind === 'cogRight' ? 1 : -1;
      const signed = (dt >= 0 ? 1 : -1) * dir;
      const absDt = Math.abs(dt);
      const swayDeg = signed * absDt * 24;

      if (hasGround) {
        // Lateral weight shift over planted ankles + hip sway + spine S-curve counterbalance
        root.tx += signed * absDt * 320;
        add('hipR', swayDeg * 0.42);
        add('hipL', swayDeg * 0.42);
        add('pelvis', swayDeg * 0.28);
        add('lumbar', -swayDeg * 0.55);
        add('thorax', swayDeg * 0.36);
        add('footR', -swayDeg * 0.32);
        add('footL', -swayDeg * 0.32);
        // Subtle head levelness stabilization
        add('head', -swayDeg * 0.24);
      } else {
        root.tx += signed * absDt * 420;
        add('pelvis', swayDeg * 0.4);
        add('thorax', swayDeg * 0.45);
      }
      break;
    }

    case 'perspUp':
      nextPerspective = {
        ...perspective,
        horizonY: Math.max(-1600, Math.min(perspective.groundY - 120, perspective.horizonY - dt * 680)),
      };
      perspChanged = true;
      add('lumbar', -dt * 9);
      add('thorax', -dt * 11);
      break;
    case 'perspDown':
      nextPerspective = {
        ...perspective,
        horizonY: Math.max(-1600, Math.min(perspective.groundY - 120, perspective.horizonY + dt * 680)),
      };
      perspChanged = true;
      add('lumbar', dt * 9);
      add('thorax', dt * 11);
      break;
    case 'perspLeft':
      nextPerspective = { ...perspective, vpX: Math.max(-400, Math.min(2900, perspective.vpX - dt * 780)) };
      perspChanged = true;
      add('head', -smallDeg * 0.5);
      add('neck', -smallDeg * 0.4);
      break;
    case 'perspRight':
      nextPerspective = { ...perspective, vpX: Math.max(-400, Math.min(2900, perspective.vpX + dt * 780)) };
      perspChanged = true;
      add('head', smallDeg * 0.5);
      add('neck', smallDeg * 0.4);
      break;
    case 'skullLeft':
    case 'headTiltL':
      add('neck', -smallDeg * 0.7);
      add('head', -stepDeg);
      break;
    case 'skullRight':
    case 'headTiltR':
      add('neck', smallDeg * 0.7);
      add('head', stepDeg);
      break;
    case 'skullUp':
    case 'headUp':
      add('neck', -smallDeg * 0.9);
      add('head', -stepDeg);
      break;
    case 'skullDown':
    case 'headTuck':
      add('neck', smallDeg * 0.9);
      add('head', stepDeg);
      break;
    case 'turnLeft':
      add('pelvis', -smallDeg * 0.4);
      add('lumbar', -smallDeg * 0.6);
      add('thorax', -smallDeg * 0.7);
      add('swivelR', smallDeg * 0.5);
      add('swivelL', smallDeg * 0.4);
      break;
    case 'turnRight':
      add('pelvis', smallDeg * 0.4);
      add('lumbar', smallDeg * 0.6);
      add('thorax', smallDeg * 0.7);
      add('swivelL', -smallDeg * 0.5);
      add('swivelR', -smallDeg * 0.4);
      break;
    case 'turnUp':
    case 'spineArch':
      add('lumbar', -stepDeg * 0.65);
      add('thorax', -stepDeg * 0.85);
      add('ribL', smallDeg * 0.4);
      add('ribR', -smallDeg * 0.4);
      break;
    case 'turnDown':
    case 'spineForward':
      add('lumbar', stepDeg * 0.65);
      add('thorax', stepDeg * 0.85);
      break;
    case 'spineSwayL':
      add('pelvis', -smallDeg * 0.55);
      add('lumbar', -stepDeg * 0.65);
      add('thorax', -stepDeg * 0.5);
      break;
    case 'spineSwayR':
      add('pelvis', smallDeg * 0.55);
      add('lumbar', stepDeg * 0.65);
      add('thorax', stepDeg * 0.5);
      break;
    case 'jawOpen':
      add('lip', smallDeg);
      break;
    case 'jawClose':
      add('lip', -smallDeg);
      break;
    case 'armSpreadOut':
      add('humerusL', -stepDeg * 1.1);
      add('humerusR', stepDeg * 1.1);
      add('swivelL', smallDeg * 0.45);
      add('swivelR', -smallDeg * 0.45);
      break;
    case 'armGuardIn':
      add('humerusL', smallDeg * 0.5);
      add('humerusR', -smallDeg * 0.5);
      add('forearmL', -stepDeg * 1.3);
      add('forearmR', stepDeg * 1.3);
      break;
    case 'legSplayOut':
      add('hipR', smallDeg * 0.8);
      add('hipL', -smallDeg * 0.8);
      add('femurR', smallDeg * 0.4);
      add('femurL', -smallDeg * 0.4);
      break;
    case 'legKneelDown':
      add('femurR', smallDeg * 0.9);
      add('shinR', -stepDeg * 1.3);
      add('femurL', -smallDeg * 0.9);
      add('shinL', stepDeg * 1.3);
      root.ty += dt * 260;
      break;
    case 'plantHeelUp':
      add('footR', -smallDeg);
      add('toeR', smallDeg * 0.8);
      add('footL', smallDeg);
      add('toeL', -smallDeg * 0.8);
      nextFootToeBreak.R = Math.max(-15, Math.min(60, nextFootToeBreak.R + smallDeg));
      nextFootToeBreak.L = Math.max(-15, Math.min(60, nextFootToeBreak.L + smallDeg));
      footToeChanged = true;
      break;
    case 'intensityUp':
    case 'seedDrift':
      add('thorax', smallDeg * 0.5);
      add('humerusL', -smallDeg * 0.9);
      add('humerusR', smallDeg * 0.9);
      add('forearmL', -smallDeg * 0.7);
      add('forearmR', smallDeg * 0.7);
      add('head', -smallDeg * 0.4);
      break;
    case 'intensityDown':
      for (const id of ['lumbar', 'thorax', 'neck', 'head', 'humerusL', 'humerusR', 'forearmL', 'forearmR']) {
        const n = by[id];
        if (n) n.ang *= Math.max(0.85, 1 - dt * 1.6);
      }
      break;
  }

  for (const n of nodes) {
    const sh = clampRealisticShoulder(
      n,
      n.ang,
      by,
      options.prometheusWings,
      options.bodyView,
      options.sideArmsFavorOpposite,
    );
    n.ang = clampChungusRibAngle(n.id, sh, options.ribAnchor, by, options.prometheusWings);
  }
  solveRig(
    nodes,
    by,
    options.bondOn,
    options.prometheusWings ? 1 : 0,
    options.ribAnchor,
    options.bodyView,
    options.sideArmsFavorOpposite,
  );

  // Maintain sole-to-floor contact automatically during CoG/leg nudges when Foot Gravity is active
  if (
    options.footGravity !== false &&
    (kind === 'cogUp' ||
      kind === 'cogDown' ||
      kind === 'cogLeft' ||
      kind === 'cogRight' ||
      kind === 'plantHeelUp' ||
      kind === 'legSplayOut')
  ) {
    applyGroundAndBalance(
      nodes,
      by,
      root,
      { groundY: perspective.groundY },
      'pinFeet',
      (n, b, bond, wp) =>
        solveRig(
          n,
          b,
          bond,
          wp,
          options.ribAnchor,
          options.bodyView,
          options.sideArmsFavorOpposite,
        ),
      pos,
      options.bondOn,
      options.prometheusWings ? 1 : 0,
      {
        pullDownToo: hasGround,
        balanceWeight: 0,
        constrainLimits: options.constrainLimits,
        footToeBreak: nextFootToeBreak,
      },
    );
  }

  return { nextPerspective, perspChanged, nextFootToeBreak, footToeChanged };
}

export function buildAndGeneratePose(
  rawRig: RawRigDef,
  recipe: ProceduralRecipe,
  buildRigGraphFn: (raw: RawRigDef, inc: boolean) => { nodes: RigNode[]; by: Record<string, RigNode> },
  customStances?: StanceSeedEntry[],
): GeneratedPoseResult {
  const { nodes, by } = buildRigGraphFn(rawRig, true);
  return generateProceduralPose(recipe, nodes, by, { customStances });
}

export { getHeadTurnStep };

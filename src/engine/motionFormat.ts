import type { GotzHandState } from './gotzHandEngine';
import type {
  AbcSerializedState,
  BodyTurnView,
  HeadTurnStep,
  Keyframe as LegacyKeyframe,
  PartRigInstance,
  PartSerializedState,
  PoseSnapshot,
  RigNode,
  SkullViewMode,
} from './types';

const VALID_BODY_VIEWS = new Set<BodyTurnView>([
  'front',
  'threeQuarterR',
  'threeQuarterL',
  'sideR',
  'sideL',
  'back',
]);

export function parseBodyTurnView(raw: unknown): BodyTurnView | undefined {
  return typeof raw === 'string' && VALID_BODY_VIEWS.has(raw as BodyTurnView)
    ? (raw as BodyTurnView)
    : undefined;
}

export const RIG_JOINTS = [
  'pelvis', 'lumbar', 'thorax', 'neck', 'head',
  'swivelL', 'acromionL', 'braceL', 'swivelR', 'acromionR', 'braceR',
  'humerusL', 'humerusR', 'forearmL', 'forearmR', 'handL', 'handR',
  'thumbR', 'thumbTipR', 'fingerR', 'fingerTipR',
  'thumbL', 'thumbTipL', 'fingerL', 'fingerTipL',
  'hipR', 'femurR', 'shinR', 'footR', 'toeR',
  'hipL', 'femurL', 'shinL', 'footL', 'toeL',
  'lip', 'chinTip', 'ribR', 'ribL',
  'wingL', 'swivelTipL', 'wingR', 'swivelTipR',
] as const;

export type JointId = typeof RIG_JOINTS[number];

export type TrackEasing = 'linear' | 'easeInOut' | 'step' | 'cubicBezier';

export interface Keyframe {
  id: string;
  frame: number;
  easing: TrackEasing;
  pose: Record<JointId, number>;
  root: [number, number];
}

export interface PartPayloadState extends Partial<PartSerializedState> {
  visible?: boolean;
  variant?: string;
  locked?: boolean;
}

export interface RigStatePayload {
  pose: Record<JointId, number>;
  coords: Record<JointId, [number, number]>;
  keys: Keyframe[];
  root: [number, number];
  parts: Record<string, PartPayloadState>;
  // Optional studio extensions preserved cleanly across round-trips
  flipX?: Record<string, boolean>;
  headStep?: HeadTurnStep;
  skullView?: SkullViewMode;
  bodyView?: BodyTurnView;
  prometheusWings?: boolean;
  ribAnchor?: 'upper' | 'lower' | 'ribwings';
  abc?: AbcSerializedState;
  legacyKeys?: LegacyKeyframe[];
}

const RIG_JOINT_SET = new Set<string>(RIG_JOINTS);

export function isValidJointId(id: string): id is JointId {
  return RIG_JOINT_SET.has(id);
}

export function createZeroPoseRecord(): Record<JointId, number> {
  const out = {} as Record<JointId, number>;
  for (const id of RIG_JOINTS) out[id] = 0;
  return out;
}

export function createZeroCoordsRecord(): Record<JointId, [number, number]> {
  const out = {} as Record<JointId, [number, number]>;
  for (const id of RIG_JOINTS) out[id] = [0, 0];
  return out;
}

const r1 = (n: number): number => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);

export function buildCanonicalPayload(
  nodes: RigNode[],
  coordsById: Record<string, [number, number]>,
  root: RigNode,
  keys: Keyframe[],
  instMap: Record<string, PartRigInstance>,
  cloneGotz: (v: GotzHandState) => GotzHandState,
  extras?: {
    abc?: AbcSerializedState;
    prometheusWings?: boolean;
    ribAnchor?: 'upper' | 'lower' | 'ribwings';
    headStep?: HeadTurnStep;
    skullView?: SkullViewMode;
    bodyView?: BodyTurnView;
    legacyKeys?: LegacyKeyframe[];
  },
): RigStatePayload {
  const pose = createZeroPoseRecord();
  const coords = createZeroCoordsRecord();
  const flipX: Record<string, boolean> = {};

  for (const n of nodes) {
    if (isValidJointId(n.id)) {
      pose[n.id] = r1(n.ang);
      const p = coordsById[n.id];
      if (p) coords[n.id] = [r1(p[0]), r1(p[1])];
    }
    if (n.flipX) flipX[n.id] = true;
  }

  const parts: Record<string, PartPayloadState> = {};
  for (const id in instMap) {
    const I = instMap[id];
    if (I.touched) {
      parts[id] = {
        visible: true,
        flip: I.flip,
        on: Array.from(I.on),
        ang: Array.from(I.ang),
        dx: Array.from(I.dx),
        dy: Array.from(I.dy),
        ...(I.gotz ? { gotz: cloneGotz(I.gotz) } : {}),
      };
    }
  }

  const payload: RigStatePayload = {
    pose,
    coords,
    keys: keys.map((k) => ({
      id: k.id,
      frame: k.frame,
      easing: k.easing,
      pose: { ...k.pose },
      root: [r1(k.root[0]), r1(k.root[1])],
    })),
    root: [r1(root.tx), r1(root.ty)],
    parts,
  };

  if (Object.keys(flipX).length) payload.flipX = flipX;
  if (extras?.headStep !== undefined) payload.headStep = extras.headStep;
  if (extras?.skullView) payload.skullView = extras.skullView;
  if (extras?.bodyView && extras.bodyView !== 'front') payload.bodyView = extras.bodyView;
  if (extras?.prometheusWings) payload.prometheusWings = true;
  if (extras?.ribAnchor && extras.ribAnchor !== 'upper') payload.ribAnchor = extras.ribAnchor;
  if (extras?.abc) {
    const hasAnyAbc = !!(extras.abc.poses.A || extras.abc.poses.B || extras.abc.poses.C);
    if (hasAnyAbc) payload.abc = extras.abc;
  }
  if (extras?.legacyKeys?.length) {
    payload.legacyKeys = extras.legacyKeys.map((k) => ({ f: k.f, a: k.a.slice(), x: k.x, y: k.y, s: k.s }));
  }
  return payload;
}

export function serializeRigPayload(payload: RigStatePayload): string {
  return JSON.stringify(payload);
}

/**
 * Parses and validates either canonical RigStatePayload or legacy PoseSnapshot JSON,
 * guaranteeing finite pose angles, coordinates, and valid keyframe structures.
 */
export function parseAndValidateRigPayload(rawJson: string): RigStatePayload {
  const raw = JSON.parse(rawJson) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Payload must be a JSON object');
  }

  const pose = createZeroPoseRecord();
  const rawPose = (raw.pose && typeof raw.pose === 'object' ? raw.pose : {}) as Record<string, unknown>;
  for (const id of RIG_JOINTS) {
    const val = rawPose[id];
    if (typeof val === 'number' && Number.isFinite(val)) {
      pose[id] = val;
    }
  }

  const coords = createZeroCoordsRecord();
  const rawCoords = (raw.coords && typeof raw.coords === 'object' ? raw.coords : {}) as Record<string, unknown>;
  for (const id of RIG_JOINTS) {
    const pair = rawCoords[id];
    if (Array.isArray(pair) && pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])) {
      coords[id] = [Number(pair[0]), Number(pair[1])];
    }
  }

  const rootRaw = Array.isArray(raw.root) ? raw.root : [0, 0];
  const root: [number, number] = [
    typeof rootRaw[0] === 'number' && Number.isFinite(rootRaw[0]) ? rootRaw[0] : 0,
    typeof rootRaw[1] === 'number' && Number.isFinite(rootRaw[1]) ? rootRaw[1] : 0,
  ];

  const keys: Keyframe[] = [];
  const legacyKeys: LegacyKeyframe[] = [];
  if (Array.isArray(raw.keys)) {
    for (let i = 0; i < raw.keys.length; i++) {
      const k = raw.keys[i] as Record<string, unknown>;
      if (!k || typeof k !== 'object') continue;
      if (typeof k.frame === 'number' && k.pose && typeof k.pose === 'object') {
        const kp = createZeroPoseRecord();
        const kPoseIn = k.pose as Record<string, unknown>;
        for (const id of RIG_JOINTS) {
          const v = kPoseIn[id];
          if (typeof v === 'number' && Number.isFinite(v)) kp[id] = v;
        }
        const kr = Array.isArray(k.root) ? k.root : [0, 0];
        const easing: TrackEasing =
          k.easing === 'linear' || k.easing === 'easeInOut' || k.easing === 'step' || k.easing === 'cubicBezier'
            ? k.easing
            : 'easeInOut';
        keys.push({
          id: typeof k.id === 'string' && k.id ? k.id : `k_${i}_${k.frame}`,
          frame: Number.isFinite(k.frame) ? k.frame : i,
          easing,
          pose: kp,
          root: [
            typeof kr[0] === 'number' && Number.isFinite(kr[0]) ? kr[0] : 0,
            typeof kr[1] === 'number' && Number.isFinite(kr[1]) ? kr[1] : 0,
          ],
        });
      } else if (typeof k.f === 'number' && Array.isArray(k.a)) {
        legacyKeys.push({
          f: k.f,
          a: (k.a as unknown[]).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)),
          x: typeof k.x === 'number' && Number.isFinite(k.x) ? k.x : 0,
          y: typeof k.y === 'number' && Number.isFinite(k.y) ? k.y : 0,
        });
      }
    }
  }

  const parts: Record<string, PartPayloadState> =
    raw.parts && typeof raw.parts === 'object' ? (raw.parts as Record<string, PartPayloadState>) : {};

  const out: RigStatePayload = { pose, coords, keys, root, parts };
  if (raw.flipX && typeof raw.flipX === 'object') out.flipX = raw.flipX as Record<string, boolean>;
  if (raw.headStep === 0 || raw.headStep === 1 || raw.headStep === 2 || raw.headStep === 3) {
    out.headStep = raw.headStep;
  }
  if (raw.skullView === 'front' || raw.skullView === 'side' || raw.skullView === 'back') {
    out.skullView = raw.skullView;
  }
  const parsedBodyView = parseBodyTurnView(raw.bodyView);
  if (parsedBodyView) {
    out.bodyView = parsedBodyView;
  }
  if (typeof raw.prometheusWings === 'boolean') out.prometheusWings = raw.prometheusWings;
  if (raw.ribAnchor === 'upper' || raw.ribAnchor === 'lower' || raw.ribAnchor === 'ribwings') {
    out.ribAnchor = raw.ribAnchor;
  }
  if (raw.abc && typeof raw.abc === 'object') {
    const rawAbc = raw.abc as Partial<AbcSerializedState> & { poses?: Record<string, unknown> };
    const slot = rawAbc.activeSlot;
    out.abc = {
      ...(rawAbc as AbcSerializedState),
      activeSlot: slot === 'B' || slot === 'C' ? slot : 'A',
      skullTurnTiming: rawAbc.skullTurnTiming === 'nextLetter' ? 'nextLetter' : 'halfway',
      poses: {
        A: (rawAbc.poses?.A as AbcSerializedState['poses']['A']) ?? null,
        B: (rawAbc.poses?.B as AbcSerializedState['poses']['B']) ?? null,
        C: (rawAbc.poses?.C as AbcSerializedState['poses']['C']) ?? null,
      },
    };
  }
  if (legacyKeys.length) out.legacyKeys = legacyKeys;
  return out;
}

export function payloadToPoseSnapshot(p: RigStatePayload): Partial<PoseSnapshot> {
  return {
    pose: { ...p.pose },
    coords: { ...p.coords },
    root: [...p.root],
    flipX: p.flipX,
    headStep: p.headStep,
    skullView: p.skullView,
    bodyView: p.bodyView,
    prometheusWings: p.prometheusWings,
    abc: p.abc,
    parts: p.parts as PoseSnapshot['parts'],
    keys: p.legacyKeys,
  };
}

/**
 * Mirrors symmetric right-to-left arm/shoulder/digit angles, or full left-to-right side
 * angles (arm + leg + rib), using Bitruvius lateral sign symmetry.
 */
export function mirrorPoseSide(nodes: RigNode[], mode: 'RtoLArms' | 'LtoRSide'): void {
  const by: Record<string, RigNode> = {};
  for (const n of nodes) by[n.id] = n;
  const armBases = ['swivel', 'acromion', 'brace', 'humerus', 'forearm', 'hand', 'thumb', 'thumbTip', 'finger', 'fingerTip'];
  const legBases = ['hip', 'femur', 'shin', 'foot', 'toe', 'rib'];
  const bases = mode === 'RtoLArms' ? armBases : [...armBases, ...legBases];
  const srcSide = mode === 'RtoLArms' ? 'R' : 'L';
  const dstSide = mode === 'RtoLArms' ? 'L' : 'R';
  for (const base of bases) {
    const src = by[base + srcSide];
    const dst = by[base + dstSide];
    if (src && dst) {
      dst.ang = src.ang === 0 ? 0 : -src.ang;
    }
  }
}

/**
 * Canonical studio starter presets with verified R->L / L->R mirrored symmetry:
 * 1) Promethean Chungus (R arms mirrored -> L arms, prometheusWings: true)
 * 2) Chungus (L side mirrored -> R side, prometheusWings: false)
 */
export const PROMETHEAN_CHUNGUS_PRESET_NODES: Record<string, number> = {
  pelvis: 0.3, lumbar: -0.6, thorax: -0.1, neck: -0.4, head: 0,
  swivelL: 28.1, acromionL: -26.9, braceL: 12,
  swivelR: -28.1, acromionR: 26.9, braceR: -12,
  humerusL: -9.7, humerusR: 9.7, forearmL: -101.4, forearmR: 101.4, handL: 127.5, handR: -127.5,
  thumbR: 0, thumbTipR: 0, fingerR: 0, fingerTipR: 0,
  thumbL: 0, thumbTipL: 0, fingerL: 0, fingerTipL: 0,
  hipR: 57.7, femurR: -25.2, shinR: -51.3, footR: 24, toeR: 0,
  hipL: -59.4, femurL: 36, shinL: 52, footL: -28.9, toeL: 0,
  lip: 0, chinTip: 0, ribR: -40.5, ribL: 33.3,
  wingL: 0, swivelTipL: 0, wingR: 0, swivelTipR: 0,
};

export const CHUNGUS_PRESET_NODES: Record<string, number> = {
  pelvis: -1, lumbar: 0, thorax: 0, neck: 0, head: 0,
  swivelL: 28, acromionL: -35, braceL: 12,
  swivelR: -28, acromionR: 35, braceR: -12,
  humerusL: 0, humerusR: 0, forearmL: 0, forearmR: 0, handL: 0, handR: 0,
  thumbR: 0, thumbTipR: 0, fingerR: 0, fingerTipR: 0,
  thumbL: 0, thumbTipL: 0, fingerL: 0, fingerTipL: 0,
  hipR: 55.4, femurR: -47.8, shinR: -22.5, footR: 13.9, toeR: 0,
  hipL: -55.4, femurL: 47.8, shinL: 22.5, footL: -13.9, toeL: 0,
  lip: 0, chinTip: 0, ribR: -41, ribL: 41,
  wingL: 0, swivelTipL: 0, wingR: 0, swivelTipR: 0,
};

export function createBuiltinChungusLibraryPoses() {
  const ts = 1763700000000;
  return [
    {
      id: 'builtin_promethean_chungus',
      name: 'Promethean Chungus',
      createdAt: ts,
      updatedAt: ts,
      prometheusWings: true,
      pose: {
        nodes: { ...PROMETHEAN_CHUNGUS_PRESET_NODES },
        root: [48.5, 162.2] as [number, number],
      },
    },
    {
      id: 'builtin_chungus',
      name: 'Chungus',
      createdAt: ts,
      updatedAt: ts,
      prometheusWings: false,
      pose: {
        nodes: { ...CHUNGUS_PRESET_NODES },
        root: [-125.4, 357.1] as [number, number],
      },
    },
  ];
}


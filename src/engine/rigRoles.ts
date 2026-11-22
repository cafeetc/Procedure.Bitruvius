import type { JointId } from './motionFormat';
import type { RigNode } from './types';

export type BoneRole =
  | 'root'
  | 'spine'
  | 'head_facial'
  | 'shoulder_girdle'
  | 'limb_arm'
  | 'hand_digit'
  | 'limb_leg'
  | 'foot_digit'
  | 'accessory_wing'
  | 'accessory_rig';

export interface JointMeta {
  id: JointId;
  role: BoneRole;
  side: 'center' | 'L' | 'R';
  /** True kinematic parent inside the 43-node articulated graph */
  parent: JointId | null;
  ikChain?: 'armL' | 'armR' | 'legL' | 'legR' | 'spine';
}

/**
 * Semantic classification & true kinematic hierarchy for all 43 skeleton joints.
 * Matches the live articulated parent-child topology (including pelvis -> hip -> femur
 * and lumbar -> swivel -> acromion -> humerus, with thorax -> brace aiming at acromion).
 */
export const RIG_METADATA: Record<JointId, JointMeta> = {
  pelvis: { id: 'pelvis', role: 'root', side: 'center', parent: null, ikChain: 'spine' },
  lumbar: { id: 'lumbar', role: 'spine', side: 'center', parent: 'pelvis', ikChain: 'spine' },
  thorax: { id: 'thorax', role: 'spine', side: 'center', parent: 'lumbar', ikChain: 'spine' },
  neck: { id: 'neck', role: 'spine', side: 'center', parent: 'thorax', ikChain: 'spine' },
  head: { id: 'head', role: 'head_facial', side: 'center', parent: 'neck' },
  lip: { id: 'lip', role: 'head_facial', side: 'center', parent: 'head' },
  chinTip: { id: 'chinTip', role: 'head_facial', side: 'center', parent: 'lip' },
  ribL: { id: 'ribL', role: 'spine', side: 'L', parent: 'thorax' },
  ribR: { id: 'ribR', role: 'spine', side: 'R', parent: 'thorax' },
  swivelL: { id: 'swivelL', role: 'shoulder_girdle', side: 'L', parent: 'lumbar', ikChain: 'armL' },
  swivelTipL: { id: 'swivelTipL', role: 'accessory_rig', side: 'L', parent: 'swivelL' },
  acromionL: { id: 'acromionL', role: 'shoulder_girdle', side: 'L', parent: 'swivelL', ikChain: 'armL' },
  braceL: { id: 'braceL', role: 'shoulder_girdle', side: 'L', parent: 'thorax' },
  humerusL: { id: 'humerusL', role: 'limb_arm', side: 'L', parent: 'acromionL', ikChain: 'armL' },
  forearmL: { id: 'forearmL', role: 'limb_arm', side: 'L', parent: 'humerusL', ikChain: 'armL' },
  handL: { id: 'handL', role: 'limb_arm', side: 'L', parent: 'forearmL', ikChain: 'armL' },
  thumbL: { id: 'thumbL', role: 'hand_digit', side: 'L', parent: 'handL' },
  thumbTipL: { id: 'thumbTipL', role: 'hand_digit', side: 'L', parent: 'thumbL' },
  fingerL: { id: 'fingerL', role: 'hand_digit', side: 'L', parent: 'handL' },
  fingerTipL: { id: 'fingerTipL', role: 'hand_digit', side: 'L', parent: 'fingerL' },
  swivelR: { id: 'swivelR', role: 'shoulder_girdle', side: 'R', parent: 'lumbar', ikChain: 'armR' },
  swivelTipR: { id: 'swivelTipR', role: 'accessory_rig', side: 'R', parent: 'swivelR' },
  acromionR: { id: 'acromionR', role: 'shoulder_girdle', side: 'R', parent: 'swivelR', ikChain: 'armR' },
  braceR: { id: 'braceR', role: 'shoulder_girdle', side: 'R', parent: 'thorax' },
  humerusR: { id: 'humerusR', role: 'limb_arm', side: 'R', parent: 'acromionR', ikChain: 'armR' },
  forearmR: { id: 'forearmR', role: 'limb_arm', side: 'R', parent: 'humerusR', ikChain: 'armR' },
  handR: { id: 'handR', role: 'limb_arm', side: 'R', parent: 'forearmR', ikChain: 'armR' },
  thumbR: { id: 'thumbR', role: 'hand_digit', side: 'R', parent: 'handR' },
  thumbTipR: { id: 'thumbTipR', role: 'hand_digit', side: 'R', parent: 'thumbR' },
  fingerR: { id: 'fingerR', role: 'hand_digit', side: 'R', parent: 'handR' },
  fingerTipR: { id: 'fingerTipR', role: 'hand_digit', side: 'R', parent: 'fingerR' },
  hipL: { id: 'hipL', role: 'limb_leg', side: 'L', parent: 'pelvis', ikChain: 'legL' },
  femurL: { id: 'femurL', role: 'limb_leg', side: 'L', parent: 'hipL', ikChain: 'legL' },
  shinL: { id: 'shinL', role: 'limb_leg', side: 'L', parent: 'femurL', ikChain: 'legL' },
  footL: { id: 'footL', role: 'limb_leg', side: 'L', parent: 'shinL', ikChain: 'legL' },
  toeL: { id: 'toeL', role: 'foot_digit', side: 'L', parent: 'footL' },
  hipR: { id: 'hipR', role: 'limb_leg', side: 'R', parent: 'pelvis', ikChain: 'legR' },
  femurR: { id: 'femurR', role: 'limb_leg', side: 'R', parent: 'hipR', ikChain: 'legR' },
  shinR: { id: 'shinR', role: 'limb_leg', side: 'R', parent: 'femurR', ikChain: 'legR' },
  footR: { id: 'footR', role: 'limb_leg', side: 'R', parent: 'shinR', ikChain: 'legR' },
  toeR: { id: 'toeR', role: 'foot_digit', side: 'R', parent: 'footR' },
  wingL: { id: 'wingL', role: 'accessory_wing', side: 'L', parent: 'braceL' },
  wingR: { id: 'wingR', role: 'accessory_wing', side: 'R', parent: 'braceR' },
};

/**
 * Contralateral arm-to-leg couplings grounded in Muybridge bipedal locomotion:
 * left arm opposes right leg phase, right arm opposes left leg phase.
 */
export const CONTRALATERAL_LIMB_PAIRS = [
  { armSide: 'L' as const, legSide: 'R' as const, humerus: 'humerusL', forearm: 'forearmL', hip: 'hipR', femur: 'femurR', shin: 'shinR' },
  { armSide: 'R' as const, legSide: 'L' as const, humerus: 'humerusR', forearm: 'forearmR', hip: 'hipL', femur: 'femurL', shin: 'shinL' },
] as const;

/**
 * Standardized anatomical terminology set across inspector, bones list, and tooltips:
 * - Shoulder Socket (`acromionL/R`): outer socket bone the arm (`humerusL/R`) connects to
 * - Collarbone (`braceL/R` tendon): links Shoulder Socket to the neck ring
 * - Swivel (`swivelL/R`): obscured by Ribs, routes down toward the navel/lumbar spine
 * - Back Shoulderbone (`wingL/R` / `Backshoulder`): project name "Prometheus Wings"
 */
export const CANONICAL_BONE_LABELS: Partial<Record<JointId, string>> = {
  acromionL: 'Shoulder Socket L',
  acromionR: 'Shoulder Socket R',
  braceL: 'Collarbone L (neck to socket)',
  braceR: 'Collarbone R (neck to socket)',
  swivelL: 'Swivel L (navel brace, behind ribs)',
  swivelR: 'Swivel R (navel brace, behind ribs)',
  swivelTipL: 'Shoulder Socket Tip L',
  swivelTipR: 'Shoulder Socket Tip R',
  wingL: 'Back Shoulderbone L (Prometheus Wing)',
  wingR: 'Back Shoulderbone R (Prometheus Wing)',
};

export function getCanonicalBoneLabel(id: string, fallback?: string): string {
  return CANONICAL_BONE_LABELS[id as JointId] ?? fallback ?? id;
}

export const SHOULDER_GIRDLE_LAYER_CONTRACT = {
  foreground: 'Ribcage (obscures Swivel)',
  middle: 'Swivel (navel brace, always between Ribs and Back Shoulderbone)',
  background: 'Back Shoulderbone (project name: Prometheus Wings)',
} as const;

export interface HierarchyAuditReport {
  valid: boolean;
  orphanNodes: string[];
  cycles: string[];
  topologicalViolations: string[];
  parentMismatches: Array<{ id: string; expected: string | null; actual: string | null }>;
}

/**
 * Computes a deterministic strict topological order so every parent node and closed-chain
 * aim/bond dependency always evaluates prior to any child or dependent node.
 */
export function sortNodesTopologically(nodes: RigNode[], by: Record<string, RigNode>): RigNode[] {
  const ordered: RigNode[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (n: RigNode) => {
    if (visited.has(n.id) || visiting.has(n.id)) return;
    visiting.add(n.id);
    if (n.parent && by[n.parent]) visit(by[n.parent]);
    if (n.aim?.to && by[n.aim.to]) visit(by[n.aim.to]);
    if (n.bond?.parent && by[n.bond.parent]) visit(by[n.bond.parent]);
    visiting.delete(n.id);
    visited.add(n.id);
    ordered.push(n);
  };

  for (const n of nodes) visit(n);
  return ordered;
}

/**
 * Verifies every joint connects to a valid parent without cycles, appears strictly after its
 * parent in evaluation order, and matches the canonical 43-joint Bitruvius topology.
 */
export function auditRigHierarchy(nodes: RigNode[], by: Record<string, RigNode>): HierarchyAuditReport {
  const orphanNodes: string[] = [];
  const cycles: string[] = [];
  const topologicalViolations: string[] = [];
  const parentMismatches: Array<{ id: string; expected: string | null; actual: string | null }> = [];
  const indexById: Record<string, number> = {};
  nodes.forEach((n, idx) => {
    indexById[n.id] = idx;
  });

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.parent && !by[n.parent]) {
      orphanNodes.push(n.id);
    } else if (n.parent && indexById[n.parent] >= i) {
      topologicalViolations.push(n.id);
    }
    const meta = RIG_METADATA[n.id as JointId];
    if (meta && meta.parent !== n.parent) {
      parentMismatches.push({ id: n.id, expected: meta.parent, actual: n.parent });
    }
    const seen = new Set<string>([n.id]);
    let cur: RigNode | undefined = n.parent ? by[n.parent] : undefined;
    while (cur) {
      if (seen.has(cur.id)) {
        cycles.push(n.id);
        break;
      }
      seen.add(cur.id);
      cur = cur.parent ? by[cur.parent] : undefined;
    }
  }

  return {
    valid: orphanNodes.length === 0 && cycles.length === 0 && topologicalViolations.length === 0,
    orphanNodes,
    cycles,
    topologicalViolations,
    parentMismatches,
  };
}

import { JOINT_LIMITS } from './jointLimits';
import type { EffectorRole, LimbChainDef } from './types';

/**
 * Anatomical soft-clamp limits (degrees) derived cleanly from JOINT_LIMITS in jointLimits.ts.
 * Keeps base FK schema synchronized with FABRIK/procedural stiffness bounds.
 */
export const ANATOMICAL_LIMITS: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(JOINT_LIMITS).map(([id, lim]) => [id, [lim!.min, lim!.max]]),
);

/**
 * Canonical 2-bone and spine kinematic chains prepared for future IK,
 * Balance counterweight, and Clockwork limb track copying.
 */
export const LIMB_CHAINS: LimbChainDef[] = [
  { id: 'armL', label: 'Left Arm', swiv: 'swivelL', upper: 'humerusL', lower: 'forearmL', effector: 'handL', bendSign: -1 },
  { id: 'armR', label: 'Right Arm', swiv: 'swivelR', upper: 'humerusR', lower: 'forearmR', effector: 'handR', bendSign: 1 },
  { id: 'legL', label: 'Left Leg', upper: 'femurL', lower: 'shinL', effector: 'footL', bendSign: 1 },
  { id: 'legR', label: 'Right Leg', upper: 'femurR', lower: 'shinR', effector: 'footR', bendSign: -1 },
];

export const EFFECTOR_ROLES: Record<string, EffectorRole> = {
  handL: 'handL',
  handR: 'handR',
  footL: 'footL',
  footR: 'footR',
  head: 'head',
};

export interface RoadmapPhase {
  phase: string;
  title: string;
  status: 'active' | 'next' | 'planned';
  summary: string;
  items: string[];
}

export const GITHUB_ROADMAP: RoadmapPhase[] = [
  {
    phase: 'Base',
    title: 'ClaudeBase Pure FK & IK-Ready Hooks',
    status: 'active',
    summary: 'Calm grayscale carbon canvas, purple cutout puppet & menu accents, green digital bones, magenta-red tension cues, zero active IK.',
    items: [
      'Deterministic 2500×8742 pyxl FK solver with topological ordering & Float64 matrices',
      'Closed-chain shoulder bond (bondAng + setAim) with live strain tension readout',
      'Hierarchical Yorrick (head), Gotz (hand), and Piggy (foot) sub-rig editor',
      'IK-ready schema: anatomical limits, LIMB_CHAINS, parentOf(n), worldToLocalAngle, fitBoxParams',
    ],
  },
  {
    phase: 'Phase 1',
    title: 'Anatomical Views, Symmetry & FK Depth',
    status: 'next',
    summary: 'Add multi-angle anatomical inspection and coupled shoulder mechanics.',
    items: [
      'Back view (bv) with dorsal shoulder wing z-order flip (zBack)',
      '360° Turn Rig + Side/Side-Flip skull views with perspective sideShifts',
      'Swivel coupling modes (Mirror / Parallel / Free / Lock ribs) + Shoulder Transition Lab',
      'Interactive pivot editing (edit pivots) & hip perspective offsets',
    ],
  },
  {
    phase: 'Phase 2',
    title: 'Camera Framing, Guides & Stage Ergonomics',
    status: 'planned',
    summary: 'Expand camera presets and workspace navigation around the generalized fitBoxParams engine.',
    items: [
      'Cam Bar presets (Full / Upper / Focus) with smooth animated transitions',
      'Vertical scroll rail & Golden Ratio Auto-Focus subtle cursor tracking',
      'Perspective horizon grid overlay (perspOn) & docked/floating layout toggle',
    ],
  },
  {
    phase: 'Phase 3',
    title: 'Live Projyct.Gotz Hand & Consolidated Skull Views',
    status: 'planned',
    summary: 'Upgrade extremity sub-rigs using the ASSET_LIBRARY consolidated specs.',
    items: [
      'Live side-by-side Gotz hand pane (5F / Claw / Trident / Mickey builds)',
      'Interactive wrist wheel, coupled grip/splay/tilt, and pose code readout',
      'View-synced Back & Side consolidated Yorrick skull assets',
    ],
  },
  {
    phase: 'Phase 4',
    title: 'Multi-Mode Motion, Snap Bar & Clockwork Engine',
    status: 'planned',
    summary: 'Layer expressive timing engines atop the unified PoseSnapshot contract.',
    items: [
      'FPS cadence gate & Fluid / Elastic / Snap (Snap/Flow/Mech/Clock) modes',
      'Draggable Snap Bar (A/B/C poses, translucent onion-skin ghosts, ping-pong loop)',
      'Clockwork stage sequencer with per-bone cubic-bezier curves, anticipation & stagger',
      'Walk cycle perspective shifts synchronized to full-model locomotion across the stage',
    ],
  },
  {
    phase: 'Phase 5',
    title: 'Full Analytical & Reverse-Hierarchy IK',
    status: 'planned',
    summary: 'Activate the dormant IK-ready chains without rewriting the FK core.',
    items: [
      '2-bone analytical limb solver (solveLimbIK) with softness & bend-hint controls',
      'Reverse-hierarchy pinning (Balance + Straight IK, Pin Feet, Pin Feet+Hands, Pin Full Rig)',
      'Counterweight balance (applyBalance), ground contact gravity, and 0.26s hold-for-IK',
    ],
  },
];

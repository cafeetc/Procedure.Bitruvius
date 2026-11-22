import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildRigGraph } from './fkEngine';
import { JOINT_LIMITS } from './jointLimits';
import {
  DEFAULT_PROCEDURAL_RECIPE,
  MOOD_OPTIONS,
  STARTER_STANCE_CATALOG,
  STANCE_OPTIONS,
  buildAndGeneratePose,
  type ProceduralRecipe,
} from './proceduralPoseEngine';
import type { JointId } from './motionFormat';
import type { RawRigDef } from './types';

const rigJsonPath = path.resolve(process.cwd(), 'public/rig-data.json');
const rawData = JSON.parse(fs.readFileSync(rigJsonPath, 'utf8')) as { rig: RawRigDef };

test('starter catalog contains 12 classic figure-drawing archetypes with cam metadata', () => {
  assert.equal(STARTER_STANCE_CATALOG.length, 12);
  for (const stance of STARTER_STANCE_CATALOG) {
    assert.ok(stance.id.length > 0);
    assert.ok(stance.label.length > 0);
    assert.ok(stance.cam && typeof stance.cam.phaseLag === 'number');
  }
});

test('all 8 Moods x 12 Stances produce finite joint angles and valid root coords', () => {
  for (const mood of MOOD_OPTIONS) {
    for (const stance of STANCE_OPTIONS) {
      const recipe: ProceduralRecipe = {
        ...DEFAULT_PROCEDURAL_RECIPE,
        mood: mood.id,
        stance: stance.id,
        prometheusWings: stance.id === 'promethean',
      };
      const result = buildAndGeneratePose(rawData.rig, recipe, buildRigGraph);
      assert.ok(Number.isFinite(result.root[0]), `root.x finite for ${mood.id}/${stance.id}`);
      assert.ok(Number.isFinite(result.root[1]), `root.y finite for ${mood.id}/${stance.id}`);
      for (const [id, ang] of Object.entries(result.angles)) {
        assert.ok(Number.isFinite(ang), `joint ${id} finite for ${mood.id}/${stance.id}`);
      }
    }
  }
});

test('mood toggles meaningfully differentiate spine, shoulders, jaw, and Gotz hand gestures', () => {
  const heroic = buildAndGeneratePose(
    rawData.rig,
    { ...DEFAULT_PROCEDURAL_RECIPE, mood: 'heroic', stance: 'wideReady' },
    buildRigGraph,
  );
  const melancholic = buildAndGeneratePose(
    rawData.rig,
    { ...DEFAULT_PROCEDURAL_RECIPE, mood: 'melancholic', stance: 'wideReady' },
    buildRigGraph,
  );
  const predatory = buildAndGeneratePose(
    rawData.rig,
    { ...DEFAULT_PROCEDURAL_RECIPE, mood: 'predatory', stance: 'wideReady' },
    buildRigGraph,
  );

  assert.notEqual(heroic.angles.thorax, melancholic.angles.thorax);
  assert.ok(melancholic.angles.head > heroic.angles.head);
  assert.ok(predatory.angles.lip > heroic.angles.lip);
  assert.notEqual(heroic.handStates.L.cj.index[0], melancholic.handStates.L.cj.index[0]);
});

test('perspective elevation and bodyView turnaround alter spine bias and 360 skull step', () => {
  const wormsEye = buildAndGeneratePose(
    rawData.rig,
    { ...DEFAULT_PROCEDURAL_RECIPE, elevation: 'wormsEye', bodyView: 'sideR' },
    buildRigGraph,
  );
  const birdsEye = buildAndGeneratePose(
    rawData.rig,
    { ...DEFAULT_PROCEDURAL_RECIPE, elevation: 'birdsEye', bodyView: 'sideR' },
    buildRigGraph,
  );
  const backView = buildAndGeneratePose(
    rawData.rig,
    { ...DEFAULT_PROCEDURAL_RECIPE, bodyView: 'back', skullFacing: 'auto' },
    buildRigGraph,
  );

  assert.notEqual(wormsEye.angles.thorax, birdsEye.angles.thorax);
  assert.equal(wormsEye.headStep, 1);
  assert.equal(wormsEye.skullView, 'side');
  assert.equal(backView.headStep, 2);
  assert.equal(backView.skullView, 'back');
});

test('custom JSON stance extends the starter catalog cleanly', () => {
  const customStance = {
    id: 'custom_archer',
    label: 'Archer Draw',
    category: 'Custom',
    cue: 'Custom JSON draw pose',
    regime: 'standing' as const,
    rootOffset: [0, 120] as [number, number],
    nodes: {
      pelvis: -4,
      humerusL: -95,
      humerusR: 72,
      forearmR: 118,
    },
  };
  const res = buildAndGeneratePose(
    rawData.rig,
    { ...DEFAULT_PROCEDURAL_RECIPE, stance: 'custom_archer' },
    buildRigGraph,
    [customStance],
  );
  assert.ok(res.angles.humerusL < -50);
  assert.ok(res.angles.forearmR > 60);
});

test('soft anatomical limits keep all clamped joints within JOINT_LIMITS', () => {
  const extreme = buildAndGeneratePose(
    rawData.rig,
    {
      ...DEFAULT_PROCEDURAL_RECIPE,
      mood: 'dramatic',
      stance: 'sprintDrive',
      intensity: 'extreme',
      constrainLimits: true,
    },
    buildRigGraph,
  );

  for (const [id, ang] of Object.entries(extreme.angles)) {
    const lim = JOINT_LIMITS[id as JointId];
    if (lim) {
      assert.ok(
        ang >= lim.min - 0.15 && ang <= lim.max + 0.15,
        `joint ${id} (${ang}) stays within [${lim.min}, ${lim.max}]`,
      );
    }
  }
});

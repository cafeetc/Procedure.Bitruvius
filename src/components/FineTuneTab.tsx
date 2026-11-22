import React from 'react';
import { RotateCcw } from 'lucide-react';
import type { RibAnchorMode } from '../engine/fkEngine';
import type { GotzBuild } from '../engine/gotzHandEngine';
import {
  ARM_ATTITUDE_OPTIONS,
  HAND_GESTURE_OPTIONS,
  HEAD_PITCH_OPTIONS,
  INTENSITY_OPTIONS,
  JAW_OPTIONS,
  LEG_SIDE_OPTIONS,
  LEG_STANCE_OPTIONS,
  SYMMETRY_OPTIONS,
  TORSO_LEAN_OPTIONS,
  type GeneratedPoseResult,
  type LiveNudgeKind,
  type ProceduralRecipe,
} from '../engine/proceduralPoseEngine';
import { CompassControl, SegmentedToggle, ToggleSwitch } from './ToggleControls';

interface FineTuneTabProps {
  recipe: ProceduralRecipe;
  poseMetrics: GeneratedPoseResult['metrics'] | null;
  onUpdate: (patch: Partial<ProceduralRecipe>) => void;
  onHoldNudge: (kind: LiveNudgeKind, dtSec: number) => void;
  onResetFineTune: () => void;
}

export const FineTuneTab: React.FC<FineTuneTabProps> = ({
  recipe,
  poseMetrics,
  onUpdate,
  onHoldNudge,
  onResetFineTune,
}) => {
  const nextSeed = (): 0 | 1 | 2 | 3 => ((recipe.seedVariant + 1) % 4) as 0 | 1 | 2 | 3;

  const tapOrVary = (patch: Partial<ProceduralRecipe>, alreadyActive: boolean) => {
    onUpdate(alreadyActive ? { ...patch, seedVariant: nextSeed() } : patch);
  };

  const activeSpineLabel =
    TORSO_LEAN_OPTIONS.find((o) => o.id === recipe.torsoLean)?.label ?? recipe.torsoLean;
  const activeHeadLabel =
    HEAD_PITCH_OPTIONS.find((o) => o.id === recipe.headPitch)?.label ?? recipe.headPitch;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[14px] font-semibold text-[#e6e8ec]">
            Toggle Fine-Tuning
          </h2>
          <p className="text-[11.5px] text-[#8b919c]">
            Tap buttons to generate · Hold buttons to live-nudge on stage.
          </p>
        </div>
        <button
          type="button"
          onClick={onResetFineTune}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[#2b2f36] bg-[#0e0f11] px-2.5 py-1.5 text-[11.5px] font-medium text-[#b4bac4] transition-colors hover:border-[#ef4444]/70 hover:text-[#fca5a5]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset
        </button>
      </div>

      {/* Concise Automaton Readout */}
      {poseMetrics && (
        <div className="grid grid-cols-3 gap-1.5 rounded border border-[#2b2f36] bg-[#0e0f11] p-2">
          <div>
            <div className="text-[10.5px] text-[#8b919c]">Regime</div>
            <div className="font-mono-tabular text-[12px] font-semibold capitalize text-[#4ade80]">
              {poseMetrics.regime}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] text-[#8b919c]">Span Ratio</div>
            <div className="font-mono-tabular text-[12px] font-semibold text-[#e6e8ec]">
              {poseMetrics.armSpanRatio.toFixed(2)}×
            </div>
          </div>
          <div>
            <div className="text-[10.5px] text-[#8b919c]">Hip Splay</div>
            <div className="font-mono-tabular text-[12px] font-semibold text-[#c084fc]">
              {poseMetrics.legSplayDeg.toFixed(1)}°
            </div>
          </div>
        </div>
      )}

      {/* 1. Energy & Symmetry */}
      <section className="space-y-3">
        <SegmentedToggle
          label="Pose Intensity"
          value={recipe.intensity}
          columns={4}
          options={INTENSITY_OPTIONS.map((o) => ({
            id: o.id,
            label: o.label,
            title: o.cue,
            onHoldStep: (dt) =>
              onHoldNudge(o.id === 'subtle' ? 'intensityDown' : 'intensityUp', dt),
          }))}
          onChange={(intensity) => tapOrVary({ intensity }, recipe.intensity === intensity)}
        />

        <SegmentedToggle
          label="Bilateral Symmetry"
          value={recipe.symmetry}
          columns={2}
          accent="green"
          options={SYMMETRY_OPTIONS.map((o) => ({ id: o.id, label: o.label, title: o.cue }))}
          onChange={(symmetry) => tapOrVary({ symmetry }, recipe.symmetry === symmetry)}
        />
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* 2. Spine & Head Compasses */}
      <section className="space-y-3">
        <h3 className="font-display text-[13px] font-semibold text-[#e6e8ec]">
          Spine &amp; Head Compasses
        </h3>

        <CompassControl
          centerLabel="Spine Lean"
          centerSublabel={activeSpineLabel}
          centerActive={recipe.torsoLean === 'auto'}
          onCenterTap={() => tapOrVary({ torsoLean: 'auto' }, recipe.torsoLean === 'auto')}
          up={{
            label: 'Arch Back',
            active: recipe.torsoLean === 'archBack',
            title: 'Lifted sternum & thoracic extension',
            onTap: () => tapOrVary({ torsoLean: 'archBack' }, recipe.torsoLean === 'archBack'),
            onHoldStep: (dt) => onHoldNudge('spineArch', dt),
          }}
          down={{
            label: 'Forward',
            active: recipe.torsoLean === 'forward',
            title: 'Coiled forward inclination',
            onTap: () => tapOrVary({ torsoLean: 'forward' }, recipe.torsoLean === 'forward'),
            onHoldStep: (dt) => onHoldNudge('spineForward', dt),
          }}
          left={{
            label: 'Sway L',
            active: recipe.torsoLean === 'swayL',
            title: 'Counter-curve toward left hip',
            onTap: () => tapOrVary({ torsoLean: 'swayL' }, recipe.torsoLean === 'swayL'),
            onHoldStep: (dt) => onHoldNudge('spineSwayL', dt),
          }}
          right={{
            label: 'Sway R',
            active: recipe.torsoLean === 'swayR',
            title: 'Counter-curve toward right hip',
            onTap: () => tapOrVary({ torsoLean: 'swayR' }, recipe.torsoLean === 'swayR'),
            onHoldStep: (dt) => onHoldNudge('spineSwayR', dt),
          }}
          topLeft={{
            label: 'Upright',
            active: recipe.torsoLean === 'upright',
            title: 'Aligned vertical spine stack',
            onTap: () => tapOrVary({ torsoLean: 'upright' }, recipe.torsoLean === 'upright'),
          }}
          topRight={{
            label: 'Auto',
            active: recipe.torsoLean === 'auto',
            title: 'Mood & stance spine curve',
            onTap: () => tapOrVary({ torsoLean: 'auto' }, recipe.torsoLean === 'auto'),
          }}
        />

        <CompassControl
          centerLabel="Head Pose"
          centerSublabel={activeHeadLabel}
          centerActive={recipe.headPitch === 'auto'}
          accent="green"
          onCenterTap={() => tapOrVary({ headPitch: 'auto' }, recipe.headPitch === 'auto')}
          up={{
            label: 'Chin Up',
            active: recipe.headPitch === 'chinUp',
            title: 'Lifted defiant crown',
            onTap: () => tapOrVary({ headPitch: 'chinUp' }, recipe.headPitch === 'chinUp'),
            onHoldStep: (dt) => onHoldNudge('headUp', dt),
          }}
          down={{
            label: 'Chin Tuck',
            active: recipe.headPitch === 'chinTuck',
            title: 'Protected lowered brow',
            onTap: () => tapOrVary({ headPitch: 'chinTuck' }, recipe.headPitch === 'chinTuck'),
            onHoldStep: (dt) => onHoldNudge('headTuck', dt),
          }}
          left={{
            label: 'Tilt L',
            active: recipe.headPitch === 'tiltL',
            title: 'Curious left ear tilt',
            onTap: () => tapOrVary({ headPitch: 'tiltL' }, recipe.headPitch === 'tiltL'),
            onHoldStep: (dt) => onHoldNudge('headTiltL', dt),
          }}
          right={{
            label: 'Tilt R',
            active: recipe.headPitch === 'tiltR',
            title: 'Curious right ear tilt',
            onTap: () => tapOrVary({ headPitch: 'tiltR' }, recipe.headPitch === 'tiltR'),
            onHoldStep: (dt) => onHoldNudge('headTiltR', dt),
          }}
          topLeft={{
            label: 'Level',
            active: recipe.headPitch === 'level',
            title: 'Neutral horizon gaze',
            onTap: () => tapOrVary({ headPitch: 'level' }, recipe.headPitch === 'level'),
          }}
          topRight={{
            label: 'Auto',
            active: recipe.headPitch === 'auto',
            title: 'Mood-driven gaze',
            onTap: () => tapOrVary({ headPitch: 'auto' }, recipe.headPitch === 'auto'),
          }}
        />

        <SegmentedToggle
          label="Mandible Jaw"
          value={recipe.jaw}
          columns={4}
          accent="red"
          options={JAW_OPTIONS.map((o) => ({
            id: o.id,
            label: o.label,
            title: o.cue,
            onHoldStep: (dt) => onHoldNudge(o.id === 'closed' ? 'jawClose' : 'jawOpen', dt),
          }))}
          onChange={(jaw) => tapOrVary({ jaw }, recipe.jaw === jaw)}
        />

        <SegmentedToggle
          label="Arm Attitude Override"
          value={recipe.armAttitude}
          columns={3}
          options={ARM_ATTITUDE_OPTIONS.map((o) => ({
            id: o.id,
            label: o.label,
            title: o.cue,
            onHoldStep: (dt) =>
              onHoldNudge(
                o.id === 'guard' || o.id === 'akimbo' ? 'armGuardIn' : 'armSpreadOut',
                dt,
              ),
          }))}
          onChange={(armAttitude) => tapOrVary({ armAttitude }, recipe.armAttitude === armAttitude)}
        />
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* 3. Consolidated Leg Stance & Foot Contact */}
      <section className="space-y-3 rounded-md border border-[#2b2f36] bg-[#141619] p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-[13px] font-semibold text-[#e6e8ec]">
            Leg Stance
          </h3>
          <span className="text-[11px] text-[#8b919c]">Side · Grounding · Plant</span>
        </div>

        <SegmentedToggle
          label="Active Leg Side"
          value={recipe.legStanceSide}
          columns={3}
          accent="green"
          options={LEG_SIDE_OPTIONS.map((o) => ({ id: o.id, label: o.label, title: o.cue }))}
          onChange={(legStanceSide) =>
            tapOrVary({ legStanceSide }, recipe.legStanceSide === legStanceSide)
          }
        />

        <SegmentedToggle
          label="Stance Type"
          value={recipe.legStanceMode}
          columns={4}
          options={LEG_STANCE_OPTIONS.map((o) => ({
            id: o.id,
            label: o.label,
            title: o.cue,
            onHoldStep: (dt) =>
              onHoldNudge(
                o.id === 'tiptoe'
                  ? 'plantHeelUp'
                  : o.id === 'oneKnee' || o.id === 'twoKnee' || o.id === 'seated'
                  ? 'legKneelDown'
                  : 'legSplayOut',
                dt,
              ),
          }))}
          onChange={(legStanceMode) =>
            tapOrVary(
              {
                legStanceMode,
                footPlant: legStanceMode === 'tiptoe' ? 'tiptoe' : 'auto',
              },
              recipe.legStanceMode === legStanceMode,
            )
          }
        />
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* 4. Thorax & Wings */}
      <section className="space-y-3">
        <h3 className="font-display text-[13px] font-semibold text-[#e6e8ec]">
          Thorax &amp; Wings
        </h3>

        <SegmentedToggle<RibAnchorMode>
          label="Ribcage Anchor"
          value={recipe.ribAnchor}
          columns={3}
          options={[
            { id: 'upper', label: 'Upper Chest', title: 'Hinges from sternum' },
            { id: 'lower', label: 'Chungus Swing', title: 'Hinges at spine junction' },
            { id: 'ribwings', label: 'Ribwings', title: 'Bilateral neck anchors' },
          ]}
          onChange={(ribAnchor) => tapOrVary({ ribAnchor }, recipe.ribAnchor === ribAnchor)}
        />

        <ToggleSwitch
          label="Prometheus Dorsal Wings"
          description="Unfurls elastic scapular wings behind the ribcage with arm follow-through."
          checked={recipe.prometheusWings}
          onChange={(prometheusWings) => onUpdate({ prometheusWings })}
        />
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* 5. Gotz 5-Digit Hands */}
      <section className="space-y-3">
        <h3 className="font-display text-[13px] font-semibold text-[#e6e8ec]">
          Gotz 5-Digit Hands
        </h3>

        <SegmentedToggle<GotzBuild>
          label="Digit Morphology"
          value={recipe.handBuild}
          columns={4}
          options={[
            { id: 'standard', label: '5-Finger' },
            { id: 'claw', label: 'Claw' },
            { id: 'trident', label: 'Trident' },
            { id: 'mickey', label: '4-Digit' },
          ]}
          onChange={(handBuild) => tapOrVary({ handBuild }, recipe.handBuild === handBuild)}
        />

        <SegmentedToggle
          label="Left Hand Gesture"
          value={recipe.handGestureL}
          columns={3}
          accent="green"
          options={HAND_GESTURE_OPTIONS.map((g) => ({
            id: g,
            label: g === 'auto' ? 'Auto' : g,
          }))}
          onChange={(handGestureL) =>
            tapOrVary({ handGestureL }, recipe.handGestureL === handGestureL)
          }
        />

        <SegmentedToggle
          label="Right Hand Gesture"
          value={recipe.handGestureR}
          columns={3}
          accent="green"
          options={HAND_GESTURE_OPTIONS.map((g) => ({
            id: g,
            label: g === 'auto' ? 'Auto' : g,
          }))}
          onChange={(handGestureR) =>
            tapOrVary({ handGestureR }, recipe.handGestureR === handGestureR)
          }
        />
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* 6. Biomechanical Solvers */}
      <section className="space-y-2">
        <h3 className="font-display text-[13px] font-semibold text-[#e6e8ec]">
          Biomechanical Linkages
        </h3>

        <ToggleSwitch
          label="Soft Anatomical Limits"
          description="Clamps joints to natural human biomechanical rotation ranges."
          checked={recipe.constrainLimits}
          accent="green"
          onChange={(constrainLimits) => onUpdate({ constrainLimits })}
        />

        <ToggleSwitch
          label="Closed-Chain Shoulder Bond"
          description="Couples clavicle braces, shoulder swivels, and acromion tendons."
          checked={recipe.bondOn}
          accent="green"
          onChange={(bondOn) => onUpdate({ bondOn })}
        />

        <ToggleSwitch
          label="Floor Contact Gravity"
          description="Plants lowest foot cleanly onto the perspective ground plane."
          checked={recipe.footGravity}
          accent="green"
          onChange={(footGravity) => onUpdate({ footGravity })}
        />

        <ToggleSwitch
          label="Counterweight Balance"
          description="Shifts pelvis center-of-mass toward the grounded support foot."
          checked={recipe.balanceCounterweight}
          accent="green"
          onChange={(balanceCounterweight) => onUpdate({ balanceCounterweight })}
        />

        <ToggleSwitch
          label="Muybridge Contralateral Swing"
          description="Applies opposite arm-to-leg swing during locomotion stances."
          checked={recipe.contralateralMotion}
          accent="green"
          onChange={(contralateralMotion) => onUpdate({ contralateralMotion })}
        />
      </section>
    </div>
  );
};

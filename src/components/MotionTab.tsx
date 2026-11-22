import React from 'react';
import { Pause, Play, Sparkles, Trash2 } from 'lucide-react';
import { ABC_SLOTS, getFilledAbcSlots } from '../engine/motionEngine';
import type {
  AbcLoopMode,
  AbcSerializedState,
  AbcSlot,
  MotionFeel,
  SkullTurnTiming,
} from '../engine/types';
import { SegmentedToggle, ToggleSwitch } from './ToggleControls';

interface MotionTabProps {
  abc: AbcSerializedState;
  playing: boolean;
  onCaptureSlot: (slot: AbcSlot) => void;
  onJumpSlot: (slot: AbcSlot) => void;
  onClearSlot: (slot: AbcSlot) => void;
  onSynthB: () => void;
  onTogglePlay: () => void;
  onUpdateAbc: (patch: Partial<AbcSerializedState>) => void;
}

const FEEL_CHOICES: Array<{ id: MotionFeel; label: string; title: string }> = [
  { id: 'flow', label: 'Flow', title: 'Continuous phase-locked flow' },
  { id: 'snap', label: 'Snap', title: 'Crisp anticipation & settle' },
  { id: 'elastic', label: 'Elastic', title: 'Spring overshoot & bounce' },
  { id: 'mechanical', label: 'Mechanical', title: 'Cam detent & crisp lock' },
  { id: 'clockwork', label: 'Clockwork', title: 'Stepped brass gear escapement' },
  { id: 'proceduralEase', label: 'Procedural', title: 'C2-smooth auto-forged arc' },
];

export const MotionTab: React.FC<MotionTabProps> = ({
  abc,
  playing,
  onCaptureSlot,
  onJumpSlot,
  onClearSlot,
  onSynthB,
  onTogglePlay,
  onUpdateAbc,
}) => {
  const filled = getFilledAbcSlots(abc.poses);
  const canAnimate = filled.length >= 2;
  const canSynthB = !!abc.poses.A && !!abc.poses.C && !abc.poses.B;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[14px] font-semibold text-[#e6e8ec]">
            A–B–C Keyframe Sequencer
          </h2>
          <p className="text-[11.5px] text-[#8b919c]">
            Capture generated poses into slots A, B, and C, then drive cam interpolation.
          </p>
        </div>
        <button
          type="button"
          disabled={!canAnimate}
          onClick={onTogglePlay}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
            !canAnimate
              ? 'cursor-not-allowed border-[#2b2f36] bg-[#0e0f11] text-[#5c626e]'
              : playing
              ? 'border-[#ef4444] bg-[#ef4444]/20 text-[#fca5a5] hover:bg-[#ef4444]/30'
              : 'border-[#22c55e] bg-[#22c55e]/20 text-[#86efac] hover:bg-[#22c55e]/30'
          }`}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? 'Stop Loop' : 'Play Loop'}
        </button>
      </div>

      {/* Keyframe Slots */}
      <section className="space-y-2">
        <div className="grid grid-cols-3 gap-1.5">
          {ABC_SLOTS.map((slot) => {
            const hasPose = !!abc.poses[slot];
            const isActive = abc.activeSlot === slot;
            return (
              <div
                key={slot}
                className={`rounded border p-2.5 transition-colors ${
                  isActive && hasPose
                    ? 'border-[#a855f7] bg-[#7e22ce]/20'
                    : 'border-[#2b2f36] bg-[#0e0f11]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono-tabular text-[12.5px] font-semibold text-[#e6e8ec]">
                    Slot {slot}
                  </span>
                  <span
                    className={`text-[10.5px] font-semibold ${
                      hasPose ? 'text-[#4ade80]' : 'text-[#6c7382]'
                    }`}
                  >
                    {hasPose ? 'Ready' : 'Empty'}
                  </span>
                </div>

                <div className="mt-2 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => onCaptureSlot(slot)}
                    className="w-full whitespace-nowrap rounded border border-[#2b2f36] bg-[#191b1f] px-2 py-1 text-[11px] font-medium text-[#e6e8ec] transition-colors hover:border-[#a855f7] hover:bg-[#7e22ce]/25"
                  >
                    {hasPose ? `Overwrite ${slot}` : `Capture ${slot}`}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!hasPose}
                      onClick={() => onJumpSlot(slot)}
                      className={`flex-1 whitespace-nowrap rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                        hasPose
                          ? 'border-[#2b2f36] bg-[#121315] text-[#b4bac4] hover:border-[#414752] hover:text-[#e6e8ec]'
                          : 'cursor-not-allowed border-[#2b2f36]/50 bg-[#121315] text-[#525866]'
                      }`}
                    >
                      Recall
                    </button>
                    {hasPose && (
                      <button
                        type="button"
                        aria-label={`Clear slot ${slot}`}
                        onClick={() => onClearSlot(slot)}
                        className="rounded border border-[#2b2f36] bg-[#121315] p-1 text-[#8b919c] transition-colors hover:border-[#ef4444]/70 hover:text-[#fca5a5]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {canSynthB && (
          <button
            type="button"
            onClick={onSynthB}
            className="flex w-full items-center justify-center gap-2 rounded border border-[#22c55e]/60 bg-[#22c55e]/15 px-3 py-2 text-[12px] font-medium text-[#86efac] transition-colors hover:bg-[#22c55e]/25"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Synthesize Procedural In-Between (B) from A → C
          </button>
        )}
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* Motion Feel & Cadence */}
      <section className="space-y-3.5">
        <SegmentedToggle<MotionFeel>
          label="Automaton Curve Feel"
          value={abc.feel}
          columns={3}
          options={FEEL_CHOICES}
          onChange={(feel) => onUpdateAbc({ feel })}
        />

        <div className="grid grid-cols-2 gap-3">
          <SegmentedToggle<AbcLoopMode>
            label="Playback Loop"
            value={abc.loopMode}
            columns={2}
            options={[
              { id: 'pingpong', label: 'Ping-Pong' },
              { id: 'cycle', label: 'Cycle' },
            ]}
            onChange={(loopMode) => onUpdateAbc({ loopMode })}
          />

          <SegmentedToggle<SkullTurnTiming>
            label="Skull Turn Timing"
            value={abc.skullTurnTiming ?? 'halfway'}
            columns={2}
            accent="green"
            options={[
              { id: 'halfway', label: '½ Tween' },
              { id: 'nextLetter', label: 'On Letter' },
            ]}
            onChange={(skullTurnTiming) => onUpdateAbc({ skullTurnTiming })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SegmentedToggle<number>
            label="Cadence FPS"
            value={abc.fps}
            columns={4}
            options={[
              { id: 8, label: '8' },
              { id: 12, label: '12' },
              { id: 24, label: '24' },
              { id: 60, label: '60' },
            ]}
            onChange={(fps) => onUpdateAbc({ fps, steppedFps: fps < 60 })}
          />

          <SegmentedToggle<number>
            label="Frames per Tween"
            value={abc.snapFrames}
            columns={4}
            options={[
              { id: 4, label: '4f' },
              { id: 6, label: '6f' },
              { id: 10, label: '10f' },
              { id: 16, label: '16f' },
            ]}
            onChange={(snapFrames) => onUpdateAbc({ snapFrames })}
          />
        </div>

        <ToggleSwitch
          label="Onion-Skin Keyframe Ghosts"
          description="Display translucent A / B / C pose silhouettes behind the active puppet."
          checked={abc.ghostVisible}
          onChange={(ghostVisible) => onUpdateAbc({ ghostVisible })}
        />
      </section>
    </div>
  );
};

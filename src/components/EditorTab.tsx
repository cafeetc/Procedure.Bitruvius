import React, { useState } from 'react';
import { Crosshair, FlipHorizontal2, Minus, Plus, RotateCcw, Save } from 'lucide-react';
import type { AbcSlot, RigNode } from '../engine/types';
import { TapHoldButton } from './ToggleControls';

interface EditorTabProps {
  nodes: RigNode[];
  selectedNodeId: string | null;
  manualOverrideActive: boolean;
  activeAbcSlot: AbcSlot;
  footToeBreak: { R: number; L: number };
  onSelectNode: (id: string | null) => void;
  onNudgeNodeAngle: (id: string, deltaDeg: number) => void;
  onToggleFlipX: (id: string) => void;
  onResetBone: (id: string) => void;
  onResetAllEdits: () => void;
  onNudgeFootToeBreak: (side: 'L' | 'R' | 'both', deltaDeg: number) => void;
  onNudgeHandsCurl: (side: 'L' | 'R' | 'both', deltaDeg: number) => void;
  onCaptureToAbc: (slot: AbcSlot) => void;
  onPromoteStance: (name: string, category: string) => void;
}

const QUICK_JOINT_GROUPS: Array<{ title: string; ids: Array<{ id: string; label: string }> }> = [
  {
    title: 'Core & Skull',
    ids: [
      { id: 'pelvis', label: 'Pelvis' },
      { id: 'lumbar', label: 'Lumbar' },
      { id: 'thorax', label: 'Thorax' },
      { id: 'neck', label: 'Neck' },
      { id: 'head', label: 'Skull' },
      { id: 'lip', label: 'Jaw' },
    ],
  },
  {
    title: 'Arms & Shoulders',
    ids: [
      { id: 'swivelR', label: 'Swivel R' },
      { id: 'humerusR', label: 'Upper R' },
      { id: 'forearmR', label: 'Forearm R' },
      { id: 'handR', label: 'Hand R' },
      { id: 'swivelL', label: 'Swivel L' },
      { id: 'humerusL', label: 'Upper L' },
      { id: 'forearmL', label: 'Forearm L' },
      { id: 'handL', label: 'Hand L' },
    ],
  },
  {
    title: 'Legs & Collapsed Feet',
    ids: [
      { id: 'femurR', label: 'Thigh R' },
      { id: 'shinR', label: 'Shin R' },
      { id: 'footR', label: 'Foot R' },
      { id: 'femurL', label: 'Thigh L' },
      { id: 'shinL', label: 'Shin L' },
      { id: 'footL', label: 'Foot L' },
    ],
  },
];

export const EditorTab: React.FC<EditorTabProps> = ({
  nodes,
  selectedNodeId,
  manualOverrideActive,
  activeAbcSlot,
  footToeBreak,
  onSelectNode,
  onNudgeNodeAngle,
  onToggleFlipX,
  onResetBone,
  onResetAllEdits,
  onNudgeFootToeBreak,
  onNudgeHandsCurl,
  onCaptureToAbc,
  onPromoteStance,
}) => {
  const [stanceName, setStanceName] = useState('');
  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = stanceName.trim();
    if (!cleaned) return;
    onPromoteStance(cleaned, 'Edited');
    setStanceName('');
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-[14px] font-semibold text-[#e6e8ec]">
            Interactive Model Editor
          </h2>
          <p className="mt-0.5 text-[11.5px] leading-snug text-[#8b919c]">
            Drag any bone on the Digital Skeleton or Rig panel to rotate · Drag Pelvis to reposition root.
          </p>
        </div>
        <button
          type="button"
          onClick={onResetAllEdits}
          title="Discard interactive edits and re-sync with procedural recipe"
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[#2b2f36] bg-[#0e0f11] px-2.5 py-1.5 text-[11.5px] font-medium text-[#b4bac4] transition-colors hover:border-[#ef4444]/70 hover:text-[#fca5a5]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset All
        </button>
      </div>

      {/* Selected Bone Inspector */}
      <section className="space-y-2.5 rounded-md border border-[#2b2f36] bg-[#141619] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Crosshair className="h-3.5 w-3.5 text-[#22c55e]" aria-hidden="true" />
            <span className="text-[12px] font-semibold text-[#e6e8ec]">
              {selectedNode ? selectedNode.name : 'No Bone Selected'}
            </span>
          </div>
          {selectedNode && (
            <span className="font-mono-tabular text-[11px] text-[#4ade80]">
              {selectedNode.ang.toFixed(1)}°
            </span>
          )}
        </div>

        {selectedNode ? (
          <>
            <div className="flex items-center justify-between text-[11px] text-[#8b919c]">
              <span>ID: {selectedNode.id}</span>
              <span className="font-mono-tabular">
                Limits [{selectedNode.limits[0]}°, {selectedNode.limits[1]}°]
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              <TapHoldButton
                onTap={() => onNudgeNodeAngle(selectedNode.id, -2)}
                onHoldStep={(dt) => onNudgeNodeAngle(selectedNode.id, -dt * 38)}
                title="Rotate counter-clockwise (Tap: -2° · Hold: continuous)"
                className="flex min-h-[34px] items-center justify-center gap-1 rounded border border-[#2b2f36] bg-[#0e0f11] px-2 text-[12px] font-medium text-[#e6e8ec] hover:border-[#a855f7]"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                CCW
              </TapHoldButton>

              <TapHoldButton
                onTap={() => onNudgeNodeAngle(selectedNode.id, 2)}
                onHoldStep={(dt) => onNudgeNodeAngle(selectedNode.id, dt * 38)}
                title="Rotate clockwise (Tap: +2° · Hold: continuous)"
                className="flex min-h-[34px] items-center justify-center gap-1 rounded border border-[#2b2f36] bg-[#0e0f11] px-2 text-[12px] font-medium text-[#e6e8ec] hover:border-[#a855f7]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                CW
              </TapHoldButton>

              <button
                type="button"
                aria-pressed={!!selectedNode.flipX}
                onClick={() => onToggleFlipX(selectedNode.id)}
                className={`flex min-h-[34px] items-center justify-center gap-1 rounded border px-2 text-[11.5px] font-medium transition-colors ${
                  selectedNode.flipX
                    ? 'border-[#22c55e] bg-[#22c55e]/20 text-[#86efac]'
                    : 'border-[#2b2f36] bg-[#0e0f11] text-[#b4bac4] hover:border-[#414752]'
                }`}
              >
                <FlipHorizontal2 className="h-3.5 w-3.5" aria-hidden="true" />
                Flip X
              </button>

              <button
                type="button"
                onClick={() => onResetBone(selectedNode.id)}
                className="flex min-h-[34px] items-center justify-center rounded border border-[#2b2f36] bg-[#0e0f11] px-2 text-[11.5px] font-medium text-[#b4bac4] hover:border-[#ef4444]/70 hover:text-[#fca5a5]"
              >
                Zero
              </button>
            </div>
          </>
        ) : (
          <p className="text-[11.5px] text-[#8b919c]">
            Click a limb on either stage panel or choose a bone below to adjust angle, limits, or Flip X.
          </p>
        )}
      </section>

      {/* Extremities Micro-Sculpt (Compact Metacarpal Hands + Collapsed Arch Feet) */}
      <section className="space-y-2.5 rounded-md border border-[#2b2f36] bg-[#141619] p-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[12px] font-semibold text-[#e6e8ec]">Hands &amp; Collapsed Feet</h3>
          <span className="font-mono-tabular text-[10.5px] text-[#8b919c]">
            Toe R {footToeBreak.R.toFixed(0)}° · L {footToeBreak.L.toFixed(0)}°
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <TapHoldButton
            onTap={() => onNudgeHandsCurl('both', 6)}
            onHoldStep={(dt) => onNudgeHandsCurl('both', dt * 42)}
            className="min-h-[32px] rounded border border-[#2b2f36] bg-[#0e0f11] px-2 text-[11.5px] font-medium text-[#b4bac4] hover:border-[#22c55e] hover:text-[#dcfce7]"
          >
            Hands Curl +
          </TapHoldButton>
          <TapHoldButton
            onTap={() => onNudgeHandsCurl('both', -6)}
            onHoldStep={(dt) => onNudgeHandsCurl('both', -dt * 42)}
            className="min-h-[32px] rounded border border-[#2b2f36] bg-[#0e0f11] px-2 text-[11.5px] font-medium text-[#b4bac4] hover:border-[#22c55e] hover:text-[#dcfce7]"
          >
            Hands Splay −
          </TapHoldButton>
          <TapHoldButton
            onTap={() => onNudgeFootToeBreak('both', 5)}
            onHoldStep={(dt) => onNudgeFootToeBreak('both', dt * 36)}
            className="min-h-[32px] rounded border border-[#2b2f36] bg-[#0e0f11] px-2 text-[11.5px] font-medium text-[#b4bac4] hover:border-[#a855f7] hover:text-[#f3e8ff]"
          >
            Toe Arch +
          </TapHoldButton>
          <TapHoldButton
            onTap={() => onNudgeFootToeBreak('both', -5)}
            onHoldStep={(dt) => onNudgeFootToeBreak('both', -dt * 36)}
            className="min-h-[32px] rounded border border-[#2b2f36] bg-[#0e0f11] px-2 text-[11.5px] font-medium text-[#b4bac4] hover:border-[#a855f7] hover:text-[#f3e8ff]"
          >
            Toe Flatten −
          </TapHoldButton>
        </div>
      </section>

      {/* Quick Joint Picker */}
      <section className="space-y-3">
        {QUICK_JOINT_GROUPS.map((grp) => (
          <div key={grp.title} className="space-y-1.5">
            <div className="text-[11px] font-medium text-[#8b919c]">{grp.title}</div>
            <div className="grid grid-cols-4 gap-1">
              {grp.ids.map((item) => {
                const active = selectedNodeId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectNode(active ? null : item.id)}
                    className={`min-h-[30px] truncate rounded border px-1.5 text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-[#22c55e] bg-[#22c55e]/20 text-[#86efac]'
                        : 'border-[#2b2f36] bg-[#0e0f11] text-[#8b919c] hover:border-[#414752] hover:text-[#e6e8ec]'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* Capture / Save Edited Pose */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-[#e6e8ec]">
            {manualOverrideActive ? 'Live Edited Pose' : 'Synced to Generator'}
          </span>
          <button
            type="button"
            onClick={() => onCaptureToAbc(activeAbcSlot)}
            className="rounded border border-[#2b2f36] bg-[#0e0f11] px-2.5 py-1 text-[11.5px] font-medium text-[#c084fc] hover:border-[#a855f7]"
          >
            Capture to Slot {activeAbcSlot}
          </button>
        </div>

        <form onSubmit={handleSave} className="flex gap-1.5">
          <input
            type="text"
            value={stanceName}
            onChange={(e) => setStanceName(e.target.value)}
            placeholder="Save edited pose as stance..."
            className="min-w-0 flex-1 rounded border border-[#2b2f36] bg-[#0e0f11] px-2.5 py-1.5 text-[12px] text-[#e6e8ec] placeholder-[#5c626e] focus:border-[#a855f7] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!stanceName.trim()}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-[#22c55e] bg-[#22c55e]/20 px-2.5 py-1.5 text-[11.5px] font-medium text-[#86efac] transition-colors hover:bg-[#22c55e]/30 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            Save
          </button>
        </form>
      </section>
    </div>
  );
};

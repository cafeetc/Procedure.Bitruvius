import React from 'react';
import { Shuffle } from 'lucide-react';
import {
  ELEVATION_OPTIONS,
  MOOD_OPTIONS,
  SKULL_FACING_OPTIONS,
  STARTER_STANCE_CATALOG,
  VANISHING_OPTIONS,
  type LiveNudgeKind,
  type PerspectiveElevation,
  type PerspectiveVanishing,
  type ProceduralRecipe,
  type StanceSeedEntry,
} from '../engine/proceduralPoseEngine';
import { BODY_TURN_VIEWS } from '../engine/turnaround';
import { CompassControl, SegmentedToggle, TapHoldButton, ToggleSwitch } from './ToggleControls';

interface GeneratorTabProps {
  recipe: ProceduralRecipe;
  customStances: StanceSeedEntry[];
  onUpdate: (patch: Partial<ProceduralRecipe>) => void;
  onHoldNudge: (kind: LiveNudgeKind, dtSec: number) => void;
  onRandomizeAll: () => void;
}

const ELEV_ORDER: PerspectiveElevation[] = [
  'extremeLow',
  'wormsEye',
  'eyeLevel',
  'birdsEye',
  'extremeHigh',
];

const VP_ORDER: PerspectiveVanishing[] = ['left', 'center', 'right'];

export const GeneratorTab: React.FC<GeneratorTabProps> = ({
  recipe,
  customStances,
  onUpdate,
  onHoldNudge,
  onRandomizeAll,
}) => {
  const allStances = [...STARTER_STANCE_CATALOG, ...customStances];
  const activeMood = MOOD_OPTIONS.find((m) => m.id === recipe.mood);
  const activeStance = allStances.find((s) => s.id === recipe.stance) ?? STARTER_STANCE_CATALOG[0];

  const nextSeed = (): 0 | 1 | 2 | 3 => ((recipe.seedVariant + 1) % 4) as 0 | 1 | 2 | 3;

  const stepElevation = (delta: number) => {
    const idx = ELEV_ORDER.indexOf(recipe.elevation);
    const nextIdx = Math.max(0, Math.min(ELEV_ORDER.length - 1, idx + delta));
    onUpdate({
      elevation: ELEV_ORDER[nextIdx],
      ...(nextIdx === idx ? { seedVariant: nextSeed() } : {}),
    });
  };

  const stepVanishing = (delta: number) => {
    const idx = VP_ORDER.indexOf(recipe.vanishing);
    const nextIdx = Math.max(0, Math.min(VP_ORDER.length - 1, idx + delta));
    onUpdate({
      vanishing: VP_ORDER[nextIdx],
      ...(nextIdx === idx ? { seedVariant: nextSeed() } : {}),
    });
  };

  const activeTurnLabel =
    BODY_TURN_VIEWS.find((v) => v.id === recipe.bodyView)?.label ?? recipe.bodyView;
  const activeElevLabel =
    ELEVATION_OPTIONS.find((e) => e.id === recipe.elevation)?.label ?? recipe.elevation;
  const activeVpLabel =
    VANISHING_OPTIONS.find((v) => v.id === recipe.vanishing)?.label ?? recipe.vanishing;
  const activeSkullLabel =
    SKULL_FACING_OPTIONS.find((k) => k.id === recipe.skullFacing)?.label ?? recipe.skullFacing;

  const tapOrVary = (patch: Partial<ProceduralRecipe>, alreadyActive: boolean) => {
    onUpdate(alreadyActive ? { ...patch, seedVariant: nextSeed() } : patch);
  };

  return (
    <div className="space-y-5">
      {/* 1. Mood */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[14px] font-semibold text-[#e6e8ec]">Mood</h2>
          {activeMood && (
            <span className="truncate text-[11.5px] text-[#8b919c]">{activeMood.cue}</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Pose mood">
          {MOOD_OPTIONS.map((m) => {
            const active = recipe.mood === m.id;
            return (
              <TapHoldButton
                key={m.id}
                ariaPressed={active}
                title={`${m.cue} · Tap: generate · Hold: live drift`}
                onTap={() => tapOrVary({ mood: m.id }, active)}
                onHoldStep={(dt) => onHoldNudge('seedDrift', dt)}
                className={`flex min-h-[36px] items-center justify-between rounded border px-3 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a855f7] ${
                  active
                    ? 'border-[#a855f7] bg-[#7e22ce]/30 text-[#f3e8ff]'
                    : 'border-[#2b2f36] bg-[#0e0f11] text-[#b4bac4] hover:border-[#414752] hover:text-[#e6e8ec]'
                }`}
              >
                <span className="truncate whitespace-nowrap text-[12.5px] font-medium">
                  {m.label}
                </span>
              </TapHoldButton>
            );
          })}
        </div>
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* 2. Stance (12-Pose Starter JSON + Custom Stances) */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="shrink-0 whitespace-nowrap font-display text-[14px] font-semibold text-[#e6e8ec]">
            Stance ({allStances.length})
          </h2>
          {activeStance && (
            <span className="truncate text-[11.5px] text-[#8b919c]">{activeStance.cue}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Pose stance">
          {allStances.map((s) => {
            const active = recipe.stance === s.id;
            const isCustom = customStances.some((c) => c.id === s.id);
            return (
              <TapHoldButton
                key={s.id}
                title={`${s.cue} · Tap: generate · Hold: live exaggerate`}
                ariaPressed={active}
                onTap={() => {
                  const autoWings =
                    s.defaultWings !== undefined ? s.defaultWings : recipe.prometheusWings;
                  const autoRib = s.defaultRibAnchor ?? recipe.ribAnchor;
                  tapOrVary(
                    {
                      stance: s.id,
                      prometheusWings: autoWings,
                      ribAnchor: autoRib,
                    },
                    active,
                  );
                }}
                onHoldStep={(dt) => onHoldNudge('intensityUp', dt)}
                className={`flex min-h-[36px] items-center justify-between gap-1.5 rounded border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a855f7] ${
                  active
                    ? isCustom
                      ? 'border-[#22c55e] bg-[#22c55e]/20 text-[#dcfce7]'
                      : 'border-[#a855f7] bg-[#7e22ce]/30 text-[#f3e8ff]'
                    : 'border-[#2b2f36] bg-[#0e0f11] text-[#b4bac4] hover:border-[#414752] hover:text-[#e6e8ec]'
                }`}
              >
                <span className="truncate whitespace-nowrap text-[12px] font-medium">
                  {s.label}
                </span>
                {isCustom && (
                  <span className="shrink-0 text-[10px] font-semibold text-[#4ade80]">JSON</span>
                )}
              </TapHoldButton>
            );
          })}
        </div>
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* 3. Perspective & Orientation Compasses */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[14px] font-semibold text-[#e6e8ec]">Orientation</h2>
          <span className="text-[11px] text-[#8b919c]">Tap: Pose · Hold: Live Nudge</span>
        </div>

        {/* Body Turnaround Compass */}
        <CompassControl
          centerLabel="Body Turn"
          centerSublabel={activeTurnLabel}
          centerActive={recipe.bodyView === 'front'}
          onCenterTap={() => tapOrVary({ bodyView: 'front' }, recipe.bodyView === 'front')}
          up={{
            label: 'Back',
            active: recipe.bodyView === 'back',
            title: 'Rear view turnaround',
            onTap: () => tapOrVary({ bodyView: 'back' }, recipe.bodyView === 'back'),
            onHoldStep: (dt) => onHoldNudge('turnUp', dt),
          }}
          down={{
            label: 'Front',
            active: recipe.bodyView === 'front',
            title: 'Direct frontal turnaround',
            onTap: () => tapOrVary({ bodyView: 'front' }, recipe.bodyView === 'front'),
            onHoldStep: (dt) => onHoldNudge('turnDown', dt),
          }}
          left={{
            label: 'Side L',
            active: recipe.bodyView === 'sideL',
            title: 'Left profile with rib flipX + inward arm swivel',
            onTap: () => tapOrVary({ bodyView: 'sideL' }, recipe.bodyView === 'sideL'),
            onHoldStep: (dt) => onHoldNudge('turnLeft', dt),
          }}
          right={{
            label: 'Side R',
            active: recipe.bodyView === 'sideR',
            title: 'Right profile with rib flipX + inward arm swivel',
            onTap: () => tapOrVary({ bodyView: 'sideR' }, recipe.bodyView === 'sideR'),
            onHoldStep: (dt) => onHoldNudge('turnRight', dt),
          }}
          topLeft={{
            label: '3/4 L',
            active: recipe.bodyView === 'threeQuarterL',
            title: 'Three-quarter left turnaround',
            onTap: () =>
              tapOrVary({ bodyView: 'threeQuarterL' }, recipe.bodyView === 'threeQuarterL'),
            onHoldStep: (dt) => onHoldNudge('turnLeft', dt),
          }}
          topRight={{
            label: '3/4 R',
            active: recipe.bodyView === 'threeQuarterR',
            title: 'Three-quarter right turnaround',
            onTap: () =>
              tapOrVary({ bodyView: 'threeQuarterR' }, recipe.bodyView === 'threeQuarterR'),
            onHoldStep: (dt) => onHoldNudge('turnRight', dt),
          }}
        />

        <ToggleSwitch
          label="Favor Opposite Side Arms"
          description="Crosses side-profile arm swivel past midline toward the opposite flank."
          checked={recipe.sideArmsFavorOpposite}
          accent="green"
          onChange={(sideArmsFavorOpposite) => onUpdate({ sideArmsFavorOpposite })}
        />

        {/* Perspective Horizon & Vanishing Point Compass */}
        <CompassControl
          centerLabel="Perspective"
          centerSublabel={`${activeElevLabel} · ${activeVpLabel.replace(' VP', '')}`}
          centerActive={recipe.elevation === 'eyeLevel' && recipe.vanishing === 'center'}
          onCenterTap={() =>
            tapOrVary(
              { elevation: 'eyeLevel', vanishing: 'center' },
              recipe.elevation === 'eyeLevel' && recipe.vanishing === 'center',
            )
          }
          up={{
            label: "Bird's +",
            active: recipe.elevation === 'birdsEye' || recipe.elevation === 'extremeHigh',
            title: 'Step horizon higher (up to Extreme High)',
            onTap: () => stepElevation(1),
            onHoldStep: (dt) => onHoldNudge('perspUp', dt),
          }}
          down={{
            label: "Worm's −",
            active: recipe.elevation === 'wormsEye' || recipe.elevation === 'extremeLow',
            title: 'Step horizon lower (down to Extreme Low)',
            onTap: () => stepElevation(-1),
            onHoldStep: (dt) => onHoldNudge('perspDown', dt),
          }}
          left={{
            label: 'VP Left',
            active: recipe.vanishing === 'left',
            title: 'Shift vanishing point left',
            onTap: () => stepVanishing(-1),
            onHoldStep: (dt) => onHoldNudge('perspLeft', dt),
          }}
          right={{
            label: 'VP Right',
            active: recipe.vanishing === 'right',
            title: 'Shift vanishing point right',
            onTap: () => stepVanishing(1),
            onHoldStep: (dt) => onHoldNudge('perspRight', dt),
          }}
          topLeft={{
            label: 'Ext High',
            active: recipe.elevation === 'extremeHigh',
            title: 'Jump to Extreme High elevation',
            onTap: () => tapOrVary({ elevation: 'extremeHigh' }, recipe.elevation === 'extremeHigh'),
            onHoldStep: (dt) => onHoldNudge('perspUp', dt),
          }}
          topRight={{
            label: 'Eye Lvl',
            active: recipe.elevation === 'eyeLevel',
            title: 'Jump to Eye-Level horizon',
            onTap: () => tapOrVary({ elevation: 'eyeLevel' }, recipe.elevation === 'eyeLevel'),
          }}
          bottomLeft={{
            label: 'Ext Low',
            active: recipe.elevation === 'extremeLow',
            title: 'Jump to Extreme Low elevation',
            onTap: () => tapOrVary({ elevation: 'extremeLow' }, recipe.elevation === 'extremeLow'),
            onHoldStep: (dt) => onHoldNudge('perspDown', dt),
          }}
          bottomRight={{
            label: 'Center VP',
            active: recipe.vanishing === 'center',
            title: 'Center vanishing point on plumb',
            onTap: () => tapOrVary({ vanishing: 'center' }, recipe.vanishing === 'center'),
          }}
        />

        {/* Skull 360° Facing Compass */}
        <CompassControl
          centerLabel="Skull 360°"
          centerSublabel={activeSkullLabel}
          centerActive={recipe.skullFacing === 'auto'}
          accent="green"
          onCenterTap={() => tapOrVary({ skullFacing: 'auto' }, recipe.skullFacing === 'auto')}
          up={{
            label: 'Back',
            active: recipe.skullFacing === 'back',
            title: 'Rear occipital skull',
            onTap: () => tapOrVary({ skullFacing: 'back' }, recipe.skullFacing === 'back'),
            onHoldStep: (dt) => onHoldNudge('skullUp', dt),
          }}
          down={{
            label: 'Front',
            active: recipe.skullFacing === 'front',
            title: 'Direct frontal cranium',
            onTap: () => tapOrVary({ skullFacing: 'front' }, recipe.skullFacing === 'front'),
            onHoldStep: (dt) => onHoldNudge('skullDown', dt),
          }}
          left={{
            label: 'Side L',
            active: recipe.skullFacing === 'sideL',
            title: 'Left profile skull',
            onTap: () => tapOrVary({ skullFacing: 'sideL' }, recipe.skullFacing === 'sideL'),
            onHoldStep: (dt) => onHoldNudge('skullLeft', dt),
          }}
          right={{
            label: 'Side R',
            active: recipe.skullFacing === 'sideR',
            title: 'Right profile skull',
            onTap: () => tapOrVary({ skullFacing: 'sideR' }, recipe.skullFacing === 'sideR'),
            onHoldStep: (dt) => onHoldNudge('skullRight', dt),
          }}
        />
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* 4. Variation Takes */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[14px] font-semibold text-[#e6e8ec]">
            Automaton Mix
          </h2>
          <TapHoldButton
            onTap={onRandomizeAll}
            onHoldStep={(dt) => onHoldNudge('seedDrift', dt)}
            title="Tap: randomize full combination · Hold: live organic drift"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-[#2b2f36] bg-[#191b1f] px-2.5 py-1.5 text-[11.5px] font-medium text-[#e6e8ec] transition-colors hover:border-[#a855f7] hover:bg-[#7e22ce]/25"
          >
            <Shuffle className="h-3.5 w-3.5 text-[#a855f7]" aria-hidden="true" />
            New Combination
          </TapHoldButton>
        </div>

        <SegmentedToggle<0 | 1 | 2 | 3>
          label="Cam Take Seed"
          value={recipe.seedVariant}
          columns={4}
          options={[
            { id: 0, label: 'Take I', title: 'Canonical base procedural take' },
            { id: 1, label: 'Take II', title: 'Deterministic micro-variation II' },
            { id: 2, label: 'Take III', title: 'Deterministic micro-variation III' },
            { id: 3, label: 'Take IV', title: 'Deterministic micro-variation IV' },
          ]}
          defaultHoldStep={(_id, dt) => onHoldNudge('seedDrift', dt)}
          onChange={(seedVariant) => tapOrVary({ seedVariant }, recipe.seedVariant === seedVariant)}
        />
      </section>
    </div>
  );
};

import React, { useState } from 'react';
import { BookmarkPlus, Check, Database, Trash2 } from 'lucide-react';
import type { StanceSeedEntry } from '../engine/proceduralPoseEngine';
import { CURATED_RECIPES, type CuratedPreset } from '../engine/studioTypes';
import type { SavedPoseEntry } from '../engine/types';

interface LibraryTabProps {
  savedPoses: SavedPoseEntry[];
  customStances: StanceSeedEntry[];
  activeSummary: string;
  onApplyCurated: (preset: CuratedPreset) => void;
  onSaveCurrentSnapshot: (name: string) => void;
  onSaveCurrentAsStance: (name: string, category: string) => void;
  onSelectStance: (stanceId: string) => void;
  onDeleteCustomStance: (id: string) => void;
  onLoadSaved: (entry: SavedPoseEntry) => void;
  onDeleteSaved: (id: string) => void;
}

export const LibraryTab: React.FC<LibraryTabProps> = ({
  savedPoses,
  customStances,
  activeSummary,
  onApplyCurated,
  onSaveCurrentSnapshot,
  onSaveCurrentAsStance,
  onSelectStance,
  onDeleteCustomStance,
  onLoadSaved,
  onDeleteSaved,
}) => {
  const [poseName, setPoseName] = useState('');
  const [stanceCategory, setStanceCategory] = useState('Custom Studies');
  const [savedNotice, setSavedNotice] = useState<'snapshot' | 'stance' | null>(null);

  const flashNotice = (kind: 'snapshot' | 'stance') => {
    setSavedNotice(kind);
    window.setTimeout(() => setSavedNotice(null), 1600);
  };

  const handleSaveSnapshot = (e: React.FormEvent) => {
    e.preventDefault();
    const label = poseName.trim() || activeSummary;
    onSaveCurrentSnapshot(label);
    setPoseName('');
    flashNotice('snapshot');
  };

  const handleSaveStance = () => {
    const label = poseName.trim() || `Study · ${activeSummary}`;
    onSaveCurrentAsStance(label, stanceCategory);
    setPoseName('');
    flashNotice('stance');
  };

  return (
    <div className="space-y-5">
      {/* Save active pose to Vault or Stance JSON Catalog */}
      <section className="space-y-2.5">
        <h2 className="font-display text-[14px] font-semibold text-[#e6e8ec]">
          Capture to Vault or Stance JSON
        </h2>
        <form onSubmit={handleSaveSnapshot} className="space-y-2">
          <label htmlFor="pose-save-name" className="sr-only">
            Pose or Stance name
          </label>
          <input
            id="pose-save-name"
            type="text"
            value={poseName}
            onChange={(e) => setPoseName(e.target.value)}
            placeholder={activeSummary}
            className="w-full rounded border border-[#2b2f36] bg-[#0e0f11] px-3 py-2 text-[12.5px] text-[#e6e8ec] placeholder-[#606775] focus:border-[#a855f7] focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded border border-[#a855f7] bg-[#7e22ce]/30 px-3 py-2 text-[12px] font-semibold text-[#f3e8ff] transition-colors hover:bg-[#7e22ce]/45"
            >
              {savedNotice === 'snapshot' ? (
                <Check className="h-3.5 w-3.5 text-[#4ade80]" />
              ) : (
                <BookmarkPlus className="h-3.5 w-3.5" />
              )}
              {savedNotice === 'snapshot' ? 'Snapshot Saved' : 'Save Snapshot'}
            </button>
            <button
              type="button"
              onClick={handleSaveStance}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded border border-[#22c55e]/70 bg-[#22c55e]/15 px-3 py-2 text-[12px] font-semibold text-[#86efac] transition-colors hover:bg-[#22c55e]/25"
            >
              {savedNotice === 'stance' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Database className="h-3.5 w-3.5" />
              )}
              {savedNotice === 'stance' ? 'Added to JSON' : 'Promote to Stance'}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-[#8b919c]">
            <span>Category for promoted stances:</span>
            <select
              aria-label="Custom stance category"
              value={stanceCategory}
              onChange={(e) => setStanceCategory(e.target.value)}
              className="rounded border border-[#2b2f36] bg-[#0e0f11] px-2 py-1 text-[11px] text-[#e6e8ec] focus:border-[#22c55e] focus:outline-none"
            >
              <option value="Custom Studies">Custom Studies</option>
              <option value="Standing & Weight">Standing &amp; Weight</option>
              <option value="Locomotion & Action">Locomotion &amp; Action</option>
              <option value="Seated & Grounded">Seated &amp; Grounded</option>
              <option value="Dynamic & Bitruvian">Dynamic &amp; Bitruvian</option>
            </select>
          </div>
        </form>
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* Custom Stance JSON Entries */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[14px] font-semibold text-[#e6e8ec]">
            Custom JSON Stances
          </h2>
          <span className="font-mono-tabular text-[11.5px] text-[#4ade80]">
            {customStances.length} added
          </span>
        </div>

        {customStances.length === 0 ? (
          <div className="rounded border border-[#2b2f36] bg-[#0e0f11] p-3 text-[11.5px] text-[#8b919c]">
            Use &ldquo;Promote to Stance&rdquo; to turn any refined pose into a reusable JSON base
            stance in the Generator tab.
          </div>
        ) : (
          <div className="space-y-1.5">
            {customStances.map((st) => (
              <div
                key={st.id}
                className="flex items-center justify-between gap-2 rounded border border-[#2b2f36] bg-[#0e0f11] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold text-[#e6e8ec]">
                    {st.label}
                  </div>
                  <div className="truncate text-[11px] text-[#8b919c]">{st.category}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelectStance(st.id)}
                    className="whitespace-nowrap rounded border border-[#22c55e]/60 bg-[#22c55e]/15 px-2.5 py-1 text-[11.5px] font-medium text-[#86efac] transition-colors hover:bg-[#22c55e]/25"
                  >
                    Use Stance
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete stance ${st.label}`}
                    onClick={() => onDeleteCustomStance(st.id)}
                    className="rounded border border-[#2b2f36] bg-[#121315] p-1.5 text-[#8b919c] transition-colors hover:border-[#ef4444]/70 hover:text-[#fca5a5]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* Curated Procedural Archetypes */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[14px] font-semibold text-[#e6e8ec]">
            Curated Combinations
          </h2>
          <span className="text-[11.5px] text-[#8b919c]">One-click mixes</span>
        </div>

        <div className="space-y-1.5">
          {CURATED_RECIPES.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyCurated(preset)}
              className="flex w-full items-center justify-between gap-3 rounded border border-[#2b2f36] bg-[#0e0f11] px-3 py-2 text-left transition-colors hover:border-[#a855f7] hover:bg-[#191b1f]"
            >
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-[#e6e8ec]">
                  {preset.title}
                </div>
                <div className="truncate text-[11px] text-[#8b919c]">{preset.subtitle}</div>
              </div>
              <span className="shrink-0 whitespace-nowrap text-[11.5px] font-medium text-[#c084fc]">
                Apply
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="border-t border-[#2b2f36]" />

      {/* Saved Pose Snapshots */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[14px] font-semibold text-[#e6e8ec]">
            Pose Snapshot Vault
          </h2>
          <span className="font-mono-tabular text-[11.5px] text-[#8b919c]">
            {savedPoses.length} poses
          </span>
        </div>

        {savedPoses.length === 0 ? (
          <div className="rounded border border-[#2b2f36] bg-[#0e0f11] p-3 text-center text-[11.5px] text-[#8b919c]">
            No saved pose snapshots yet.
          </div>
        ) : (
          <div className="space-y-1.5">
            {savedPoses.map((entry) => {
              const isBuiltin = entry.id.startsWith('builtin_');
              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-2 rounded border border-[#2b2f36] bg-[#0e0f11] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-medium text-[#e6e8ec]">
                      {entry.name}
                    </div>
                    <div className="text-[11px] text-[#8b919c]">
                      {isBuiltin ? 'Canonical Rig Preset' : 'Saved Snapshot'}
                      {entry.prometheusWings ? ' · Prometheus Wings' : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onLoadSaved(entry)}
                      className="whitespace-nowrap rounded border border-[#2b2f36] bg-[#191b1f] px-2.5 py-1 text-[11.5px] font-medium text-[#e6e8ec] transition-colors hover:border-[#a855f7] hover:bg-[#7e22ce]/25"
                    >
                      Load
                    </button>
                    {!isBuiltin && (
                      <button
                        type="button"
                        aria-label={`Delete ${entry.name}`}
                        onClick={() => onDeleteSaved(entry.id)}
                        className="rounded border border-[#2b2f36] bg-[#121315] p-1.5 text-[#8b919c] transition-colors hover:border-[#ef4444]/70 hover:text-[#fca5a5]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

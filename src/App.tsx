import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Crosshair,
  Download,
  Layers,
  Library,
  PlaySquare,
  Shuffle,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { EditorTab } from './components/EditorTab';
import { ExportModal } from './components/ExportModal';
import { FineTuneTab } from './components/FineTuneTab';
import { GeneratorTab } from './components/GeneratorTab';
import { LibraryTab } from './components/LibraryTab';
import { MotionTab } from './components/MotionTab';
import { StageCanvas } from './components/StageCanvas';
import { StageRenderer, type AbcGhostItem } from './engine/canvasRenderer';
import {
  buildRigGraph,
  clampAnatomicalAngle,
  clampChungusRibAngle,
  clampRealisticShoulder,
  decImage,
  normalizeDeg,
  pos,
  setPieceBitmap,
  solveRig,
  sortPiecesForWings,
} from './engine/fkEngine';
import { GOTZ_DIGITS, cloneGotzState } from './engine/gotzHandEngine';
import { DEFAULT_SPATIAL_ENV } from './engine/groundSystem';
import {
  applyAbcPoseInstant,
  applyAbcTweenPose,
  captureAbcPose,
  createDefaultAbcState,
  getAbcCycleSequence,
  getFilledAbcSlots,
  synthesizeProceduralInBetween,
} from './engine/motionEngine';
import {
  buildCanonicalPayload,
  createBuiltinChungusLibraryPoses,
  parseAndValidateRigPayload,
} from './engine/motionFormat';
import { PartRigManager } from './engine/partRigEngine';
import {
  DEFAULT_PROCEDURAL_RECIPE,
  ELEVATION_OPTIONS,
  MOOD_OPTIONS,
  SKULL_FACING_OPTIONS,
  STARTER_STANCE_CATALOG,
  VANISHING_OPTIONS,
  generateProceduralPose,
  nudgeLivePoseRuntime,
  type GeneratedPoseResult,
  type LiveNudgeKind,
  type ProceduralRecipe,
  type StanceSeedEntry,
} from './engine/proceduralPoseEngine';
import { applyHeadTurnStep, preloadSkullAssets } from './engine/skullKitModels';
import type { CameraFraming, CuratedPreset, RenderStyleMode, StudioTab } from './engine/studioTypes';
import { BODY_TURN_VIEWS, applyBodyViewPivots, sortPiecesForBodyView } from './engine/turnaround';
import type {
  AbcSerializedState,
  AbcSlot,
  PartsManifest,
  PerspectiveState,
  RawRigDef,
  RigNode,
  RigPiece,
  SavedPoseEntry,
} from './engine/types';

const VAULT_STORAGE_KEY = 'bitruvius.procedural.vault.v1';
const CUSTOM_STANCES_STORAGE_KEY = 'bitruvius.procedural.customStances.v1';

interface RigRuntime {
  nodes: RigNode[];
  by: Record<string, RigNode>;
  root: RigNode;
  pieces: RigPiece[];
  partMgr: PartRigManager;
  renderer: StageRenderer;
}

function loadInitialVault(): SavedPoseEntry[] {
  const builtins = createBuiltinChungusLibraryPoses();
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return builtins;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return builtins;
    const custom = parsed.filter(
      (x): x is SavedPoseEntry =>
        !!x && typeof x === 'object' && typeof x.id === 'string' && !x.id.startsWith('builtin_') && !!x.pose,
    );
    return [...builtins, ...custom];
  } catch {
    return builtins;
  }
}

function loadInitialCustomStances(): StanceSeedEntry[] {
  try {
    const raw = localStorage.getItem(CUSTOM_STANCES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is StanceSeedEntry =>
        !!s &&
        typeof s === 'object' &&
        typeof s.id === 'string' &&
        typeof s.label === 'string' &&
        !!s.nodes,
    );
  } catch {
    return [];
  }
}

function triggerDownload(filename: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [tab, setTab] = useState<StudioTab>('generator');
  const [recipe, setRecipe] = useState<ProceduralRecipe>(DEFAULT_PROCEDURAL_RECIPE);
  const [customStances, setCustomStances] = useState<StanceSeedEntry[]>(loadInitialCustomStances);
  const [savedPoses, setSavedPoses] = useState<SavedPoseEntry[]>(loadInitialVault);

  // Stage render & gesture study aid toggles
  const [renderMode, setRenderMode] = useState<RenderStyleMode>('cutout');
  const [showBones, setShowBones] = useState(false);
  const [showLineOfAction, setShowLineOfAction] = useState(true);
  const [showGestureRibs, setShowGestureRibs] = useState(true);
  const [showPerspGrid, setShowPerspGrid] = useState(true);
  const [showVitruvianGuides, setShowVitruvianGuides] = useState(false);
  const [framing, setFraming] = useState<CameraFraming>('full');

  // Motion ABC sequencer state
  const [abc, setAbc] = useState<AbcSerializedState>(createDefaultAbcState);
  const [playing, setPlaying] = useState(false);

  // Modal & Runtime state
  const [exportOpen, setExportOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rigReady, setRigReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [generatedResult, setGeneratedResult] = useState<GeneratedPoseResult | null>(null);
  const [manualOverrideActive, setManualOverrideActive] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [livePerspective, setLivePerspective] = useState<PerspectiveState>({
    ...DEFAULT_SPATIAL_ENV,
    enabled: true,
  });
  const [footToeBreak, setFootToeBreak] = useState<{ R: number; L: number }>({ R: 0, L: 0 });

  const runtimeRef = useRef<RigRuntime | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const digitalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const transitionRafRef = useRef<number>(0);

  const bumpRevision = useCallback(() => {
    setRevision((r) => (r + 1) % 1000000);
  }, []);

  // Persist vault and custom stances locally
  useEffect(() => {
    try {
      const custom = savedPoses.filter((p) => !p.id.startsWith('builtin_'));
      localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(custom));
    } catch {
      // Ignore storage quota errors
    }
  }, [savedPoses]);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_STANCES_STORAGE_KEY, JSON.stringify(customStances));
    } catch {
      // Ignore storage quota errors
    }
  }, [customStances]);

  // Load canonical Bitruvian rig-data.json and sprite bitmaps once
  useEffect(() => {
    let cancelled = false;
    preloadSkullAssets();

    fetch('/rig-data.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading rig-data.json`);
        return res.json() as Promise<{ rig: RawRigDef; parts: PartsManifest }>;
      })
      .then((data) => {
        if (cancelled) return;
        const { nodes, by, root, pieces } = buildRigGraph(data.rig, true);
        const partMgr = new PartRigManager(data.parts);
        const renderer = new StageRenderer();

        partMgr.initAll(by, () => {
          if (!cancelled) bumpRevision();
        });

        runtimeRef.current = { nodes, by, root, pieces, partMgr, renderer };

        for (const p of pieces) {
          if (p.src && !p.gotzManaged) {
            void decImage(p.src)
              .then((bm) => {
                if (!cancelled) {
                  setPieceBitmap(p, bm, bumpRevision);
                }
              })
              .catch(() => {});
          }
        }

        setRigReady(true);
        bumpRevision();
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load rig data.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bumpRevision]);

  // Commit final procedural result to sub-rigs, collapsed side foot, head sprite, turnaround & wing sort
  const commitGeneratedToRuntime = useCallback(
    (rt: RigRuntime, res: GeneratedPoseResult) => {
      const { nodes, by, root, pieces, partMgr } = rt;

      for (const n of nodes) {
        if (n.id in res.angles) n.ang = res.angles[n.id];
        n.flipX = !!res.flipX[n.id];
      }
      root.tx = res.root[0];
      root.ty = res.root[1];

      if (by.head) {
        applyHeadTurnStep(by.head, res.headStep, bumpRevision);
      }

      if (partMgr.inst.handL) {
        partMgr.inst.handL.gotz = cloneGotzState(res.handStates.L);
        partMgr.inst.handL.touched = 1;
        partMgr.rebake(partMgr.inst.handL, bumpRevision);
      }
      if (partMgr.inst.handR) {
        partMgr.inst.handR.gotz = cloneGotzState(res.handStates.R);
        partMgr.inst.handR.touched = 1;
        partMgr.rebake(partMgr.inst.handR, bumpRevision);
      }

      partMgr.syncFootPlant(res.footToeBreak.R, res.footToeBreak.L, bumpRevision);

      applyBodyViewPivots(nodes, by, res.bodyView, res.ribAnchor);
      sortPiecesForWings(pieces, res.prometheusWings);
      sortPiecesForBodyView(pieces, res.bodyView, res.prometheusWings);
      solveRig(
        nodes,
        by,
        recipe.bondOn,
        res.prometheusWings ? 1 : 0,
        res.ribAnchor,
        res.bodyView,
        res.sideArmsFavorOpposite,
      );

      setGeneratedResult(res);
      setLivePerspective(res.perspective);
      setFootToeBreak(res.footToeBreak);
      bumpRevision();
    },
    [bumpRevision, recipe.bondOn],
  );

  // Regenerate procedural pose cleanly whenever recipe or customStances updates
  useEffect(() => {
    const rt = runtimeRef.current;
    if (!rigReady || !rt || playing || manualOverrideActive) return;

    cancelAnimationFrame(transitionRafRef.current);

    const prevAngles: Record<string, number> = {};
    for (const n of rt.nodes) prevAngles[n.id] = n.ang;
    const prevRoot: [number, number] = [rt.root.tx, rt.root.ty];
    const hasPrev = generatedResult !== null;

    const nextRes = generateProceduralPose(recipe, rt.nodes, rt.by, {
      perspGridVisible: showPerspGrid,
      customStances,
    });

    if (!hasPrev) {
      commitGeneratedToRuntime(rt, nextRes);
      return;
    }

    const durationMs = 135;
    const t0 = performance.now();

    if (rt.by.head) applyHeadTurnStep(rt.by.head, nextRes.headStep, bumpRevision);
    if (rt.partMgr.inst.handL) {
      rt.partMgr.inst.handL.gotz = cloneGotzState(nextRes.handStates.L);
      rt.partMgr.inst.handL.touched = 1;
      rt.partMgr.rebake(rt.partMgr.inst.handL, bumpRevision);
    }
    if (rt.partMgr.inst.handR) {
      rt.partMgr.inst.handR.gotz = cloneGotzState(nextRes.handStates.R);
      rt.partMgr.inst.handR.touched = 1;
      rt.partMgr.rebake(rt.partMgr.inst.handR, bumpRevision);
    }
    rt.partMgr.syncFootPlant(nextRes.footToeBreak.R, nextRes.footToeBreak.L, bumpRevision);

    setGeneratedResult(nextRes);
    setLivePerspective(nextRes.perspective);
    setFootToeBreak(nextRes.footToeBreak);

    const step = (now: number) => {
      const raw = Math.min(1, (now - t0) / durationMs);
      const ease = 1 - Math.pow(1 - raw, 3);

      for (const n of rt.nodes) {
        const a0 = prevAngles[n.id] ?? 0;
        const a1 = nextRes.angles[n.id] ?? 0;
        n.ang = a0 + normalizeDeg(a1 - a0) * ease;
        n.flipX = raw >= 0.5 ? !!nextRes.flipX[n.id] : !!n.flipX;
      }
      rt.root.tx = prevRoot[0] + (nextRes.root[0] - prevRoot[0]) * ease;
      rt.root.ty = prevRoot[1] + (nextRes.root[1] - prevRoot[1]) * ease;

      applyBodyViewPivots(rt.nodes, rt.by, nextRes.bodyView, nextRes.ribAnchor);
      sortPiecesForBodyView(rt.pieces, nextRes.bodyView, nextRes.prometheusWings);
      solveRig(
        rt.nodes,
        rt.by,
        recipe.bondOn,
        nextRes.prometheusWings ? 1 : 0,
        nextRes.ribAnchor,
        nextRes.bodyView,
        nextRes.sideArmsFavorOpposite,
      );
      bumpRevision();

      if (raw < 1) {
        transitionRafRef.current = requestAnimationFrame(step);
      } else {
        commitGeneratedToRuntime(rt, nextRes);
      }
    };

    transitionRafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(transitionRafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rigReady, recipe, customStances, manualOverrideActive, playing, showPerspGrid]);

  // ABC Motion Loop playback
  useEffect(() => {
    const rt = runtimeRef.current;
    if (!playing || !rt) return;

    const seq = getAbcCycleSequence(abc.poses, abc.loopMode);
    if (!seq.length) {
      setPlaying(false);
      return;
    }

    let rafId = 0;
    const t0 = performance.now();
    const segDurationMs = (abc.snapFrames / Math.max(1, abc.fps)) * 1000;
    const totalDurationMs = segDurationMs * seq.length;
    const stepIntervalMs = 1000 / Math.max(1, abc.fps);
    let lastDrawnBucket = -1;

    const tick = (now: number) => {
      const elapsed = now - t0;
      const quantizedElapsed = abc.steppedFps
        ? Math.floor(elapsed / stepIntervalMs) * stepIntervalMs
        : elapsed;

      const bucket = abc.steppedFps ? Math.floor(elapsed / stepIntervalMs) : Math.floor(elapsed);
      if (bucket !== lastDrawnBucket) {
        lastDrawnBucket = bucket;
        const loopMs = quantizedElapsed % totalDurationMs;
        const segIdx = Math.min(seq.length - 1, Math.floor(loopMs / segDurationMs));
        const segU = (loopMs - segIdx * segDurationMs) / segDurationMs;
        const [fromSlot, toSlot] = seq[segIdx];
        const fromPose = abc.poses[fromSlot];
        const toPose = abc.poses[toSlot];

        if (fromPose && toPose) {
          applyAbcTweenPose(
            fromPose,
            toPose,
            segU,
            abc.feel,
            abc.settings,
            rt.nodes,
            rt.root,
            rt.partMgr.inst,
            (inst) => rt.partMgr.rebake(inst, bumpRevision),
            recipe.constrainLimits,
            rt.by,
            recipe.prometheusWings,
            {
              skullTurnTiming: abc.skullTurnTiming,
              ribAnchor: recipe.ribAnchor,
              pieces: rt.pieces,
              onWake: bumpRevision,
            },
          );
          solveRig(
            rt.nodes,
            rt.by,
            recipe.bondOn,
            recipe.prometheusWings ? 1 : 0,
            recipe.ribAnchor,
            recipe.bodyView,
            recipe.sideArmsFavorOpposite,
          );
          bumpRevision();
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    playing,
    abc,
    recipe.bondOn,
    recipe.constrainLimits,
    recipe.prometheusWings,
    recipe.ribAnchor,
    recipe.bodyView,
    recipe.sideArmsFavorOpposite,
    bumpRevision,
  ]);

  const handleUpdateRecipe = useCallback((patch: Partial<ProceduralRecipe>) => {
    setPlaying(false);
    setManualOverrideActive(false);
    setRecipe((prev) => ({ ...prev, ...patch }));
  }, []);

  // Live continuous hold-button fine-tuning on the active pose
  const handleHoldNudge = useCallback(
    (kind: LiveNudgeKind, dtSec: number) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      cancelAnimationFrame(transitionRafRef.current);
      setPlaying(false);
      setManualOverrideActive(true);

      const bv = generatedResult?.bodyView ?? recipe.bodyView;
      const { nextPerspective, perspChanged } = nudgeLivePoseRuntime(
        rt.nodes,
        rt.root,
        rt.by,
        livePerspective,
        kind,
        dtSec,
        {
          constrainLimits: recipe.constrainLimits,
          bondOn: recipe.bondOn,
          prometheusWings: recipe.prometheusWings,
          ribAnchor: recipe.ribAnchor,
          bodyView: bv,
          sideArmsFavorOpposite: recipe.sideArmsFavorOpposite,
        },
      );

      if (perspChanged) {
        setLivePerspective(nextPerspective);
      }
      if (kind === 'plantHeelUp') {
        setFootToeBreak((prev) => {
          const next = {
            R: Math.max(-15, Math.min(60, prev.R + dtSec * 36)),
            L: Math.max(-15, Math.min(60, prev.L + dtSec * 36)),
          };
          rt.partMgr.syncFootPlant(next.R, next.L, bumpRevision);
          return next;
        });
      }
      bumpRevision();
    },
    [
      generatedResult,
      recipe.bodyView,
      recipe.constrainLimits,
      recipe.bondOn,
      recipe.prometheusWings,
      recipe.ribAnchor,
      recipe.sideArmsFavorOpposite,
      livePerspective,
      bumpRevision,
    ],
  );

  // Interactive canvas & Editor-tab handlers
  const activeBodyView = generatedResult?.bodyView ?? recipe.bodyView;

  const solveEditorRuntime = useCallback(
    (rt: RigRuntime) => {
      for (const n of rt.nodes) {
        const clamped = clampAnatomicalAngle(n, n.ang, recipe.constrainLimits);
        const sh = clampRealisticShoulder(
          n,
          clamped,
          rt.by,
          recipe.prometheusWings,
          activeBodyView,
          recipe.sideArmsFavorOpposite,
        );
        n.ang = clampChungusRibAngle(n.id, sh, recipe.ribAnchor, rt.by, recipe.prometheusWings);
      }
      applyBodyViewPivots(rt.nodes, rt.by, activeBodyView, recipe.ribAnchor);
      sortPiecesForBodyView(rt.pieces, activeBodyView, recipe.prometheusWings);
      solveRig(
        rt.nodes,
        rt.by,
        recipe.bondOn,
        recipe.prometheusWings ? 1 : 0,
        recipe.ribAnchor,
        activeBodyView,
        recipe.sideArmsFavorOpposite,
      );
      bumpRevision();
    },
    [
      recipe.constrainLimits,
      recipe.prometheusWings,
      recipe.ribAnchor,
      recipe.bondOn,
      recipe.sideArmsFavorOpposite,
      activeBodyView,
      bumpRevision,
    ],
  );

  const handleInteractiveSetAngle = useCallback(
    (id: string, nextDeg: number) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      const n = rt.by[id];
      if (!n || n.lock) return;
      cancelAnimationFrame(transitionRafRef.current);
      setPlaying(false);
      setManualOverrideActive(true);
      n.ang = clampAnatomicalAngle(n, nextDeg, recipe.constrainLimits);
      solveEditorRuntime(rt);
    },
    [recipe.constrainLimits, solveEditorRuntime],
  );

  const handleInteractiveMoveRoot = useCallback(
    (tx: number, ty: number) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      cancelAnimationFrame(transitionRafRef.current);
      setPlaying(false);
      setManualOverrideActive(true);
      rt.root.tx = Math.max(-1400, Math.min(1400, tx));
      rt.root.ty = Math.max(-1400, Math.min(1400, ty));
      solveEditorRuntime(rt);
    },
    [solveEditorRuntime],
  );

  const handleNudgeNodeAngle = useCallback(
    (id: string, deltaDeg: number) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      const n = rt.by[id];
      if (!n || n.lock) return;
      handleInteractiveSetAngle(id, n.ang + deltaDeg);
    },
    [handleInteractiveSetAngle],
  );

  const handleToggleFlipX = useCallback(
    (id: string) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      const n = rt.by[id];
      if (!n) return;
      setManualOverrideActive(true);
      n.flipX = !n.flipX;
      solveEditorRuntime(rt);
    },
    [solveEditorRuntime],
  );

  const handleResetBone = useCallback(
    (id: string) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      const n = rt.by[id];
      if (!n) return;
      setManualOverrideActive(true);
      n.ang = 0;
      n.flipX = false;
      if (id === rt.root.id) {
        rt.root.tx = 0;
        rt.root.ty = 0;
      }
      solveEditorRuntime(rt);
    },
    [solveEditorRuntime],
  );

  const handleResetAllEdits = useCallback(() => {
    setManualOverrideActive(false);
    setSelectedNodeId(null);
    setRecipe((prev) => ({
      ...prev,
      seedVariant: prev.seedVariant,
    }));
    const rt = runtimeRef.current;
    if (rt) {
      const fresh = generateProceduralPose(recipe, rt.nodes, rt.by, {
        perspGridVisible: showPerspGrid,
        customStances,
      });
      commitGeneratedToRuntime(rt, fresh);
    }
  }, [recipe, showPerspGrid, customStances, commitGeneratedToRuntime]);

  const handleNudgeFootToeBreak = useCallback(
    (side: 'L' | 'R' | 'both', deltaDeg: number) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      setManualOverrideActive(true);
      setFootToeBreak((prev) => {
        const next = {
          R: side === 'R' || side === 'both' ? Math.max(-25, Math.min(62, prev.R + deltaDeg)) : prev.R,
          L: side === 'L' || side === 'both' ? Math.max(-25, Math.min(62, prev.L + deltaDeg)) : prev.L,
        };
        rt.partMgr.syncFootPlant(next.R, next.L, bumpRevision);
        return next;
      });
      bumpRevision();
    },
    [bumpRevision],
  );

  const handleNudgeHandsCurl = useCallback(
    (side: 'L' | 'R' | 'both', deltaDeg: number) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      setManualOverrideActive(true);
      const sides: Array<'L' | 'R'> = side === 'both' ? ['L', 'R'] : [side];
      for (const s of sides) {
        const inst = rt.partMgr.inst[`hand${s}`];
        if (!inst?.gotz) continue;
        const g = inst.gotz;
        g.splay = Math.max(-4, Math.min(34, g.splay - deltaDeg * 0.25));
        for (const d of GOTZ_DIGITS) {
          const arr = g.cj[d];
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const gain = k === 0 ? 0.35 : 1.0;
            arr[k] = Math.max(-8, Math.min(102, arr[k] + deltaDeg * gain));
          }
        }
        inst.touched = 1;
        rt.partMgr.rebake(inst, bumpRevision);
      }
      bumpRevision();
    },
    [bumpRevision],
  );

  const handleRandomizeAll = useCallback(() => {
    const allStances = [...STARTER_STANCE_CATALOG, ...customStances];
    const rand = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const pickedStance = rand(allStances);
    const pickedMood = rand(MOOD_OPTIONS).id;
    const pickedView = rand(BODY_TURN_VIEWS).id;
    const pickedElev = rand(ELEVATION_OPTIONS).id;
    const pickedVp = rand(VANISHING_OPTIONS).id;
    const pickedSkull = rand(SKULL_FACING_OPTIONS).id;
    const pickedSeed = ([0, 1, 2, 3] as const)[Math.floor(Math.random() * 4)];

    setPlaying(false);
    setManualOverrideActive(false);
    setRecipe((prev) => ({
      ...prev,
      mood: pickedMood,
      stance: pickedStance.id,
      bodyView: pickedView,
      sideArmsFavorOpposite: false,
      elevation: pickedElev,
      vanishing: pickedVp,
      skullFacing: pickedSkull,
      seedVariant: pickedSeed,
      prometheusWings: pickedStance.defaultWings ?? false,
      ribAnchor: pickedStance.defaultRibAnchor ?? 'upper',
      torsoLean: 'auto',
      headPitch: 'auto',
      jaw: 'auto',
      armAttitude: 'auto',
      footPlant: 'auto',
      legStanceMode: 'auto',
      legStanceSide: 'both',
    }));
  }, [customStances]);

  const handleResetFineTune = useCallback(() => {
    setManualOverrideActive(false);
    setRecipe((prev) => ({
      ...prev,
      intensity: DEFAULT_PROCEDURAL_RECIPE.intensity,
      symmetry: DEFAULT_PROCEDURAL_RECIPE.symmetry,
      torsoLean: 'auto',
      headPitch: 'auto',
      jaw: 'auto',
      armAttitude: 'auto',
      footPlant: 'auto',
      legStanceMode: 'auto',
      legStanceSide: 'both',
      sideArmsFavorOpposite: false,
      handBuild: 'standard',
      handGestureL: 'auto',
      handGestureR: 'auto',
      prometheusWings: false,
      ribAnchor: 'upper',
      constrainLimits: true,
      bondOn: true,
      footGravity: true,
      balanceCounterweight: true,
      contralateralMotion: true,
    }));
  }, []);

  // ABC Motion handlers
  const handleCaptureSlot = useCallback(
    (slot: AbcSlot) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      const poseRec = captureAbcPose(rt.nodes, rt.root, rt.partMgr.inst, {
        headStep: generatedResult?.headStep,
        skullView: generatedResult?.skullView,
        bodyView: generatedResult?.bodyView ?? recipe.bodyView,
      });
      setAbc((prev) => ({
        ...prev,
        activeSlot: slot,
        poses: { ...prev.poses, [slot]: poseRec },
      }));
    },
    [generatedResult, recipe.bodyView],
  );

  const handleJumpSlot = useCallback(
    (slot: AbcSlot) => {
      const rt = runtimeRef.current;
      const target = abc.poses[slot];
      if (!rt || !target) return;
      setPlaying(false);
      setManualOverrideActive(true);
      applyAbcPoseInstant(
        target,
        rt.nodes,
        rt.root,
        rt.partMgr.inst,
        (inst) => rt.partMgr.rebake(inst, bumpRevision),
        undefined,
        bumpRevision,
      );
      const bv = target.bodyView ?? recipe.bodyView;
      applyBodyViewPivots(rt.nodes, rt.by, bv, recipe.ribAnchor);
      sortPiecesForBodyView(rt.pieces, bv, recipe.prometheusWings);
      solveRig(
        rt.nodes,
        rt.by,
        recipe.bondOn,
        recipe.prometheusWings ? 1 : 0,
        recipe.ribAnchor,
        bv,
        recipe.sideArmsFavorOpposite,
      );
      setAbc((prev) => ({ ...prev, activeSlot: slot }));
      bumpRevision();
    },
    [
      abc.poses,
      recipe.bodyView,
      recipe.ribAnchor,
      recipe.prometheusWings,
      recipe.bondOn,
      recipe.sideArmsFavorOpposite,
      bumpRevision,
    ],
  );

  const handleClearSlot = useCallback((slot: AbcSlot) => {
    setPlaying(false);
    setAbc((prev) => ({
      ...prev,
      poses: { ...prev.poses, [slot]: null },
    }));
  }, []);

  const handleSynthB = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt || !abc.poses.A || !abc.poses.C) return;
    const poseB = synthesizeProceduralInBetween(
      abc.poses.A,
      abc.poses.C,
      rt.nodes,
      rt.root,
      rt.partMgr.inst,
      (inst) => rt.partMgr.rebake(inst, bumpRevision),
      {
        by: rt.by,
        bondOn: recipe.bondOn,
        wingPop: recipe.prometheusWings ? 1 : 0,
        ribAnchor: recipe.ribAnchor,
        pieces: rt.pieces,
        constrainLimits: recipe.constrainLimits,
        prometheusWings: recipe.prometheusWings,
        groundY: livePerspective.groundY ?? DEFAULT_SPATIAL_ENV.groundY,
        footGravity: recipe.footGravity,
      },
    );
    setAbc((prev) => ({
      ...prev,
      activeSlot: 'B',
      poses: { ...prev.poses, B: poseB },
    }));
    bumpRevision();
  }, [abc.poses.A, abc.poses.C, recipe, livePerspective.groundY, bumpRevision]);

  const handleUpdateAbc = useCallback((patch: Partial<AbcSerializedState>) => {
    setAbc((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleTogglePlay = useCallback(() => {
    const filled = getFilledAbcSlots(abc.poses);
    if (filled.length < 2) return;
    setManualOverrideActive(false);
    setPlaying((p) => !p);
  }, [abc.poses]);

  // Library & Custom JSON Stance handlers
  const handleSaveCurrentSnapshot = useCallback(
    (name: string) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      const pose = captureAbcPose(rt.nodes, rt.root, rt.partMgr.inst, {
        headStep: generatedResult?.headStep,
        skullView: generatedResult?.skullView,
        bodyView: generatedResult?.bodyView ?? recipe.bodyView,
      });
      const now = Date.now();
      const entry: SavedPoseEntry = {
        id: `pose_${now}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        createdAt: now,
        updatedAt: now,
        prometheusWings: recipe.prometheusWings,
        pose,
      };
      setSavedPoses((prev) => [entry, ...prev]);
    },
    [generatedResult, recipe.bodyView, recipe.prometheusWings],
  );

  const handleSaveCurrentAsStance = useCallback(
    (name: string, category: string) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      const nodesMap: Record<string, number> = {};
      const flipXMap: Record<string, boolean> = {};
      for (const n of rt.nodes) {
        const rounded = Math.round(n.ang * 10) / 10;
        if (Math.abs(rounded) >= 0.05) nodesMap[n.id] = rounded;
        if (n.flipX) flipXMap[n.id] = true;
      }
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24);
      const id = `custom_${slug || 'stance'}_${Date.now().toString(36)}`;
      const entry: StanceSeedEntry = {
        id,
        label: name,
        category,
        cue: `Custom pose derived from ${generatedResult?.metrics.summary ?? 'Studio'}`,
        regime: generatedResult?.metrics.regime ?? 'standing',
        airborne: false,
        defaultRibAnchor: recipe.ribAnchor,
        defaultWings: recipe.prometheusWings,
        rootOffset: [
          Math.round(rt.root.tx * 10) / 10,
          Math.round(rt.root.ty * 10) / 10,
        ],
        nodes: nodesMap,
        ...(Object.keys(flipXMap).length ? { flipX: flipXMap } : {}),
        cam: generatedResult?.camHint ?? { waveform: 'sine', phaseLag: 0.14, breathAmp: 2.0 },
      };
      setCustomStances((prev) => [...prev, entry]);
      setManualOverrideActive(false);
      setRecipe((prev) => ({
        ...prev,
        stance: entry.id,
        mood: 'composed',
        torsoLean: 'auto',
        headPitch: 'auto',
        jaw: 'auto',
        armAttitude: 'auto',
        footPlant: 'auto',
        legStanceMode: 'auto',
        legStanceSide: 'both',
      }));
    },
    [generatedResult, recipe.prometheusWings, recipe.ribAnchor],
  );

  const handleLoadSaved = useCallback(
    (entry: SavedPoseEntry) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      setPlaying(false);
      setManualOverrideActive(true);
      applyAbcPoseInstant(
        entry.pose,
        rt.nodes,
        rt.root,
        rt.partMgr.inst,
        (inst) => rt.partMgr.rebake(inst, bumpRevision),
        undefined,
        bumpRevision,
      );
      const bv = entry.pose.bodyView ?? 'front';
      const wings = !!entry.prometheusWings;
      applyBodyViewPivots(rt.nodes, rt.by, bv, recipe.ribAnchor);
      sortPiecesForBodyView(rt.pieces, bv, wings);
      solveRig(
        rt.nodes,
        rt.by,
        recipe.bondOn,
        wings ? 1 : 0,
        recipe.ribAnchor,
        bv,
        recipe.sideArmsFavorOpposite,
      );
      setRecipe((prev) => ({
        ...prev,
        prometheusWings: wings,
        bodyView: bv,
      }));
      bumpRevision();
    },
    [recipe.bondOn, recipe.ribAnchor, recipe.sideArmsFavorOpposite, bumpRevision],
  );

  const handleApplyCurated = useCallback((preset: CuratedPreset) => {
    setPlaying(false);
    setManualOverrideActive(false);
    setRecipe((prev) => ({
      ...DEFAULT_PROCEDURAL_RECIPE,
      constrainLimits: prev.constrainLimits,
      bondOn: prev.bondOn,
      footGravity: prev.footGravity,
      balanceCounterweight: prev.balanceCounterweight,
      contralateralMotion: prev.contralateralMotion,
      ...preset.recipe,
    }));
  }, []);

  // Build JSON payloads for ExportModal
  const { rigJsonPayload, catalogJsonPayload } = useMemo(() => {
    const rt = runtimeRef.current;
    let rigJson = '{}';
    if (rt && rigReady) {
      const coordsById: Record<string, [number, number]> = {};
      for (const n of rt.nodes) {
        const p = pos(n, rt.by);
        coordsById[n.id] = [p[0], p[1]];
      }
      const payload = buildCanonicalPayload(
        rt.nodes,
        coordsById,
        rt.root,
        [],
        rt.partMgr.inst,
        cloneGotzState,
        {
          abc,
          prometheusWings: recipe.prometheusWings,
          ribAnchor: recipe.ribAnchor,
          headStep: generatedResult?.headStep,
          skullView: generatedResult?.skullView,
          bodyView: generatedResult?.bodyView ?? recipe.bodyView,
        },
      );
      rigJson = JSON.stringify(payload, null, 2);
    }

    const catalogJson = JSON.stringify(
      {
        version: '1.0',
        schema: 'bitruvius-automaton-stances',
        stances: [...STARTER_STANCE_CATALOG, ...customStances],
      },
      null,
      2,
    );

    return { rigJsonPayload: rigJson, catalogJsonPayload: catalogJson };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rigReady, revision, customStances, abc, recipe, generatedResult]);

  // Composite side-by-side Digital Skeleton + Anatomical Rig PNG export
  const handleExportPng = useCallback(() => {
    const digCv = digitalCanvasRef.current;
    const rigCv = canvasRef.current;
    if (!rigCv) return;
    if (!digCv) {
      const dataUrl = rigCv.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `bitruvius-${recipe.stance}-${recipe.mood}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    const gap = 2;
    const composite = document.createElement('canvas');
    composite.width = digCv.width + gap + rigCv.width;
    composite.height = Math.max(digCv.height, rigCv.height);
    const cctx = composite.getContext('2d');
    if (cctx) {
      cctx.fillStyle = '#2b2f36';
      cctx.fillRect(0, 0, composite.width, composite.height);
      cctx.drawImage(digCv, 0, 0);
      cctx.drawImage(rigCv, digCv.width + gap, 0);
      const dataUrl = composite.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `bitruvius-dual-${recipe.stance}-${recipe.mood}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, [recipe.mood, recipe.stance]);

  const handleExportBsk = useCallback(() => {
    triggerDownload(`bitruvius-${recipe.stance}-${recipe.mood}.bsk.json`, rigJsonPayload);
  }, [recipe.mood, recipe.stance, rigJsonPayload]);

  const handleExportCatalogJson = useCallback(() => {
    triggerDownload('bitruvius-stance-catalog.json', catalogJsonPayload);
  }, [catalogJsonPayload]);

  const handleImportJson = useCallback(
    (raw: string) => {
      const parsedObj = JSON.parse(raw) as Record<string, unknown>;
      if (parsedObj && Array.isArray(parsedObj.stances)) {
        const imported = parsedObj.stances.filter(
          (s): s is StanceSeedEntry =>
            !!s &&
            typeof s === 'object' &&
            typeof (s as StanceSeedEntry).id === 'string' &&
            typeof (s as StanceSeedEntry).label === 'string' &&
            !!(s as StanceSeedEntry).nodes,
        );
        if (!imported.length) {
          throw new Error('Catalog JSON contains zero valid stances.');
        }
        const starterIds = new Set(STARTER_STANCE_CATALOG.map((s) => s.id));
        const customAdditions = imported.filter((s) => !starterIds.has(s.id));
        if (customAdditions.length) {
          setCustomStances((prev) => {
            const byId = new Map(prev.map((p) => [p.id, p]));
            for (const add of customAdditions) byId.set(add.id, add);
            return Array.from(byId.values());
          });
        }
        setManualOverrideActive(false);
        setRecipe((prev) => ({ ...prev, stance: imported[0].id }));
        return;
      }

      const payload = parseAndValidateRigPayload(raw);
      const rt = runtimeRef.current;
      if (!rt) return;
      setPlaying(false);
      setManualOverrideActive(true);
      applyAbcPoseInstant(
        {
          nodes: payload.pose,
          root: payload.root,
          flipX: payload.flipX,
          headStep: payload.headStep,
          skullView: payload.skullView,
          bodyView: payload.bodyView,
          parts: payload.parts as AbcSerializedState['poses']['A'] extends infer T
            ? T extends { parts?: infer P }
              ? P
              : never
            : never,
        },
        rt.nodes,
        rt.root,
        rt.partMgr.inst,
        (inst) => rt.partMgr.rebake(inst, bumpRevision),
        undefined,
        bumpRevision,
      );
      const bv = payload.bodyView ?? 'front';
      const wings = !!payload.prometheusWings;
      const rib = payload.ribAnchor ?? 'upper';
      applyBodyViewPivots(rt.nodes, rt.by, bv, rib);
      sortPiecesForBodyView(rt.pieces, bv, wings);
      solveRig(
        rt.nodes,
        rt.by,
        recipe.bondOn,
        wings ? 1 : 0,
        rib,
        bv,
        recipe.sideArmsFavorOpposite,
      );
      setRecipe((prev) => ({
        ...prev,
        bodyView: bv,
        prometheusWings: wings,
        ribAnchor: rib,
      }));
      if (payload.abc) setAbc(payload.abc);
      bumpRevision();
    },
    [recipe.bondOn, recipe.sideArmsFavorOpposite, bumpRevision],
  );

  // Build onion-skin ghosts when playing or ghostVisible is on
  const abcGhosts: AbcGhostItem[] = useMemo(() => {
    if (!abc.ghostVisible) return [];
    const items: AbcGhostItem[] = [];
    for (const slot of ['A', 'B', 'C'] as const) {
      const p = abc.poses[slot];
      if (!p) continue;
      items.push({
        slot,
        pose: p,
        isPrimary: abc.activeSlot === slot,
        opacity: abc.activeSlot === slot ? abc.ghostOpacity : abc.ghostOpacity * 0.65,
      });
    }
    return items;
  }, [abc]);

  const perspectiveState: PerspectiveState = useMemo(
    () => ({
      ...livePerspective,
      enabled: showPerspGrid,
    }),
    [livePerspective, showPerspGrid],
  );

  const activeSummary =
    generatedResult?.metrics.summary ?? 'Composed · Contrapposto · Eye-Level';

  const rt = runtimeRef.current;
  const interactiveMode = tab === 'editor';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#121315] text-[#e6e8ec]">
      {/* Top Bar (Single-Row 3-Zone Contract; Editor sits strictly between Library and Mix Pose) */}
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-[#2b2f36] bg-[#191b1f] px-4">
        {/* Zone 1: Brand */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#a855f7]/60 bg-[#7e22ce]/25 text-[#c084fc]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-[14px] font-semibold text-[#e6e8ec]">
              Bitruvius Procedural Studio
            </h1>
          </div>
        </div>

        {/* Zone 2: Primary Segmented Tabs (Generator · Fine-Tune · Motion · Library) */}
        <nav
          aria-label="Studio workspace sections"
          className="flex items-center gap-1 rounded border border-[#2b2f36] bg-[#0e0f11] p-1"
        >
          {(
            [
              { id: 'generator', label: 'Generator', icon: Layers },
              { id: 'finetune', label: 'Fine-Tune', icon: Sliders },
              { id: 'motion', label: 'Motion', icon: PlaySquare },
              { id: 'library', label: 'Library', icon: Library },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setTab(item.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-3 py-1 text-[12px] font-medium transition-colors ${
                  active
                    ? 'bg-[#7e22ce]/35 text-[#f3e8ff] ring-1 ring-[#a855f7]'
                    : 'text-[#8b919c] hover:text-[#e6e8ec]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Editor Tab (strictly between Library and Mix Pose) + Quick Actions */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-current={tab === 'editor' ? 'page' : undefined}
            onClick={() => setTab('editor')}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              tab === 'editor'
                ? 'border-[#22c55e] bg-[#22c55e]/20 text-[#86efac]'
                : 'border-[#2b2f36] bg-[#0e0f11] text-[#b4bac4] hover:border-[#22c55e]/70 hover:text-[#e6e8ec]'
            }`}
          >
            <Crosshair className="h-3.5 w-3.5 text-[#22c55e]" aria-hidden="true" />
            Editor
          </button>

          <button
            type="button"
            onClick={handleRandomizeAll}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[#2b2f36] bg-[#0e0f11] px-2.5 py-1.5 text-[12px] font-medium text-[#e6e8ec] transition-colors hover:border-[#22c55e] hover:text-[#86efac]"
          >
            <Shuffle className="h-3.5 w-3.5 text-[#22c55e]" aria-hidden="true" />
            Mix Pose
          </button>

          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[#a855f7] bg-[#7e22ce] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#9333ea]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export / JSON
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: Dual-Panel Stage (Digital Skeleton + Anatomical Rig) */}
        <div className="relative min-h-[380px] bg-[#121315]">
          {loadError ? (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div className="max-w-md rounded border border-[#ef4444]/60 bg-[#191b1f] p-4">
                <p className="font-semibold text-[#fca5a5]">Rig Asset Load Error</p>
                <p className="mt-1 text-[12px] text-[#8b919c]">{loadError}</p>
              </div>
            </div>
          ) : !rigReady || !rt ? (
            <div className="flex h-full items-center justify-center text-[12.5px] text-[#8b919c]">
              Assembling Bitruvian anatomical rig...
            </div>
          ) : (
            <StageCanvas
              renderer={rt.renderer}
              canvasRefExternal={canvasRef}
              digitalCanvasRefExternal={digitalCanvasRef}
              nodes={rt.nodes}
              by={rt.by}
              root={rt.root}
              pieces={rt.pieces}
              renderMode={renderMode}
              showBones={showBones}
              showLineOfAction={showLineOfAction}
              showGestureRibs={showGestureRibs}
              showPerspGrid={showPerspGrid}
              showVitruvianGuides={showVitruvianGuides}
              framing={framing}
              constrainLimits={recipe.constrainLimits}
              bondOn={recipe.bondOn}
              wingPop={recipe.prometheusWings ? 1 : 0}
              bodyView={activeBodyView}
              ribAnchor={recipe.ribAnchor}
              perspective={perspectiveState}
              abcGhosts={abcGhosts}
              handLGotz={rt.partMgr.inst.handL?.gotz}
              handRGotz={rt.partMgr.inst.handR?.gotz}
              footToeBreakR={footToeBreak.R}
              footToeBreakL={footToeBreak.L}
              revision={revision}
              activeSummary={activeSummary}
              interactiveMode={interactiveMode}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onInteractiveSetAngle={handleInteractiveSetAngle}
              onInteractiveMoveRoot={handleInteractiveMoveRoot}
              onChangeRenderMode={(nextMode) => {
                setRenderMode(nextMode);
              }}
              onToggleBones={() => setShowBones((v) => !v)}
              onToggleLineOfAction={() => setShowLineOfAction((v) => !v)}
              onToggleGestureRibs={() => setShowGestureRibs((v) => !v)}
              onTogglePerspGrid={() => setShowPerspGrid((v) => !v)}
              onToggleVitruvian={() => setShowVitruvianGuides((v) => !v)}
              onChangeFraming={setFraming}
            />
          )}
        </div>

        {/* Right: Procedural Controls & Editor Rail */}
        <aside className="studio-scroll overflow-y-auto border-t border-[#2b2f36] bg-[#191b1f] p-4 lg:border-t-0 lg:border-l">
          {tab === 'generator' && (
            <GeneratorTab
              recipe={recipe}
              customStances={customStances}
              onUpdate={handleUpdateRecipe}
              onHoldNudge={handleHoldNudge}
              onRandomizeAll={handleRandomizeAll}
            />
          )}

          {tab === 'finetune' && (
            <FineTuneTab
              recipe={recipe}
              poseMetrics={generatedResult?.metrics ?? null}
              onUpdate={handleUpdateRecipe}
              onHoldNudge={handleHoldNudge}
              onResetFineTune={handleResetFineTune}
            />
          )}

          {tab === 'motion' && (
            <MotionTab
              abc={abc}
              playing={playing}
              onCaptureSlot={handleCaptureSlot}
              onJumpSlot={handleJumpSlot}
              onClearSlot={handleClearSlot}
              onSynthB={handleSynthB}
              onTogglePlay={handleTogglePlay}
              onUpdateAbc={handleUpdateAbc}
            />
          )}

          {tab === 'library' && (
            <LibraryTab
              savedPoses={savedPoses}
              customStances={customStances}
              activeSummary={activeSummary}
              onApplyCurated={handleApplyCurated}
              onSaveCurrentSnapshot={handleSaveCurrentSnapshot}
              onSaveCurrentAsStance={handleSaveCurrentAsStance}
              onSelectStance={(id) => {
                setManualOverrideActive(false);
                setRecipe((prev) => ({ ...prev, stance: id }));
                setTab('generator');
              }}
              onDeleteCustomStance={(id) =>
                setCustomStances((prev) => prev.filter((s) => s.id !== id))
              }
              onLoadSaved={handleLoadSaved}
              onDeleteSaved={(id) => setSavedPoses((prev) => prev.filter((p) => p.id !== id))}
            />
          )}

          {tab === 'editor' && rt && (
            <EditorTab
              nodes={rt.nodes}
              selectedNodeId={selectedNodeId}
              manualOverrideActive={manualOverrideActive}
              activeAbcSlot={abc.activeSlot}
              footToeBreak={footToeBreak}
              onSelectNode={setSelectedNodeId}
              onNudgeNodeAngle={handleNudgeNodeAngle}
              onToggleFlipX={handleToggleFlipX}
              onResetBone={handleResetBone}
              onResetAllEdits={handleResetAllEdits}
              onNudgeFootToeBreak={handleNudgeFootToeBreak}
              onNudgeHandsCurl={handleNudgeHandsCurl}
              onCaptureToAbc={handleCaptureSlot}
              onPromoteStance={handleSaveCurrentAsStance}
            />
          )}
        </aside>
      </main>

      <ExportModal
        open={exportOpen}
        jsonPayload={rigJsonPayload}
        catalogJsonPayload={catalogJsonPayload}
        onClose={() => setExportOpen(false)}
        onExportPng={handleExportPng}
        onExportBsk={handleExportBsk}
        onExportCatalogJson={handleExportCatalogJson}
        onImportJson={handleImportJson}
      />
    </div>
  );
}

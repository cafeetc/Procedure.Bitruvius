import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bone,
  Compass,
  Eye,
  Grid,
  Move,
  Scan,
} from 'lucide-react';
import { type AbcGhostItem, type StageRenderer } from '../engine/canvasRenderer';
import {
  computeRigWorldBounds,
  hitTestPiece,
  normalizeDeg,
  pos,
  type RibAnchorMode,
} from '../engine/fkEngine';
import type { GotzHandState } from '../engine/gotzHandEngine';
import type { CameraFraming, RenderStyleMode } from '../engine/studioTypes';
import type {
  BodyTurnView,
  PerspectiveState,
  RigNode,
  RigPiece,
} from '../engine/types';

interface StageCanvasProps {
  renderer: StageRenderer | null;
  canvasRefExternal?: React.MutableRefObject<HTMLCanvasElement | null>;
  digitalCanvasRefExternal?: React.MutableRefObject<HTMLCanvasElement | null>;
  nodes: RigNode[];
  by: Record<string, RigNode>;
  root: RigNode;
  pieces: RigPiece[];
  renderMode: RenderStyleMode;
  showBones: boolean;
  showLineOfAction: boolean;
  showGestureRibs: boolean;
  showPerspGrid: boolean;
  showVitruvianGuides: boolean;
  framing: CameraFraming;
  constrainLimits: boolean;
  bondOn: boolean;
  wingPop: number;
  bodyView: BodyTurnView;
  ribAnchor: RibAnchorMode;
  perspective: PerspectiveState;
  abcGhosts: AbcGhostItem[];
  handLGotz?: GotzHandState;
  handRGotz?: GotzHandState;
  footToeBreakR?: number;
  footToeBreakL?: number;
  revision: number;
  activeSummary: string;
  interactiveMode: boolean;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onInteractiveSetAngle: (id: string, nextDeg: number) => void;
  onInteractiveMoveRoot: (tx: number, ty: number) => void;
  onChangeRenderMode: (mode: RenderStyleMode) => void;
  onToggleBones: () => void;
  onToggleLineOfAction: () => void;
  onToggleGestureRibs: () => void;
  onTogglePerspGrid: () => void;
  onToggleVitruvian: () => void;
  onChangeFraming: (framing: CameraFraming) => void;
}

function computeCameraTransform(
  by: Record<string, RigNode>,
  pieces: RigPiece[],
  wingPop: number,
  framing: CameraFraming,
  W: number,
  H: number,
): { z: number; ox: number; oy: number } {
  const safeBottom = 60;
  const padX = 24;
  const padTop = 30;
  const availW = Math.max(100, W - padX * 2);
  const availH = Math.max(100, H - padTop - safeBottom);

  const bounds = computeRigWorldBounds(by, pieces, wingPop);
  let x0 = bounds ? bounds.x0 : 400;
  let x1 = bounds ? bounds.x1 : 2100;
  let y0 = bounds ? bounds.y0 : -100;
  let y1 = bounds ? bounds.y1 : 8700;

  if (framing === 'skull' && by.head) {
    const pHd = pos(by.head, by);
    const pNk = by.neck ? pos(by.neck, by) : pHd;
    const cx = (pHd[0] + pNk[0]) * 0.5;
    const cy = pHd[1] - 260;
    x0 = cx - 900;
    x1 = cx + 900;
    y0 = cy - 900;
    y1 = cy + 1000;
  } else if (framing === 'upper' && by.pelvis) {
    const pPel = pos(by.pelvis, by);
    const topY = bounds ? bounds.headTopY - 220 : pPel[1] - 3200;
    const botY = pPel[1] + 550;
    const cx = bounds ? (bounds.x0 + bounds.x1) * 0.5 : 1250;
    const halfW = Math.max(1350, (x1 - x0) * 0.55);
    x0 = cx - halfW;
    x1 = cx + halfW;
    y0 = topY;
    y1 = botY;
  } else if (framing === 'extremities' && by.pelvis) {
    const pPel = pos(by.pelvis, by);
    y0 = pPel[1] - 250;
    y1 = Math.max(bounds ? bounds.y1 + 260 : 8800, pPel[1] + 2200);
    const cx = bounds ? (bounds.x0 + bounds.x1) * 0.5 : 1250;
    const halfW = Math.max(1500, (x1 - x0) * 0.58);
    x0 = cx - halfW;
    x1 = cx + halfW;
  } else {
    const spanX = Math.max(1800, x1 - x0);
    const cx = (x0 + x1) * 0.5;
    x0 = cx - spanX * 0.5 - 240;
    x1 = cx + spanX * 0.5 + 240;
    y0 = Math.min(y0 - 240, -220);
    y1 = Math.max(y1 + 280, y0 + 2600);
  }

  const boxW = Math.max(400, x1 - x0);
  const boxH = Math.max(400, y1 - y0);
  const z = Math.min(availW / boxW, availH / boxH);
  const ox = padX + (availW - boxW * z) * 0.5 - x0 * z;
  const oy = padTop + (availH - boxH * z) * 0.5 - y0 * z;
  return { z, ox, oy };
}

export const StageCanvas: React.FC<StageCanvasProps> = ({
  renderer,
  canvasRefExternal,
  digitalCanvasRefExternal,
  nodes,
  by,
  root,
  pieces,
  renderMode,
  showBones,
  showLineOfAction,
  showGestureRibs,
  showPerspGrid,
  showVitruvianGuides,
  framing,
  constrainLimits,
  bondOn,
  wingPop,
  bodyView,
  ribAnchor,
  perspective,
  abcGhosts,
  handLGotz,
  handRGotz,
  footToeBreakR = 0,
  footToeBreakL = 0,
  revision,
  activeSummary,
  interactiveMode,
  selectedNodeId,
  onSelectNode,
  onInteractiveSetAngle,
  onInteractiveMoveRoot,
  onChangeRenderMode,
  onToggleBones,
  onToggleLineOfAction,
  onToggleGestureRibs,
  onTogglePerspGrid,
  onToggleVitruvian,
  onChangeFraming,
}) => {
  const digitalPaneRef = useRef<HTMLDivElement | null>(null);
  const rigPaneRef = useRef<HTMLDivElement | null>(null);
  const digitalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rigCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  // Snapshot camera & initial gesture on drag start so bones rotate/move smoothly without cam feedback jump
  const dragSessionRef = useRef<{
    panel: 'digital' | 'rig';
    nodeId: string;
    isRootMove: boolean;
    cam: { z: number; ox: number; oy: number };
    startWorld: [number, number];
    startRoot: [number, number];
    pivWorld: [number, number];
    startPointerDeg: number;
    startNodeAng: number;
    flipXSign: number;
  } | null>(null);

  const camSnapshotRef = useRef<{
    digital: { z: number; ox: number; oy: number };
    rig: { z: number; ox: number; oy: number };
  }>({
    digital: { z: 0.08, ox: 120, oy: 40 },
    rig: { z: 0.08, ox: 120, oy: 40 },
  });

  // Clear hover/drag if leaving Editor mode
  useEffect(() => {
    if (!interactiveMode) {
      setHoveredNodeId(null);
      setDraggingNodeId(null);
      dragSessionRef.current = null;
    }
  }, [interactiveMode]);

  useEffect(() => {
    const drawAll = () => {
      if (!renderer || !nodes.length) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const selNode = interactiveMode && selectedNodeId ? by[selectedNodeId] ?? null : null;
      const hovNode = interactiveMode && hoveredNodeId ? by[hoveredNodeId] ?? null : null;

      const panels: Array<{
        key: 'digital' | 'rig';
        el: HTMLDivElement | null;
        cv: HTMLCanvasElement | null;
        mode: 'D' | 'A';
        silhouetteMode: boolean;
        panelShowBones: boolean;
      }> = [
        {
          key: 'digital',
          el: digitalPaneRef.current,
          cv: digitalCanvasRef.current,
          mode: 'D',
          silhouetteMode: false,
          panelShowBones: true,
        },
        {
          key: 'rig',
          el: rigPaneRef.current,
          cv: rigCanvasRef.current,
          mode: 'A',
          silhouetteMode: renderMode === 'silhouette',
          panelShowBones: showBones,
        },
      ];

      for (const p of panels) {
        if (!p.el || !p.cv) continue;
        const cssW = Math.max(180, p.el.clientWidth);
        const cssH = Math.max(180, p.el.clientHeight);
        const pw = Math.round(cssW * dpr);
        const ph = Math.round(cssH * dpr);
        if (p.cv.width !== pw || p.cv.height !== ph) {
          p.cv.width = pw;
          p.cv.height = ph;
        }
        const ctx = p.cv.getContext('2d');
        if (!ctx) continue;

        // While dragging on this panel, freeze camera transform so bone motion stays 1:1 under cursor
        const dragSess = dragSessionRef.current;
        const cam =
          dragSess && dragSess.panel === p.key
            ? dragSess.cam
            : computeCameraTransform(by, pieces, wingPop, framing, cssW, cssH);

        camSnapshotRef.current[p.key] = cam;

        renderer.render({
          cv: p.cv,
          ctx,
          nodes,
          by,
          pieces,
          sel: selNode,
          hov: hovNode,
          W: pw,
          H: ph,
          z: cam.z * dpr,
          ox: cam.ox * dpr,
          oy: cam.oy * dpr,
          dpr,
          mode: p.mode,
          silhouetteMode: p.silhouetteMode,
          showBones: p.panelShowBones,
          showGuides: interactiveMode,
          constrainLimits,
          bondOn,
          isActiveMotion: !!draggingNodeId,
          actUntil: 0,
          bgColor: '#121315',
          wingPop,
          bodyView,
          ribAnchor,
          abcGhosts,
          handLGotz,
          handRGotz,
          footToeBreakR,
          footToeBreakL,
          persp: {
            ...perspective,
            enabled: showPerspGrid,
          },
          hidePerspLabels: p.key === 'digital',
          hideBackdropText: true,
          hideCanvasControls: !interactiveMode,
          showVitruvianGuides,
          showLineOfAction,
          showGestureRibs,
        });
      }
    };

    if (canvasRefExternal) canvasRefExternal.current = rigCanvasRef.current;
    if (digitalCanvasRefExternal) digitalCanvasRefExternal.current = digitalCanvasRef.current;

    const rafId = requestAnimationFrame(drawAll);
    return () => cancelAnimationFrame(rafId);
  }, [
    renderer,
    nodes,
    by,
    pieces,
    renderMode,
    showBones,
    showLineOfAction,
    showGestureRibs,
    showPerspGrid,
    showVitruvianGuides,
    framing,
    constrainLimits,
    bondOn,
    wingPop,
    bodyView,
    ribAnchor,
    perspective,
    abcGhosts,
    handLGotz,
    handRGotz,
    footToeBreakR,
    footToeBreakL,
    revision,
    interactiveMode,
    selectedNodeId,
    hoveredNodeId,
    draggingNodeId,
    canvasRefExternal,
    digitalCanvasRefExternal,
  ]);

  // Redraw when panels resize
  useEffect(() => {
    const els = [digitalPaneRef.current, rigPaneRef.current].filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const ro = new ResizeObserver(() => {
      // Trigger lightweight hover state ping or force redraw? We can directly trigger ResizeObserver callback if needed,
      // but since parent revision handles rig updates, we'll force a local tick state:
      setPaneResizeTick((t) => (t + 1) % 100000);
    });
    els.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, []);

  const [, setPaneResizeTick] = useState(0);

  const clientToWorld = useCallback(
    (panel: 'digital' | 'rig', clientX: number, clientY: number, camOverride?: { z: number; ox: number; oy: number }): [number, number] | null => {
      const el = panel === 'digital' ? digitalPaneRef.current : rigPaneRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const cam = camOverride ?? camSnapshotRef.current[panel];
      if (!cam || cam.z <= 1e-6) return null;
      return [(sx - cam.ox) / cam.z, (sy - cam.oy) / cam.z];
    },
    [],
  );

  const pickNodeAtWorld = useCallback(
    (wx: number, wy: number, camZ: number): RigNode | null => {
      // 1. Direct joint pivot hit (makes thin Digital Skeleton joints crisp & easy to grab)
      const jointRadiusWorld = Math.max(95, 22 / Math.max(0.02, camZ));
      let bestPivotNode: RigNode | null = null;
      let bestPivotDist = jointRadiusWorld;
      for (const n of nodes) {
        if (n.ghost || n.lock) continue;
        const p = pos(n, by);
        const d = Math.hypot(wx - p[0], wy - p[1]);
        if (d < bestPivotDist) {
          bestPivotDist = d;
          bestPivotNode = n;
        }
      }
      if (bestPivotNode) return bestPivotNode;

      // 2. Pixel-accurate cutout mask hit
      const pieceHit = hitTestPiece([wx, wy], pieces, wingPop);
      if (pieceHit && !pieceHit.node.lock && !pieceHit.node.ghost) {
        return pieceHit.node;
      }

      // 3. Nearest limb segment midpoint fallback
      let bestSegNode: RigNode | null = null;
      let bestSegDist = Math.max(140, 32 / Math.max(0.02, camZ));
      for (const n of nodes) {
        if (n.ghost || n.lock || !n.parent) continue;
        const par = by[n.parent];
        if (!par) continue;
        const a = pos(par, by);
        const b = pos(n, by);
        const abx = b[0] - a[0];
        const aby = b[1] - a[1];
        const len2 = abx * abx + aby * aby;
        if (len2 < 25) continue;
        const t = Math.max(0, Math.min(1, ((wx - a[0]) * abx + (wy - a[1]) * aby) / len2));
        const px = a[0] + t * abx;
        const py = a[1] + t * aby;
        const d = Math.hypot(wx - px, wy - py);
        if (d < bestSegDist) {
          bestSegDist = d;
          // Dragging along child bone segment rotates parent bone cleanly
          bestSegNode = par.lock || par.ghost ? n : par;
        }
      }
      return bestSegNode;
    },
    [nodes, by, pieces, wingPop],
  );

  const handlePointerMove = useCallback(
    (panel: 'digital' | 'rig', e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!interactiveMode) return;

      const sess = dragSessionRef.current;
      if (sess && sess.panel === panel) {
        const w = clientToWorld(panel, e.clientX, e.clientY, sess.cam);
        if (!w) return;
        if (sess.isRootMove) {
          const dx = w[0] - sess.startWorld[0];
          const dy = w[1] - sess.startWorld[1];
          onInteractiveMoveRoot(sess.startRoot[0] + dx, sess.startRoot[1] + dy);
        } else {
          const curDeg = Math.atan2(w[1] - sess.pivWorld[1], w[0] - sess.pivWorld[0]) * (180 / Math.PI);
          const deltaDeg = normalizeDeg(curDeg - sess.startPointerDeg);
          onInteractiveSetAngle(sess.nodeId, sess.startNodeAng + deltaDeg * sess.flipXSign);
        }
        return;
      }

      const cam = camSnapshotRef.current[panel];
      const w = clientToWorld(panel, e.clientX, e.clientY);
      if (!w) return;
      const hit = pickNodeAtWorld(w[0], w[1], cam.z);
      setHoveredNodeId(hit ? hit.id : null);
    },
    [
      interactiveMode,
      clientToWorld,
      pickNodeAtWorld,
      onInteractiveMoveRoot,
      onInteractiveSetAngle,
    ],
  );

  const handlePointerDown = useCallback(
    (panel: 'digital' | 'rig', e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!interactiveMode) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      const cam = camSnapshotRef.current[panel];
      const w = clientToWorld(panel, e.clientX, e.clientY, cam);
      if (!w) return;

      const hit = pickNodeAtWorld(w[0], w[1], cam.z);
      if (!hit) {
        onSelectNode(null);
        return;
      }

      e.currentTarget.setPointerCapture(e.pointerId);
      onSelectNode(hit.id);
      setDraggingNodeId(hit.id);

      const pivWorld = pos(hit, by);
      const isRootMove = hit.id === root.id || e.altKey;
      const par = hit.parent ? by[hit.parent] : null;
      const parFlip = par && par.w[0] * par.w[3] - par.w[1] * par.w[2] < 0 ? -1 : 1;
      const flipXSign = (hit.flipX ? -1 : 1) * parFlip;

      dragSessionRef.current = {
        panel,
        nodeId: hit.id,
        isRootMove,
        cam: { ...cam },
        startWorld: w,
        startRoot: [root.tx, root.ty],
        pivWorld,
        startPointerDeg:
          Math.atan2(w[1] - pivWorld[1], w[0] - pivWorld[0]) * (180 / Math.PI),
        startNodeAng: hit.ang,
        flipXSign,
      };
    },
    [interactiveMode, clientToWorld, pickNodeAtWorld, onSelectNode, by, root],
  );

  const endDrag = useCallback((e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore release errors
      }
    }
    dragSessionRef.current = null;
    setDraggingNodeId(null);
  }, []);

  const canvasCursor = !interactiveMode
    ? 'cursor-default'
    : draggingNodeId
    ? 'cursor-grabbing'
    : hoveredNodeId
    ? 'cursor-grab'
    : 'cursor-crosshair';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#121315] select-none">
      {/* Dual Split Panels: Digital Skeleton (Left) + Anatomical Rig (Right) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-[#2b2f36] md:grid-cols-2">
        {/* Left Panel: Crisp Digital Skeleton */}
        <div
          ref={digitalPaneRef}
          className="relative min-h-[240px] w-full overflow-hidden bg-[#121315]"
        >
          <div className="pointer-events-none absolute top-2.5 left-2.5 z-10 flex items-center gap-2 rounded border border-[#2b2f36] bg-[#191b1f]/90 px-2.5 py-1 text-[11px] text-[#b4bac4]">
            <span className="font-semibold text-[#4ade80]">Digital Skeleton</span>
            <span className="text-[#5c626e]">·</span>
            <span className="max-w-[200px] truncate text-[#e6e8ec]">{activeSummary}</span>
          </div>

          {interactiveMode && (
            <div className="pointer-events-none absolute top-2.5 right-2.5 z-10 flex items-center gap-1 rounded border border-[#22c55e]/60 bg-[#22c55e]/15 px-2 py-0.5 text-[10.5px] font-medium text-[#86efac]">
              <Move className="h-3 w-3" aria-hidden="true" />
              Editor Active
            </div>
          )}

          <canvas
            ref={digitalCanvasRef}
            aria-label="Digital geometric skeleton stage panel"
            onPointerMove={(e) => handlePointerMove('digital', e)}
            onPointerDown={(e) => handlePointerDown('digital', e)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => {
              if (!dragSessionRef.current) setHoveredNodeId(null);
            }}
            className={`h-full w-full touch-none ${canvasCursor}`}
          />
        </div>

        {/* Right Panel: Anatomical Rig */}
        <div
          ref={rigPaneRef}
          className="relative min-h-[240px] w-full overflow-hidden bg-[#121315]"
        >
          <div className="pointer-events-none absolute top-2.5 left-2.5 z-10 flex items-center gap-2 rounded border border-[#2b2f36] bg-[#191b1f]/90 px-2.5 py-1 text-[11px] text-[#b4bac4]">
            <span className="font-semibold text-[#c084fc]">Anatomical Rig</span>
            <span className="text-[#5c626e]">·</span>
            <span className="text-[#8b919c]">
              {renderMode === 'silhouette' ? 'Silhouette' : 'Cutout'}
            </span>
          </div>

          <canvas
            ref={rigCanvasRef}
            aria-label="Anatomical figure rig stage panel"
            onPointerMove={(e) => handlePointerMove('rig', e)}
            onPointerDown={(e) => handlePointerDown('rig', e)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => {
              if (!dragSessionRef.current) setHoveredNodeId(null);
            }}
            className={`h-full w-full touch-none ${canvasCursor}`}
          />
        </div>
      </div>

      {/* Bottom Floating Bar: Rig Style, Study Aids & Framing */}
      <div className="pointer-events-none absolute inset-x-3 bottom-2.5 z-10 flex flex-wrap items-center justify-between gap-2">
        {/* Left group: Right-Panel Rig Render Mode */}
        <div
          className="pointer-events-auto inline-flex items-center gap-1 rounded border border-[#2b2f36] bg-[#191b1f]/95 p-1 shadow-lg"
          role="group"
          aria-label="Anatomical rig render mode"
        >
          {(
            [
              { id: 'cutout', label: 'Cutout', icon: Eye },
              { id: 'silhouette', label: 'Silhouette', icon: Scan },
            ] as const
          ).map((m) => {
            const Icon = m.icon;
            const active =
              m.id === 'silhouette' ? renderMode === 'silhouette' : renderMode !== 'silhouette';
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChangeRenderMode(m.id)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-[#7e22ce]/35 text-[#f3e8ff] ring-1 ring-[#a855f7]'
                    : 'text-[#8b919c] hover:bg-[#0e0f11] hover:text-[#e6e8ec]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Center group: Gesture Study Aids */}
        <div
          className="pointer-events-auto inline-flex flex-wrap items-center gap-1 rounded border border-[#2b2f36] bg-[#191b1f]/95 p-1 shadow-lg"
          role="group"
          aria-label="Gesture study overlays"
        >
          <button
            type="button"
            aria-pressed={showLineOfAction}
            onClick={onToggleLineOfAction}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              showLineOfAction
                ? 'bg-[#ef4444]/20 text-[#fca5a5] ring-1 ring-[#ef4444]'
                : 'text-[#8b919c] hover:bg-[#0e0f11] hover:text-[#e6e8ec]'
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-[#ef4444]" aria-hidden="true" />
            Line of Action
          </button>

          <button
            type="button"
            aria-pressed={showGestureRibs}
            onClick={onToggleGestureRibs}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              showGestureRibs
                ? 'bg-[#22c55e]/20 text-[#86efac] ring-1 ring-[#22c55e]'
                : 'text-[#8b919c] hover:bg-[#0e0f11] hover:text-[#e6e8ec]'
            }`}
          >
            <Compass className="h-3.5 w-3.5 text-[#22c55e]" aria-hidden="true" />
            Rib Curves
          </button>

          <button
            type="button"
            aria-pressed={showBones}
            onClick={onToggleBones}
            title="Show skeleton overlay on the right Anatomical Rig panel"
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              showBones
                ? 'bg-[#22c55e]/20 text-[#86efac] ring-1 ring-[#22c55e]'
                : 'text-[#8b919c] hover:bg-[#0e0f11] hover:text-[#e6e8ec]'
            }`}
          >
            <Bone className="h-3.5 w-3.5" aria-hidden="true" />
            Rig Bones
          </button>

          <button
            type="button"
            aria-pressed={showPerspGrid}
            onClick={onTogglePerspGrid}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              showPerspGrid
                ? 'bg-[#7e22ce]/35 text-[#f3e8ff] ring-1 ring-[#a855f7]'
                : 'text-[#8b919c] hover:bg-[#0e0f11] hover:text-[#e6e8ec]'
            }`}
          >
            <Grid className="h-3.5 w-3.5" aria-hidden="true" />
            Perspective
          </button>

          <button
            type="button"
            aria-pressed={showVitruvianGuides}
            onClick={onToggleVitruvian}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              showVitruvianGuides
                ? 'bg-[#22c55e]/20 text-[#86efac] ring-1 ring-[#22c55e]'
                : 'text-[#8b919c] hover:bg-[#0e0f11] hover:text-[#e6e8ec]'
            }`}
          >
            Vitruvian
          </button>
        </div>

        {/* Right group: Camera Framing */}
        <div
          className="pointer-events-auto inline-flex items-center gap-1 rounded border border-[#2b2f36] bg-[#191b1f]/95 p-1 shadow-lg"
          role="group"
          aria-label="Camera framing presets"
        >
          {(
            [
              { id: 'full', label: 'Full' },
              { id: 'upper', label: 'Upper' },
              { id: 'skull', label: 'Skull' },
              { id: 'extremities', label: 'Limbs' },
            ] as const
          ).map((f) => {
            const active = framing === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChangeFraming(f.id)}
                className={`whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-[#7e22ce]/35 text-[#f3e8ff] ring-1 ring-[#a855f7]'
                    : 'text-[#8b919c] hover:bg-[#0e0f11] hover:text-[#e6e8ec]'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/**
 * Feature Notes (Plain English):
 * - Sub-Rig & Piggy/Gotz Part Manager: Manages detailed nested parts attached to the main body,
 *   including the procedural Gotz 5-digit hand (with forearm above wrist) and Piggy multi-bone feet.
 * - Live Baking: Re-renders modified part layers into sprites on Bitruvius in real time.
 */
import { DEG, decImage, mkCanvas, setPieceBitmap } from './fkEngine';
import {
  GOTZ_PROPS_ANAT,
  GOTZ_PROPS_LEG,
  GOTZ_STAGE_BOX,
  bakeGotzHandToCanvas,
  cloneGotzState,
  createDefaultGotzHandState,
} from './gotzHandEngine';
import { setFrontSkullCache } from './skullKitModels';
import type { Keyframe, PartRigInstance, PartsManifest, RigNode } from './types';

export const SKL = 'Skullbone/skull/skullplate';

export const FACE = {
  tree: {
    Forehead: SKL,
    Crownpin: SKL,
    Furlbone: SKL,
    Eyeframe1: SKL,
    Eyeframe2: SKL,
    Cheek1: SKL,
    Cheek2: SKL,
    Nasalcavity: SKL,
    Throatbone: SKL,
    'Upper Lip': SKL,
    Chin: SKL,
    Socketbone1: 'Eyeframe1',
    Eyeball1: 'Eyeframe1',
    Iris1: 'Eyeball1',
    Pupil1: 'Iris1',
    Socketbone2: 'Eyeframe2',
    Eyeball2: 'Eyeframe2',
    Iris2: 'Eyeball2',
    Pupil2: 'Iris2',
    Nosepin: 'Nasalcavity',
    'Upper Jowl1': 'Cheek1',
    'Upper Jowl2': 'Cheek2',
    'Upper Teeth': 'Upper Lip',
    Chinpin: 'Chin',
    Chinrest: 'Chin',
    'Bottom Teeth': 'Chin',
    Jowl1: 'Chin',
    Jowl2: 'Chin',
  } as Record<string, string>,
  pivot: {
    Chin: 'Upper Lip',
    Cheek1: 'Upper Lip',
    Cheek2: 'Upper Lip',
    'Upper Jowl1': 'Upper Lip',
    'Upper Jowl2': 'Upper Lip',
  } as Record<string, string>,
  at: {
    Jowl1: [1125, 2614],
    Jowl2: [1875, 2614],
  } as Record<string, [number, number]>,
  hinge: ['Chin', 'Cheek1', 'Cheek2', 'Upper Jowl1', 'Upper Jowl2'],
  exc: {} as Record<string, [number, number]>,
};

export const PART_LINKS: Array<{ node: string; inst: string; name: string; k: number }> = [];

const FOOTA = [
  -0.19088577804596826,
  -0.1996935484063157,
  -0.3096125456814106,
  0.2959566402963461,
  1152.5055661304632,
  133.5272042764406,
];

// Stage padding around footR/footL original boxes so collapsed heel/ankle never clips
const FOOT_STAGE_PAD = {
  left: 60,
  right: 140,
  top: 220,
  bottom: 48,
};

// Anatomical parent links (childIdx -> parentIdx) for the 23-piece parts.foot view
const FOOT_PARENT_BY_INDEX: Record<number, number> = {
  14: 12, // Market Middle -> Market Metacarpal (Hallux)
  13: 14, // Market Distal -> Market Middle
  16: 15, // Prox 2 -> Met 2
  17: 16, // Middle 2 -> Prox 2
  18: 17, // Toebone 2 -> Middle 2
  22: 19, // Proximal 3 -> Met 3
  20: 22, // Middle 3 -> Proximal 3
  21: 20, // Toebone 3 -> Middle 3
  5: 2,   // Proximal 4 -> Met 4
  3: 5,   // Middle 4 -> Proximal 4
  4: 3,   // Toebone 4 -> Middle 4
  7: 6,   // Prox 5 -> Met 5
  8: 7,   // Middle 5 -> Prox 5
  9: 8,   // Toebone 5 -> Middle 5
};

const FOOT_PROXIMAL_TOE_INDICES = [14, 16, 22, 5, 7] as const;

export function buildCollapsedFootMatrix(origW: number, _origH: number, pad = FOOT_STAGE_PAD): number[] {
  // Ankle anchor in original footR local box [0..origW, 0..origH]: (664, 71.5)
  const ax = 664;
  const ay = 71.5;
  const scale = 0.84;
  const rot = -5 * DEG;
  const rc = Math.cos(rot) * scale;
  const rs = Math.sin(rot) * scale;
  // Compose RotateScaleAround(ax, ay) * FOOTA, shifted into padded canvas
  const a0 = rc * FOOTA[0] - rs * FOOTA[1];
  const b0 = rs * FOOTA[0] + rc * FOOTA[1];
  const c0 = rc * FOOTA[2] - rs * FOOTA[3];
  const d0 = rs * FOOTA[2] + rc * FOOTA[3];
  const tx0 = FOOTA[4] - ax;
  const ty0 = FOOTA[5] - ay;
  const e0 = ax + (rc * tx0 - rs * ty0) + pad.left;
  const f0 = ay + (rs * tx0 + rc * ty0) + pad.top;
  return [a0, b0, c0, d0, e0, f0];
}

export function applyCollapsedSideFootPose(I: PartRigInstance, toeBreakDeg = 0): void {
  if (I.key !== 'foot') return;
  const ps = I.ps;
  I.on.fill(1);
  I.ang.fill(0);
  I.dx.fill(0);
  I.dy.fill(0);

  // Pack tarsals & metatarsals tightly into the firm midfoot arch body (do not over-stretch),
  // while letting distal toe phalanges articulate forward of the metatarsal ball.
  for (let k = 0; k < ps.length; k++) {
    const p = ps[k];
    const cx = p.x + p.w * 0.5;
    const cy = p.y + p.h * 0.5;
    if (k === 10 || k === 11) {
      // Shift calcaneus & talus cup cleanly beneath tibial socket so heel locks into ankle
      I.dx[k] = k === 10 ? 175 - (cx - 1390) * 0.22 : 90 - (cx - 1430) * 0.22;
      I.dy[k] = k === 10 ? 240 : 202;
      I.ang[k] = k === 10 ? -5 : 0;
      continue;
    }

    const par = I.par[k];
    if (par < 0) {
      // Metatarsal or tarsal arch body: pack rays tightly onto medial sagittal plane (0.08 spread)
      const targetX = 1495 + (cx - 1495) * 0.08;
      I.dx[k] = targetX - cx;
      I.dy[k] = cy > 1500 ? -24 : 28;
    } else {
      // Toe phalanges past MTP ball: gentle longitudinal compaction + slight natural stagger
      I.dx[k] = (1495 - cx) * 0.14;
      I.dy[k] = -86;
    }
  }

  // Metatarsal ball articulation for heelLift / tiptoe (dorsiflex toes cleanly relative to arch body)
  for (const idx of FOOT_PROXIMAL_TOE_INDICES) {
    if (idx < I.ang.length) {
      I.ang[idx] = -toeBreakDeg;
    }
  }
  for (const midIdx of [13, 17, 20, 3, 8]) {
    if (midIdx < I.ang.length) {
      I.ang[midIdx] = -toeBreakDeg * 0.24;
    }
  }
  I.touched = 1;
}

export class PartRigManager {
  public inst: Record<string, PartRigInstance> = {};
  private parts: PartsManifest;
  private partLoadPromises: Partial<Record<'head' | 'hand' | 'foot', Promise<void>>> = {};
  private links = PART_LINKS.map((l) => ({ ...l }));
  private by: Record<string, RigNode> | null = null;

  constructor(parts: PartsManifest) {
    this.parts = parts;
  }

  public loadPartAssets(key: 'head' | 'hand' | 'foot'): Promise<void> {
    if (key === 'hand') {
      return Promise.resolve();
    }
    if (!this.partLoadPromises[key]) {
      const pieces = this.parts[key].views[0].pieces;
      this.partLoadPromises[key] = Promise.all(pieces.map((p) => decImage(p.src))).then((bms) => {
        pieces.forEach((p, i) => {
          p.bm = bms[i];
        });
      });
    }
    return this.partLoadPromises[key]!;
  }

  private mkInst(
    id: string,
    key: 'head' | 'hand' | 'foot',
    nid: string,
    mir: boolean,
    by: Record<string, RigNode>,
    onWake: () => void,
  ): void {
    const n = by[nid];
    if (!n || !n.pieces.length) return;
    const ps = this.parts[key].views[0].pieces;
    const fp = n.pieces[0];
    const on = ps.map((p) => (p.on ? 1 : 0));

    if (key === 'hand') {
      if (!fp.restBox) {
        fp.restBox = { x: fp.x, y: fp.y, w: fp.w, h: fp.h };
      }
      fp.gotzManaged = true;
      fp.x = n.piv[0] - GOTZ_STAGE_BOX.halfW;
      fp.y = n.piv[1] - GOTZ_STAGE_BOX.topPad;
      fp.w = GOTZ_STAGE_BOX.w;
      fp.h = GOTZ_STAGE_BOX.h;
    } else if (key === 'foot') {
      if (!fp.restBox) {
        fp.restBox = { x: fp.x, y: fp.y, w: fp.w, h: fp.h };
      }
      const rb = fp.restBox;
      fp.w = rb.w + FOOT_STAGE_PAD.left + FOOT_STAGE_PAD.right;
      fp.h = rb.h + FOOT_STAGE_PAD.top + FOOT_STAGE_PAD.bottom;
      fp.y = rb.y - FOOT_STAGE_PAD.top;
      if (mir) {
        // Mirror padding across footL ankle axis
        fp.x = rb.x - FOOT_STAGE_PAD.right;
      } else {
        fp.x = rb.x - FOOT_STAGE_PAD.left;
      }
    }

    let m: number[];
    if (key === 'foot') {
      const rb = fp.restBox ?? { w: fp.w, h: fp.h };
      m = buildCollapsedFootMatrix(rb.w, rb.h);
    } else if (key === 'hand') {
      m = [1, 0, 0, 1, 0, 0];
    } else {
      const q = ps.filter((p) => p.on);
      const x0 = Math.min(...q.map((p) => p.x));
      const y0 = Math.min(...q.map((p) => p.y));
      const x1 = Math.max(...q.map((p) => p.x + p.w));
      const y1 = Math.max(...q.map((p) => p.y + p.h));
      const a = fp.w / (x1 - x0);
      const d = fp.h / (y1 - y0);
      m = [a, 0, 0, d, -x0 * a, -y0 * d];
    }
    if (mir && key !== 'hand') {
      m = [-m[0], m[1], -m[2], m[3], fp.w - m[4], m[5]];
    }

    const idx: Record<string, number> = {};
    ps.forEach((p, k) => {
      idx[p.name] = k;
    });
    const par = new Int16Array(ps.length).fill(-1);
    const pv = new Float32Array(ps.length * 2);
    ps.forEach((p, k) => {
      pv[2 * k] = p.x + p.w / 2;
      pv[2 * k + 1] = p.y + p.h / 2;
    });

    if (key === 'foot') {
      for (const [childStr, parIdx] of Object.entries(FOOT_PARENT_BY_INDEX)) {
        const childIdx = Number(childStr);
        if (childIdx < ps.length && parIdx < ps.length) {
          par[childIdx] = parIdx;
        }
      }
      // Anchor metatarsal ball pivots near top edge of proximal toe bones for natural toe break
      for (const proxIdx of FOOT_PROXIMAL_TOE_INDICES) {
        if (proxIdx < ps.length) {
          const pp = ps[proxIdx];
          pv[2 * proxIdx] = pp.x + pp.w * 0.5;
          pv[2 * proxIdx + 1] = pp.y + 30;
        }
      }
    }

    if (key === 'head') {
      for (const c in FACE.tree) {
        const a = idx[c];
        const b = idx[FACE.tree[c]];
        if (a != null && b != null) par[a] = b;
      }
      for (const c in FACE.pivot) {
        const a = idx[c];
        const b = idx[FACE.pivot[c]];
        if (a != null && b != null) {
          pv[2 * a] = pv[2 * b];
          pv[2 * a + 1] = pv[2 * b + 1];
        }
      }
      for (const c in FACE.at) {
        const a = idx[c];
        if (a != null) {
          pv[2 * a] = FACE.at[c][0];
          pv[2 * a + 1] = FACE.at[c][1];
        }
      }
      for (const c in FACE.exc) {
        const a = idx[c];
        if (a != null) {
          pv[2 * a] += FACE.exc[c][0];
          pv[2 * a + 1] += FACE.exc[c][1];
        }
      }
    }

    const ord: number[] = [];
    const seen = new Uint8Array(ps.length);
    const vis = (k: number) => {
      if (seen[k]) return;
      seen[k] = 1;
      if (par[k] >= 0) vis(par[k]);
      ord.push(k);
    };
    ps.forEach((_p, k) => vis(k));

    const tree: Array<{ k: number; d: number }> = [];
    const walk = (k: number, d: number) => {
      tree.push({ k, d });
      ps.forEach((_p, j) => {
        if (par[j] === k) walk(j, d + 1);
      });
    };
    ps.forEach((_p, k) => {
      if (par[k] < 0) walk(k, 0);
    });

    const gotzMirror = key === 'hand' ? (id === 'handR' ? true : id === 'handL' ? false : mir) : false;
    const gotzDefault = key === 'hand' ? createDefaultGotzHandState(gotzMirror, 'Fist') : undefined;
    const mgr = this;

    const instObj: PartRigInstance = {
      id,
      key,
      fp,
      ps,
      m,
      par,
      pv,
      ord,
      tree,
      W: new Float64Array(6 * ps.length),
      flip: 0,
      title: key === 'hand' ? 'Gotz Hand Rig v2' : key === 'foot' ? 'Collapsed Side Foot' : this.parts[key].title,
      on0: on,
      on: Uint8Array.from(on),
      ang: new Float32Array(ps.length),
      dx: new Float32Array(ps.length),
      dy: new Float32Array(ps.length),
      touched: 0,
      h: '',
      q: 0,
      gotz: gotzDefault ? cloneGotzState(gotzDefault) : undefined,
      gotzDefault,
      propsModel: key === 'hand' ? 'anat' : undefined,
      reset() {
        this.on.set(this.on0);
        this.ang.fill(0);
        this.dx.fill(0);
        this.dy.fill(0);
        this.flip = 0;
        this.touched = 0;
        this.h = '';
        if (this.key === 'hand' && this.gotzDefault) {
          this.gotz = cloneGotzState(this.gotzDefault);
          this.propsModel = 'anat';
          mgr.bake(this, onWake);
          return;
        }
        if (this.key === 'foot') {
          applyCollapsedSideFootPose(this, 0);
          void mgr.loadPartAssets('foot').then(() => mgr.bake(this, onWake));
          return;
        }
        if (this.key === 'head') {
          void mgr.loadPartAssets('head').then(() => {
            if (fp.name === 'Front') {
              mgr.bake(this, onWake);
            }
          });
          return;
        }
        const sourceBm = (fp.full0 || fp.bm0) as (CanvasImageSource & { width: number; height: number }) | undefined;
        if (sourceBm) {
          setPieceBitmap(fp, sourceBm, onWake);
        }
      },
    };

    if (key === 'foot') {
      applyCollapsedSideFootPose(instObj, 0);
    }

    this.inst[id] = instObj;
  }

  private syncGotzTips(I: PartRigInstance, middleTipOffset: [number, number], thumbTipOffset: [number, number]): void {
    const by = this.by;
    if (!by) return;
    const side = I.id === 'handR' ? 'R' : I.id === 'handL' ? 'L' : null;
    if (!side) return;
    const hand = by['hand' + side];
    const fingerTip = by['fingerTip' + side];
    const thumbTip = by['thumbTip' + side];
    if (hand && fingerTip) {
      fingerTip.piv[0] = hand.piv[0] + middleTipOffset[0];
      fingerTip.piv[1] = hand.piv[1] + middleTipOffset[1];
      fingerTip.rest[0] = fingerTip.piv[0];
      fingerTip.rest[1] = fingerTip.piv[1];
    }
    if (hand && thumbTip) {
      thumbTip.piv[0] = hand.piv[0] + thumbTipOffset[0];
      thumbTip.piv[1] = hand.piv[1] + thumbTipOffset[1];
      thumbTip.rest[0] = thumbTip.piv[0];
      thumbTip.rest[1] = thumbTip.piv[1];
    }
  }

  public initAll(by: Record<string, RigNode>, onWake: () => void): void {
    this.by = by;
    for (const k in this.inst) delete this.inst[k];
    this.mkInst('head', 'head', 'head', false, by, onWake);
    this.mkInst('handR', 'hand', 'handR', false, by, onWake);
    this.mkInst('handL', 'hand', 'handL', true, by, onWake);
    this.mkInst('footR', 'foot', 'footR', false, by, onWake);
    this.mkInst('footL', 'foot', 'footL', true, by, onWake);
    if (this.inst.handR) this.bake(this.inst.handR, onWake);
    if (this.inst.handL) this.bake(this.inst.handL, onWake);
    if (this.inst.footR || this.inst.footL) {
      void this.loadPartAssets('foot').then(() => {
        if (this.inst.footR) this.bake(this.inst.footR, onWake);
        if (this.inst.footL) this.bake(this.inst.footL, onWake);
      });
    }
    if (this.inst.head) {
      void this.loadPartAssets('head').then(() => {
        const h = this.inst.head;
        if (h && h.fp.name === 'Front') {
          this.bake(h, onWake);
        }
      });
    }
    for (const l of this.links) {
      const I = this.inst[l.inst];
      l.k = I ? I.ps.findIndex((p) => p.name === l.name) : -1;
    }
  }

  public syncFootPlant(toeBreakDegR: number, toeBreakDegL: number, onWake: () => void): void {
    if (this.inst.footR) {
      applyCollapsedSideFootPose(this.inst.footR, toeBreakDegR);
      this.rebake(this.inst.footR, onWake);
    }
    if (this.inst.footL) {
      applyCollapsedSideFootPose(this.inst.footL, toeBreakDegL);
      this.rebake(this.inst.footL, onWake);
    }
  }

  public syncLinks(by: Record<string, RigNode>, onWake: () => void): void {
    for (const l of this.links) {
      const I = this.inst[l.inst];
      const n = by[l.node];
      if (I && n && l.k >= 0 && Math.abs(I.ang[l.k] - n.ang) > 1e-3) {
        I.ang[l.k] = n.ang;
        I.touched = 1;
        this.rebake(I, onWake);
      }
    }
  }

  public linkOut(I: PartRigInstance, by: Record<string, RigNode>): void {
    for (const l of this.links) {
      if (l.inst === I.id && l.k >= 0 && by[l.node]) {
        by[l.node].ang = I.ang[l.k];
      }
    }
  }

  public static pfk(I: PartRigInstance): void {
    const W = I.W;
    for (const k of I.ord) {
      const a = I.ang[k] * DEG;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const px = I.pv[2 * k];
      const py = I.pv[2 * k + 1];
      const e = px - c * px + s * py + I.dx[k];
      const f = py - s * px - c * py + I.dy[k];
      const q = I.par[k];
      const o = 6 * k;
      if (q < 0) {
        W[o] = c;
        W[o + 1] = s;
        W[o + 2] = -s;
        W[o + 3] = c;
        W[o + 4] = e;
        W[o + 5] = f;
      } else {
        const t = 6 * q;
        W[o] = W[t] * c + W[t + 2] * s;
        W[o + 1] = W[t + 1] * c + W[t + 3] * s;
        W[o + 2] = -W[t] * s + W[t + 2] * c;
        W[o + 3] = -W[t + 1] * s + W[t + 3] * c;
        W[o + 4] = W[t] * e + W[t + 2] * f + W[t + 4];
        W[o + 5] = W[t + 1] * e + W[t + 3] * f + W[t + 5];
      }
    }
  }

  private bake(I: PartRigInstance, onWake: () => void): void {
    if (I.key === 'hand' && I.gotz) {
      const props = I.propsModel === 'leg' ? GOTZ_PROPS_LEG : GOTZ_PROPS_ANAT;
      const baked = bakeGotzHandToCanvas(I.gotz, props);
      setPieceBitmap(I.fp, baked.canvas as CanvasImageSource & { width: number; height: number }, onWake);
      this.syncGotzTips(I, baked.middleTipOffset, baked.thumbTipOffset);
      return;
    }

    PartRigManager.pfk(I);
    const fp = I.fp;
    const s = Math.min(1, 512 / Math.max(fp.w, fp.h));
    const c = mkCanvas(Math.ceil(fp.w * s), Math.ceil(fp.h * s));
    const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const m = I.flip ? [-I.m[0], I.m[1], -I.m[2], I.m[3], fp.w - I.m[4], I.m[5]] : I.m;
    const W = I.W;
    for (let k = I.ps.length - 1; k >= 0; k--) {
      if (!I.on[k]) continue;
      const p = I.ps[k];
      if (!p.bm) continue;
      const o = 6 * k;
      g.setTransform(
        s * (m[0] * W[o] + m[2] * W[o + 1]),
        s * (m[1] * W[o] + m[3] * W[o + 1]),
        s * (m[0] * W[o + 2] + m[2] * W[o + 3]),
        s * (m[1] * W[o + 2] + m[3] * W[o + 3]),
        s * (m[0] * W[o + 4] + m[2] * W[o + 5] + m[4]),
        s * (m[1] * W[o + 4] + m[3] * W[o + 5] + m[5]),
      );
      g.drawImage(p.bm, p.x, p.y, p.w, p.h);
    }
    const commitBaked = (b: CanvasImageSource & { width: number; height: number }) => {
      if (I.key === 'head') {
        if (!I.touched) {
          fp.full0 = b;
          fp.bm0 = b;
          setFrontSkullCache(b);
        }
        if (fp.name !== 'Front') return;
      }
      setPieceBitmap(fp, b, onWake);
    };
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(c).then(commitBaked);
    } else {
      commitBaked(c as CanvasImageSource & { width: number; height: number });
    }
  }

  public rebake = (I: PartRigInstance, onWake?: () => void): void => {
    const h =
      I.key === 'hand' && I.gotz
        ? `${I.propsModel || 'anat'}|${JSON.stringify(I.gotz)}`
        : `${I.flip}${I.on.join('')}${I.ang.join()}${I.dx.join()}${I.dy.join()}`;
    if (I.q || h === I.h) return;
    I.h = h;
    I.q = 1;
    requestAnimationFrame(() => {
      I.q = 0;
      if (I.key === 'hand' && I.gotz) {
        this.bake(I, onWake || (() => {}));
      } else {
        this.loadPartAssets(I.key).then(() => this.bake(I, onWake || (() => {})));
      }
    });
  };

  public partSnap(): Record<string, number[]> {
    const o: Record<string, number[]> = {};
    for (const id in this.inst) {
      const I = this.inst[id];
      if (I.touched) o[id] = Array.from(I.ang);
    }
    return o;
  }

  public partApply(A: Keyframe, B: Keyframe, t: number, onWake: () => void): void {
    const sh = (d: number) => ((d + 540) % 360) - 180;
    for (const id in A.s || {}) {
      const I = this.inst[id];
      const a = A.s?.[id];
      if (!I || !a) continue;
      const b = B.s?.[id] || a;
      for (let k = 0; k < a.length; k++) {
        I.ang[k] = a[k] + sh(b[k] - a[k]) * t;
      }
      I.touched = 1;
      this.rebake(I, onWake);
    }
  }
}

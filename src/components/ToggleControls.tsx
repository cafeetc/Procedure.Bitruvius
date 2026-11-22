import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
} from 'lucide-react';

export type ToggleAccent = 'purple' | 'green' | 'red';

interface TapHoldButtonProps {
  children: React.ReactNode;
  title?: string;
  ariaPressed?: boolean;
  ariaLabel?: string;
  className?: string;
  holdingClassName?: string;
  onTap: () => void;
  onHoldStep?: (dtSec: number) => void;
  holdDelayMs?: number;
}

export const TapHoldButton: React.FC<TapHoldButtonProps> = ({
  children,
  title,
  ariaPressed,
  ariaLabel,
  className = '',
  holdingClassName = 'ring-1 ring-[#22c55e] border-[#22c55e]',
  onTap,
  onHoldStep,
  holdDelayMs = 240,
}) => {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const activeHoldRef = useRef(false);
  const lastFrameRef = useRef(0);
  const pressedRef = useRef(false);
  const holdStepRef = useRef(onHoldStep);
  const tapRef = useRef(onTap);

  holdStepRef.current = onHoldStep;
  tapRef.current = onTap;

  const stopHold = useCallback((shouldFireTap: boolean) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const wasHolding = activeHoldRef.current;
    const wasPressed = pressedRef.current;
    activeHoldRef.current = false;
    pressedRef.current = false;
    setHolding(false);
    if (wasPressed && !wasHolding && shouldFireTap) {
      tapRef.current();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pressedRef.current = true;
    activeHoldRef.current = false;

    if (!holdStepRef.current) return;

    timerRef.current = window.setTimeout(() => {
      if (!pressedRef.current || !holdStepRef.current) return;
      activeHoldRef.current = true;
      setHolding(true);
      lastFrameRef.current = performance.now();

      const loop = (now: number) => {
        if (!activeHoldRef.current || !holdStepRef.current) return;
        const dt = Math.min(0.06, Math.max(0.004, (now - lastFrameRef.current) / 1000));
        lastFrameRef.current = now;
        holdStepRef.current(dt);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    }, holdDelayMs);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      tapRef.current();
    }
  };

  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onPointerDown={handlePointerDown}
      onPointerUp={() => stopHold(true)}
      onPointerLeave={() => stopHold(false)}
      onPointerCancel={() => stopHold(false)}
      onKeyDown={handleKeyDown}
      className={`${className} ${holding ? holdingClassName : ''}`}
    >
      {children}
    </button>
  );
};

interface ToggleSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  accent?: ToggleAccent;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  label,
  description,
  checked,
  onChange,
  accent = 'purple',
}) => {
  const activeBg =
    accent === 'green'
      ? 'bg-[#22c55e] border-[#4ade80]'
      : accent === 'red'
      ? 'bg-[#ef4444] border-[#f87171]'
      : 'bg-[#7e22ce] border-[#a855f7]';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center justify-between gap-3 rounded-md border border-[#2b2f36] bg-[#0e0f11] px-3 py-2 text-left transition-colors hover:border-[#414752] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a855f7]"
    >
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-[#e6e8ec]">{label}</div>
        {description && (
          <div className="mt-0.5 text-[11px] leading-snug text-[#8b919c]">{description}</div>
        )}
      </div>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full border transition-colors ${
          checked ? activeBg : 'border-[#2b2f36] bg-[#191b1f]'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-[#e6e8ec] transition-transform duration-150 ${
            checked ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
};

interface SegmentedOption<T extends string | number> {
  id: T;
  label: string;
  title?: string;
  onHoldStep?: (dtSec: number) => void;
}

interface SegmentedToggleProps<T extends string | number> {
  label: string;
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4 | 5 | 6;
  accent?: ToggleAccent;
  defaultHoldStep?: (id: T, dtSec: number) => void;
}

export function SegmentedToggle<T extends string | number>({
  label,
  value,
  options,
  onChange,
  columns = 3,
  accent = 'purple',
  defaultHoldStep,
}: SegmentedToggleProps<T>) {
  const gridCols =
    columns === 2
      ? 'grid-cols-2'
      : columns === 4
      ? 'grid-cols-4'
      : columns === 5
      ? 'grid-cols-5'
      : columns === 6
      ? 'grid-cols-6'
      : 'grid-cols-3';

  const activeCls =
    accent === 'green'
      ? 'border-[#22c55e] bg-[#22c55e]/20 text-[#86efac]'
      : accent === 'red'
      ? 'border-[#ef4444] bg-[#ef4444]/20 text-[#fca5a5]'
      : 'border-[#a855f7] bg-[#7e22ce]/30 text-[#f3e8ff]';

  return (
    <div className="space-y-1.5">
      <div className="text-[11.5px] font-medium text-[#8b919c]">{label}</div>
      <div className={`grid ${gridCols} gap-1.5`} role="group" aria-label={label}>
        {options.map((opt) => {
          const active = opt.id === value;
          const holdHandler =
            opt.onHoldStep || (defaultHoldStep ? (dt: number) => defaultHoldStep(opt.id, dt) : undefined);
          return (
            <TapHoldButton
              key={String(opt.id)}
              title={opt.title}
              ariaPressed={active}
              onTap={() => onChange(opt.id)}
              onHoldStep={holdHandler}
              className={`min-h-[34px] truncate whitespace-nowrap rounded border px-2 py-1 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a855f7] ${
                active
                  ? activeCls
                  : 'border-[#2b2f36] bg-[#0e0f11] text-[#8b919c] hover:border-[#414752] hover:text-[#e6e8ec]'
              }`}
            >
              {opt.label}
            </TapHoldButton>
          );
        })}
      </div>
    </div>
  );
}

export interface CompassSlot {
  label: string;
  active?: boolean;
  title?: string;
  onTap: () => void;
  onHoldStep?: (dtSec: number) => void;
}

interface CompassControlProps {
  centerLabel: string;
  centerSublabel?: string;
  centerActive?: boolean;
  onCenterTap?: () => void;
  up?: CompassSlot;
  down?: CompassSlot;
  left?: CompassSlot;
  right?: CompassSlot;
  topLeft?: CompassSlot;
  topRight?: CompassSlot;
  bottomLeft?: CompassSlot;
  bottomRight?: CompassSlot;
  accent?: ToggleAccent;
}

export const CompassControl: React.FC<CompassControlProps> = ({
  centerLabel,
  centerSublabel,
  centerActive = false,
  onCenterTap,
  up,
  down,
  left,
  right,
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  accent = 'purple',
}) => {
  const activeCls =
    accent === 'green'
      ? 'border-[#22c55e] bg-[#22c55e]/20 text-[#86efac]'
      : accent === 'red'
      ? 'border-[#ef4444] bg-[#ef4444]/20 text-[#fca5a5]'
      : 'border-[#a855f7] bg-[#7e22ce]/30 text-[#f3e8ff]';

  const renderSlot = (slot: CompassSlot | undefined, icon: React.ReactNode) => {
    if (!slot) {
      return <div className="min-h-[36px]" aria-hidden="true" />;
    }
    return (
      <TapHoldButton
        title={slot.title ? `${slot.title} (Tap: generate · Hold: live nudge)` : 'Tap: generate · Hold: live nudge'}
        ariaPressed={slot.active}
        onTap={slot.onTap}
        onHoldStep={slot.onHoldStep}
        className={`flex min-h-[36px] flex-col items-center justify-center gap-0.5 rounded border px-1.5 py-1 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a855f7] ${
          slot.active
            ? activeCls
            : 'border-[#2b2f36] bg-[#0e0f11] text-[#b4bac4] hover:border-[#414752] hover:text-[#e6e8ec]'
        }`}
      >
        {icon}
        <span className="truncate whitespace-nowrap text-[10.5px] font-medium leading-none">
          {slot.label}
        </span>
      </TapHoldButton>
    );
  };

  return (
    <div
      className="grid grid-cols-3 gap-1.5 rounded-md border border-[#2b2f36] bg-[#141619] p-2"
      role="group"
      aria-label={`${centerLabel} compass`}
    >
      {renderSlot(topLeft, <ArrowUpLeft className="h-3 w-3 opacity-80" aria-hidden="true" />)}
      {renderSlot(up, <ArrowUp className="h-3 w-3 opacity-80" aria-hidden="true" />)}
      {renderSlot(topRight, <ArrowUpRight className="h-3 w-3 opacity-80" aria-hidden="true" />)}

      {renderSlot(left, <ArrowLeft className="h-3 w-3 opacity-80" aria-hidden="true" />)}

      {onCenterTap ? (
        <button
          type="button"
          onClick={onCenterTap}
          title={`Reset ${centerLabel} to default / Auto`}
          className={`flex min-h-[36px] flex-col items-center justify-center rounded border px-1.5 py-1 text-center transition-colors ${
            centerActive
              ? 'border-[#22c55e] bg-[#22c55e]/15 text-[#dcfce7]'
              : 'border-[#2b2f36] bg-[#191b1f] text-[#e6e8ec] hover:border-[#414752]'
          }`}
        >
          <span className="whitespace-nowrap text-[11px] font-semibold leading-tight">
            {centerLabel}
          </span>
          {centerSublabel && (
            <span className="mt-0.5 max-w-full truncate font-mono-tabular text-[9.5px] text-[#8b919c]">
              {centerSublabel}
            </span>
          )}
        </button>
      ) : (
        <div className="flex min-h-[36px] flex-col items-center justify-center rounded border border-[#2b2f36] bg-[#191b1f] px-1.5 py-1 text-center">
          <span className="whitespace-nowrap text-[11px] font-semibold leading-tight text-[#e6e8ec]">
            {centerLabel}
          </span>
          {centerSublabel && (
            <span className="mt-0.5 max-w-full truncate font-mono-tabular text-[9.5px] text-[#8b919c]">
              {centerSublabel}
            </span>
          )}
        </div>
      )}

      {renderSlot(right, <ArrowRight className="h-3 w-3 opacity-80" aria-hidden="true" />)}

      {renderSlot(bottomLeft, <span className="text-[9px] text-[#8b919c]">·</span>)}
      {renderSlot(down, <ArrowDown className="h-3 w-3 opacity-80" aria-hidden="true" />)}
      {renderSlot(bottomRight, <span className="text-[9px] text-[#8b919c]">·</span>)}
    </div>
  );
};

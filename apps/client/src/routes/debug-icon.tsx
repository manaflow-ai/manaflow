import CmuxLogo from "@/components/logo/cmux-logo";
import CmuxLogoMark from "@/components/logo/cmux-logo-mark";
import CmuxLogoMarkAnimated from "@/components/logo/cmux-logo-mark-animated";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/debug-icon")({
  component: DebugIconPage,
});

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
      <span className="w-28 select-none">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-neutral-600"
      />
      <input
        type="number"
        value={Number(value.toFixed(2))}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-24 rounded-md border border-neutral-200 bg-white px-2 py-1 text-neutral-900 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      />
    </label>
  );
}

function DebugIconPage() {
  const [tx, setTx] = useState<number>(87.2);
  const [ty, setTy] = useState<number>(62.7);
  const [scale, setScale] = useState<number>(0.2);
  const [showGuides, setShowGuides] = useState<boolean>(true);
  const [showBorder, setShowBorder] = useState<boolean>(true);
  const [showWordmark, setShowWordmark] = useState<boolean>(true);
  const [pulse, setPulse] = useState<number>(2.9);

  const code = useMemo(
    () =>
      `// CmuxLogo props\n< CmuxLogo markTranslateX={${tx.toFixed(2)}} markTranslateY={${ty.toFixed(
        2
      )}} markScale={${scale.toFixed(3)}} showGuides={${showGuides}} showBorder={${showBorder}} showWordmark={${showWordmark}} />`,
    [tx, ty, scale, showGuides, showBorder, showWordmark]
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Debug Icon
      </h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center justify-center h-40">
            <CmuxLogo
              height={84}
              markTranslateX={tx}
              markTranslateY={ty}
              markScale={scale}
              showGuides={showGuides}
              showBorder={showBorder}
              showWordmark={showWordmark}
              aria-label="manaflow logo"
            />
          </div>
          <div className="mt-2 text-center text-xs text-neutral-500 dark:text-neutral-500">
            Light background
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-900 p-4 dark:border-neutral-800 dark:bg-black">
          <div className="flex items-center justify-center h-40">
            <CmuxLogo
              height={84}
              markTranslateX={tx}
              markTranslateY={ty}
              markScale={scale}
              showGuides={showGuides}
              showBorder={showBorder}
              showWordmark={showWordmark}
              aria-label="manaflow logo dark"
            />
          </div>
          <div className="mt-2 text-center text-xs text-neutral-400 dark:text-neutral-600">
            Dark background
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <NumberInput
          label="Translate X"
          value={tx}
          onChange={setTx}
          min={0}
          max={300}
          step={0.1}
        />
        <NumberInput
          label="Translate Y"
          value={ty}
          onChange={setTy}
          min={0}
          max={200}
          step={0.1}
        />
        <NumberInput
          label="Scale"
          value={scale}
          onChange={setScale}
          min={0.05}
          max={0.5}
          step={0.001}
        />

        <div className="flex items-center gap-6 pt-2 text-sm">
          <label className="flex items-center gap-2 text-neutral-800 dark:text-neutral-200">
            <input
              type="checkbox"
              checked={showGuides}
              onChange={(e) => setShowGuides(e.target.checked)}
            />
            <span>Show guides</span>
          </label>
          <label className="flex items-center gap-2 text-neutral-800 dark:text-neutral-200">
            <input
              type="checkbox"
              checked={showBorder}
              onChange={(e) => setShowBorder(e.target.checked)}
            />
            <span>Show border</span>
          </label>
          <label className="flex items-center gap-2 text-neutral-800 dark:text-neutral-200">
            <input
              type="checkbox"
              checked={showWordmark}
              onChange={(e) => setShowWordmark(e.target.checked)}
            />
            <span>Show wordmark</span>
          </label>

          <button
            type="button"
            onClick={() => {
              setTx(87.2);
              setTy(62.7);
              setScale(0.2);
            }}
            className="ml-auto rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 shadow-sm hover:bg-neutral-50 active:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center justify-center h-40">
            <CmuxLogoMark height={84} showGuides showBorder />
          </div>
          <div className="mt-2 text-center text-xs text-neutral-500 dark:text-neutral-500">
            Mark only (guides)
          </div>
        </div>
        <pre className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
{code}
        </pre>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center justify-center h-40">
            <CmuxLogoMarkAnimated height={96} duration={pulse} aria-label="animated mark" />
          </div>
          <div className="mt-2 text-center text-xs text-neutral-500 dark:text-neutral-500">
            Animated glow (light)
          </div>
        </div>
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-900 p-4 dark:border-neutral-800 dark:bg-black">
          <div className="flex items-center justify-center h-40">
            <CmuxLogoMarkAnimated height={96} duration={pulse} aria-label="animated mark dark" />
          </div>
          <div className="mt-2 text-center text-xs text-neutral-400 dark:text-neutral-600">
            Animated glow (dark)
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <NumberInput label="Pulse (s)" value={pulse} onChange={setPulse} min={1} max={8} step={0.1} />
      </div>
    </div>
  );
}

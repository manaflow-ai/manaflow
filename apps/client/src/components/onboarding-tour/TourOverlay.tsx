import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useOnboardingTourSafe } from "./OnboardingTourContext";
import type { TourStep } from "./tour-steps";

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TourOverlay() {
  const tour = useOnboardingTourSafe();
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);

  const updateTargetRect = useCallback(() => {
    if (!tour?.currentStep) {
      setTargetRect(null);
      return;
    }

    const target = document.querySelector(tour.currentStep.target);
    if (!target) {
      setTargetRect(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    const padding = tour.currentStep.spotlightPadding ?? 4;

    setTargetRect({
      top: rect.top - padding,
      left: rect.left - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    });
  }, [tour?.currentStep]);

  // Update rect on step change and window resize/scroll
  useEffect(() => {
    if (!tour?.isActive) {
      setTargetRect(null);
      return;
    }

    updateTargetRect();

    // Update on resize and scroll
    window.addEventListener("resize", updateTargetRect);
    window.addEventListener("scroll", updateTargetRect, true);

    // Also use ResizeObserver for more reliable updates
    const target = tour.currentStep
      ? document.querySelector(tour.currentStep.target)
      : null;
    let resizeObserver: ResizeObserver | null = null;

    if (target) {
      resizeObserver = new ResizeObserver(updateTargetRect);
      resizeObserver.observe(target);
    }

    return () => {
      window.removeEventListener("resize", updateTargetRect);
      window.removeEventListener("scroll", updateTargetRect, true);
      resizeObserver?.disconnect();
    };
  }, [tour?.isActive, tour?.currentStep, updateTargetRect]);

  if (!tour?.isActive || !tour.currentStep) {
    return null;
  }

  return createPortal(
    <AnimatePresence mode="wait">
      <motion.div
        key="tour-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[var(--z-modal)]"
        style={{ pointerEvents: "none" }}
      >
        {/* Dark overlay with spotlight cutout */}
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "auto" }}
          onClick={tour.endTour}
        >
          <defs>
            <mask id="spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {targetRect && (
                <motion.rect
                  initial={{ opacity: 0 }}
                  animate={{
                    x: targetRect.left,
                    y: targetRect.top,
                    width: targetRect.width,
                    height: targetRect.height,
                    opacity: 1,
                  }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  rx="8"
                  ry="8"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.6)"
            mask="url(#spotlight-mask)"
          />
        </svg>

        {/* Tooltip */}
        {targetRect && (
          <TourTooltip
            step={tour.currentStep}
            targetRect={targetRect}
            stepIndex={tour.currentStepIndex}
            totalSteps={tour.totalSteps}
            onNext={tour.nextStep}
            onPrev={tour.prevStep}
            onSkip={tour.endTour}
          />
        )}
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

interface TourTooltipProps {
  step: TourStep;
  targetRect: TargetRect;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

function TourTooltip({
  step,
  targetRect,
  stepIndex,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
}: TourTooltipProps) {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [arrowPosition, setArrowPosition] = useState<{
    side: "top" | "bottom" | "left" | "right";
    offset: number;
  }>({ side: "top", offset: 50 });

  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === totalSteps - 1;

  useEffect(() => {
    const tooltipWidth = 320;
    const tooltipHeight = 180; // Approximate
    const gap = 12;
    const viewportPadding = 16;

    let top = 0;
    let left = 0;
    let arrowSide: "top" | "bottom" | "left" | "right" = "top";

    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;

    switch (step.placement) {
      case "bottom":
        top = targetRect.top + targetRect.height + gap;
        left = targetCenterX - tooltipWidth / 2;
        arrowSide = "top";
        break;
      case "top":
        top = targetRect.top - tooltipHeight - gap;
        left = targetCenterX - tooltipWidth / 2;
        arrowSide = "bottom";
        break;
      case "left":
        top = targetCenterY - tooltipHeight / 2;
        left = targetRect.left - tooltipWidth - gap;
        arrowSide = "right";
        break;
      case "right":
        top = targetCenterY - tooltipHeight / 2;
        left = targetRect.left + targetRect.width + gap;
        arrowSide = "left";
        break;
    }

    // Constrain to viewport
    const maxLeft = window.innerWidth - tooltipWidth - viewportPadding;
    const maxTop = window.innerHeight - tooltipHeight - viewportPadding;

    left = Math.max(viewportPadding, Math.min(left, maxLeft));
    top = Math.max(viewportPadding, Math.min(top, maxTop));

    // Calculate arrow offset based on target center relative to tooltip
    let arrowOffset = 50;
    if (arrowSide === "top" || arrowSide === "bottom") {
      arrowOffset = ((targetCenterX - left) / tooltipWidth) * 100;
      arrowOffset = Math.max(10, Math.min(90, arrowOffset));
    } else {
      arrowOffset = ((targetCenterY - top) / tooltipHeight) * 100;
      arrowOffset = Math.max(10, Math.min(90, arrowOffset));
    }

    setPosition({ top, left });
    setArrowPosition({ side: arrowSide, offset: arrowOffset });
  }, [targetRect, step.placement]);

  const arrowStyles = {
    top: {
      top: -6,
      left: `${arrowPosition.offset}%`,
      transform: "translateX(-50%) rotate(45deg)",
    },
    bottom: {
      bottom: -6,
      left: `${arrowPosition.offset}%`,
      transform: "translateX(-50%) rotate(45deg)",
    },
    left: {
      left: -6,
      top: `${arrowPosition.offset}%`,
      transform: "translateY(-50%) rotate(45deg)",
    },
    right: {
      right: -6,
      top: `${arrowPosition.offset}%`,
      transform: "translateY(-50%) rotate(45deg)",
    },
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="absolute w-80 bg-white dark:bg-neutral-800 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700"
      style={{
        top: position.top,
        left: position.left,
        pointerEvents: "auto",
      }}
    >
      {/* Arrow */}
      <div
        className="absolute w-3 h-3 bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
        style={{
          ...arrowStyles[arrowPosition.side],
          borderWidth:
            arrowPosition.side === "top" || arrowPosition.side === "left"
              ? "1px 0 0 1px"
              : "0 1px 1px 0",
        }}
      />

      {/* Content */}
      <div className="p-4">
        {/* Header with skip button */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {step.title}
          </h3>
          <button
            onClick={onSkip}
            className="p-1 -m-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            aria-label="Skip tour"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Description */}
        <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
          {step.content}
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100 dark:border-neutral-700/50 bg-neutral-50/50 dark:bg-neutral-800/50 rounded-b-xl">
        {/* Progress indicator */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-1.5 h-1.5 rounded-full transition-colors",
                i === stepIndex
                  ? "bg-blue-500"
                  : i < stepIndex
                    ? "bg-blue-300 dark:bg-blue-700"
                    : "bg-neutral-300 dark:bg-neutral-600"
              )}
            />
          ))}
          <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
            {stepIndex + 1} of {totalSteps}
          </span>
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-2">
          {!isFirstStep && (
            <button
              onClick={onPrev}
              className="flex items-center gap-1 px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}
          <button
            onClick={onNext}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
              isLastStep
                ? "bg-green-500 hover:bg-green-600 text-white"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            )}
          >
            {isLastStep ? (
              "Get started"
            ) : (
              <>
                Next
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

import { createContext, useContext } from "react";
import type { TourStep } from "./tour-steps";

export interface OnboardingTourContextValue {
  /** Whether the tour is currently active */
  isActive: boolean;
  /** Current step index */
  currentStepIndex: number;
  /** Current step data */
  currentStep: TourStep | null;
  /** Total number of steps */
  totalSteps: number;
  /** Start the tour */
  startTour: () => void;
  /** Go to next step */
  nextStep: () => void;
  /** Go to previous step */
  prevStep: () => void;
  /** Skip/end the tour */
  endTour: () => void;
  /** Whether onboarding has been completed before */
  hasCompletedOnboarding: boolean;
  /** Reset onboarding state (for testing) */
  resetOnboarding: () => void;
}

export const OnboardingTourContext =
  createContext<OnboardingTourContextValue | null>(null);

export function useOnboardingTour(): OnboardingTourContextValue {
  const context = useContext(OnboardingTourContext);
  if (!context) {
    throw new Error(
      "useOnboardingTour must be used within an OnboardingTourProvider"
    );
  }
  return context;
}

/**
 * Safe version that returns null if not within provider
 * Useful for components that may or may not be in tour context
 */
export function useOnboardingTourSafe(): OnboardingTourContextValue | null {
  return useContext(OnboardingTourContext);
}

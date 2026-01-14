import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { OnboardingTourContext } from "./OnboardingTourContext";
import { TourOverlay } from "./TourOverlay";
import { STORAGE_KEY, TOUR_STEPS } from "./tour-steps";

interface OnboardingTourProviderProps {
  children: ReactNode;
  /** Auto-start tour for new users (default: true) */
  autoStart?: boolean;
  /** Delay before auto-starting tour in ms (default: 1000) */
  autoStartDelay?: number;
}

export function OnboardingTourProvider({
  children,
  autoStart = true,
  autoStartDelay = 1500,
}: OnboardingTourProviderProps) {
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const currentStep = useMemo(() => {
    if (!isActive || currentStepIndex >= TOUR_STEPS.length) {
      return null;
    }
    return TOUR_STEPS[currentStepIndex];
  }, [isActive, currentStepIndex]);

  const startTour = useCallback(() => {
    setCurrentStepIndex(0);
    setIsActive(true);
  }, []);

  const nextStep = useCallback(() => {
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      // Tour completed
      setIsActive(false);
      setHasCompletedOnboarding(true);
      try {
        localStorage.setItem(STORAGE_KEY, "true");
      } catch (error) {
        console.error("Failed to save onboarding state:", error);
      }
    }
  }, [currentStepIndex]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  }, [currentStepIndex]);

  const endTour = useCallback(() => {
    setIsActive(false);
    setHasCompletedOnboarding(true);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch (error) {
      console.error("Failed to save onboarding state:", error);
    }
  }, []);

  const resetOnboarding = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error("Failed to reset onboarding state:", error);
    }
    setHasCompletedOnboarding(false);
    setCurrentStepIndex(0);
    setIsActive(false);
  }, []);

  // Auto-start tour for new users
  useEffect(() => {
    if (!autoStart || hasCompletedOnboarding) {
      return;
    }

    const timer = setTimeout(() => {
      // Check if user is on dashboard and the tour targets exist
      const taskInput = document.querySelector("[data-tour='task-input']");
      if (taskInput) {
        startTour();
      }
    }, autoStartDelay);

    return () => clearTimeout(timer);
  }, [autoStart, autoStartDelay, hasCompletedOnboarding, startTour]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endTour();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        nextStep();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevStep();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, endTour, nextStep, prevStep]);

  const contextValue = useMemo(
    () => ({
      isActive,
      currentStepIndex,
      currentStep,
      totalSteps: TOUR_STEPS.length,
      startTour,
      nextStep,
      prevStep,
      endTour,
      hasCompletedOnboarding,
      resetOnboarding,
    }),
    [
      isActive,
      currentStepIndex,
      currentStep,
      startTour,
      nextStep,
      prevStep,
      endTour,
      hasCompletedOnboarding,
      resetOnboarding,
    ]
  );

  return (
    <OnboardingTourContext.Provider value={contextValue}>
      {children}
      <TourOverlay />
    </OnboardingTourContext.Provider>
  );
}

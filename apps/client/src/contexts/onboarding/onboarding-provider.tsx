import { env } from "@/client-env";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  OnboardingContext,
  type OnboardingContextValue,
  type OnboardingStepId,
} from "./onboarding-context";
import { ONBOARDING_STEPS } from "./onboarding-steps";

const STORAGE_KEY = "cmux-onboarding";

interface StoredOnboardingState {
  completed: boolean;
  completedSteps: OnboardingStepId[];
  skipped: boolean;
}

function loadStoredState(): StoredOnboardingState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredOnboardingState;
      return {
        completed: parsed.completed ?? false,
        completedSteps: parsed.completedSteps ?? [],
        skipped: parsed.skipped ?? false,
      };
    }
  } catch (err) {
    console.error("Failed to load onboarding state:", err);
  }
  return { completed: false, completedSteps: [], skipped: false };
}

function saveStoredState(state: StoredOnboardingState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save onboarding state:", err);
  }
}

interface OnboardingProviderProps {
  children: ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<OnboardingStepId>>(
    () => new Set(loadStoredState().completedSteps)
  );
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    () => loadStoredState().completed || loadStoredState().skipped
  );
  // Filter steps based on environment - skip cloud-mode in web mode
  const filteredSteps = useMemo(() => {
    if (env.NEXT_PUBLIC_WEB_MODE) {
      return ONBOARDING_STEPS.filter((step) => step.id !== "cloud-mode");
    }
    return ONBOARDING_STEPS;
  }, []);

  // NOTE: Auto-start is now handled by the dashboard component
  // which checks if the user has any tasks before showing onboarding

  const currentStep = useMemo(() => {
    if (!isOnboardingActive) return null;
    return filteredSteps[currentStepIndex] ?? null;
  }, [isOnboardingActive, currentStepIndex, filteredSteps]);

  const startOnboarding = useCallback(() => {
    setCurrentStepIndex(0);
    setIsOnboardingActive(true);
  }, []);

  const nextStep = useCallback(() => {
    const currentId = filteredSteps[currentStepIndex]?.id;
    if (currentId) {
      setCompletedSteps((prev) => {
        const next = new Set(prev);
        next.add(currentId);
        return next;
      });
    }

    if (currentStepIndex < filteredSteps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      // Last step - complete the onboarding
      setIsOnboardingActive(false);
      setHasCompletedOnboarding(true);
      const allStepIds = filteredSteps.map((s) => s.id);
      saveStoredState({
        completed: true,
        completedSteps: allStepIds,
        skipped: false,
      });
    }
  }, [currentStepIndex, filteredSteps]);

  const previousStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  }, [currentStepIndex]);

  const skipOnboarding = useCallback(() => {
    setIsOnboardingActive(false);
    setHasCompletedOnboarding(true);
    saveStoredState({
      completed: false,
      completedSteps: Array.from(completedSteps),
      skipped: true,
    });
  }, [completedSteps]);

  const completeOnboarding = useCallback(() => {
    setIsOnboardingActive(false);
    setHasCompletedOnboarding(true);
    const allStepIds = filteredSteps.map((s) => s.id);
    saveStoredState({
      completed: true,
      completedSteps: allStepIds,
      skipped: false,
    });
  }, [filteredSteps]);

  const goToStep = useCallback((stepId: OnboardingStepId) => {
    const index = filteredSteps.findIndex((s) => s.id === stepId);
    if (index >= 0) {
      setCurrentStepIndex(index);
      setIsOnboardingActive(true);
    }
  }, [filteredSteps]);

  const resetOnboarding = useCallback(() => {
    setCompletedSteps(new Set());
    setHasCompletedOnboarding(false);
    setCurrentStepIndex(0);
    setIsOnboardingActive(false);
    saveStoredState({ completed: false, completedSteps: [], skipped: false });
  }, []);

  // Save completed steps when they change
  useEffect(() => {
    if (completedSteps.size > 0 && !hasCompletedOnboarding) {
      const stored = loadStoredState();
      saveStoredState({
        ...stored,
        completedSteps: Array.from(completedSteps),
      });
    }
  }, [completedSteps, hasCompletedOnboarding]);


  const contextValue: OnboardingContextValue = useMemo(
    () => ({
      isOnboardingActive,
      currentStepIndex,
      currentStep,
      steps: filteredSteps,
      completedSteps,
      hasCompletedOnboarding,
      startOnboarding,
      nextStep,
      previousStep,
      skipOnboarding,
      completeOnboarding,
      goToStep,
      resetOnboarding,
    }),
    [
      isOnboardingActive,
      currentStepIndex,
      currentStep,
      filteredSteps,
      completedSteps,
      hasCompletedOnboarding,
      startOnboarding,
      nextStep,
      previousStep,
      skipOnboarding,
      completeOnboarding,
      goToStep,
      resetOnboarding,
    ]
  );

  return (
    <OnboardingContext.Provider value={contextValue}>
      {children}
    </OnboardingContext.Provider>
  );
}

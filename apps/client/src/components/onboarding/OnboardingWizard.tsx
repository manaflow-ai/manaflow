import { useState, useCallback, useEffect } from "react";
import { api } from "@cmux/convex/api";
import { useMutation, useQuery } from "convex/react";
import { ThemeSelectionStep } from "./steps/ThemeSelectionStep";
import { GitHubConnectStep } from "./steps/GitHubConnectStep";
import { EnvironmentsExplanationStep } from "./steps/EnvironmentsExplanationStep";
import { AgentConfigStep } from "./steps/AgentConfigStep";
import { CompleteStep } from "./steps/CompleteStep";

export type OnboardingStep = "theme" | "github" | "agents" | "environments" | "complete";

interface OnboardingWizardProps {
  open: boolean;
  onComplete: () => void;
  teamSlugOrId: string;
}

const STEP_ORDER: OnboardingStep[] = [
  "theme",
  "github",
  "agents",
  "environments",
  "complete",
];

function getStepIndex(step: OnboardingStep): number {
  return STEP_ORDER.indexOf(step);
}

export function OnboardingWizard({
  open,
  onComplete,
  teamSlugOrId,
}: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("theme");
  const [completedSteps, setCompletedSteps] = useState<Set<OnboardingStep>>(
    new Set()
  );

  const updateOnboardingStep = useMutation(api.onboarding.updateOnboardingStep);
  const completeOnboarding = useMutation(api.onboarding.completeOnboarding);
  const onboardingState = useQuery(api.onboarding.getOnboardingState);

  // Track connected GitHub accounts
  const [hasGitHubConnection, setHasGitHubConnection] = useState(false);

  useEffect(() => {
    if (open && onboardingState?.onboardingStep) {
      const step = onboardingState.onboardingStep as OnboardingStep;
      if (STEP_ORDER.includes(step)) {
        setCurrentStep(step);
      }
    }
  }, [open, onboardingState]);

  const handleNext = useCallback(async () => {
    const currentIndex = getStepIndex(currentStep);
    if (currentIndex < STEP_ORDER.length - 1) {
      const nextStep = STEP_ORDER[currentIndex + 1];
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      setCurrentStep(nextStep);
      await updateOnboardingStep({ step: nextStep });
    }
  }, [currentStep, updateOnboardingStep]);

  const handleSkip = useCallback(async () => {
    await handleNext();
  }, [handleNext]);

  const handleComplete = useCallback(async () => {
    await completeOnboarding({});
    onComplete();
  }, [completeOnboarding, onComplete]);

  const handleGitHubConnected = useCallback(() => {
    setHasGitHubConnection(true);
  }, []);

  const renderStep = () => {
    switch (currentStep) {
      case "theme":
        return <ThemeSelectionStep onNext={handleNext} />;
      case "github":
        return (
          <GitHubConnectStep
            teamSlugOrId={teamSlugOrId}
            onNext={handleNext}
            onSkip={handleSkip}
            onGitHubConnected={handleGitHubConnected}
            hasConnection={hasGitHubConnection}
          />
        );
      case "agents":
        return <AgentConfigStep onNext={handleNext} onSkip={handleSkip} teamSlugOrId={teamSlugOrId} />;
      case "environments":
        return (
          <EnvironmentsExplanationStep
            onNext={handleNext}
            teamSlugOrId={teamSlugOrId}
          />
        );
      case "complete":
        return (
          <CompleteStep
            onComplete={handleComplete}
            teamSlugOrId={teamSlugOrId}
            hasGitHubConnection={hasGitHubConnection}
          />
        );
    }
  };

  if (!open) return null;

  // Theme selection step should always be dark
  const isThemeStep = currentStep === "theme";

  return (
    <div className={`fixed inset-0 z-50 ${isThemeStep ? "bg-neutral-950" : "bg-white dark:bg-neutral-950"}`}>
      {/* Main content - centered */}
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl">
          {renderStep()}
        </div>
      </div>

      {/* Step indicators (dots) */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2">
        <div className="flex items-center gap-2">
          {STEP_ORDER.map((step) => {
            const isActive = step === currentStep;
            const isCompleted = completedSteps.has(step);

            return (
              <div
                key={step}
                className={`h-2 rounded-full transition-all ${
                  isActive
                    ? isThemeStep ? "w-8 bg-white" : "w-8 bg-neutral-900 dark:bg-white"
                    : isCompleted
                      ? isThemeStep ? "w-2 bg-white/60" : "w-2 bg-neutral-900/60 dark:bg-white/60"
                      : isThemeStep ? "w-2 bg-white/20" : "w-2 bg-neutral-900/20 dark:bg-white/20"
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

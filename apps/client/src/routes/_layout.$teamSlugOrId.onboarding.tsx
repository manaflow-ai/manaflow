import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { api } from "@cmux/convex/api";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";

export const Route = createFileRoute("/_layout/$teamSlugOrId/onboarding")({
  component: OnboardingPage,
  beforeLoad: async ({ params }) => {
    // Check if user has already completed onboarding
    const onboardingState = await convexQueryClient.convexClient.query(
      api.onboarding.getOnboardingState,
      {}
    );

    if (onboardingState?.hasCompletedOnboarding) {
      // User has already completed onboarding, redirect to dashboard
      throw redirect({
        to: "/$teamSlugOrId/dashboard",
        params: { teamSlugOrId: params.teamSlugOrId },
      });
    }
  },
});

function OnboardingPage() {
  const { teamSlugOrId } = Route.useParams();
  const navigate = useNavigate();

  const handleComplete = () => {
    navigate({
      to: "/$teamSlugOrId/dashboard",
      params: { teamSlugOrId },
    });
  };

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <OnboardingWizard
        open={true}
        onComplete={handleComplete}
        teamSlugOrId={teamSlugOrId}
      />
    </div>
  );
}

import { Button } from "@/components/ui/button";

interface EnvironmentsExplanationStepProps {
  onNext: () => void;
  teamSlugOrId: string;
}

export function EnvironmentsExplanationStep({
  onNext,
}: EnvironmentsExplanationStepProps) {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Header */}
      <div className="mb-12">
        <h1 className="mb-4 text-4xl font-semibold text-neutral-900 dark:text-white">
          Workspace Modes
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-md mx-auto">
          cmux runs agents in isolated containers. Choose between local Docker or cloud-based workspaces.
        </p>
      </div>

      {/* Workspace Modes */}
      <div className="mb-12 w-full max-w-lg space-y-4 text-left">
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 p-6 backdrop-blur">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-2">
            Local Mode
          </h3>
          <p className="text-base text-neutral-600 dark:text-neutral-400">
            Runs Docker containers on your machine. Fast and free, but requires Docker Desktop.
          </p>
        </div>

        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 p-6 backdrop-blur">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-2">
            Cloud Mode
          </h3>
          <p className="text-base text-neutral-600 dark:text-neutral-400">
            Runs in cloud-based containers. Works without Docker, but requires an environment configuration.
          </p>
        </div>
      </div>

      {/* Continue Button */}
      <Button
        onClick={onNext}
        className="h-12 px-8 text-base bg-blue-600 hover:bg-blue-700 text-white"
      >
        Continue
      </Button>
    </div>
  );
}

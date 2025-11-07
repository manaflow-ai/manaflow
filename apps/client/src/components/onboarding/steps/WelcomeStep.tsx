import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Code, Zap, Users } from "lucide-react";

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 ring-4 ring-primary/10">
        <Sparkles className="h-10 w-10 text-primary" />
      </div>

      <h2 className="mb-3 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
        Welcome to cmux
      </h2>

      <p className="mb-8 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
        cmux is a powerful platform that spawns coding agents like Claude Code, Codex CLI,
        and more in parallel across multiple tasks. Let's get you set up in just a few steps.
      </p>

      <div className="mb-10 grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-3">
        <FeatureCard
          icon={Code}
          title="Connect GitHub"
          description="Link your GitHub account to access your repositories"
        />
        <FeatureCard
          icon={Zap}
          title="Sync Repos"
          description="Select the repositories you want to work with"
        />
        <FeatureCard
          icon={Users}
          title="Set Up Environments"
          description="Learn how to create isolated development environments"
        />
      </div>

      <Button size="lg" onClick={onNext} className="gap-2 px-8">
        Get Started
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Code;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="mb-2 font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h3>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {description}
      </p>
    </div>
  );
}

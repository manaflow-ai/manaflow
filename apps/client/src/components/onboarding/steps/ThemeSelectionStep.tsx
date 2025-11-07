import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme/use-theme";
import { useState } from "react";

interface ThemeSelectionStepProps {
  onNext: () => void;
}

export function ThemeSelectionStep({ onNext }: ThemeSelectionStepProps) {
  const { theme, setTheme } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState<"light" | "dark">(
    theme === "light" ? "light" : "dark"
  );

  const handleContinue = () => {
    setTheme(selectedTheme);
    onNext();
  };

  return (
    <div className="flex flex-col items-center text-center">
      {/* Header */}
      <div className="mb-12">
        <h1 className="mb-4 text-4xl font-semibold text-white">
          Choose your style
        </h1>
        <p className="text-lg text-neutral-400 max-w-md mx-auto">
          Change your theme at any time via the command menu or settings.
        </p>
      </div>

      {/* Theme Options */}
      <div className="mb-12 flex gap-6">
        {/* Light Theme */}
        <button
          onClick={() => setSelectedTheme("light")}
          className={`group relative rounded-xl border-2 transition-all ${
            selectedTheme === "light"
              ? "border-blue-500"
              : "border-neutral-800 hover:border-neutral-700"
          }`}
        >
          <div className="w-72 p-6">
            {/* Light theme preview */}
            <div className="mb-4 rounded-lg border border-neutral-300 bg-white p-4 shadow-sm">
              <div className="mb-2 h-2 w-16 rounded bg-neutral-800" />
              <div className="space-y-1.5">
                <div className="h-1.5 w-full rounded bg-neutral-200" />
                <div className="h-1.5 w-full rounded bg-neutral-200" />
                <div className="h-1.5 w-3/4 rounded bg-neutral-200" />
              </div>
            </div>
            <div className="text-lg font-medium text-white">Light</div>
          </div>
        </button>

        {/* Dark Theme */}
        <button
          onClick={() => setSelectedTheme("dark")}
          className={`group relative rounded-xl border-2 transition-all ${
            selectedTheme === "dark"
              ? "border-blue-500"
              : "border-neutral-800 hover:border-neutral-700"
          }`}
        >
          <div className="w-72 p-6">
            {/* Dark theme preview */}
            <div className="mb-4 rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-sm">
              <div className="mb-2 h-2 w-16 rounded bg-white" />
              <div className="space-y-1.5">
                <div className="h-1.5 w-full rounded bg-neutral-700" />
                <div className="h-1.5 w-full rounded bg-neutral-700" />
                <div className="h-1.5 w-3/4 rounded bg-neutral-700" />
              </div>
            </div>
            <div className="text-lg font-medium text-white">Dark</div>
          </div>
        </button>
      </div>

      {/* Continue Button */}
      <Button
        onClick={handleContinue}
        className="h-12 px-8 text-base bg-blue-600 hover:bg-blue-700 text-white"
      >
        Continue
      </Button>
    </div>
  );
}

"use client";

import { useState } from "react";
import FakeCmuxUI, { type FakeCmuxUIVariant } from "./FakeCmuxUI";

const steps: {
  number: number;
  title: string;
  subtitle: string;
  bullets: string[];
  browserTitle: string;
  variant: FakeCmuxUIVariant;
}[] = [
  {
    number: 1,
    title: "Configure run context",
    subtitle: "Set up the repo or environment for your task, configure scripts, and pick the agents you want to run.",
    bullets: [
      "Configure dev and maintenance scripts on the Environments page or link the repo you need.",
      "Select the branches that apply to the task before launching agents.",
      "Choose which agents should execute in parallel for the run.",
    ],
    browserTitle: "cmux — Configure Environment",
    variant: "dashboard",
  },
  {
    number: 2,
    title: "Watch agents execute",
    subtitle: "Follow each agent's VS Code instance as they work; completion shows a green check and the crown evaluator picks the best run.",
    bullets: [
      "Monitor the dedicated VS Code sessions to see agents progress in real time.",
      "Wait for every task card to reach the green check before moving ahead.",
      "Review the crown evaluator's selection once all agents finish.",
    ],
    browserTitle: "cmux — Agent Execution",
    variant: "tasks",
  },
  {
    number: 3,
    title: "Verify diffs and previews",
    subtitle: "Open the diff viewer, confirm tests, and use the auto-started preview environments to validate changes.",
    bullets: [
      "Inspect code updates in the git diff viewer for each agent.",
      "Review test and command output captured during the run.",
      "Launch the preview environment dev servers to confirm everything works.",
    ],
    browserTitle: "cmux — Diff Viewer",
    variant: "diff",
  },
  {
    number: 4,
    title: "Ship directly from cmux",
    subtitle: "Create your pull request inside cmux and finish the merge once verification is done.",
    bullets: [
      "Open a pull request from the cmux review surface when you're ready.",
      "Attach verification notes and confirm required checks before finishing.",
      "Merge the pull request in cmux to wrap the run.",
    ],
    browserTitle: "cmux — Create Pull Request",
    variant: "pr",
  },
];

function WorkflowPreview({ variant }: { variant: FakeCmuxUIVariant }) {
  const scale = 0.5;
  const frameWidth = 980;
  const frameHeight = 560;
  return (
    <div className="relative w-full h-[280px] overflow-hidden bg-neutral-50 dark:bg-neutral-900">
      <div
        className="origin-top-left"
        style={{
          transform: `scale(${scale})`,
          width: `${frameWidth}px`,
          height: `${frameHeight}px`,
        }}
      >
        <FakeCmuxUI
          variant={variant}
          draggable={false}
          showDragHint={false}
          className="pointer-events-none"
        />
      </div>
    </div>
  );
}

export default function Workflow() {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <section className="py-32 bg-[#fafafa] dark:bg-[#0a0a0a] relative">
      <div className="relative z-10 max-w-7xl mx-auto px-6">
        {/* Section header */}
        <div className="text-left mb-6">
          <h2 className="text-3xl md:text-5xl mb-6 leading-tight text-neutral-900 dark:text-white tracking-tighter" style={{ fontWeight: 420 }}>
            A guided workflow from <span className="text-purple-800 dark:text-purple-400">start</span> to <span className="text-blue-600 dark:text-blue-400">finish.</span>
          </h2>
          <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-3xl">
            Each phase inside cmux is integral to keep the process fast and confidence high while coding agents execute tasks in parallel.
          </p>
        </div>

        {/* Workflow steps */}
        <div className="mt-16 grid lg:grid-cols-2 gap-12 items-start">
          {/* Left: Steps list */}
          <div className="space-y-4">
            {steps.map((step, index) => (
              <div
                key={step.number}
                className={`cursor-pointer transition-all duration-500 flex gap-4 ${
                  activeStep === index
                    ? "opacity-100"
                    : "opacity-50 hover:opacity-70"
                }`}
                onClick={() => setActiveStep(index)}
              >
                {/* Thin chevron indicator */}
                <div className="flex-shrink-0 pt-1">
                  <svg
                    width="8"
                    height="20"
                    viewBox="0 0 12 20"
                    className={`transition-colors duration-300 ${
                      activeStep === index ? "text-purple-800 dark:text-purple-400" : "text-neutral-300 dark:text-neutral-600"
                    }`}
                  >
                    <polygon
                      points="0,0 8,10 0,20 1.5,20 9.5,10 1.5,0"
                      fill="currentColor"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className={`font-medium mb-1 transition-all duration-300 ${
                    activeStep === index ? "text-xl text-neutral-900 dark:text-white" : "text-base text-neutral-700 dark:text-neutral-300"
                  }`}>
                    {step.title}
                  </h3>
                  <div className={`overflow-hidden transition-all duration-500 ${
                    activeStep === index ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                  }`}>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4 mt-2">
                      {step.subtitle}
                    </p>
                    <ul className="space-y-2">
                      {step.bullets.map((bullet, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                          <span className="text-blue-500 mt-0.5">•</span>
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right: Browser preview */}
          <div className="lg:sticky lg:top-32">
            <div className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
              {/* Browser header */}
              <div className="bg-gradient-to-b from-neutral-100 to-neutral-50 dark:from-neutral-800 dark:to-neutral-900 px-4 py-2 flex items-center border-b border-neutral-200 dark:border-neutral-700">
                <div className="flex gap-2 mr-4">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                  <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="bg-white dark:bg-neutral-800 rounded-md px-4 py-1 text-xs text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 flex items-center gap-2">
                    <svg className="w-3 h-3 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    {steps[activeStep].browserTitle}
                  </div>
                </div>
                <div className="w-16" />
              </div>
              {/* Browser content */}
              <WorkflowPreview variant={steps[activeStep].variant} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

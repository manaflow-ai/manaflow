"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { SetupStep, type SetupStepConfig, type StepStatus } from "./setup-step";

const SETUP_STEPS: SetupStepConfig[] = [
  {
    id: "git-pull",
    title: "Git pull",
    description: "What command should we use to pull the latest code? This will be run during session startup.",
    defaultValue: "cd ~/repos/{repo} && git pull && git submodule update --init --recursive",
    placeholder: "git pull && git submodule update --init --recursive",
    docsUrl: "https://docs.cmux.dev/setup/git-pull",
  },
  {
    id: "secrets",
    title: "Configure secrets",
    description: "Add environment variables and API keys needed to run your project.",
    optional: true,
    placeholder: "OPENAI_API_KEY=sk-...\nDATABASE_URL=...",
  },
  {
    id: "install-deps",
    title: "Install dependencies",
    description: "Command to install your project dependencies (npm install, pip install, etc.)",
    defaultValue: "npm install",
    placeholder: "npm install",
  },
  {
    id: "dev-server",
    title: "Start dev server",
    description: "Command to start your development server for previews.",
    optional: true,
    defaultValue: "npm run dev",
    placeholder: "npm run dev",
  },
  {
    id: "additional-notes",
    title: "Additional notes",
    description: "Any special instructions for the AI agent (browser testing notes, preview screenshot tips, etc.)",
    optional: true,
    placeholder: "The main page is at /dashboard. Login uses test@example.com / password123...",
  },
];

interface SetupWorkspaceProps {
  repo: string;
  vscodeUrl: string;
  teamSlugOrId: string;
  onComplete: (config: Record<string, string>) => void;
  onFinishLater: () => void;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function SetupWorkspace({
  repo,
  vscodeUrl,
  teamSlugOrId: _teamSlugOrId,
  onComplete,
  onFinishLater,
}: SetupWorkspaceProps) {
  const repoName = repo.split("/").pop() || repo;

  // Initialize step values with defaults
  const [stepValues, setStepValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const step of SETUP_STEPS) {
      initial[step.id] = step.defaultValue?.replace("{repo}", repoName) || "";
    }
    return initial;
  });

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  // Chat state
  const [chatOpen, setChatOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      role: "assistant",
      content: "Let's set up your machine together. I'll help you install dependencies, get authenticated, and configure everything needed to work in this repository.\n\nI'll guide you through the setup process and execute commands as needed.",
    },
  ]);
  const [chatInput, setChatInput] = useState("I'm ready. Let's proceed with the setup steps.");
  const [isStreaming, setIsStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const getStepStatus = (stepId: string, index: number): StepStatus => {
    if (completedSteps.has(stepId)) return "completed";
    if (index === currentStepIndex) return "current";
    return "pending";
  };

  const handleStepChange = useCallback((stepId: string, value: string) => {
    setStepValues((prev) => ({ ...prev, [stepId]: value }));
  }, []);

  const handleVerifyStep = useCallback(async (stepId: string) => {
    // Mark step as completed and move to next
    setCompletedSteps((prev) => new Set([...prev, stepId]));
    const stepIndex = SETUP_STEPS.findIndex((s) => s.id === stepId);
    if (stepIndex < SETUP_STEPS.length - 1) {
      setCurrentStepIndex(stepIndex + 1);
    }
  }, []);

  const handleSendMessage = useCallback(async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || isStreaming) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: trimmed,
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsStreaming(true);

    // Call the chat API
    try {
      const response = await fetch("/api/onboarding/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: [
            ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: trimmed },
          ],
          step: SETUP_STEPS[currentStepIndex]?.id,
          repo,
        }),
      });

      if (!response.ok) throw new Error("Chat failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const assistantId = (Date.now() + 1).toString();
      setChatMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                fullContent += parsed.delta.text;
                setChatMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: fullContent } : m))
                );
              }
            } catch {
              // skip
            }
          }
        }
      }
    } catch (err) {
      console.error("Chat error:", err);
      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "I'm here to help with setup. What would you like to configure?",
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }, [chatInput, isStreaming, chatMessages, currentStepIndex, repo]);

  const handleFinishSetup = () => {
    onComplete(stepValues);
  };

  const completedCount = completedSteps.size;

  return (
    <div className="min-h-dvh bg-[#0d1117] text-neutral-100 flex">
      {/* Left sidebar - steps */}
      <div className="w-72 border-r border-neutral-800 flex flex-col">
        <div className="p-4 border-b border-neutral-800">
          <h2 className="text-sm font-medium text-neutral-100">Repository setup</h2>
          <p className="text-xs text-neutral-500 mt-1">Configure {repoName}</p>
          <p className="text-xs text-neutral-600 mt-2">{completedCount}/{SETUP_STEPS.length} steps</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {SETUP_STEPS.map((step, index) => (
            <SetupStep
              key={step.id}
              step={step}
              status={getStepStatus(step.id, index)}
              value={stepValues[step.id] || ""}
              onChange={(v) => handleStepChange(step.id, v)}
              onVerify={() => handleVerifyStep(step.id)}
            />
          ))}
        </div>

        <div className="p-4 border-t border-neutral-800 flex gap-2">
          <button
            onClick={handleFinishSetup}
            className="flex-1 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded transition"
          >
            Finish setup
          </button>
          <button
            onClick={onFinishLater}
            className="flex-1 px-4 py-2 text-sm font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded transition"
          >
            Finish later
          </button>
        </div>
      </div>

      {/* Main content - VSCode iframe */}
      <div className="flex-1 flex flex-col relative">
        {/* Tab bar */}
        <div className="h-10 border-b border-neutral-800 flex items-center px-4 gap-4">
          <button className="text-sm text-neutral-100 border-b-2 border-neutral-100 pb-2 -mb-[1px]">
            Machine
          </button>
          <button className="text-sm text-neutral-500 pb-2 -mb-[1px]">
            Browser
          </button>
        </div>

        {/* VSCode iframe */}
        <div className="flex-1 relative">
          <iframe
            src={vscodeUrl}
            className="absolute inset-0 w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
          />
        </div>

        {/* Chat overlay */}
        {chatOpen && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[600px] max-w-[90%] bg-[#1c2128] border border-neutral-700 rounded-xl shadow-2xl overflow-hidden">
            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-neutral-200">Setup Assistant</span>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="text-neutral-500 hover:text-neutral-300 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Chat messages */}
            <div className="max-h-48 overflow-y-auto p-4 space-y-3">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-neutral-800 text-neutral-200"
                    }`}
                  >
                    {msg.content || <span className="text-neutral-500">...</span>}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div className="border-t border-neutral-700 p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                  placeholder="Ask for help with setup..."
                  disabled={isStreaming}
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600 disabled:opacity-50"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={isStreaming || !chatInput.trim()}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Collapsed chat button */}
        {!chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 bg-[#1c2128] border border-neutral-700 rounded-full text-sm text-neutral-300 hover:text-white hover:border-neutral-600 transition shadow-lg"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Setup Assistant</span>
          </button>
        )}

        {/* Command hint */}
        <div className="absolute bottom-4 right-4 text-xs text-neutral-600">
          {chatOpen ? "" : "⌘K to generate a command"}
        </div>
      </div>
    </div>
  );
}

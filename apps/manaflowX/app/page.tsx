"use client";

import { useQuery, useAction } from "convex/react";
import { useUser } from "@stackframe/stack";
import Link from "next/link";
import { api } from "../convex/_generated/api";
import { useState, useCallback } from "react";
import { RepositoryPicker } from "@/components/RepositoryPicker";

async function triggerSignupWorkflow(email: string) {
  const response = await fetch("/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return response.json();
}

export default function Home() {
  const user = useUser();
  const data = useQuery(api.myFunctions.listTasks, { limit: 20 });
  const startWorkflow = useAction(api.actions.startWorkflow);
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);

  const handleReposSelected = useCallback((repos: string[]) => {
    setSelectedRepos(repos);
  }, []);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setIsSubmitting(true);
    try {
      // Trigger the Workflow DevKit workflow
      await triggerSignupWorkflow(content);
      // Also create a task in Convex
      await startWorkflow({ content });
      setContent("");
    } catch (error) {
      console.error("Failed to start workflow:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!data) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
          <div
            className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
            style={{ animationDelay: "0.1s" }}
          ></div>
          <div
            className="w-2 h-2 bg-gray-600 rounded-full animate-bounce"
            style={{ animationDelay: "0.2s" }}
          ></div>
          <p className="ml-2 text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  const { viewer, tasks } = data;

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-[600px] mx-auto border-x border-gray-800 min-h-screen">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-gray-800 p-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Home</h1>
          {!user ? (
            <Link
              href="/sign-in"
              className="bg-white text-black font-bold py-1.5 px-4 rounded-full hover:bg-gray-200 transition-colors"
            >
              Sign in
            </Link>
          ) : null}
        </div>

        {/* Input Area */}
        <div className="p-4 border-b border-gray-800 flex gap-4">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-sm font-bold">
              {viewer ? viewer[0].toUpperCase() : "?"}
            </div>
          </div>
          <div className="flex-grow">
            <textarea
              className="w-full bg-transparent text-xl placeholder-gray-500 focus:outline-none resize-none py-2"
              placeholder="What's happening?"
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            {/* Selected repos display */}
            {selectedRepos.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {selectedRepos.map((repo) => (
                  <span
                    key={repo}
                    className="inline-flex items-center gap-1 text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-full"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                    </svg>
                    {repo}
                    <button
                      type="button"
                      onClick={() => setSelectedRepos(selectedRepos.filter(r => r !== repo))}
                      className="ml-0.5 hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center mt-2 border-t border-gray-800 pt-3">
              <div className="flex gap-2 text-blue-400">
                {/* Repo picker button */}
                <button
                  type="button"
                  onClick={() => setShowRepoPicker(!showRepoPicker)}
                  className={`p-1.5 rounded-full hover:bg-blue-900/20 transition-colors ${showRepoPicker ? "bg-blue-900/30" : ""}`}
                  title="Add repositories"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                  </svg>
                </button>
              </div>
              <button
                disabled={!content.trim() || isSubmitting}
                onClick={handleSubmit}
                className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-1.5 px-4 rounded-full transition-colors"
              >
                {isSubmitting ? "Posting..." : "Post"}
              </button>
            </div>

            {/* Repository Picker */}
            {showRepoPicker && user && (
              <div className="mt-4 border-t border-gray-800 pt-4">
                <RepositoryPicker
                  onReposSelected={handleReposSelected}
                  showHeader={false}
                />
              </div>
            )}
          </div>
        </div>

        {/* Feed */}
        <div>
          {tasks.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No tasks yet. Start a workflow above!
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task._id}
                className="p-4 border-b border-gray-800 hover:bg-gray-900/30 transition-colors cursor-pointer"
              >
                <div className="flex gap-3">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-xs">
                      TASK
                    </div>
                  </div>
                  <div className="flex-grow">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold hover:underline">
                        {task.type}
                      </span>
                      <span className="text-gray-500 text-sm">
                        · {new Date(task.createdAt).toLocaleDateString()}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ml-auto ${
                          task.priority === "critical"
                            ? "bg-red-900 text-red-200"
                            : task.priority === "high"
                              ? "bg-orange-900 text-orange-200"
                              : "bg-gray-800 text-gray-300"
                        }`}
                      >
                        {task.priority}
                      </span>
                    </div>
                    <p className="text-gray-200 whitespace-pre-wrap mb-2">
                      {task.content}
                    </p>
                    <div className="flex justify-between text-gray-500 text-sm max-w-md">
                      <span className="hover:text-blue-400 transition-colors">
                        {task.replyCount} replies
                      </span>
                      <span className="hover:text-green-400 transition-colors">
                        {task.descendantCount} descendants
                      </span>
                      <span className="hover:text-pink-400 transition-colors">
                        {task.reactionCount} reactions
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

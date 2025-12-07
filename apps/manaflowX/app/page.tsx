"use client";

import { useQuery, useAction } from "convex/react";
import { useUser } from "@stackframe/stack";
import Link from "next/link";
import { api } from "../convex/_generated/api";
import { useState } from "react";
import { RepoPickerDropdown } from "@/components/RepoPickerDropdown";

async function triggerPostWorkflow(content: string) {
  const response = await fetch("/api/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return response.json();
}

export default function Home() {
  const user = useUser();
  const data = useQuery(api.myFunctions.listTasks, { limit: 20 });
  const startWorkflow = useAction(api.actions.startWorkflow);
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setIsSubmitting(true);
    try {
      // Trigger the Workflow DevKit workflow
      await triggerPostWorkflow(content);
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
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <div className="flex justify-between items-center mt-2 border-t border-gray-800 pt-3">
              <div className="flex gap-2 items-center">
                {/* Repo picker dropdown */}
                {user && (
                  <RepoPickerDropdown
                    selectedRepo={selectedRepo}
                    onRepoSelect={setSelectedRepo}
                  />
                )}
              </div>
              <button
                disabled={!content.trim() || isSubmitting}
                onClick={handleSubmit}
                className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-1.5 px-4 rounded-full transition-colors"
              >
                {isSubmitting ? "Posting..." : "Post"}
              </button>
            </div>
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

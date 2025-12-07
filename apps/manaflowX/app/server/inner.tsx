"use client";

import { Preloaded, useMutation, usePreloadedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function Home({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.myFunctions.listTasks>;
}) {
  const data = usePreloadedQuery(preloaded);
  const createTask = useMutation(api.myFunctions.createTask);
  return (
    <>
      <div className="flex flex-col gap-4 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 p-6 rounded-xl shadow-md">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">
          Tasks
        </h2>
        <code className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-300 dark:border-slate-600 overflow-x-auto">
          <pre className="text-sm text-slate-700 dark:text-slate-300">
            {JSON.stringify(data, null, 2)}
          </pre>
        </code>
      </div>
      <button
        className="bg-slate-700 hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 text-white px-6 py-3 rounded-lg mx-auto cursor-pointer transition-all duration-200 shadow-md hover:shadow-lg font-medium"
        onClick={() => {
          void createTask({
            title: "New Task",
            content: "Task created at " + new Date().toLocaleString(),
            type: "feedback",
          });
        }}
      >
        Create a task
      </button>
    </>
  );
}

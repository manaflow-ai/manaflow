import Home from "./inner";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import Image from "next/image";

export default async function ServerPage() {
  const preloaded = await preloadQuery(api.myFunctions.listNumbers, {
    count: 3,
  });

  const data = preloadedQueryResult(preloaded);

  return (
    <main className="p-8 flex flex-col gap-6 mx-auto max-w-2xl">
      <div className="flex items-center justify-center gap-4">
        <div className="flex items-center gap-4">
          <Image
            src="/convex.svg"
            alt="Convex Logo"
            width={48}
            height={48}
          />
          <div className="w-px h-12 bg-slate-300 dark:bg-slate-600"></div>
          <Image
            src="/nextjs-icon-light-background.svg"
            alt="Next.js Logo"
            width={48}
            height={48}
            className="dark:hidden"
          />
          <Image
            src="/nextjs-icon-dark-background.svg"
            alt="Next.js Logo"
            width={48}
            height={48}
            className="hidden dark:block"
          />
        </div>
        <h1 className="text-4xl font-bold text-slate-800 dark:text-slate-200">
          Convex + Next.js
        </h1>
      </div>
      <div className="flex flex-col gap-4 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 p-6 rounded-xl shadow-md">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">
          Non-reactive server-loaded data
        </h2>
        <code className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-300 dark:border-slate-600 overflow-x-auto">
          <pre className="text-sm text-slate-700 dark:text-slate-300">
            {JSON.stringify(data, null, 2)}
          </pre>
        </code>
      </div>
      <Home preloaded={preloaded} />
    </main>
  );
}

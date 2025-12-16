import Link from "next/link";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-900">
      <div className="max-w-md w-full">
        <div className="border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-6 w-6 text-rose-600 flex-shrink-0 mt-0.5 dark:text-rose-500" />
            <div className="flex-1">
              <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                Pull Request Not Found
              </h1>
              <p className="mt-3 text-sm text-neutral-700 leading-relaxed dark:text-neutral-300">
                The pull request could not be found. It may not exist, or you may not have access to view it.
              </p>
              <div className="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
                <Link
                  href="/"
                  className="text-sm font-medium text-neutral-900 hover:text-neutral-700 underline dark:text-neutral-100 dark:hover:text-neutral-300"
                >
                  Return to home
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

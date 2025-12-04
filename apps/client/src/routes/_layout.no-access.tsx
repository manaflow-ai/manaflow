import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isElectron } from "@/lib/electron";
import { createFileRoute, Link } from "@tanstack/react-router";
import type React from "react";
import { z } from "zod";

const noAccessSearchSchema = z.object({
  team: z.string().optional(),
});

export const Route = createFileRoute("/_layout/no-access")({
  validateSearch: noAccessSearchSchema,
  component: NoAccessPage,
});

function NoAccessPage() {
  const { team } = Route.useSearch();

  return (
    <div className="min-h-dvh w-full bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6">
      {isElectron ? (
        <div
          className="fixed top-0 left-0 right-0 h-[24px]"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
      ) : null}
      <div className="mx-auto w-full max-w-xl">
        <Card className="border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/70 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-neutral-900 dark:text-neutral-50">
              Access Restricted
            </CardTitle>
            <CardDescription className="text-neutral-600 dark:text-neutral-400">
              You don&apos;t have access to this workspace
              {team ? ` (${team})` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4 text-sm text-neutral-700 dark:text-neutral-300">
              <p>
                The <strong>Open Workspace</strong> and{" "}
                <strong>Open Dev Browser</strong> links require you to be a
                member of the team that owns this repository&apos;s cmux
                configuration.
              </p>

              <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4">
                <p className="font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                  Want to use cmux on your own repos?
                </p>
                <p className="text-neutral-600 dark:text-neutral-400">
                  You can set up cmux on repositories you have access to by
                  creating a team and connecting your GitHub repositories.
                </p>
              </div>

              <p className="text-neutral-500 dark:text-neutral-500">
                <strong>Note:</strong> The <em>Diff Heatmap</em> feature is
                available to anyone with access to the GitHub repository and
                does not require team membership.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button asChild variant="default">
                <Link to="/team-picker">Go to Team Picker</Link>
              </Button>
              <Button asChild variant="outline">
                <a
                  href="https://cmux.sh"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Learn more about cmux
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

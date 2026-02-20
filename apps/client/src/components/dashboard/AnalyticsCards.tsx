import { api } from "@cmux/convex/api";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { memo, useId, useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

type MetricCardProps = {
  label: string;
  total: number;
  daily: number[];
  accentColor: string;
  accentColorDark: string;
};

function MetricCard({
  label,
  total,
  daily,
  accentColor,
  accentColorDark,
}: MetricCardProps) {
  const id = useId();
  const gradientId = `analytics-gradient-${id}`;

  const chartData = useMemo(() => {
    const today = new Date();
    return daily.map((count, i) => {
      const date = new Date(today);
      date.setDate(date.getDate() - (6 - i));
      return {
        day: date.toLocaleDateString("en-US", { weekday: "short" }),
        count,
      };
    });
  }, [daily]);

  const maxCount = Math.max(...daily, 1);

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-neutral-200 dark:border-neutral-700/60 bg-white dark:bg-neutral-800/50 px-4 pt-3.5 pb-1 overflow-hidden">
      <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400 tracking-tight">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
        {total.toLocaleString()}
      </span>
      <div className="h-14 w-full -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  className="[stop-color:var(--accent)] dark:[stop-color:var(--accent-dark)]"
                  stopOpacity={0.25}
                  style={
                    {
                      "--accent": accentColor,
                      "--accent-dark": accentColorDark,
                    } as React.CSSProperties
                  }
                />
                <stop
                  offset="100%"
                  className="[stop-color:var(--accent)] dark:[stop-color:var(--accent-dark)]"
                  stopOpacity={0.02}
                  style={
                    {
                      "--accent": accentColor,
                      "--accent-dark": accentColorDark,
                    } as React.CSSProperties
                  }
                />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" hide />
            <YAxis hide domain={[0, maxCount * 1.2]} />
            <Area
              type="monotone"
              dataKey="count"
              stroke={accentColor}
              strokeWidth={1.5}
              fill={`url(#${CSS.escape(gradientId)})`}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MetricCardSkeleton() {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-neutral-200 dark:border-neutral-700/60 bg-white dark:bg-neutral-800/50 px-4 pt-3.5 pb-1 overflow-hidden animate-pulse">
      <div className="h-3.5 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-7 w-16 rounded bg-neutral-200 dark:bg-neutral-700 mt-1" />
      <div className="h-14 w-full rounded bg-neutral-100 dark:bg-neutral-800 mt-1 -mx-1" />
    </div>
  );
}

export const AnalyticsCards = memo(function AnalyticsCards({
  teamSlugOrId,
}: {
  teamSlugOrId: string;
}) {
  const analyticsQuery = useQuery(
    convexQuery(api.analytics.getDashboardStats, { teamSlugOrId }),
  );

  if (analyticsQuery.isLoading) {
    return (
      <div className="grid grid-cols-3 gap-3 mt-4 mb-2">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    );
  }

  if (!analyticsQuery.data) {
    return null;
  }

  const { tasksStarted, tasksMerged, runsCompleted } = analyticsQuery.data;

  return (
    <div className="grid grid-cols-3 gap-3 mt-4 mb-2">
      <MetricCard
        label="Tasks past week"
        total={tasksStarted.total}
        daily={tasksStarted.daily}
        accentColor="#737373"
        accentColorDark="#a3a3a3"
      />
      <MetricCard
        label="Merges past week"
        total={tasksMerged.total}
        daily={tasksMerged.daily}
        accentColor="#737373"
        accentColorDark="#a3a3a3"
      />
      <MetricCard
        label="Runs completed past week"
        total={runsCompleted.total}
        daily={runsCompleted.daily}
        accentColor="#737373"
        accentColorDark="#a3a3a3"
      />
    </div>
  );
});

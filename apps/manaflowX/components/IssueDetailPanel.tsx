"use client"

import { useQuery } from "convex/react"
import { api } from "../convex/_generated/api"
import { Id } from "../convex/_generated/dataModel"

type Issue = {
  _id: Id<"issues">
  shortId: string
  title: string
  description?: string
  status: "open" | "in_progress" | "closed"
  priority: number
  type: "bug" | "feature" | "task" | "epic" | "chore"
  assignee?: string
  labels: string[]
  parentIssue?: Id<"issues">
  isCompacted: boolean
  compactedSummary?: string
  closedAt?: number
  createdAt: number
  updatedAt: number
}

const statusColors: Record<Issue["status"], string> = {
  open: "bg-green-500/20 text-green-400 border-green-500/30",
  in_progress: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  closed: "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30",
}

const typeIcons: Record<Issue["type"], React.ReactNode> = {
  bug: (
    <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M6.56 1.14a.75.75 0 01.177 1.045 3.989 3.989 0 00-.464.86c.185.17.382.329.59.473A3.993 3.993 0 0110 2c1.272 0 2.405.594 3.137 1.518.208-.144.405-.302.59-.473a3.989 3.989 0 00-.464-.86.75.75 0 011.222-.869c.369.519.65 1.105.822 1.736a.75.75 0 01-.174.707 5.475 5.475 0 01-1.14.86 4.002 4.002 0 01.015.386c0 .127-.007.252-.02.375h1.262a.75.75 0 010 1.5h-1.6c-.08.17-.173.334-.278.491l1.516 1.516a.75.75 0 11-1.06 1.06l-1.33-1.329a4.007 4.007 0 01-.644.379l.523 1.178a.75.75 0 01-1.371.61L9.483 9.43A3.996 3.996 0 0110 9.5c.183 0 .361.013.535.039l-.523-1.178a.75.75 0 011.371-.61l.634 1.426a4.007 4.007 0 01.644-.379l1.33 1.329a.75.75 0 101.06-1.06l-1.516-1.516c.105-.157.198-.321.278-.491h1.6a.75.75 0 000-1.5h-1.262c.013-.123.02-.248.02-.375 0-.13-.005-.258-.015-.386a5.475 5.475 0 001.14-.86.75.75 0 00.174-.707 5.474 5.474 0 00-.822-1.736.75.75 0 10-1.222.869c.182.256.337.535.464.86a3.989 3.989 0 01-.59.473A3.993 3.993 0 0010 2c-1.272 0-2.405.594-3.137 1.518a3.989 3.989 0 01-.59-.473c.127-.325.282-.604.464-.86a.75.75 0 10-1.222-.869 5.474 5.474 0 00-.822 1.736.75.75 0 00.174.707c.313.296.698.538 1.14.86-.01.128-.015.256-.015.386 0 .127.007.252.02.375H4.75a.75.75 0 000 1.5h1.6c.08.17.173.334.278.491L5.112 8.887a.75.75 0 101.06 1.06l1.33-1.329c.197.148.414.276.644.379l-.523 1.178a.75.75 0 001.371.61L9.483 9.43A3.996 3.996 0 0010 9.5v3a.75.75 0 001.5 0v-3c.183 0 .361-.013.535-.039l.634 1.426a.75.75 0 101.371-.61l-.523-1.178c.23-.103.447-.231.644-.379l1.33 1.329a.75.75 0 101.06-1.06L13.035 7.473c.105-.157.198-.321.278-.491h1.6a.75.75 0 000-1.5h-1.262c.013-.123.02-.248.02-.375 0-.13-.005-.258-.015-.386a5.475 5.475 0 001.14-.86.75.75 0 00.174-.707 5.474 5.474 0 00-.822-1.736.75.75 0 10-1.222.869V18a.75.75 0 01-.75.75H5.5a.75.75 0 01-.75-.75V8.879a.75.75 0 011.222-.869z" clipRule="evenodd" />
    </svg>
  ),
  feature: (
    <svg className="w-4 h-4 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
      <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
    </svg>
  ),
  task: (
    <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  epic: (
    <svg className="w-4 h-4 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
      <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
    </svg>
  ),
  chore: (
    <svg className="w-4 h-4 text-muted-foreground" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  ),
}

const priorityLabels = ["Critical", "High", "Medium", "Low", "Backlog"]
const priorityColors = [
  "text-red-500",
  "text-orange-400",
  "text-yellow-400",
  "text-blue-400",
  "text-muted-foreground",
]

interface IssueDetailPanelProps {
  issueId: Id<"issues">
  onClose: () => void
  onIssueClick?: (issueId: Id<"issues">) => void
}

export function IssueDetailPanel({
  issueId,
  onClose,
  onIssueClick,
}: IssueDetailPanelProps) {
  const issueData = useQuery(api.issues.getIssue, { issueId })
  const dependencies = useQuery(api.issues.getIssueDependencies, { issueId })

  if (!issueData) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    )
  }

  const { issue, events } = issueData

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-border flex justify-between items-center sticky top-0 bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          {typeIcons[issue.type]}
          <span className="text-muted-foreground font-mono">{issue.shortId}</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Title and Status */}
        <div>
          <h1 className="text-xl font-bold mb-3">{issue.title}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm px-3 py-1 rounded-full border ${statusColors[issue.status]}`}>
              {issue.status.replace("_", " ")}
            </span>
            <span className={`text-sm ${priorityColors[issue.priority]}`}>
              P{issue.priority}: {priorityLabels[issue.priority]}
            </span>
          </div>
        </div>

        {/* Description */}
        {issue.description && (
          <div>
            <h3 className="text-muted-foreground text-sm font-medium mb-2">Description</h3>
            <p className="text-foreground/80 whitespace-pre-wrap">{issue.description}</p>
          </div>
        )}

        {issue.isCompacted && issue.compactedSummary && (
          <div className="p-3 bg-card rounded-lg border border-border">
            <div className="text-xs text-muted-foreground mb-1">Compacted Summary</div>
            <p className="text-foreground/80">{issue.compactedSummary}</p>
          </div>
        )}

        {/* Dependencies */}
        {dependencies && (
          <div className="space-y-4">
            {/* Blocked by */}
            {dependencies.dependsOn.length > 0 && (
              <div>
                <h3 className="text-muted-foreground text-sm font-medium mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  Depends On ({dependencies.dependsOn.length})
                </h3>
                <div className="space-y-2">
                  {dependencies.dependsOn.map(({ dependency, issue: depIssue }) => (
                    depIssue && (
                      <div
                        key={dependency._id}
                        onClick={() => onIssueClick?.(depIssue._id)}
                        className={`p-2 bg-card rounded border border-border flex items-center gap-2 ${onIssueClick ? "cursor-pointer hover:bg-accent/50" : ""}`}
                      >
                        <span className="text-muted-foreground font-mono text-sm">{depIssue.shortId}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${statusColors[depIssue.status]}`}>
                          {depIssue.status}
                        </span>
                        <span className="text-foreground/80 truncate flex-1">{depIssue.title}</span>
                        <span className="text-xs text-muted-foreground">{dependency.type}</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}

            {/* Blocking */}
            {dependencies.blockedBy.length > 0 && (
              <div>
                <h3 className="text-muted-foreground text-sm font-medium mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Blocking ({dependencies.blockedBy.length})
                </h3>
                <div className="space-y-2">
                  {dependencies.blockedBy.map(({ dependency, issue: blockedIssue }) => (
                    blockedIssue && (
                      <div
                        key={dependency._id}
                        onClick={() => onIssueClick?.(blockedIssue._id)}
                        className={`p-2 bg-card rounded border border-border flex items-center gap-2 ${onIssueClick ? "cursor-pointer hover:bg-accent/50" : ""}`}
                      >
                        <span className="text-muted-foreground font-mono text-sm">{blockedIssue.shortId}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${statusColors[blockedIssue.status]}`}>
                          {blockedIssue.status}
                        </span>
                        <span className="text-foreground/80 truncate flex-1">{blockedIssue.title}</span>
                        <span className="text-xs text-muted-foreground">{dependency.type}</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Labels */}
        {issue.labels.length > 0 && (
          <div>
            <h3 className="text-muted-foreground text-sm font-medium mb-2">Labels</h3>
            <div className="flex flex-wrap gap-2">
              {issue.labels.map((label) => (
                <span
                  key={label}
                  className="px-2 py-1 rounded bg-card text-foreground/80 text-sm"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        {events.length > 0 && (
          <div>
            <h3 className="text-muted-foreground text-sm font-medium mb-2">Activity</h3>
            <div className="space-y-2">
              {events.slice(0, 10).map((event) => (
                <div key={event._id} className="flex items-start gap-2 text-sm">
                  <div className="w-2 h-2 bg-border rounded-full mt-1.5"></div>
                  <div className="flex-1">
                    <span className="text-muted-foreground">
                      {event.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-muted-foreground/60 ml-2">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default IssueDetailPanel

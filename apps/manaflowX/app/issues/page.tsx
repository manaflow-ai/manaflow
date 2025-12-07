"use client"

import { useQuery } from "convex/react"
import { useRouter, useSearchParams } from "next/navigation"
import { api } from "../../convex/_generated/api"
import { Id } from "../../convex/_generated/dataModel"
import { Suspense, useState, useCallback, useMemo } from "react"

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

type StatusFilter = "all" | "open" | "in_progress" | "closed" | "ready" | "blocked"
type TypeFilter = "all" | "bug" | "feature" | "task" | "epic" | "chore"
type ViewMode = "list" | "tree"

type IssueWithGraph = Issue & {
  blockedBy: Array<{ issueId: string; type: string }>
  blocks: Array<{ issueId: string; type: string }>
  children: string[]
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

function IssueCard({
  issue,
  onClick,
  isSelected,
  blockedByCount,
  blocksCount,
}: {
  issue: Issue
  onClick: () => void
  isSelected: boolean
  blockedByCount: number
  blocksCount: number
}) {
  const isBlocked = blockedByCount > 0 && issue.status !== "closed"

  return (
    <div
      onClick={onClick}
      className={`p-4 border-b border-border hover:bg-accent/30 transition-colors cursor-pointer ${
        isSelected ? "bg-accent/50 border-l-2 border-l-blue-500" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{typeIcons[issue.type]}</div>
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-muted-foreground text-sm font-mono">{issue.shortId}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[issue.status]}`}>
              {issue.status.replace("_", " ")}
            </span>
            {isBlocked && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                Blocked ({blockedByCount})
              </span>
            )}
            {blocksCount > 0 && issue.status !== "closed" && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
                Blocking {blocksCount}
              </span>
            )}
          </div>
          <h3 className="text-foreground font-medium mb-2">{issue.title}</h3>
          <div className="flex items-center gap-3 text-sm">
            <span className={priorityColors[issue.priority]}>
              P{issue.priority}: {priorityLabels[issue.priority]}
            </span>
            {issue.assignee && (
              <span className="text-muted-foreground">
                → {issue.assignee}
              </span>
            )}
            {issue.labels.length > 0 && (
              <div className="flex gap-1">
                {issue.labels.slice(0, 3).map((label) => (
                  <span
                    key={label}
                    className="text-xs px-2 py-0.5 rounded bg-card text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
                {issue.labels.length > 3 && (
                  <span className="text-xs text-muted-foreground">+{issue.labels.length - 3}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Tree node type - computed structure
type TreeNode = {
  issue: IssueWithGraph
  children: TreeNode[]
}

// Build tree structure from flat list (computed once, no mutation during render)
function buildTree(issues: IssueWithGraph[]): TreeNode[] {
  // Use string keys for the map since dependency issueIds are strings
  const issueMap = new Map<string, IssueWithGraph>(issues.map((i) => [i._id as string, i]))
  const rendered = new Set<string>()

  // Root issues = not blocked by anything in our list
  const rootIssues = issues.filter((i) => {
    const blockingDeps = i.blockedBy.filter(b => b.type === "blocks" && issueMap.has(b.issueId))
    return blockingDeps.length === 0
  })

  function buildNode(issue: IssueWithGraph): TreeNode | null {
    if (rendered.has(issue._id as string)) return null
    rendered.add(issue._id as string)

    const children: TreeNode[] = []
    for (const blocked of issue.blocks) {
      const child = issueMap.get(blocked.issueId)
      if (child) {
        const node = buildNode(child)
        if (node) children.push(node)
      }
    }

    return { issue, children }
  }

  const tree: TreeNode[] = []
  for (const issue of rootIssues) {
    const node = buildNode(issue)
    if (node) tree.push(node)
  }

  // If no blocking structure, return all as flat roots
  if (tree.length === 0) {
    return issues.map((issue) => ({ issue, children: [] }))
  }

  return tree
}

// File-tree style: blocked issues nest under their blockers
function IssueTreeNode({
  node,
  expandedNodes,
  toggleExpand,
  onSelect,
  selectedId,
  depth = 0,
}: {
  node: TreeNode
  expandedNodes: Set<string>
  toggleExpand: (id: string) => void
  onSelect: (id: Id<"issues">) => void
  selectedId: Id<"issues"> | null
  depth?: number
}) {
  const { issue, children } = node
  const isExpanded = expandedNodes.has(issue._id)
  const isSelected = selectedId === issue._id
  const hasChildren = children.length > 0

  return (
    <div>
      <div
        className={`group flex items-center py-1.5 hover:bg-accent/50 cursor-pointer ${
          isSelected ? "bg-accent/70" : ""
        }`}
        style={{ paddingLeft: `${8 + depth * 20}px` }}
        onClick={() => onSelect(issue._id)}
      >
        {/* Expand/collapse */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) toggleExpand(issue._id)
          }}
          className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground"
        >
          {hasChildren ? (
            <svg
              className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6 6L14 10L6 14V6Z" />
            </svg>
          ) : (
            <span className="w-1 h-1 rounded-full bg-muted" />
          )}
        </button>

        {/* ID */}
        <span className="text-sm text-muted-foreground ml-1 font-mono">
          {issue.shortId}
        </span>

        {/* Priority indicator */}
        {issue.priority <= 1 && issue.status !== "closed" && (
          <div className={`flex items-center gap-0.5 ml-1.5 w-4 h-4 justify-center ${
            issue.priority === 0 ? "text-red-400" : "text-orange-400"
          }`}>
            {[...Array(issue.priority === 0 ? 3 : 2)].map((_, i) => (
              <div key={i} className="w-[2px] bg-current rounded-full" style={{ height: `${6 + i * 2}px` }} />
            ))}
          </div>
        )}

        {/* Title */}
        <span
          className={`text-base font-medium ml-1.5 truncate ${
            issue.status === "closed" ? "text-muted-foreground line-through" : "text-foreground/80"
          }`}
        >
          {issue.title}
        </span>
      </div>

      {/* Blocked issues (nested underneath) */}
      {isExpanded &&
        children.map((child) => (
          <IssueTreeNode
            key={child.issue._id}
            node={child}
            expandedNodes={expandedNodes}
            toggleExpand={toggleExpand}
            onSelect={onSelect}
            selectedId={selectedId}
            depth={depth + 1}
          />
        ))}
    </div>
  )
}

function IssueTreeView({
  issues,
  onSelect,
  selectedId,
}: {
  issues: IssueWithGraph[]
  onSelect: (id: Id<"issues">) => void
  selectedId: Id<"issues"> | null
}) {
  // Start with all nodes expanded
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() =>
    new Set(issues.map(i => i._id as string))
  )

  const toggleExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // Build tree structure once (no mutation during render)
  const tree = useMemo(() => buildTree(issues), [issues])

  return (
    <div className="py-1">
      {issues.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground text-sm">No issues found.</div>
      ) : (
        tree.map((node) => (
          <IssueTreeNode
            key={node.issue._id}
            node={node}
            expandedNodes={expandedNodes}
            toggleExpand={toggleExpand}
            onSelect={onSelect}
            selectedId={selectedId}
          />
        ))
      )}
    </div>
  )
}

function IssueDetailPanel({
  issueId,
  onClose,
}: {
  issueId: Id<"issues">
  onClose: () => void
}) {
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
          <div className="p-3 bg-muted rounded-lg border border-border">
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
                        className="p-2 bg-muted rounded border border-border flex items-center gap-2"
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
                        className="p-2 bg-muted rounded border border-border flex items-center gap-2"
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
                  <div className="w-2 h-2 bg-muted rounded-full mt-1.5"></div>
                  <div className="flex-1">
                    <span className="text-muted-foreground">
                      {event.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-muted-foreground ml-2">
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

function IssuesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const selectedIssue = searchParams.get("issue") as Id<"issues"> | null
  const statusFilterParam = searchParams.get("status") as StatusFilter | null
  const typeFilterParam = searchParams.get("type") as TypeFilter | null
  const viewModeParam = searchParams.get("view") as ViewMode | null
  const searchQueryParam = searchParams.get("search") || ""

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(statusFilterParam || "all")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(typeFilterParam || "all")
  const [viewMode, setViewMode] = useState<ViewMode>(viewModeParam || "tree")
  const [searchQuery, setSearchQuery] = useState(searchQueryParam)
  const [searchInput, setSearchInput] = useState(searchQueryParam)

  // Fetch issues based on filter - use graph query for tree view
  const regularIssues = useQuery(
    api.issues.listIssuesWithDependencies,
    viewMode === "list" && statusFilter !== "ready" && statusFilter !== "blocked"
      ? {
          limit: 100,
          status: statusFilter === "all" ? undefined : statusFilter,
          type: typeFilter === "all" ? undefined : typeFilter,
        }
      : "skip"
  )

  // Fetch full graph for tree view
  const graphData = useQuery(
    api.issues.listIssuesWithDependencyGraph,
    viewMode === "tree"
      ? {
          status: statusFilter === "all" || statusFilter === "ready" || statusFilter === "blocked"
            ? undefined
            : statusFilter,
          type: typeFilter === "all" ? undefined : typeFilter,
        }
      : "skip"
  )

  const readyIssues = useQuery(
    api.issues.listReadyIssues,
    viewMode === "list" && statusFilter === "ready" ? { limit: 100 } : "skip"
  )

  const blockedIssuesData = useQuery(
    api.issues.listBlockedIssues,
    viewMode === "list" && statusFilter === "blocked" ? { limit: 100 } : "skip"
  )

  // Search query - when active, overrides other filters
  const searchResults = useQuery(
    api.issues.searchIssues,
    searchQuery
      ? {
          query: searchQuery,
          limit: 50,
          status: statusFilter === "all" || statusFilter === "ready" || statusFilter === "blocked"
            ? undefined
            : statusFilter,
        }
      : "skip"
  )

  // Get issue stats for the header
  const issueStats = useQuery(api.issues.getIssueStats, {})

  const setSelectedIssue = useCallback(
    (issueId: Id<"issues"> | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (issueId) {
        params.set("issue", issueId)
      } else {
        params.delete("issue")
      }
      router.push(`/issues?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  const updateFilter = useCallback(
    (key: "status" | "type" | "view", value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if ((key === "status" || key === "type") && value === "all") {
        params.delete(key)
      } else if (key === "view" && value === "tree") {
        params.delete(key) // tree is default
      } else {
        params.set(key, value)
      }
      router.push(`/issues?${params.toString()}`, { scroll: false })

      if (key === "status") setStatusFilter(value as StatusFilter)
      if (key === "type") setTypeFilter(value as TypeFilter)
      if (key === "view") setViewMode(value as ViewMode)
    },
    [router, searchParams]
  )

  const updateSearch = useCallback(
    (query: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (query.trim()) {
        params.set("search", query.trim())
      } else {
        params.delete("search")
      }
      router.push(`/issues?${params.toString()}`, { scroll: false })
      setSearchQuery(query.trim())
    },
    [router, searchParams]
  )

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateSearch(searchInput)
  }

  const clearSearch = () => {
    setSearchInput("")
    updateSearch("")
  }

  type IssueWithDeps = Issue & { blockedByCount: number; blocksCount: number }

  // Determine which issues to show
  let issues: IssueWithDeps[] = []

  // If searching, use search results
  if (searchQuery && searchResults) {
    issues = searchResults.map((i) => ({ ...i, blockedByCount: 0, blocksCount: 0 }))
  } else if (statusFilter === "ready" && readyIssues) {
    issues = readyIssues.map((i) => ({ ...i, blockedByCount: 0, blocksCount: 0 }))
  } else if (statusFilter === "blocked" && blockedIssuesData) {
    issues = blockedIssuesData.map((b) => ({
      ...b.issue,
      blockedByCount: b.blockedBy.length,
      blocksCount: 0,
    }))
  } else if (regularIssues) {
    issues = regularIssues
  }

  // Apply type filter for ready/blocked views (also for search)
  if ((statusFilter === "ready" || statusFilter === "blocked" || searchQuery) && typeFilter !== "all") {
    issues = issues.filter((i) => i.type === typeFilter)
  }

  const loading = searchQuery
    ? !searchResults
    : viewMode === "tree"
      ? !graphData
      : (statusFilter === "ready" && !readyIssues) ||
        (statusFilter === "blocked" && !blockedIssuesData) ||
        (statusFilter !== "ready" && statusFilter !== "blocked" && !regularIssues)

  return (
    <div className="h-screen overflow-hidden">
      <div className="flex justify-center h-full">
        <main className="w-full max-w-[1200px] border-x border-border h-full flex flex-col">
          {/* Header */}
          <div className="flex-shrink-0 bg-background/80 backdrop-blur-md border-b border-border z-10">
            <div className="px-4 pt-4 pb-2 flex justify-between items-center gap-4">
              <h1 className="text-base font-semibold text-foreground flex-shrink-0">Issues</h1>
              {/* Search input */}
              <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md">
                <div className="relative">
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search issues..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg pl-10 pr-8 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={clearSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground/80"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </form>
              <div className="flex items-center gap-3">
                {issueStats && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      {issueStats.byStatus.open}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      {issueStats.readyCount}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      {issueStats.blockedCount}
                    </span>
                  </div>
                )}
                {/* View mode toggle */}
                <div className="flex items-center rounded-md bg-muted p-0.5">
                  <button
                    onClick={() => updateFilter("view", "tree")}
                    className={`p-1 rounded transition-colors ${
                      viewMode === "tree" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground/80"
                    }`}
                    title="Tree view"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                  </button>
                  <button
                    onClick={() => updateFilter("view", "list")}
                    className={`p-1 rounded transition-colors ${
                      viewMode === "list" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground/80"
                    }`}
                    title="Card view"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Filters - Linear style */}
            <div className="px-4 pb-3 flex items-center gap-2">
              {/* Status filter tabs */}
              <div className="flex items-center">
                {(["all", "open", "in_progress", "closed"] as StatusFilter[]).map(
                  (status) => (
                    <button
                      key={status}
                      onClick={() => updateFilter("status", status)}
                      className={`px-3 py-1 text-sm font-medium transition-colors relative ${
                        statusFilter === status
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground/80"
                      }`}
                    >
                      {status === "all" ? "All issues" : status === "in_progress" ? "In Progress" : status.charAt(0).toUpperCase() + status.slice(1)}
                      {statusFilter === status && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />
                      )}
                    </button>
                  )
                )}
              </div>

              <div className="h-4 w-px bg-border mx-1" />

              {/* Quick filters */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => updateFilter("status", statusFilter === "ready" ? "all" : "ready")}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    statusFilter === "ready"
                      ? "bg-green-500/15 text-green-400 ring-1 ring-green-500/30"
                      : "text-muted-foreground hover:text-foreground/80 hover:bg-accent/50"
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${statusFilter === "ready" ? "bg-green-400" : "bg-muted-foreground"}`} />
                  Ready
                </button>
                <button
                  onClick={() => updateFilter("status", statusFilter === "blocked" ? "all" : "blocked")}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    statusFilter === "blocked"
                      ? "bg-red-500/15 text-red-400 ring-1 ring-red-500/30"
                      : "text-muted-foreground hover:text-foreground/80 hover:bg-accent/50"
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${statusFilter === "blocked" ? "bg-red-400" : "bg-muted-foreground"}`} />
                  Blocked
                </button>
              </div>

              <div className="h-4 w-px bg-border mx-1" />

              {/* Type dropdown-style pills */}
              <div className="flex items-center gap-1">
                {(["bug", "feature", "task", "epic", "chore"] as Exclude<TypeFilter, "all">[]).map(
                  (type) => (
                    <button
                      key={type}
                      onClick={() => updateFilter("type", typeFilter === type ? "all" : type)}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-all ${
                        typeFilter === type
                          ? type === "bug"
                            ? "bg-red-500/15 text-red-400 ring-1 ring-red-500/30"
                            : type === "feature"
                              ? "bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/30"
                              : type === "task"
                                ? "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30"
                                : type === "epic"
                                  ? "bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30"
                                  : "bg-muted-foreground/15 text-muted-foreground ring-1 ring-muted-foreground/30"
                          : "text-muted-foreground hover:text-foreground/80 hover:bg-accent/50"
                      }`}
                      title={type.charAt(0).toUpperCase() + type.slice(1)}
                    >
                      <span className="[&>svg]:w-3 [&>svg]:h-3">{typeIcons[type]}</span>
                    </button>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Issue List */}
          <div className="flex-1 overflow-y-auto">
            {/* Search results indicator */}
            {searchQuery && (
              <div className="px-4 py-2 border-b border-border text-sm text-muted-foreground flex items-center justify-between">
                <span>
                  Search results for &quot;{searchQuery}&quot;
                  {searchResults && ` (${searchResults.length} found)`}
                </span>
                <button
                  onClick={clearSearch}
                  className="text-blue-400 hover:text-blue-300 text-xs"
                >
                  Clear search
                </button>
              </div>
            )}
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                </div>
              </div>
            ) : viewMode === "tree" && graphData && !searchQuery ? (
              <IssueTreeView
                issues={graphData.issues}
                onSelect={setSelectedIssue}
                selectedId={selectedIssue}
              />
            ) : issues.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {searchQuery ? `No issues found for "${searchQuery}"` : "No issues found matching the current filters."}
              </div>
            ) : (
              issues.map((issue) => (
                <IssueCard
                  key={issue._id}
                  issue={issue}
                  onClick={() => setSelectedIssue(issue._id)}
                  isSelected={selectedIssue === issue._id}
                  blockedByCount={issue.blockedByCount}
                  blocksCount={issue.blocksCount}
                />
              ))
            )}
          </div>
        </main>

        {/* Issue Detail Panel */}
        {selectedIssue && (
          <aside className="w-[500px] border-r border-border h-full overflow-y-auto hidden lg:block">
            <IssueDetailPanel
              issueId={selectedIssue}
              onClose={() => setSelectedIssue(null)}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

export default function IssuesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
            <p className="ml-2 text-muted-foreground">Loading...</p>
          </div>
        </div>
      }
    >
      <IssuesContent />
    </Suspense>
  )
}

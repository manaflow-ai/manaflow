import ConvexMobile
import Foundation

// Generated from /Users/lawrencechen/fun/cmux-wt-swift-autogen/packages/convex/convex/_generated/api.d.ts

// Functions: tasks.get, tasks.getArchivedPaginated, tasks.getWithNotificationOrder, tasks.getPreviewTasks

struct ConvexId<Table>: Decodable, Hashable, Sendable, ConvexEncodable {

  let rawValue: String

  init(rawValue: String) {

    self.rawValue = rawValue

  }

  init(from decoder: Decoder) throws {

    let container = try decoder.singleValueContainer()

    rawValue = try container.decode(String.self)

  }

  func convexEncode() throws -> String {

    try rawValue.convexEncode()

  }

}

private func convexEncodeArray<T: ConvexEncodable>(_ values: [T]) -> [ConvexEncodable?] {

  values.map { $0 }

}

private func convexEncodeRecord<T: ConvexEncodable>(_ values: [String: T]) -> [String:
  ConvexEncodable?]
{

  var result: [String: ConvexEncodable?] = [:]

  for (key, value) in values {

    result[key] = value

  }

  return result

}

enum ConvexTableEnvironments {}

enum ConvexTableStorage {}

enum ConvexTableTaskRunScreenshotSets {}

enum ConvexTableTaskRuns {}

enum ConvexTableTasks {}

enum TasksGetItemCrownEvaluationStatusEnum: String, Decodable {
  case pending = "pending"
  case inProgress = "in_progress"
  case succeeded = "succeeded"
  case error = "error"
}

enum TasksGetItemMergeStatusEnum: String, Decodable {
  case none = "none"
  case prDraft = "pr_draft"
  case prOpen = "pr_open"
  case prApproved = "pr_approved"
  case prChangesRequested = "pr_changes_requested"
  case prMerged = "pr_merged"
  case prClosed = "pr_closed"
}

enum TasksGetItemScreenshotStatusEnum: String, Decodable {
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
  case skipped = "skipped"
}

enum TasksGetArchivedPaginatedReturnPageItemCrownEvaluationStatusEnum: String, Decodable {
  case pending = "pending"
  case inProgress = "in_progress"
  case succeeded = "succeeded"
  case error = "error"
}

enum TasksGetArchivedPaginatedReturnPageItemMergeStatusEnum: String, Decodable {
  case none = "none"
  case prDraft = "pr_draft"
  case prOpen = "pr_open"
  case prApproved = "pr_approved"
  case prChangesRequested = "pr_changes_requested"
  case prMerged = "pr_merged"
  case prClosed = "pr_closed"
}

enum TasksGetArchivedPaginatedReturnPageItemScreenshotStatusEnum: String, Decodable {
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
  case skipped = "skipped"
}

enum TasksGetArchivedPaginatedReturnPageStatusEnum: String, Decodable {
  case splitRecommended = "SplitRecommended"
  case splitRequired = "SplitRequired"
}

enum TasksGetWithNotificationOrderItemCrownEvaluationStatusEnum: String, Decodable {
  case pending = "pending"
  case inProgress = "in_progress"
  case succeeded = "succeeded"
  case error = "error"
}

enum TasksGetWithNotificationOrderItemMergeStatusEnum: String, Decodable {
  case none = "none"
  case prDraft = "pr_draft"
  case prOpen = "pr_open"
  case prApproved = "pr_approved"
  case prChangesRequested = "pr_changes_requested"
  case prMerged = "pr_merged"
  case prClosed = "pr_closed"
}

enum TasksGetWithNotificationOrderItemScreenshotStatusEnum: String, Decodable {
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
  case skipped = "skipped"
}

enum TasksGetPreviewTasksItemCrownEvaluationStatusEnum: String, Decodable {
  case pending = "pending"
  case inProgress = "in_progress"
  case succeeded = "succeeded"
  case error = "error"
}

enum TasksGetPreviewTasksItemMergeStatusEnum: String, Decodable {
  case none = "none"
  case prDraft = "pr_draft"
  case prOpen = "pr_open"
  case prApproved = "pr_approved"
  case prChangesRequested = "pr_changes_requested"
  case prMerged = "pr_merged"
  case prClosed = "pr_closed"
}

enum TasksGetPreviewTasksItemScreenshotStatusEnum: String, Decodable {
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
  case skipped = "skipped"
}

struct TasksGetItemImagesItem: Decodable {
  let fileName: String?
  let storageId: ConvexId<ConvexTableStorage>
  let altText: String
}

struct TasksGetItem: Decodable {
  let hasUnread: Bool
  let _id: ConvexId<ConvexTableTasks>
  @ConvexFloat var _creationTime: Double
  @OptionalConvexFloat var createdAt: Double?
  @OptionalConvexFloat var updatedAt: Double?
  let isArchived: Bool?
  let pinned: Bool?
  let isPreview: Bool?
  let isLocalWorkspace: Bool?
  let isCloudWorkspace: Bool?
  let description: String?
  let pullRequestTitle: String?
  let pullRequestDescription: String?
  let projectFullName: String?
  let baseBranch: String?
  let worktreePath: String?
  let generatedBranchName: String?
  @OptionalConvexFloat var lastActivityAt: Double?
  let environmentId: ConvexId<ConvexTableEnvironments>?
  let crownEvaluationStatus: TasksGetItemCrownEvaluationStatusEnum?
  let crownEvaluationError: String?
  let mergeStatus: TasksGetItemMergeStatusEnum?
  let images: [TasksGetItemImagesItem]?
  let screenshotStatus: TasksGetItemScreenshotStatusEnum?
  let screenshotRunId: ConvexId<ConvexTableTaskRuns>?
  let screenshotRequestId: String?
  @OptionalConvexFloat var screenshotRequestedAt: Double?
  @OptionalConvexFloat var screenshotCompletedAt: Double?
  let screenshotError: String?
  let screenshotStorageId: ConvexId<ConvexTableStorage>?
  let screenshotMimeType: String?
  let screenshotFileName: String?
  let screenshotCommitSha: String?
  let latestScreenshotSetId: ConvexId<ConvexTableTaskRunScreenshotSets>?
  let teamId: String
  let userId: String
  let text: String
  let isCompleted: Bool
}

struct TasksGetArchivedPaginatedArgsPaginationOpts: ConvexEncodable {
  let id: Double?
  let endCursor: String?
  let maximumRowsRead: Double?
  let maximumBytesRead: Double?
  let numItems: Double
  let cursor: String?

  func convexEncode() throws -> String {
    var result: [String: ConvexEncodable?] = [:]
    if let value = id { result["id"] = value }
    if let value = endCursor { result["endCursor"] = value }
    if let value = maximumRowsRead { result["maximumRowsRead"] = value }
    if let value = maximumBytesRead { result["maximumBytesRead"] = value }
    result["numItems"] = numItems
    if let value = cursor { result["cursor"] = value }
    return try result.convexEncode()
  }
}

struct TasksGetArchivedPaginatedReturnPageItemImagesItem: Decodable {
  let fileName: String?
  let storageId: ConvexId<ConvexTableStorage>
  let altText: String
}

struct TasksGetArchivedPaginatedReturnPageItem: Decodable {
  let hasUnread: Bool
  let _id: ConvexId<ConvexTableTasks>
  @ConvexFloat var _creationTime: Double
  @OptionalConvexFloat var createdAt: Double?
  @OptionalConvexFloat var updatedAt: Double?
  let isArchived: Bool?
  let pinned: Bool?
  let isPreview: Bool?
  let isLocalWorkspace: Bool?
  let isCloudWorkspace: Bool?
  let description: String?
  let pullRequestTitle: String?
  let pullRequestDescription: String?
  let projectFullName: String?
  let baseBranch: String?
  let worktreePath: String?
  let generatedBranchName: String?
  @OptionalConvexFloat var lastActivityAt: Double?
  let environmentId: ConvexId<ConvexTableEnvironments>?
  let crownEvaluationStatus: TasksGetArchivedPaginatedReturnPageItemCrownEvaluationStatusEnum?
  let crownEvaluationError: String?
  let mergeStatus: TasksGetArchivedPaginatedReturnPageItemMergeStatusEnum?
  let images: [TasksGetArchivedPaginatedReturnPageItemImagesItem]?
  let screenshotStatus: TasksGetArchivedPaginatedReturnPageItemScreenshotStatusEnum?
  let screenshotRunId: ConvexId<ConvexTableTaskRuns>?
  let screenshotRequestId: String?
  @OptionalConvexFloat var screenshotRequestedAt: Double?
  @OptionalConvexFloat var screenshotCompletedAt: Double?
  let screenshotError: String?
  let screenshotStorageId: ConvexId<ConvexTableStorage>?
  let screenshotMimeType: String?
  let screenshotFileName: String?
  let screenshotCommitSha: String?
  let latestScreenshotSetId: ConvexId<ConvexTableTaskRunScreenshotSets>?
  let teamId: String
  let userId: String
  let text: String
  let isCompleted: Bool
}

struct TasksGetArchivedPaginatedReturn: Decodable {
  let page: [TasksGetArchivedPaginatedReturnPageItem]
  let isDone: Bool
  let continueCursor: String
  let splitCursor: String?
  let pageStatus: TasksGetArchivedPaginatedReturnPageStatusEnum?
}

struct TasksGetWithNotificationOrderItemImagesItem: Decodable {
  let fileName: String?
  let storageId: ConvexId<ConvexTableStorage>
  let altText: String
}

struct TasksGetWithNotificationOrderItem: Decodable {
  let hasUnread: Bool
  let _id: ConvexId<ConvexTableTasks>
  @ConvexFloat var _creationTime: Double
  @OptionalConvexFloat var createdAt: Double?
  @OptionalConvexFloat var updatedAt: Double?
  let isArchived: Bool?
  let pinned: Bool?
  let isPreview: Bool?
  let isLocalWorkspace: Bool?
  let isCloudWorkspace: Bool?
  let description: String?
  let pullRequestTitle: String?
  let pullRequestDescription: String?
  let projectFullName: String?
  let baseBranch: String?
  let worktreePath: String?
  let generatedBranchName: String?
  @OptionalConvexFloat var lastActivityAt: Double?
  let environmentId: ConvexId<ConvexTableEnvironments>?
  let crownEvaluationStatus: TasksGetWithNotificationOrderItemCrownEvaluationStatusEnum?
  let crownEvaluationError: String?
  let mergeStatus: TasksGetWithNotificationOrderItemMergeStatusEnum?
  let images: [TasksGetWithNotificationOrderItemImagesItem]?
  let screenshotStatus: TasksGetWithNotificationOrderItemScreenshotStatusEnum?
  let screenshotRunId: ConvexId<ConvexTableTaskRuns>?
  let screenshotRequestId: String?
  @OptionalConvexFloat var screenshotRequestedAt: Double?
  @OptionalConvexFloat var screenshotCompletedAt: Double?
  let screenshotError: String?
  let screenshotStorageId: ConvexId<ConvexTableStorage>?
  let screenshotMimeType: String?
  let screenshotFileName: String?
  let screenshotCommitSha: String?
  let latestScreenshotSetId: ConvexId<ConvexTableTaskRunScreenshotSets>?
  let teamId: String
  let userId: String
  let text: String
  let isCompleted: Bool
}

struct TasksGetPreviewTasksItemImagesItem: Decodable {
  let fileName: String?
  let storageId: ConvexId<ConvexTableStorage>
  let altText: String
}

struct TasksGetPreviewTasksItem: Decodable {
  let _id: ConvexId<ConvexTableTasks>
  @ConvexFloat var _creationTime: Double
  @OptionalConvexFloat var createdAt: Double?
  @OptionalConvexFloat var updatedAt: Double?
  let isArchived: Bool?
  let pinned: Bool?
  let isPreview: Bool?
  let isLocalWorkspace: Bool?
  let isCloudWorkspace: Bool?
  let description: String?
  let pullRequestTitle: String?
  let pullRequestDescription: String?
  let projectFullName: String?
  let baseBranch: String?
  let worktreePath: String?
  let generatedBranchName: String?
  @OptionalConvexFloat var lastActivityAt: Double?
  let environmentId: ConvexId<ConvexTableEnvironments>?
  let crownEvaluationStatus: TasksGetPreviewTasksItemCrownEvaluationStatusEnum?
  let crownEvaluationError: String?
  let mergeStatus: TasksGetPreviewTasksItemMergeStatusEnum?
  let images: [TasksGetPreviewTasksItemImagesItem]?
  let screenshotStatus: TasksGetPreviewTasksItemScreenshotStatusEnum?
  let screenshotRunId: ConvexId<ConvexTableTaskRuns>?
  let screenshotRequestId: String?
  @OptionalConvexFloat var screenshotRequestedAt: Double?
  @OptionalConvexFloat var screenshotCompletedAt: Double?
  let screenshotError: String?
  let screenshotStorageId: ConvexId<ConvexTableStorage>?
  let screenshotMimeType: String?
  let screenshotFileName: String?
  let screenshotCommitSha: String?
  let latestScreenshotSetId: ConvexId<ConvexTableTaskRunScreenshotSets>?
  let teamId: String
  let userId: String
  let text: String
  let isCompleted: Bool
}

struct TasksGetArgs {
  let projectFullName: String?
  let archived: Bool?
  let excludeLocalWorkspaces: Bool?
  let teamSlugOrId: String

  func asDictionary() -> [String: ConvexEncodable?] {
    var result: [String: ConvexEncodable?] = [:]
    if let value = projectFullName { result["projectFullName"] = value }
    if let value = archived { result["archived"] = value }
    if let value = excludeLocalWorkspaces { result["excludeLocalWorkspaces"] = value }
    result["teamSlugOrId"] = teamSlugOrId
    return result
  }
}

struct TasksGetArchivedPaginatedArgs {
  let excludeLocalWorkspaces: Bool?
  let teamSlugOrId: String
  let paginationOpts: TasksGetArchivedPaginatedArgsPaginationOpts

  func asDictionary() -> [String: ConvexEncodable?] {
    var result: [String: ConvexEncodable?] = [:]
    if let value = excludeLocalWorkspaces { result["excludeLocalWorkspaces"] = value }
    result["teamSlugOrId"] = teamSlugOrId
    result["paginationOpts"] = paginationOpts
    return result
  }
}

struct TasksGetWithNotificationOrderArgs {
  let projectFullName: String?
  let archived: Bool?
  let excludeLocalWorkspaces: Bool?
  let teamSlugOrId: String

  func asDictionary() -> [String: ConvexEncodable?] {
    var result: [String: ConvexEncodable?] = [:]
    if let value = projectFullName { result["projectFullName"] = value }
    if let value = archived { result["archived"] = value }
    if let value = excludeLocalWorkspaces { result["excludeLocalWorkspaces"] = value }
    result["teamSlugOrId"] = teamSlugOrId
    return result
  }
}

struct TasksGetPreviewTasksArgs {
  let limit: Double?
  let teamSlugOrId: String

  func asDictionary() -> [String: ConvexEncodable?] {
    var result: [String: ConvexEncodable?] = [:]
    if let value = limit { result["limit"] = value }
    result["teamSlugOrId"] = teamSlugOrId
    return result
  }
}

typealias TasksGetReturn = [TasksGetItem]

typealias TasksGetWithNotificationOrderReturn = [TasksGetWithNotificationOrderItem]

typealias TasksGetPreviewTasksReturn = [TasksGetPreviewTasksItem]

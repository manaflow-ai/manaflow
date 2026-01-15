import ConvexMobile
import Foundation

// Generated from packages/convex/convex/schema.ts

enum ConvexValue: Decodable {

  case string(String)

  case double(Double)

  case bool(Bool)

  case array([ConvexValue])

  case object([String: ConvexValue])

  case null

  init(from decoder: Decoder) throws {

    let container = try decoder.singleValueContainer()

    if container.decodeNil() {

      self = .null

      return

    }

    if let value = try? container.decode(Bool.self) {

      self = .bool(value)

      return

    }

    if let value = try? container.decode(Double.self) {

      self = .double(value)

      return

    }

    if let value = try? container.decode(String.self) {

      self = .string(value)

      return

    }

    if let value = try? container.decode([String: ConvexValue].self) {

      self = .object(value)

      return

    }

    if let value = try? container.decode([ConvexValue].self) {

      self = .array(value)

      return

    }

    throw DecodingError.dataCorruptedError(
      in: container, debugDescription: "Unsupported ConvexValue")

  }

}

enum ConvexTeamMembershipsRoleEnum: String, Decodable {
  case owner = "owner"
  case member = "member"
}

struct ConvexUsersOauthProvidersItem: Decodable {
  let id: String
  let accountId: String
  let email: String?
}

enum ConvexTasksCrownEvaluationStatusEnum: String, Decodable {
  case pending = "pending"
  case inProgress = "in_progress"
  case succeeded = "succeeded"
  case error = "error"
}

enum ConvexTasksMergeStatusEnum: String, Decodable {
  case none = "none"
  case prDraft = "pr_draft"
  case prOpen = "pr_open"
  case prApproved = "pr_approved"
  case prChangesRequested = "pr_changes_requested"
  case prMerged = "pr_merged"
  case prClosed = "pr_closed"
}

struct ConvexTasksImagesItem: Decodable {
  let storageId: String
  let fileName: String?
  let altText: String
}

enum ConvexTasksScreenshotStatusEnum: String, Decodable {
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
  case skipped = "skipped"
}

enum ConvexTaskRunsStatusEnum: String, Decodable {
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
  case skipped = "skipped"
}

struct ConvexTaskRunsEnvironmentError: Decodable {
  let devError: String?
  let maintenanceError: String?
}

enum ConvexTaskRunsPullRequestStateEnum: String, Decodable {
  case none = "none"
  case draft = "draft"
  case `open` = "open"
  case merged = "merged"
  case closed = "closed"
  case unknown = "unknown"
}

enum ConvexTaskRunsPullRequestsItemStateEnum: String, Decodable {
  case none = "none"
  case draft = "draft"
  case `open` = "open"
  case merged = "merged"
  case closed = "closed"
  case unknown = "unknown"
}

struct ConvexTaskRunsPullRequestsItem: Decodable {
  let repoFullName: String
  let url: String?
  @OptionalConvexFloat var number: Double?
  let state: ConvexTaskRunsPullRequestsItemStateEnum
  let isDraft: Bool?
}

enum ConvexTaskRunsVscodeProviderEnum: String, Decodable {
  case docker = "docker"
  case morph = "morph"
  case daytona = "daytona"
  case other = "other"
}

enum ConvexTaskRunsVscodeStatusEnum: String, Decodable {
  case starting = "starting"
  case running = "running"
  case stopped = "stopped"
}

struct ConvexTaskRunsVscodePorts: Decodable {
  let vscode: String
  let worker: String
  let `extension`: String?
  let proxy: String?
  let vnc: String?
}

struct ConvexTaskRunsVscode: Decodable {
  let provider: ConvexTaskRunsVscodeProviderEnum
  let containerName: String?
  let status: ConvexTaskRunsVscodeStatusEnum
  let statusMessage: String?
  let ports: ConvexTaskRunsVscodePorts?
  let url: String?
  let workspaceUrl: String?
  @OptionalConvexFloat var startedAt: Double?
  @OptionalConvexFloat var stoppedAt: Double?
  @OptionalConvexFloat var lastAccessedAt: Double?
  let keepAlive: Bool?
  @OptionalConvexFloat var scheduledStopAt: Double?
}

enum ConvexTaskRunsNetworkingItemStatusEnum: String, Decodable {
  case starting = "starting"
  case running = "running"
  case stopped = "stopped"
}

struct ConvexTaskRunsNetworkingItem: Decodable {
  let status: ConvexTaskRunsNetworkingItemStatusEnum
  @ConvexFloat var port: Double
  let url: String
}

struct ConvexTaskRunsCustomPreviewsItem: Decodable {
  let url: String
  @ConvexFloat var createdAt: Double
}

enum ConvexTaskRunScreenshotSetsStatusEnum: String, Decodable {
  case completed = "completed"
  case failed = "failed"
  case skipped = "skipped"
}

struct ConvexTaskRunScreenshotSetsImagesItem: Decodable {
  let storageId: String
  let mimeType: String
  let fileName: String?
  let commitSha: String?
  let description: String?
}

struct ConvexTaskVersionsFilesItem: Decodable {
  let path: String
  let changes: String
}

enum ConvexAutomatedCodeReviewJobsJobTypeEnum: String, Decodable {
  case pullRequest = "pull_request"
  case comparison = "comparison"
}

enum ConvexAutomatedCodeReviewJobsStateEnum: String, Decodable {
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
}

enum ConvexAutomatedCodeReviewVersionsJobTypeEnum: String, Decodable {
  case pullRequest = "pull_request"
  case comparison = "comparison"
}

enum ConvexAutomatedCodeReviewFileOutputsJobTypeEnum: String, Decodable {
  case pullRequest = "pull_request"
  case comparison = "comparison"
}

enum ConvexReposOwnerTypeEnum: String, Decodable {
  case user = "User"
  case organization = "Organization"
}

enum ConvexReposVisibilityEnum: String, Decodable {
  case `public` = "public"
  case `private` = "private"
}

struct ConvexWorkspaceSettingsHeatmapColorsLine: Decodable {
  let start: String
  let end: String
}

struct ConvexWorkspaceSettingsHeatmapColorsToken: Decodable {
  let start: String
  let end: String
}

struct ConvexWorkspaceSettingsHeatmapColors: Decodable {
  let line: ConvexWorkspaceSettingsHeatmapColorsLine
  let token: ConvexWorkspaceSettingsHeatmapColorsToken
}

enum ConvexPreviewConfigsStatusEnum: String, Decodable {
  case active = "active"
  case paused = "paused"
  case disabled = "disabled"
}

enum ConvexPreviewRunsStatusEnum: String, Decodable {
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
  case skipped = "skipped"
  case superseded = "superseded"
}

struct ConvexUserEditorSettingsSnippetsItem: Decodable {
  let name: String
  let content: String
}

enum ConvexProviderConnectionsAccountTypeEnum: String, Decodable {
  case user = "User"
  case organization = "Organization"
}

enum ConvexInstallStatesStatusEnum: String, Decodable {
  case pending = "pending"
  case used = "used"
  case expired = "expired"
}

enum ConvexPullRequestsStateEnum: String, Decodable {
  case `open` = "open"
  case closed = "closed"
}

enum ConvexGithubWorkflowRunsStatusEnum: String, Decodable {
  case queued = "queued"
  case inProgress = "in_progress"
  case completed = "completed"
  case pending = "pending"
  case waiting = "waiting"
}

enum ConvexGithubWorkflowRunsConclusionEnum: String, Decodable {
  case success = "success"
  case failure = "failure"
  case neutral = "neutral"
  case cancelled = "cancelled"
  case skipped = "skipped"
  case timedOut = "timed_out"
  case actionRequired = "action_required"
}

enum ConvexGithubCheckRunsStatusEnum: String, Decodable {
  case queued = "queued"
  case inProgress = "in_progress"
  case completed = "completed"
  case pending = "pending"
  case waiting = "waiting"
}

enum ConvexGithubCheckRunsConclusionEnum: String, Decodable {
  case success = "success"
  case failure = "failure"
  case neutral = "neutral"
  case cancelled = "cancelled"
  case skipped = "skipped"
  case timedOut = "timed_out"
  case actionRequired = "action_required"
}

enum ConvexGithubDeploymentsStateEnum: String, Decodable {
  case error = "error"
  case failure = "failure"
  case pending = "pending"
  case inProgress = "in_progress"
  case queued = "queued"
  case success = "success"
}

enum ConvexGithubCommitStatusesStateEnum: String, Decodable {
  case error = "error"
  case failure = "failure"
  case pending = "pending"
  case success = "success"
}

enum ConvexTaskNotificationsTypeEnum: String, Decodable {
  case runCompleted = "run_completed"
  case runFailed = "run_failed"
}

enum ConvexConversationsStatusEnum: String, Decodable {
  case active = "active"
  case completed = "completed"
  case cancelled = "cancelled"
  case error = "error"
}

enum ConvexConversationsStopReasonEnum: String, Decodable {
  case endTurn = "end_turn"
  case maxTokens = "max_tokens"
  case maxTurnRequests = "max_turn_requests"
  case refusal = "refusal"
  case cancelled = "cancelled"
}

enum ConvexConversationsIsolationModeEnum: String, Decodable {
  case none = "none"
  case sharedNamespace = "shared_namespace"
  case dedicatedNamespace = "dedicated_namespace"
}

struct ConvexConversationsModesAvailableModesItem: Decodable {
  let id: String
  let name: String
  let description: String?
}

struct ConvexConversationsModes: Decodable {
  let currentModeId: String
  let availableModes: [ConvexConversationsModesAvailableModesItem]
}

struct ConvexConversationsAgentInfo: Decodable {
  let name: String
  let version: String
  let title: String?
}

enum ConvexConversationMessagesRoleEnum: String, Decodable {
  case user = "user"
  case assistant = "assistant"
}

enum ConvexConversationMessagesContentItemTypeEnum: String, Decodable {
  case text = "text"
  case image = "image"
  case audio = "audio"
  case resourceLink = "resource_link"
  case resource = "resource"
}

struct ConvexConversationMessagesContentItemResource: Decodable {
  let uri: String
  let text: String?
  let blob: String?
  let mimeType: String?
}

struct ConvexConversationMessagesContentItemAnnotations: Decodable {
  let audience: [String]?
  let lastModified: String?
  @OptionalConvexFloat var priority: Double?
}

struct ConvexConversationMessagesContentItem: Decodable {
  let type: ConvexConversationMessagesContentItemTypeEnum
  let text: String?
  let data: String?
  let mimeType: String?
  let uri: String?
  let resource: ConvexConversationMessagesContentItemResource?
  let name: String?
  let description: String?
  @OptionalConvexFloat var size: Double?
  let title: String?
  let annotations: ConvexConversationMessagesContentItemAnnotations?
}

enum ConvexConversationMessagesToolCallsItemStatusEnum: String, Decodable {
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
}

struct ConvexConversationMessagesToolCallsItem: Decodable {
  let id: String
  let name: String
  let arguments: String
  let status: ConvexConversationMessagesToolCallsItemStatusEnum
  let result: String?
}

enum ConvexAcpSandboxesProviderEnum: String, Decodable {
  case morph = "morph"
  case freestyle = "freestyle"
  case daytona = "daytona"
}

enum ConvexAcpSandboxesStatusEnum: String, Decodable {
  case starting = "starting"
  case running = "running"
  case paused = "paused"
  case stopped = "stopped"
  case error = "error"
}

struct ConvexTeams: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let teamId: String
  let slug: String?
  let displayName: String?
  let name: String?
  let profileImageUrl: String?
  let clientMetadata: ConvexValue?
  let clientReadOnlyMetadata: ConvexValue?
  let serverMetadata: ConvexValue?
  @OptionalConvexFloat var createdAtMillis: Double?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexTeamMemberships: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let teamId: String
  let userId: String
  let role: ConvexTeamMembershipsRoleEnum?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexTeamPermissions: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let teamId: String
  let userId: String
  let permissionId: String
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexUsers: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let userId: String
  let primaryEmail: String?
  let primaryEmailVerified: Bool?
  let primaryEmailAuthEnabled: Bool?
  let displayName: String?
  let profileImageUrl: String?
  let selectedTeamId: String?
  let selectedTeamDisplayName: String?
  let selectedTeamProfileImageUrl: String?
  let hasPassword: Bool?
  let otpAuthEnabled: Bool?
  let passkeyAuthEnabled: Bool?
  @OptionalConvexFloat var signedUpAtMillis: Double?
  @OptionalConvexFloat var lastActiveAtMillis: Double?
  let clientMetadata: ConvexValue?
  let clientReadOnlyMetadata: ConvexValue?
  let serverMetadata: ConvexValue?
  let oauthProviders: [ConvexUsersOauthProvidersItem]?
  let isAnonymous: Bool?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexTasks: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let text: String
  let isCompleted: Bool
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
  @OptionalConvexFloat var createdAt: Double?
  @OptionalConvexFloat var updatedAt: Double?
  @OptionalConvexFloat var lastActivityAt: Double?
  let userId: String
  let teamId: String
  let environmentId: String?
  let crownEvaluationStatus: ConvexTasksCrownEvaluationStatusEnum?
  let crownEvaluationError: String?
  let mergeStatus: ConvexTasksMergeStatusEnum?
  let images: [ConvexTasksImagesItem]?
  let screenshotStatus: ConvexTasksScreenshotStatusEnum?
  let screenshotRunId: String?
  let screenshotRequestId: String?
  @OptionalConvexFloat var screenshotRequestedAt: Double?
  @OptionalConvexFloat var screenshotCompletedAt: Double?
  let screenshotError: String?
  let screenshotStorageId: String?
  let screenshotMimeType: String?
  let screenshotFileName: String?
  let screenshotCommitSha: String?
  let latestScreenshotSetId: String?
}

struct ConvexTaskRuns: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let taskId: String
  let parentRunId: String?
  let prompt: String
  let agentName: String?
  let summary: String?
  let status: ConvexTaskRunsStatusEnum
  let isArchived: Bool?
  let isLocalWorkspace: Bool?
  let isCloudWorkspace: Bool?
  let isPreviewJob: Bool?
  let log: String?
  let worktreePath: String?
  let newBranch: String?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
  @OptionalConvexFloat var completedAt: Double?
  @OptionalConvexFloat var exitCode: Double?
  let environmentError: ConvexTaskRunsEnvironmentError?
  let errorMessage: String?
  let userId: String
  let teamId: String
  let environmentId: String?
  let isCrowned: Bool?
  let crownReason: String?
  let pullRequestUrl: String?
  let pullRequestIsDraft: Bool?
  let pullRequestState: ConvexTaskRunsPullRequestStateEnum?
  @OptionalConvexFloat var pullRequestNumber: Double?
  let pullRequests: [ConvexTaskRunsPullRequestsItem]?
  @OptionalConvexFloat var diffsLastUpdated: Double?
  let screenshotStorageId: String?
  @OptionalConvexFloat var screenshotCapturedAt: Double?
  let screenshotMimeType: String?
  let screenshotFileName: String?
  let screenshotCommitSha: String?
  let latestScreenshotSetId: String?
  let vscode: ConvexTaskRunsVscode?
  let networking: [ConvexTaskRunsNetworkingItem]?
  let customPreviews: [ConvexTaskRunsCustomPreviewsItem]?
}

struct ConvexTaskRunPullRequests: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let taskRunId: String
  let teamId: String
  let repoFullName: String
  @ConvexFloat var prNumber: Double
  @ConvexFloat var createdAt: Double
}

struct ConvexTaskRunScreenshotSets: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let taskId: String
  let runId: String
  let status: ConvexTaskRunScreenshotSetsStatusEnum
  let hasUiChanges: Bool?
  let commitSha: String?
  @ConvexFloat var capturedAt: Double
  let error: String?
  let images: [ConvexTaskRunScreenshotSetsImagesItem]
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexTaskVersions: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let taskId: String
  @ConvexFloat var version: Double
  let diff: String
  let summary: String
  @ConvexFloat var createdAt: Double
  let userId: String
  let teamId: String
  let files: [ConvexTaskVersionsFilesItem]
}

struct ConvexAutomatedCodeReviewJobs: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let teamId: String?
  let repoFullName: String
  let repoUrl: String
  @OptionalConvexFloat var prNumber: Double?
  let commitRef: String
  let headCommitRef: String?
  let baseCommitRef: String?
  let requestedByUserId: String
  let jobType: ConvexAutomatedCodeReviewJobsJobTypeEnum?
  let comparisonSlug: String?
  let comparisonBaseOwner: String?
  let comparisonBaseRef: String?
  let comparisonHeadOwner: String?
  let comparisonHeadRef: String?
  let state: ConvexAutomatedCodeReviewJobsStateEnum
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
  @OptionalConvexFloat var startedAt: Double?
  @OptionalConvexFloat var completedAt: Double?
  let sandboxInstanceId: String?
  let callbackTokenHash: String?
  @OptionalConvexFloat var callbackTokenIssuedAt: Double?
  let errorCode: String?
  let errorDetail: String?
  let codeReviewOutput: [String: ConvexValue]?
}

struct ConvexAutomatedCodeReviewVersions: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let jobId: String
  let teamId: String?
  let requestedByUserId: String
  let repoFullName: String
  let repoUrl: String
  @OptionalConvexFloat var prNumber: Double?
  let commitRef: String
  let headCommitRef: String?
  let baseCommitRef: String?
  let jobType: ConvexAutomatedCodeReviewVersionsJobTypeEnum?
  let comparisonSlug: String?
  let comparisonBaseOwner: String?
  let comparisonBaseRef: String?
  let comparisonHeadOwner: String?
  let comparisonHeadRef: String?
  let sandboxInstanceId: String?
  let codeReviewOutput: [String: ConvexValue]
  @ConvexFloat var createdAt: Double
}

struct ConvexAutomatedCodeReviewFileOutputs: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let jobId: String
  let teamId: String?
  let repoFullName: String
  @OptionalConvexFloat var prNumber: Double?
  let commitRef: String
  let headCommitRef: String?
  let baseCommitRef: String?
  let jobType: ConvexAutomatedCodeReviewFileOutputsJobTypeEnum?
  let comparisonSlug: String?
  let comparisonBaseOwner: String?
  let comparisonBaseRef: String?
  let comparisonHeadOwner: String?
  let comparisonHeadRef: String?
  let sandboxInstanceId: String?
  let filePath: String
  let codexReviewOutput: ConvexValue
  let tooltipLanguage: String?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexRepos: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let fullName: String
  let org: String
  let name: String
  let gitRemote: String
  let provider: String?
  let userId: String
  let teamId: String
  @OptionalConvexFloat var providerRepoId: Double?
  let ownerLogin: String?
  let ownerType: ConvexReposOwnerTypeEnum?
  let visibility: ConvexReposVisibilityEnum?
  let defaultBranch: String?
  let connectionId: String?
  @OptionalConvexFloat var lastSyncedAt: Double?
  @OptionalConvexFloat var lastPushedAt: Double?
  let manual: Bool?
}

struct ConvexBranches: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let repo: String
  let repoId: String?
  let name: String
  let userId: String
  let teamId: String
  let lastCommitSha: String?
  @OptionalConvexFloat var lastActivityAt: Double?
  let lastKnownBaseSha: String?
  let lastKnownMergeCommitSha: String?
}

struct ConvexTaskRunLogChunks: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let taskRunId: String
  let content: String
  let userId: String
  let teamId: String
}

struct ConvexApiKeys: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let envVar: String
  let value: String
  let displayName: String
  let description: String?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
  let userId: String
  let teamId: String
}

struct ConvexWorkspaceSettings: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let worktreePath: String?
  let autoPrEnabled: Bool?
  @OptionalConvexFloat var nextLocalWorkspaceSequence: Double?
  let heatmapModel: String?
  @OptionalConvexFloat var heatmapThreshold: Double?
  let heatmapTooltipLanguage: String?
  let heatmapColors: ConvexWorkspaceSettingsHeatmapColors?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
  let userId: String
  let teamId: String
}

struct ConvexWorkspaceConfigs: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let projectFullName: String
  let maintenanceScript: String?
  let dataVaultKey: String?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
  let userId: String
  let teamId: String
}

struct ConvexPreviewConfigs: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let teamId: String
  let createdByUserId: String?
  let repoFullName: String
  let repoProvider: String?
  @OptionalConvexFloat var repoInstallationId: Double?
  let repoDefaultBranch: String?
  let environmentId: String?
  let status: ConvexPreviewConfigsStatusEnum?
  @OptionalConvexFloat var lastRunAt: Double?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexPreviewRuns: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let previewConfigId: String
  let teamId: String
  let repoFullName: String
  @OptionalConvexFloat var repoInstallationId: Double?
  @ConvexFloat var prNumber: Double
  let prUrl: String
  let prTitle: String?
  let prDescription: String?
  let headSha: String
  let baseSha: String?
  let headRef: String?
  let headRepoFullName: String?
  let headRepoCloneUrl: String?
  let taskRunId: String?
  let status: ConvexPreviewRunsStatusEnum
  let supersededBy: String?
  let stateReason: String?
  @OptionalConvexFloat var dispatchedAt: Double?
  @OptionalConvexFloat var startedAt: Double?
  @OptionalConvexFloat var completedAt: Double?
  let screenshotSetId: String?
  let githubCommentUrl: String?
  @OptionalConvexFloat var githubCommentId: Double?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexCrownEvaluations: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let taskId: String
  @ConvexFloat var evaluatedAt: Double
  let winnerRunId: String
  let candidateRunIds: [String]
  let evaluationPrompt: String
  let evaluationResponse: String
  @ConvexFloat var createdAt: Double
  let userId: String
  let teamId: String
}

struct ConvexContainerSettings: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  @OptionalConvexFloat var maxRunningContainers: Double?
  @OptionalConvexFloat var reviewPeriodMinutes: Double?
  let autoCleanupEnabled: Bool?
  let stopImmediatelyOnCompletion: Bool?
  @OptionalConvexFloat var minContainersToKeep: Double?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
  let userId: String
  let teamId: String
}

struct ConvexUserEditorSettings: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let teamId: String
  let userId: String
  let settingsJson: String?
  let keybindingsJson: String?
  let snippets: [ConvexUserEditorSettingsSnippetsItem]?
  let extensions: String?
  @ConvexFloat var updatedAt: Double
}

struct ConvexTaskComments: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let taskId: String
  let content: String
  let userId: String
  let teamId: String
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexComments: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let url: String
  let page: String
  let pageTitle: String
  let nodeId: String
  @ConvexFloat var x: Double
  @ConvexFloat var y: Double
  let content: String
  let resolved: Bool?
  let archived: Bool?
  let userId: String
  let teamId: String
  let profileImageUrl: String?
  let userAgent: String
  @ConvexFloat var screenWidth: Double
  @ConvexFloat var screenHeight: Double
  @ConvexFloat var devicePixelRatio: Double
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexCommentReplies: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let commentId: String
  let userId: String
  let teamId: String
  let content: String
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexProviderConnections: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let teamId: String?
  let connectedByUserId: String?
  let type: String
  @ConvexFloat var installationId: Double
  let accountLogin: String?
  @OptionalConvexFloat var accountId: Double?
  let accountType: ConvexProviderConnectionsAccountTypeEnum?
  let isActive: Bool?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexEnvironments: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let name: String
  let teamId: String
  let userId: String
  let morphSnapshotId: String
  let dataVaultKey: String
  let selectedRepos: [String]?
  let description: String?
  let maintenanceScript: String?
  let devScript: String?
  let exposedPorts: [Double]?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexEnvironmentSnapshotVersions: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let environmentId: String
  let teamId: String
  let morphSnapshotId: String
  @ConvexFloat var version: Double
  @ConvexFloat var createdAt: Double
  let createdByUserId: String
  let label: String?
  let maintenanceScript: String?
  let devScript: String?
}

struct ConvexWebhookDeliveries: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let provider: String
  let deliveryId: String
  @OptionalConvexFloat var installationId: Double?
  let payloadHash: String
  @ConvexFloat var receivedAt: Double
}

struct ConvexInstallStates: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let nonce: String
  let teamId: String
  let userId: String
  @ConvexFloat var iat: Double
  @ConvexFloat var exp: Double
  let status: ConvexInstallStatesStatusEnum
  @ConvexFloat var createdAt: Double
  let returnUrl: String?
}

struct ConvexPullRequests: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let provider: String
  @ConvexFloat var installationId: Double
  @OptionalConvexFloat var repositoryId: Double?
  let repoFullName: String
  @ConvexFloat var number: Double
  @OptionalConvexFloat var providerPrId: Double?
  let teamId: String
  let title: String
  let state: ConvexPullRequestsStateEnum
  let merged: Bool?
  let draft: Bool?
  let authorLogin: String?
  @OptionalConvexFloat var authorId: Double?
  let htmlUrl: String?
  let baseRef: String?
  let headRef: String?
  let baseSha: String?
  let headSha: String?
  let mergeCommitSha: String?
  @OptionalConvexFloat var createdAt: Double?
  @OptionalConvexFloat var updatedAt: Double?
  @OptionalConvexFloat var closedAt: Double?
  @OptionalConvexFloat var mergedAt: Double?
  @OptionalConvexFloat var commentsCount: Double?
  @OptionalConvexFloat var reviewCommentsCount: Double?
  @OptionalConvexFloat var commitsCount: Double?
  @OptionalConvexFloat var additions: Double?
  @OptionalConvexFloat var deletions: Double?
  @OptionalConvexFloat var changedFiles: Double?
}

struct ConvexGithubWorkflowRuns: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let provider: String
  @ConvexFloat var installationId: Double
  @OptionalConvexFloat var repositoryId: Double?
  let repoFullName: String
  @ConvexFloat var runId: Double
  @ConvexFloat var runNumber: Double
  let teamId: String
  @ConvexFloat var workflowId: Double
  let workflowName: String
  let name: String?
  let event: String
  let status: ConvexGithubWorkflowRunsStatusEnum?
  let conclusion: ConvexGithubWorkflowRunsConclusionEnum?
  let headBranch: String?
  let headSha: String?
  let htmlUrl: String?
  @OptionalConvexFloat var createdAt: Double?
  @OptionalConvexFloat var updatedAt: Double?
  @OptionalConvexFloat var runStartedAt: Double?
  @OptionalConvexFloat var runCompletedAt: Double?
  @OptionalConvexFloat var runDuration: Double?
  let actorLogin: String?
  @OptionalConvexFloat var actorId: Double?
  @OptionalConvexFloat var triggeringPrNumber: Double?
}

struct ConvexGithubCheckRuns: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let provider: String
  @ConvexFloat var installationId: Double
  @OptionalConvexFloat var repositoryId: Double?
  let repoFullName: String
  @ConvexFloat var checkRunId: Double
  let teamId: String
  let name: String
  let status: ConvexGithubCheckRunsStatusEnum?
  let conclusion: ConvexGithubCheckRunsConclusionEnum?
  let headSha: String
  let htmlUrl: String?
  @OptionalConvexFloat var updatedAt: Double?
  @OptionalConvexFloat var startedAt: Double?
  @OptionalConvexFloat var completedAt: Double?
  let appName: String?
  let appSlug: String?
  @OptionalConvexFloat var triggeringPrNumber: Double?
}

struct ConvexGithubDeployments: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let provider: String
  @ConvexFloat var installationId: Double
  @OptionalConvexFloat var repositoryId: Double?
  let repoFullName: String
  @ConvexFloat var deploymentId: Double
  let teamId: String
  let sha: String
  let ref: String?
  let task: String?
  let environment: String?
  let description: String?
  let creatorLogin: String?
  @OptionalConvexFloat var createdAt: Double?
  @OptionalConvexFloat var updatedAt: Double?
  let state: ConvexGithubDeploymentsStateEnum?
  let statusDescription: String?
  let targetUrl: String?
  let environmentUrl: String?
  let logUrl: String?
  @OptionalConvexFloat var triggeringPrNumber: Double?
}

struct ConvexGithubCommitStatuses: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let provider: String
  @ConvexFloat var installationId: Double
  @OptionalConvexFloat var repositoryId: Double?
  let repoFullName: String
  @ConvexFloat var statusId: Double
  let teamId: String
  let sha: String
  let state: ConvexGithubCommitStatusesStateEnum
  let context: String
  let description: String?
  let targetUrl: String?
  let creatorLogin: String?
  @OptionalConvexFloat var createdAt: Double?
  @OptionalConvexFloat var updatedAt: Double?
  @OptionalConvexFloat var triggeringPrNumber: Double?
}

struct ConvexHostScreenshotCollectorReleases: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let version: String
  let commitSha: String
  let storageId: String
  let isStaging: Bool
  let isLatest: Bool
  let releaseUrl: String?
  @ConvexFloat var createdAt: Double
}

struct ConvexTaskNotifications: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let taskId: String
  let taskRunId: String?
  let teamId: String
  let userId: String
  let type: ConvexTaskNotificationsTypeEnum
  let message: String?
  @OptionalConvexFloat var readAt: Double?
  @ConvexFloat var createdAt: Double
}

struct ConvexUnreadTaskRuns: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let taskRunId: String
  let taskId: String?
  let userId: String
  let teamId: String
}

struct ConvexMorphInstanceActivity: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let instanceId: String
  @OptionalConvexFloat var lastPausedAt: Double?
  @OptionalConvexFloat var lastResumedAt: Double?
  @OptionalConvexFloat var stoppedAt: Double?
}

struct ConvexConversations: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let teamId: String
  let userId: String?
  let sessionId: String
  let providerId: String
  let cwd: String
  let status: ConvexConversationsStatusEnum
  let stopReason: ConvexConversationsStopReasonEnum?
  let namespaceId: String?
  let sandboxInstanceId: String?
  let isolationMode: ConvexConversationsIsolationModeEnum?
  let modes: ConvexConversationsModes?
  let agentInfo: ConvexConversationsAgentInfo?
  let acpSandboxId: String?
  let initializedOnSandbox: Bool?
  @OptionalConvexFloat var lastMessageAt: Double?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct ConvexConversationMessages: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let conversationId: String
  let role: ConvexConversationMessagesRoleEnum
  let content: [ConvexConversationMessagesContentItem]
  let toolCalls: [ConvexConversationMessagesToolCallsItem]?
  let reasoning: String?
  @ConvexFloat var createdAt: Double
}

struct ConvexAcpSandboxes: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let teamId: String
  let provider: ConvexAcpSandboxesProviderEnum
  let instanceId: String
  let status: ConvexAcpSandboxesStatusEnum
  let sandboxUrl: String?
  let callbackJwtHash: String
  @ConvexFloat var lastActivityAt: Double
  @ConvexFloat var conversationCount: Double
  let snapshotId: String
  @ConvexFloat var createdAt: Double
}

struct ConvexCodexTokens: Decodable {
  let _id: String
  @ConvexFloat var _creationTime: Double
  let userId: String
  let teamId: String
  let accessToken: String
  let refreshToken: String
  let idToken: String?
  let accountId: String?
  let planType: String?
  let email: String?
  @ConvexFloat var expiresAt: Double
  @ConvexFloat var lastRefresh: Double
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

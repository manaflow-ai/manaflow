import Foundation
import Combine
import ConvexMobile

/// ViewModel for managing conversations list from Convex
@MainActor
class ConversationsViewModel: ObservableObject {
    @Published var conversations: [ConvexConversation] = []
    @Published var isLoading = true
    @Published var error: String?
    @Published var isLoadingMore = false
    @Published var hasMore = false

    private var cancellables = Set<AnyCancellable>()
    private var teamId: String?
    private let convex = ConvexClientManager.shared
    private var lastPrewarmAt: Date?
    private var firstPage: [ConvexConversation] = []
    private var extraConversations: [ConvexConversation] = []
    private var continueCursor: String?
    private var lastLoadedCursor: String?
    private let pageSize: Double = 50

    init() {
        // Start loading when auth is ready
        Task {
            await loadConversations()
        }
    }

    /// Create a new conversation with sandbox
    /// Returns the conversation ID on success
    func createConversation(initialMessage: String) async throws -> String {
        var teamId = self.teamId
        if teamId == nil {
            teamId = await getFirstTeamId()
        }
        guard let teamId else {
            throw ConversationError.noTeam
        }

        print("📱 ConversationsViewModel: Creating conversation for team \(teamId)")

        // Call acp:startConversation action
        let startArgs = AcpStartConversationArgs(
            sandboxId: nil,
            providerId: .claude,
            cwd: "/workspace",
            teamSlugOrId: teamId
        )
        let response: AcpStartConversationReturn = try await convex.client.action(
            "acp:startConversation",
            with: startArgs.asDictionary()
        )

        print("📱 ConversationsViewModel: Created conversation \(response.conversationId), status: \(response.status)")

        // Send initial message if provided
        if !initialMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let contentItem = AcpSendMessageArgsContentItem(
                name: nil,
                text: initialMessage,
                mimeType: nil,
                data: nil,
                uri: nil,
                type: .text
            )
            let sendArgs = AcpSendMessageArgs(
                content: [contentItem],
                conversationId: response.conversationId
            )

            let _: AcpSendMessageReturn = try await convex.client.action(
                "acp:sendMessage",
                with: sendArgs.asDictionary()
            )
            print("📱 ConversationsViewModel: Sent initial message")
        }

        return response.conversationId.rawValue
    }

    func loadConversations() async {
        // Wait for auth with retry loop (up to 30 seconds)
        var attempts = 0
        while !convex.isAuthenticated && attempts < 30 {
            print("📱 ConversationsViewModel: Not authenticated, waiting... (attempt \(attempts + 1))")
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            attempts += 1
        }

        guard convex.isAuthenticated else {
            print("📱 ConversationsViewModel: Auth timeout")
            error = "Authentication timeout"
            isLoading = false
            return
        }

        // Get team ID first
        guard let teamId = await getFirstTeamId() else {
            print("📱 ConversationsViewModel: Failed to get team ID")
            error = "Failed to get team"
            isLoading = false
            return
        }

        self.teamId = teamId
        self.firstPage = []
        self.extraConversations = []
        self.continueCursor = nil
        self.lastLoadedCursor = nil
        self.hasMore = false
        self.isLoadingMore = false
        NSLog("📱 ConversationsViewModel: Using team \(teamId)")

        // Subscribe to conversations (paginated response)
        let paginationOpts = ConversationsListPagedWithLatestArgsPaginationOpts(
            id: nil,
            endCursor: nil,
            maximumRowsRead: nil,
            maximumBytesRead: nil,
            numItems: pageSize,
            cursor: nil
        )
        let listArgs = ConversationsListPagedWithLatestArgs(
            teamSlugOrId: teamId,
            paginationOpts: paginationOpts,
            scope: .all
        )
        convex.client
            .subscribe(
                to: "conversations:listPagedWithLatest",
                with: listArgs.asDictionary(),
                yielding: ConversationsPage.self
            )
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    if case .failure(let err) = completion {
                        print("📱 ConversationsViewModel: Subscription error: \(err)")
                        self?.error = err.localizedDescription
                        self?.isLoading = false
                    }
                },
                receiveValue: { [weak self] page in
                    guard let self else { return }
                    NSLog("📱 ConversationsViewModel: Received \(page.page.count) conversations (isDone: \(page.isDone), cursor: \(page.continueCursor))")
                    self.firstPage = page.page
                    if self.extraConversations.isEmpty && self.lastLoadedCursor == nil {
                        self.continueCursor = page.isDone ? nil : page.continueCursor
                        self.hasMore = !page.isDone
                    }
                    self.conversations = self.mergeConversations(firstPage: page.page)
                    self.isLoading = false
                }
            )
            .store(in: &cancellables)
    }

    func loadMore() async {
        guard !isLoadingMore, hasMore else {
            return
        }
        guard let teamId else {
            return
        }
        guard let cursor = continueCursor else {
            hasMore = false
            return
        }
        if cursor == lastLoadedCursor {
            NSLog("📱 ConversationsViewModel: Skipping load; cursor already loaded")
            return
        }

        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            NSLog("📱 ConversationsViewModel: Loading more (cursor: \(cursor))")
            let paginationOpts = ConversationsListPagedWithLatestArgsPaginationOpts(
                id: nil,
                endCursor: nil,
                maximumRowsRead: nil,
                maximumBytesRead: nil,
                numItems: pageSize,
                cursor: cursor
            )
            let listArgs = ConversationsListPagedWithLatestArgs(
                teamSlugOrId: teamId,
                paginationOpts: paginationOpts,
                scope: .all
            )

            let page = try await fetchPage(args: listArgs)
            NSLog("📱 ConversationsViewModel: Load more received \(page.page.count) conversations")
            let appendedCount = appendExtraConversations(page.page)
            lastLoadedCursor = cursor
            continueCursor = page.isDone ? nil : page.continueCursor
            hasMore = !page.isDone
            if appendedCount == 0 {
                NSLog("📱 ConversationsViewModel: No new conversations appended; stopping pagination")
                hasMore = false
            }
            conversations = mergeConversations(firstPage: firstPage)
        } catch {
            NSLog("📱 ConversationsViewModel: Load more failed: \(error)")
        }
    }

    func prewarmSandbox() async {
        if let lastPrewarmAt, Date().timeIntervalSince(lastPrewarmAt) < 10 {
            return
        }
        lastPrewarmAt = Date()

        guard convex.isAuthenticated else {
            return
        }

        var teamId = self.teamId
        if teamId == nil {
            teamId = await getFirstTeamId()
        }
        guard let teamId else {
            return
        }

        do {
            let args = AcpPrewarmSandboxArgs(teamSlugOrId: teamId)
            let _: AcpPrewarmSandboxReturn = try await convex.client.action(
                "acp:prewarmSandbox",
                with: args.asDictionary()
            )
        } catch {
            print("📱 ConversationsViewModel: Prewarm failed: \(error)")
        }
    }

    private func getFirstTeamId() async -> String? {
        return await withCheckedContinuation { continuation in
            var cancellable: AnyCancellable?
            cancellable = convex.client
                .subscribe(to: "teams:listTeamMemberships", yielding: TeamsListTeamMembershipsReturn.self)
                .first()
                .receive(on: DispatchQueue.main)
                .sink(
                    receiveCompletion: { completion in
                        if case .failure = completion {
                            continuation.resume(returning: nil)
                        }
                        cancellable?.cancel()
                    },
                    receiveValue: { memberships in
                        // Use Stack Auth UUID (teamId) for queries
                        if let first = memberships.first {
                            print("📱 ConversationsViewModel: Team '\(first.team.displayName ?? "?")' teamId: \(first.teamId)")
                        }
                        continuation.resume(returning: memberships.first?.teamId)
                    }
                )
        }
    }

    private func fetchPage(args: ConversationsListPagedWithLatestArgs) async throws -> ConversationsListPagedWithLatestReturn {
        try await withCheckedThrowingContinuation { continuation in
            var cancellable: AnyCancellable?
            cancellable = convex.client
                .subscribe(
                    to: "conversations:listPagedWithLatest",
                    with: args.asDictionary(),
                    yielding: ConversationsPage.self
                )
                .first()
                .receive(on: DispatchQueue.main)
                .sink(
                    receiveCompletion: { completion in
                        if case .failure(let error) = completion {
                            print("📱 ConversationsViewModel: Page fetch error: \(error)")
                            continuation.resume(throwing: error)
                        }
                        cancellable?.cancel()
                    },
                    receiveValue: { page in
                        continuation.resume(returning: page)
                    }
                )
        }
    }

    private func appendExtraConversations(_ page: [ConvexConversation]) -> Int {
        let existingIds = Set(extraConversations.map(\.id))
        let firstPageIds = Set(firstPage.map(\.id))
        let newItems = page.filter { !existingIds.contains($0.id) && !firstPageIds.contains($0.id) }
        extraConversations.append(contentsOf: newItems)
        return newItems.count
    }

    private func mergeConversations(firstPage: [ConvexConversation]) -> [ConvexConversation] {
        let firstIds = Set(firstPage.map(\.id))
        let extras = extraConversations.filter { !firstIds.contains($0.id) }
        return firstPage + extras
    }
}

// MARK: - Create Conversation Types

enum ConversationError: LocalizedError {
    case noTeam
    case createFailed(String)

    var errorDescription: String? {
        switch self {
        case .noTeam:
            return "No team available"
        case .createFailed(let message):
            return "Failed to create conversation: \(message)"
        }
    }
}

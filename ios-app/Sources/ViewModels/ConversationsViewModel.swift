import Foundation
import Combine
import ConvexMobile

/// ViewModel for managing conversations list from Convex
@MainActor
class ConversationsViewModel: ObservableObject {
    @Published var conversations: [ConvexConversation] = []
    @Published var isLoading = true
    @Published var error: String?

    private var cancellables = Set<AnyCancellable>()
    private var teamId: String?
    private let convex = ConvexClientManager.shared

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
        print("📱 ConversationsViewModel: Using team \(teamId)")

        // Subscribe to conversations (paginated response)
        let listArgs = ConversationsListArgs(status: nil, limit: nil, cursor: nil, teamSlugOrId: teamId)
        convex.client
            .subscribe(to: "conversations:list", with: listArgs.asDictionary(), yielding: ConversationsPage.self)
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
                    print("📱 ConversationsViewModel: Received \(page.conversations.count) conversations")
                    self?.conversations = page.conversations
                    self?.isLoading = false
                }
            )
            .store(in: &cancellables)
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

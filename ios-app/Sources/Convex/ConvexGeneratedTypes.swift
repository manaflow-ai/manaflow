import Foundation

// Convenience aliases for generated Convex API types

typealias ConversationsPage = ConversationsListReturn
typealias ConvexConversation = ConversationsListReturnConversationsItem
typealias MessagesPage = ConversationMessagesListByConversationReturn
typealias ConvexMessage = ConversationMessagesListByConversationReturnMessagesItem
typealias ConvexContentBlock = ConversationMessagesListByConversationReturnMessagesItemContentItem
typealias ConvexToolCall = ConversationMessagesListByConversationReturnMessagesItemToolCallsItem

extension ConversationsListReturnConversationsItem: Identifiable {
    var id: String { _id.rawValue }
}

extension ConversationsListReturnConversationsItem {
    var providerDisplayName: String {
        switch providerId {
        case "claude": return "Claude"
        case "codex": return "Codex"
        case "gemini": return "Gemini"
        case "opencode": return "OpenCode"
        default: return providerId.capitalized
        }
    }

    var providerIcon: String {
        switch providerId {
        case "claude": return "brain.head.profile"
        case "codex": return "chevron.left.forwardslash.chevron.right"
        case "gemini": return "sparkles"
        case "opencode": return "terminal"
        default: return "cpu"
        }
    }

    var displayTimestamp: Date {
        let timestamp = lastMessageAt ?? updatedAt
        return Date(timeIntervalSince1970: timestamp / 1000)
    }

    var isActive: Bool {
        status == .active
    }
}

extension ConversationMessagesListByConversationReturnMessagesItem: Identifiable {
    var id: String { _id.rawValue }
}

extension ConversationMessagesListByConversationReturnMessagesItem {
    var isFromUser: Bool {
        role == .user
    }

    var textContent: String {
        content
            .filter { $0.type == .text }
            .compactMap { $0.text }
            .joined(separator: "\n")
    }

    var displayTimestamp: Date {
        let timestamp = createdAt
        return Date(timeIntervalSince1970: timestamp / 1000)
    }
}

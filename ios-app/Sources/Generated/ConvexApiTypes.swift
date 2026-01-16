import ConvexMobile
import Foundation

// Generated from /Users/lawrencechen/fun/cmux/packages/convex/convex/_generated/api.d.ts

// Functions: acp.startConversation, acp.sendMessage, codexTokens.get, conversationMessages.listByConversation, conversations.list, teams.listTeamMemberships

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

enum ConvexTableAcpSandboxes {}

enum ConvexTableCodexTokens {}

enum ConvexTableConversationMessages {}

enum ConvexTableConversations {}

enum ConvexTableTeamMemberships {}

enum ConvexTableTeams {}

enum AcpStartConversationArgsProviderIdEnum: String, Encodable, ConvexEncodable {
  case claude = "claude"
  case codex = "codex"
  case gemini = "gemini"
  case opencode = "opencode"
}

enum AcpStartConversationReturnStatusEnum: String, Decodable {
  case starting = "starting"
  case ready = "ready"
}

enum AcpSendMessageArgsContentItemTypeEnum: String, Encodable, ConvexEncodable {
  case text = "text"
  case image = "image"
  case resourceLink = "resource_link"
}

enum AcpSendMessageReturnStatusEnum: String, Decodable {
  case error = "error"
  case sent = "sent"
}

enum ConversationMessagesListByConversationReturnMessagesItemToolCallsItemStatusEnum: String,
  Decodable
{
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
}

enum ConversationMessagesListByConversationReturnMessagesItemRoleEnum: String, Decodable {
  case user = "user"
  case assistant = "assistant"
}

enum ConversationMessagesListByConversationReturnMessagesItemContentItemTypeEnum: String, Decodable
{
  case text = "text"
  case image = "image"
  case audio = "audio"
  case resourceLink = "resource_link"
  case resource = "resource"
}

enum ConversationsListArgsStatusEnum: String, Encodable, ConvexEncodable {
  case error = "error"
  case completed = "completed"
  case active = "active"
  case cancelled = "cancelled"
}

enum ConversationsListReturnConversationsItemPermissionModeEnum: String, Decodable {
  case manual = "manual"
  case autoAllowOnce = "auto_allow_once"
  case autoAllowAlways = "auto_allow_always"
}

enum ConversationsListReturnConversationsItemStopReasonEnum: String, Decodable {
  case cancelled = "cancelled"
  case endTurn = "end_turn"
  case maxTokens = "max_tokens"
  case maxTurnRequests = "max_turn_requests"
  case refusal = "refusal"
}

enum ConversationsListReturnConversationsItemIsolationModeEnum: String, Decodable {
  case none = "none"
  case sharedNamespace = "shared_namespace"
  case dedicatedNamespace = "dedicated_namespace"
}

enum ConversationsListReturnConversationsItemStatusEnum: String, Decodable {
  case error = "error"
  case completed = "completed"
  case active = "active"
  case cancelled = "cancelled"
}

enum TeamsListTeamMembershipsItemRoleEnum: String, Decodable {
  case owner = "owner"
  case member = "member"
}

struct AcpStartConversationReturn: Decodable {
  let conversationId: ConvexId<ConvexTableConversations>
  let sandboxId: ConvexId<ConvexTableAcpSandboxes>
  let status: AcpStartConversationReturnStatusEnum
}

struct AcpSendMessageArgsContentItem: ConvexEncodable {
  let name: String?
  let text: String?
  let mimeType: String?
  let data: String?
  let uri: String?
  let type: AcpSendMessageArgsContentItemTypeEnum

  func convexEncode() throws -> String {
    var result: [String: ConvexEncodable?] = [:]
    if let value = name { result["name"] = value }
    if let value = text { result["text"] = value }
    if let value = mimeType { result["mimeType"] = value }
    if let value = data { result["data"] = value }
    if let value = uri { result["uri"] = value }
    result["type"] = type
    return try result.convexEncode()
  }
}

struct AcpSendMessageReturn: Decodable {
  let messageId: ConvexId<ConvexTableConversationMessages>
  let status: AcpSendMessageReturnStatusEnum
  let error: String?
}

struct CodexTokensGetReturn: Decodable {
  let _id: ConvexId<ConvexTableCodexTokens>
  @ConvexFloat var _creationTime: Double
  let accountId: String?
  let email: String?
  let idToken: String?
  let planType: String?
  let teamId: String
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
  let userId: String
  let accessToken: String
  let refreshToken: String
  @ConvexFloat var expiresAt: Double
  @ConvexFloat var lastRefresh: Double
}

struct ConversationMessagesListByConversationReturnMessagesItemToolCallsItem: Decodable {
  let result: String?
  let id: String
  let name: String
  let status: ConversationMessagesListByConversationReturnMessagesItemToolCallsItemStatusEnum
  let arguments: String
}

struct ConversationMessagesListByConversationReturnMessagesItemContentItemResource: Decodable {
  let text: String?
  let mimeType: String?
  let blob: String?
  let uri: String
}

struct ConversationMessagesListByConversationReturnMessagesItemContentItemAnnotations: Decodable {
  let audience: [String]?
  let lastModified: String?
  @OptionalConvexFloat var priority: Double?
}

struct ConversationMessagesListByConversationReturnMessagesItemContentItem: Decodable {
  let name: String?
  let text: String?
  let description: String?
  let mimeType: String?
  let title: String?
  let resource: ConversationMessagesListByConversationReturnMessagesItemContentItemResource?
  let data: String?
  let uri: String?
  @OptionalConvexFloat var size: Double?
  let annotations: ConversationMessagesListByConversationReturnMessagesItemContentItemAnnotations?
  let type: ConversationMessagesListByConversationReturnMessagesItemContentItemTypeEnum
}

struct ConversationMessagesListByConversationReturnMessagesItem: Decodable {
  let _id: ConvexId<ConvexTableConversationMessages>
  @ConvexFloat var _creationTime: Double
  let toolCalls: [ConversationMessagesListByConversationReturnMessagesItemToolCallsItem]?
  let reasoning: String?
  @OptionalConvexFloat var acpSeq: Double?
  @ConvexFloat var createdAt: Double
  let role: ConversationMessagesListByConversationReturnMessagesItemRoleEnum
  let content: [ConversationMessagesListByConversationReturnMessagesItemContentItem]
  let conversationId: ConvexId<ConvexTableConversations>
}

struct ConversationMessagesListByConversationReturn: Decodable {
  let messages: [ConversationMessagesListByConversationReturnMessagesItem]
  let nextCursor: String
  let isDone: Bool
}

struct ConversationsListReturnConversationsItemModesAvailableModesItem: Decodable {
  let description: String?
  let id: String
  let name: String
}

struct ConversationsListReturnConversationsItemModes: Decodable {
  let currentModeId: String
  let availableModes: [ConversationsListReturnConversationsItemModesAvailableModesItem]
}

struct ConversationsListReturnConversationsItemAgentInfo: Decodable {
  let title: String?
  let name: String
  let version: String
}

struct ConversationsListReturnConversationsItem: Decodable {
  let _id: ConvexId<ConvexTableConversations>
  @ConvexFloat var _creationTime: Double
  let userId: String?
  let sandboxInstanceId: String?
  let modelId: String?
  let permissionMode: ConversationsListReturnConversationsItemPermissionModeEnum?
  let stopReason: ConversationsListReturnConversationsItemStopReasonEnum?
  let namespaceId: String?
  let isolationMode: ConversationsListReturnConversationsItemIsolationModeEnum?
  let modes: ConversationsListReturnConversationsItemModes?
  let agentInfo: ConversationsListReturnConversationsItemAgentInfo?
  let acpSandboxId: ConvexId<ConvexTableAcpSandboxes>?
  let initializedOnSandbox: Bool?
  @OptionalConvexFloat var lastMessageAt: Double?
  let teamId: String
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
  let status: ConversationsListReturnConversationsItemStatusEnum
  let sessionId: String
  let providerId: String
  let cwd: String
}

struct ConversationsListReturn: Decodable {
  let conversations: [ConversationsListReturnConversationsItem]
  let nextCursor: String
  let isDone: Bool
}

struct TeamsListTeamMembershipsItemTeam: Decodable {
  let _id: ConvexId<ConvexTableTeams>
  @ConvexFloat var _creationTime: Double
  let slug: String?
  let displayName: String?
  let name: String?
  let profileImageUrl: String?
  let clientMetadata: String?
  let clientReadOnlyMetadata: String?
  let serverMetadata: String?
  @OptionalConvexFloat var createdAtMillis: Double?
  let teamId: String
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
}

struct TeamsListTeamMembershipsItem: Decodable {
  let team: TeamsListTeamMembershipsItemTeam
  let _id: ConvexId<ConvexTableTeamMemberships>
  @ConvexFloat var _creationTime: Double
  let role: TeamsListTeamMembershipsItemRoleEnum?
  let teamId: String
  @ConvexFloat var createdAt: Double
  @ConvexFloat var updatedAt: Double
  let userId: String
}

struct AcpStartConversationArgs {
  let sandboxId: ConvexId<ConvexTableAcpSandboxes>?
  let providerId: AcpStartConversationArgsProviderIdEnum
  let cwd: String
  let teamSlugOrId: String

  func asDictionary() -> [String: ConvexEncodable?] {
    var result: [String: ConvexEncodable?] = [:]
    if let value = sandboxId { result["sandboxId"] = value }
    result["providerId"] = providerId
    result["cwd"] = cwd
    result["teamSlugOrId"] = teamSlugOrId
    return result
  }
}

struct AcpSendMessageArgs {
  let content: [AcpSendMessageArgsContentItem]
  let conversationId: ConvexId<ConvexTableConversations>

  func asDictionary() -> [String: ConvexEncodable?] {
    var result: [String: ConvexEncodable?] = [:]
    result["content"] = convexEncodeArray(content)
    result["conversationId"] = conversationId
    return result
  }
}

struct CodexTokensGetArgs {
  let teamSlugOrId: String

  func asDictionary() -> [String: ConvexEncodable?] {
    var result: [String: ConvexEncodable?] = [:]
    result["teamSlugOrId"] = teamSlugOrId
    return result
  }
}

struct ConversationMessagesListByConversationArgs {
  let limit: Double?
  let cursor: String?
  let conversationId: ConvexId<ConvexTableConversations>
  let teamSlugOrId: String

  func asDictionary() -> [String: ConvexEncodable?] {
    var result: [String: ConvexEncodable?] = [:]
    if let value = limit { result["limit"] = value }
    if let value = cursor { result["cursor"] = value }
    result["conversationId"] = conversationId
    result["teamSlugOrId"] = teamSlugOrId
    return result
  }
}

struct ConversationsListArgs {
  let status: ConversationsListArgsStatusEnum?
  let limit: Double?
  let cursor: String?
  let teamSlugOrId: String

  func asDictionary() -> [String: ConvexEncodable?] {
    var result: [String: ConvexEncodable?] = [:]
    if let value = status { result["status"] = value }
    if let value = limit { result["limit"] = value }
    if let value = cursor { result["cursor"] = value }
    result["teamSlugOrId"] = teamSlugOrId
    return result
  }
}

struct TeamsListTeamMembershipsArgs {
  // Unsupported args shape
}

typealias TeamsListTeamMembershipsReturn = [TeamsListTeamMembershipsItem]

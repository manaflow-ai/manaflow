import Foundation
import ConvexMobile

enum UITestMockData {
    private static let jankConversationId = "ts79xr7rr98pbr98rb6vssta75800802"
    private static let jankTranscript: [String] = [
        "optimistic return 1769512215538",
        """
I see you've provided what appears to be a number or identifier: `1769512215538`. Could you please clarify what you'd like me to do with this?

Are you looking to:
- Search for this value in a codebase?
- Convert or interpret this number in some way?
- Something else?

Please provide more context about what task you'd like help with.
"""
    ]
    private static let morphConversationId = "ts7bx1k6fg8swft6edw4ykjg3s805hpj"
    private static let morphTranscript: [String] = [
        "Verify morph snapshot links post-https-fix",
        """
        I'll help you verify morph snapshot links after an HTTPS fix. Let me first explore the codebase to understand what we're working with.
        The exploration didn't find any project source code in the current working directory. Let me check what files and directories are available in the current location.
        There's no project code in the current directory. Let me check if there are any projects or code elsewhere in the system.
        The files found are all from system dependencies, not project source code. There doesn't appear to be a project repository in this environment. Let me check if there's a specific path or recent git history that might give us context about the morph snapshot work.
        No git repositories found. Let me check if there's anything in the user's clipboard or recent file activity that might indicate where the project is located.
        Found a project in `/app/cmux-code`. Let me explore it.
        Based on the exploration, I found that this is a VS Code-based project (cmux-code). The search didn't find any "morph" references, but found snapshot-related code in the heap profiler extension. Let me search more specifically for "morph" in case it's in a different location or format.
        Found "morph" references in multiple files. Let me examine the main workbench file and look for the morph-related code, particularly anything related to snapshots or HTTPS.
        The output is very long. Let me search more specifically for "morph" in the context of snapshots.
        I see - the "morph" references are related to SVG `feMorphology` (an SVG filter element), not a specific "morph snapshot" feature. Let me search more specifically for the actual snapshot link functionality.
        Let me read the extension.js file more carefully to understand the snapshot URI generation.
        Now I have a good understanding. Let me check the protocol handling specifically in this extension. I can see the code checks for `http:` and `https:` protocols. Let me verify the snapshot links are using HTTPS correctly.Based on my analysis of the code, here's what I found regarding the "morph snapshot links post-https-fix":
        
        **Finding:** The "morph" references in this codebase are actually SVG `feMorphology` filter elements (part of DOMPurify sanitization), not a specific "morph snapshot" feature.
        
        **Snapshot Link Generation (extension.js):**
        
        The snapshot URI generation code at `/app/cmux-code/extensions/ms-vscode.vscode-js-profile-table/out/extension.js` shows:
        
        1. **Protocol validation** (line ~1, in the `f` function):
        ```javascript
        if("http:"!==c.protocol&&"https:"!==c.protocol)return!1;
        ```
        This correctly accepts both HTTP and HTTPS protocols.
        
        2. **Snapshot URI generation** uses `asWebviewUri()`:
        ```javascript
        SNAPSHOT_URI:s.asWebviewUri(o).toString()
        ```
        The `asWebviewUri()` method automatically converts file URIs to webview-accessible URIs that use HTTPS in secure contexts.
        
        Let me verify the actual webview URI scheme being used.
        Now I have a complete picture. Let me update the todos and provide a summary.## Verification Results: Morph Snapshot Links Post-HTTPS Fix
        
        ### Summary
        
        I've analyzed the cmux-code (VS Code-based) codebase. Here are the findings:
        
        ### Key Findings
        
        1. **"Morph" Clarification**: The "morph" references found are SVG `feMorphology` elements (part of DOMPurify's allowed SVG filters list), not a dedicated "morph snapshot" feature.
        
        2. **Snapshot Link HTTPS Support - VERIFIED**:
        
           **Extension Code** (`/app/cmux-code/extensions/ms-vscode.vscode-js-profile-table/out/extension.js`):
           - Protocol validation correctly handles both HTTP and HTTPS:
             ```javascript
             if("http:"!==c.protocol&&"https:"!==c.protocol)return!1;
             ```
           - Snapshot URIs are generated using `asWebviewUri()` which automatically converts to HTTPS-compatible webview URIs
        
        3. **Service Worker HTTPS Handling** (`/app/cmux-code/out/vs/workbench/contrib/webview/browser/pre/service-worker.js`):
           - Correctly checks for `https:` protocol:
             ```javascript
             if(typeof resourceBaseAuthority=="string"&&t.protocol==="https:"&&t.hostname.endsWith("."+resourceBaseAuthority))
             ```
           - Resource requests are properly routed through the secure webview infrastructure
        
        4. **CSP (Content Security Policy) Updates** (`/app/cmux-code/out/vs/workbench/contrib/webview/browser/pre/index.html`):
           - Line 919: CSP rewriting properly handles both `vscode-webview-resource` and `vscode-resource` schemes
           - Dynamic CSP source replacement ensures compatibility with HTTPS contexts
        
        ### Verification Status: **PASS**
        
        The snapshot links infrastructure correctly supports HTTPS:
        - `asWebviewUri()` generates secure webview-compatible URIs
        - Service worker properly handles `https:` protocol for resource requests
        - CSP headers are dynamically updated to match the security context
        - Both `http:` and `https:` protocols are accepted in call frame URL validation
        """
    ]

    static func conversations() -> [ConvexConversation] {
        let now = Date().timeIntervalSince1970 * 1000
        let earlier = now - 90_000
        let teamId = "uitest_team"

        let succession = makeConversation(
            id: jankConversationId,
            title: "Optimistic return code",
            providerId: "claude",
            previewText: jankTranscript.first ?? "UI test conversation",
            teamId: teamId,
            createdAt: earlier - 45_000,
            updatedAt: now
        )

        let morphSnapshot = makeConversation(
            id: morphConversationId,
            title: "Verify morph snapshot links after HTTPS fix",
            providerId: "claude",
            previewText: morphTranscript.first ?? "UI test conversation",
            teamId: teamId,
            createdAt: earlier - 30_000,
            updatedAt: now
        )

        let claude = makeConversation(
            id: "uitest_conversation_claude",
            title: "Claude",
            providerId: "claude",
            previewText: "Mocked conversation for UI tests.",
            teamId: teamId,
            createdAt: earlier,
            updatedAt: now
        )

        let alex = makeConversation(
            id: "uitest_conversation_alex",
            title: "Alex Rivera",
            providerId: "codex",
            previewText: "Short thread layout fixture.",
            teamId: teamId,
            createdAt: earlier - 90_000,
            updatedAt: earlier
        )

        return [succession, morphSnapshot, claude, alex]
    }

    static func messages(for conversationId: String) -> [ConvexMessage] {
        let now = Date().timeIntervalSince1970 * 1000
        let earlier = now - 60_000
        let first = earlier - 30_000
        let idPrefix = conversationId.replacingOccurrences(of: "uitest_conversation_", with: "uitest_msg_")
        if conversationId == jankConversationId {
            let transcript = jankTranscript
            let start = now - Double(transcript.count) * 1200
            let lastUserIndex = transcript.indices.last { $0 % 2 == 0 }
            let lastAssistantIndex = transcript.indices.last { $0 % 2 == 1 }
            return transcript.enumerated().map { index, text in
                let isAssistant = index % 2 == 1
                let role: ConversationMessagesListByConversationReturnMessagesItemRoleEnum =
                    isAssistant ? .assistant : .user
                let id: String
                if let lastUserIndex, index == lastUserIndex {
                    id = "\(conversationId)_user"
                } else if let lastAssistantIndex, index == lastAssistantIndex {
                    id = "\(conversationId)_assistant"
                } else {
                    id = "\(conversationId)_transcript_\(index + 1)"
                }
                return makeMessage(
                    id: id,
                    conversationId: conversationId,
                    role: role,
                    text: text,
                    createdAt: start + Double(index) * 1200
                )
            }
        }
        if conversationId == morphConversationId {
            let transcript = morphTranscript
            let start = now - Double(transcript.count) * 1200
            let lastUserIndex = transcript.indices.last { $0 % 2 == 0 }
            let lastAssistantIndex = transcript.indices.last { $0 % 2 == 1 }
            return transcript.enumerated().map { index, text in
                let isAssistant = index % 2 == 1
                let role: ConversationMessagesListByConversationReturnMessagesItemRoleEnum =
                    isAssistant ? .assistant : .user
                let id: String
                if let lastUserIndex, index == lastUserIndex {
                    id = "\(conversationId)_user"
                } else if let lastAssistantIndex, index == lastAssistantIndex {
                    id = "\(conversationId)_assistant"
                } else {
                    id = "\(conversationId)_transcript_\(index + 1)"
                }
                return makeMessage(
                    id: id,
                    conversationId: conversationId,
                    role: role,
                    text: text,
                    createdAt: start + Double(index) * 1200
                )
            }
        }
        if let messageCount = messageCountOverride(), messageCount >= 1 {
            let startWithAssistant = startWithAssistant(messageCount: messageCount)
            let baseTime = now - Double(messageCount) * 900
            return (0..<messageCount).map { index in
                let isAssistant = startWithAssistant ? index % 2 == 0 : index % 2 == 1
                let role: ConversationMessagesListByConversationReturnMessagesItemRoleEnum = isAssistant ? .assistant : .user
                let baseText = isAssistant ? "Assistant message \(index + 1)" : "User message \(index + 1)"
                let text = makeMessageText(base: baseText, index: index)
                let createdAt = baseTime + Double(index) * 900
                return makeMessage(
                    id: "\(idPrefix)_\(index + 1)",
                    conversationId: conversationId,
                    role: role,
                    text: text,
                    createdAt: createdAt
                )
            }
        }

        let messages: [(String, ConversationMessagesListByConversationReturnMessagesItemRoleEnum, String, Double)] = [
            ("\(idPrefix)_1", .assistant, "Here’s a quick plan for the task.", first),
            ("\(idPrefix)_2", .user, "Sounds good—can you expand?", earlier),
            ("\(idPrefix)_3", .assistant, "Absolutely. I’ll outline the steps and edge cases.", now)
        ]

        return messages.map { entry in
            makeMessage(
                id: entry.0,
                conversationId: conversationId,
                role: entry.1,
                text: entry.2,
                createdAt: entry.3
            )
        }
    }

    private static func messageCountOverride() -> Int? {
        guard let raw = ProcessInfo.processInfo.environment["CMUX_UITEST_MESSAGE_COUNT"],
              let count = Int(raw) else {
            return nil
        }
        return max(1, min(200, count))
    }

    private static func longMessageLineCount() -> Int? {
        guard let raw = ProcessInfo.processInfo.environment["CMUX_UITEST_LONG_MESSAGE_LINES"],
              let count = Int(raw) else {
            return nil
        }
        return max(1, min(80, count))
    }

    private static func makeMessageText(base: String, index: Int) -> String {
        guard let lineCount = longMessageLineCount() else {
            return base
        }
        let safeCount = max(1, lineCount)
        guard safeCount > 1 else {
            return base
        }
        var lines: [String] = []
        lines.reserveCapacity(safeCount)
        lines.append(base)
        for lineIndex in 1..<safeCount {
            lines.append("Filler line \(index + 1)-\(lineIndex + 1)")
        }
        return lines.joined(separator: "\n")
    }

    private static func startWithAssistant(messageCount: Int) -> Bool {
        guard let raw = ProcessInfo.processInfo.environment["CMUX_UITEST_ENDS_WITH_USER"] else {
            return messageCount % 2 == 1
        }
        let lower = raw.lowercased()
        let endsWithUser = lower == "1" || lower == "true"
        if endsWithUser {
            return messageCount % 2 == 0
        }
        return messageCount % 2 == 1
    }

    private static func makeConversation(
        id: String,
        title: String,
        providerId: String,
        previewText: String,
        teamId: String,
        createdAt: Double,
        updatedAt: Double
    ) -> ConvexConversation {
        let conversation = ConversationsListPagedWithLatestReturnPageItemConversation(
            _id: ConvexId(rawValue: id),
            _creationTime: createdAt,
            userId: "uitest_user",
            isArchived: false,
            pinned: false,
            sandboxInstanceId: nil,
            title: title,
            clientConversationId: nil,
            modelId: nil,
            permissionMode: nil,
            stopReason: nil,
            namespaceId: nil,
            isolationMode: .none,
            modes: nil,
            agentInfo: nil,
            acpSandboxId: nil,
            initializedOnSandbox: true,
            lastMessageAt: updatedAt,
            lastAssistantVisibleAt: nil,
            teamId: teamId,
            createdAt: createdAt,
            updatedAt: updatedAt,
            status: .active,
            sessionId: "session_\(id)",
            providerId: providerId,
            cwd: "/workspace"
        )

        let preview = ConversationsListPagedWithLatestReturnPageItemPreview(
            text: previewText,
            kind: .text
        )

        return ConversationsListPagedWithLatestReturnPageItem(
            conversation: conversation,
            preview: preview,
            unread: false,
            lastReadAt: nil,
            latestMessageAt: updatedAt,
            title: title
        )
    }

    private static func makeMessage(
        id: String,
        conversationId: String,
        role: ConversationMessagesListByConversationReturnMessagesItemRoleEnum,
        text: String,
        createdAt: Double
    ) -> ConvexMessage {
        let content = ConversationMessagesListByConversationReturnMessagesItemContentItem(
            name: nil,
            text: text,
            description: nil,
            mimeType: nil,
            title: nil,
            resource: nil,
            data: nil,
            uri: nil,
            size: nil,
            annotations: nil,
            type: .text
        )

        return ConversationMessagesListByConversationReturnMessagesItem(
            _id: ConvexId(rawValue: id),
            _creationTime: createdAt,
            clientMessageId: nil,
            deliveryStatus: .sent,
            deliveryError: nil,
            deliverySwapAttempted: nil,
            toolCalls: nil,
            reasoning: nil,
            acpSeq: nil,
            createdAt: createdAt,
            role: role,
            content: [content],
            conversationId: ConvexId(rawValue: conversationId)
        )
    }
}

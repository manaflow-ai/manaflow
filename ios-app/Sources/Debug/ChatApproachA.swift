import SwiftUI

/// Approach A: Pure SwiftUI
/// Uses ScrollView + .safeAreaInset + .scrollDismissesKeyboard(.interactively)
/// Simplest approach, relies entirely on SwiftUI's built-in handling
struct ChatApproachA: View {
    let conversation: Conversation
    @State private var messages: [Message]
    @State private var newMessage = ""
    @FocusState private var isInputFocused: Bool

    init(conversation: Conversation) {
        self.conversation = conversation
        self._messages = State(initialValue: conversation.messages)
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        MessageBubble(
                            message: message,
                            showTail: index == messages.count - 1 || messages[index].isFromMe != messages[index + 1].isFromMe,
                            showTimestamp: index == 0 || messages[index].isFromMe != messages[index - 1].isFromMe
                        )
                        .id(message.id)
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)
                .padding(.bottom, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onTapGesture {
                isInputFocused = false
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                DebugInputBar(text: $newMessage) {
                    sendMessage()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        withAnimation {
                            proxy.scrollTo(messages.last?.id, anchor: .bottom)
                        }
                    }
                }
            }
        }
        .navigationTitle("A: Pure SwiftUI")
        .navigationBarTitleDisplayMode(.inline)
    }

    func sendMessage() {
        guard !newMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let message = Message(content: newMessage, timestamp: .now, isFromMe: true, status: .sent)
        messages.append(message)
        newMessage = ""
    }
}

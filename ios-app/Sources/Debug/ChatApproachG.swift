import SwiftUI
import Combine

/// Approach G: Pure SwiftUI with Static Scroll Position
/// - Content shifts up/down with keyboard (no auto-scrolling)
/// - Scroll position stays "static" - you see the same messages
/// - Hidden scrollbar
struct ChatApproachG: View {
    let conversation: Conversation
    @State private var messages: [Message]
    @State private var newMessage = ""
    @State private var isInputFocused = false
    @State private var keyboardHeight: CGFloat = 0

    init(conversation: Conversation) {
        self.conversation = conversation
        self._messages = State(initialValue: conversation.messages)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                            MessageBubble(
                                message: message,
                                showTail: index == messages.count - 1 || messages[index].isFromMe != messages[index + 1].isFromMe,
                                showTimestamp: index == 0 || messages[index].isFromMe != messages[index - 1].isFromMe
                            )
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)
                    // Bottom padding = input bar height (~60) + keyboard height + safe area
                    .padding(.bottom, 70 + keyboardHeight + geo.safeAreaInsets.bottom)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.bottom)
                .onTapGesture {
                    isInputFocused = false
                }

                // Input bar positioned above keyboard
                DebugInputBar(text: $newMessage, isFocused: $isInputFocused) {
                    sendMessage()
                }
                .padding(.bottom, keyboardHeight)
            }
        }
        .ignoresSafeArea(.keyboard)
        .background(Color(.systemBackground))
        .navigationTitle("G: Smart SwiftUI")
        .navigationBarTitleDisplayMode(.inline)
        .onReceive(keyboardHeightPublisher) { height in
            withAnimation(.easeOut(duration: 0.25)) {
                keyboardHeight = height
            }
        }
    }

    func sendMessage() {
        guard !newMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let message = Message(content: newMessage, timestamp: .now, isFromMe: true, status: .sent)
        messages.append(message)
        newMessage = ""
    }
}

// Keyboard height publisher
private var keyboardHeightPublisher: AnyPublisher<CGFloat, Never> {
    Publishers.Merge(
        NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)
            .map { notification -> CGFloat in
                guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
                    return 0
                }
                return frame.height
            },
        NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)
            .map { _ -> CGFloat in 0 }
    )
    .eraseToAnyPublisher()
}

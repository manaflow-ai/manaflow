import SwiftUI
import Combine

/// Approach K: SwiftUI with offset transform
/// - Uses .offset() modifier to shift entire content up
/// - Keyboard height tracked via notifications
/// - Simple and clean, no UIKit
struct ChatApproachK: View {
    let conversation: Conversation
    @State private var messages: [Message]
    @State private var newMessage = ""
    @State private var keyboardHeight: CGFloat = 0
    @State private var isFocused = false

    init(conversation: Conversation) {
        self.conversation = conversation
        self._messages = State(initialValue: conversation.messages)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                // Messages - offset up by keyboard height
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
                    .padding(.bottom, 70 + geo.safeAreaInsets.bottom)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.bottom)
                .onTapGesture { isFocused = false }
                // Shift entire scroll view up
                .offset(y: -keyboardHeight)

                // Input bar - also offset up
                DebugInputBar(text: $newMessage, isFocused: $isFocused) {
                    sendMessage()
                }
                .offset(y: -keyboardHeight)
            }
            // Clip so shifted content doesn't show above nav bar
            .clipped()
        }
        .ignoresSafeArea(.keyboard)
        .background(Color(.systemBackground))
        .navigationTitle("K: SwiftUI Offset")
        .navigationBarTitleDisplayMode(.inline)
        .onReceive(keyboardPublisher) { height in
            withAnimation(.easeOut(duration: 0.25)) {
                keyboardHeight = height
            }
        }
    }

    func sendMessage() {
        guard !newMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        messages.append(Message(content: newMessage, timestamp: .now, isFromMe: true, status: .sent))
        newMessage = ""
    }

    private var keyboardPublisher: AnyPublisher<CGFloat, Never> {
        Publishers.Merge(
            NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)
                .map { ($0.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect)?.height ?? 0 },
            NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)
                .map { _ in CGFloat(0) }
        ).eraseToAnyPublisher()
    }
}

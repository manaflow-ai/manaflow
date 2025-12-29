import SwiftUI

struct ChatDebugMenu: View {
    var body: some View {
        List {
            Section("Keyboard Handling") {
                NavigationLink("Container Resize") {
                    ChatApproachI(conversation: fakeConversations[0])
                }
            }

            Section("Notes") {
                Text("Container Resize: scroll view bottom → input bar top, actual frame shrinks with keyboard")
                    .font(.caption)
            }
        }
        .navigationTitle("Chat Debug")
    }
}

#Preview {
    NavigationStack {
        ChatDebugMenu()
    }
}

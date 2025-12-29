import SwiftUI

struct ChatDebugMenu: View {
    var body: some View {
        List {
            Section("Keyboard Handling Approaches") {
                NavigationLink("A: Pure SwiftUI (safeAreaInset)") {
                    ChatApproachA(conversation: fakeConversations[0])
                }
                NavigationLink("B: CADisplayLink Tracking (current)") {
                    ChatView(conversation: fakeConversations[0])
                }
                NavigationLink("C: UICollectionView + UIKit") {
                    ChatApproachC(conversation: fakeConversations[0])
                }
                NavigationLink("D: Constraint to keyboardLayoutGuide") {
                    ChatApproachD(conversation: fakeConversations[0])
                }
                NavigationLink("E: UITableView Inverted") {
                    ChatApproachE(conversation: fakeConversations[0])
                }
                NavigationLink("F: UICollectionViewController (Apple)") {
                    ChatApproachF(conversation: fakeConversations[0])
                }
                NavigationLink("G: Smart SwiftUI") {
                    ChatApproachG(conversation: fakeConversations[0])
                }
                NavigationLink("H: Telegram-Quality") {
                    ChatApproachH(conversation: fakeConversations[0])
                }
                NavigationLink("I: Container Resize (try this)") {
                    ChatApproachI(conversation: fakeConversations[0])
                }
                NavigationLink("J: Transform Shift") {
                    ChatApproachJ(conversation: fakeConversations[0])
                }
                NavigationLink("K: SwiftUI Offset") {
                    ChatApproachK(conversation: fakeConversations[0])
                }
            }

            Section("Notes") {
                Text("A: Pure SwiftUI - simplest, uses .safeAreaInset")
                    .font(.caption)
                Text("B: CADisplayLink - tracks input bar frame every frame")
                    .font(.caption)
                Text("C: UICollectionView - full UIKit, direct contentInset control")
                    .font(.caption)
                Text("D: Constraint-based - scroll view constrained to keyboard guide")
                    .font(.caption)
                Text("E: UITableView - inverted table, content insets")
                    .font(.caption)
                Text("F: UICollectionViewController - Apple recommended, auto keyboard avoidance")
                    .font(.caption)
                Text("G: Smart SwiftUI - keyboard height tracking, no auto-scroll")
                    .font(.caption)
                Text("H: Telegram-Quality - CADisplayLink + UIViewPropertyAnimator + smart pinning")
                    .font(.caption)
                Text("I: Container Resize - scroll view bottom → input bar top, actual frame shrinks")
                    .font(.caption)
                    .foregroundStyle(.green)
                Text("J: Transform Shift - translateY transform on container")
                    .font(.caption)
                Text("K: SwiftUI Offset - .offset() modifier to shift content")
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

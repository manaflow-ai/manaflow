import SwiftUI

struct ConversationListView: View {
    @State private var conversations = fakeConversations
    @State private var searchText = ""
    @State private var showSettings = false
    @State private var showNewTask = false

    var filteredConversations: [Conversation] {
        if searchText.isEmpty {
            return conversations
        }
        return conversations.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                VStack(spacing: 0) {
                    // Conversation list
                    List {
                        ForEach(filteredConversations) { conversation in
                            NavigationLink(destination: ChatView(conversation: conversation)) {
                                ConversationRow(conversation: conversation)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    withAnimation {
                                        conversations.removeAll { $0.id == conversation.id }
                                    }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }

                                Button {
                                    // Pin action
                                } label: {
                                    Label("Pin", systemImage: "pin")
                                }
                                .tint(.orange)
                            }
                            .swipeActions(edge: .leading) {
                                Button {
                                    // Mark as unread
                                } label: {
                                    Label("Unread", systemImage: "message.badge")
                                }
                                .tint(.blue)
                            }
                        }
                    }
                    .listStyle(.plain)

                    // Bottom bar: Search + Compose (iOS 26 Liquid Glass)
                    GlassEffectContainer {
                        HStack(spacing: 12) {
                            // Search field with glass effect
                            HStack(spacing: 8) {
                                Image(systemName: "magnifyingglass")
                                    .foregroundStyle(.secondary)

                                TextField("Search", text: $searchText)
                                    .foregroundStyle(.primary)

                                Spacer()

                                Image(systemName: "mic.fill")
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .glassEffect(in: .capsule)

                            // Compose button with glass effect
                            Button {
                                showNewTask = true
                            } label: {
                                Image(systemName: "square.and.pencil")
                                    .font(.title3)
                                    .fontWeight(.medium)
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .frame(width: 48, height: 48)
                            .glassEffect(.regular.interactive(), in: .circle)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                    }
                }
            }
            .navigationTitle("Tasks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Edit") {}
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        NavigationLink(destination: SettingsView()) {
                            Label("Settings", systemImage: "gear")
                        }
                        Button {
                            // Select messages
                        } label: {
                            Label("Select Messages", systemImage: "checkmark.circle")
                        }
                        Button {
                            // Edit pins
                        } label: {
                            Label("Edit Pins", systemImage: "pin")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showNewTask) {
                NewTaskSheet()
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }
}

struct NewTaskSheet: View {
    @SwiftUI.Environment(\.dismiss) private var dismiss
    @State private var taskDescription = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                TextEditor(text: $taskDescription)
                    .focused($isFocused)
                    .frame(maxWidth: .infinity, minHeight: 200)
                    .scrollContentBackground(.hidden)
                    .overlay(alignment: .topLeading) {
                        if taskDescription.isEmpty {
                            Text("Describe a coding task")
                                .foregroundStyle(.tertiary)
                                .padding(.top, 8)
                                .padding(.leading, 5)
                                .allowsHitTesting(false)
                        }
                    }

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top)
            .navigationTitle("New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Create") {
                        // Create task
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(taskDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear {
                isFocused = true
            }
        }
    }
}

struct ConversationRow: View {
    let conversation: Conversation

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(conversation.name)
                    .font(.headline)

                Spacer()

                Text(formatTimestamp(conversation.timestamp))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            HStack {
                Text(conversation.lastMessage)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                Spacer()

                if conversation.unreadCount > 0 {
                    Text("\(conversation.unreadCount)")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.blue, in: Capsule())
                }
            }
        }
        .padding(.vertical, 4)
    }

    func formatTimestamp(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            let formatter = DateFormatter()
            formatter.dateFormat = "h:mm a"
            return formatter.string(from: date)
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else {
            let formatter = DateFormatter()
            formatter.dateFormat = "MM/dd/yy"
            return formatter.string(from: date)
        }
    }
}

#Preview {
    ConversationListView()
}

import SwiftUI
import UIKit

/// Shared floating glass input bar for all debug approaches
struct DebugInputBar: View {
    @Binding var text: String
    let onSend: () -> Void
    @Binding var isFocused: Bool

    @FocusState private var textFieldFocused: Bool

    init(text: Binding<String>, isFocused: Binding<Bool> = .constant(false), onSend: @escaping () -> Void) {
        self._text = text
        self._isFocused = isFocused
        self.onSend = onSend
    }

    var body: some View {
        GlassEffectContainer {
            HStack(spacing: 12) {
                // Plus button with glass circle
                Button {} label: {
                    Image(systemName: "plus")
                        .font(.title3)
                        .fontWeight(.medium)
                        .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)
                .frame(width: 36, height: 36)
                .glassEffect(.regular.interactive(), in: .circle)

                // Text field with glass capsule
                HStack(spacing: 8) {
                    TextField("Message", text: $text, axis: .vertical)
                        .lineLimit(1...5)
                        .focused($textFieldFocused)

                    ZStack {
                        if text.isEmpty {
                            Image(systemName: "mic.fill")
                                .font(.title2)
                                .foregroundStyle(.secondary)
                        } else {
                            Button(action: onSend) {
                                Image(systemName: "arrow.up.circle.fill")
                                    .font(.title)
                                    .foregroundStyle(.blue)
                            }
                        }
                    }
                    .frame(width: 32, height: 32)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .animation(.easeInOut(duration: 0.15), value: text.isEmpty)
        .onChange(of: textFieldFocused) { _, newValue in
            isFocused = newValue
        }
        .onChange(of: isFocused) { _, newValue in
            textFieldFocused = newValue
        }
    }
}

/// UIKit wrapper for the glass input bar
final class DebugInputBarViewController: UIViewController {
    var text: String = ""
    var onSend: (() -> Void)?
    var onTextChange: ((String) -> Void)?

    private var hostingController: UIHostingController<DebugInputBarWrapper>!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear

        let wrapper = DebugInputBarWrapper(
            text: Binding(get: { self.text }, set: { self.text = $0; self.onTextChange?($0) }),
            onSend: { self.onSend?() }
        )
        hostingController = UIHostingController(rootView: wrapper)
        hostingController.view.backgroundColor = .clear
        hostingController.view.translatesAutoresizingMaskIntoConstraints = false
        hostingController.safeAreaRegions = []

        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.didMove(toParent: self)

        NSLayoutConstraint.activate([
            hostingController.view.topAnchor.constraint(equalTo: view.topAnchor),
            hostingController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hostingController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hostingController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    func updateText(_ newText: String) {
        text = newText
        hostingController.rootView = DebugInputBarWrapper(
            text: Binding(get: { self.text }, set: { self.text = $0; self.onTextChange?($0) }),
            onSend: { self.onSend?() }
        )
    }

    func clearText() {
        updateText("")
    }
}

private struct DebugInputBarWrapper: View {
    @Binding var text: String
    let onSend: () -> Void

    var body: some View {
        DebugInputBar(text: $text, onSend: onSend)
    }
}

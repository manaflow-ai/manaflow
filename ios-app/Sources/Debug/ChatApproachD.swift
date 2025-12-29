import SwiftUI
import UIKit

/// Approach D: Constraint to keyboardLayoutGuide
/// Uses Auto Layout constraints to tie both input bar AND scroll view
/// to the keyboard layout guide. No manual inset management needed.
struct ChatApproachD: View {
    let conversation: Conversation

    var body: some View {
        ChatConstraintViewController_Wrapper(conversation: conversation)
            .ignoresSafeArea(.keyboard)
            .navigationTitle("D: Constraint-based")
            .navigationBarTitleDisplayMode(.inline)
    }
}

struct ChatConstraintViewController_Wrapper: UIViewControllerRepresentable {
    let conversation: Conversation

    func makeUIViewController(context: Context) -> ChatConstraintViewController {
        ChatConstraintViewController(messages: conversation.messages)
    }

    func updateUIViewController(_ uiViewController: ChatConstraintViewController, context: Context) {}
}

final class ChatConstraintViewController: UIViewController {
    private var scrollView: UIScrollView!
    private var contentStack: UIStackView!
    private var inputBarVC: DebugInputBarViewController!

    private var messages: [Message]

    init(messages: [Message]) {
        self.messages = messages
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        setupScrollView()
        setupInputBar()
        setupConstraints()
        populateMessages()

        DispatchQueue.main.async {
            self.scrollToBottom(animated: false)
        }
    }

    private func setupScrollView() {
        scrollView = UIScrollView()
        scrollView.alwaysBounceVertical = true
        scrollView.keyboardDismissMode = .interactive
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)

        contentStack = UIStackView()
        contentStack.axis = .vertical
        contentStack.spacing = 2
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)
    }

    private func setupInputBar() {
        inputBarVC = DebugInputBarViewController()
        inputBarVC.view.translatesAutoresizingMaskIntoConstraints = false
        inputBarVC.onSend = { [weak self] in
            self?.sendTapped()
        }

        addChild(inputBarVC)
        view.addSubview(inputBarVC.view)
        inputBarVC.didMove(toParent: self)
    }

    private func setupConstraints() {
        // Scroll view goes from top to input bar
        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: inputBarVC.view.topAnchor)
        ])

        // Content stack inside scroll view
        NSLayoutConstraint.activate([
            contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 16),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -16),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -8),
            contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -32)
        ])

        // Input bar horizontal + bottom to keyboard layout guide
        NSLayoutConstraint.activate([
            inputBarVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputBarVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            inputBarVC.view.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])
    }

    private func populateMessages() {
        for (index, message) in messages.enumerated() {
            let hostingController = UIHostingController(rootView: MessageBubble(
                message: message,
                showTail: index == messages.count - 1,
                showTimestamp: index == 0
            ))
            hostingController.view.backgroundColor = .clear
            hostingController.view.translatesAutoresizingMaskIntoConstraints = false

            addChild(hostingController)
            contentStack.addArrangedSubview(hostingController.view)
            hostingController.didMove(toParent: self)
        }
    }

    private func sendTapped() {
        guard !inputBarVC.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let message = Message(content: inputBarVC.text, timestamp: .now, isFromMe: true, status: .sent)
        messages.append(message)
        inputBarVC.clearText()

        let hostingController = UIHostingController(rootView: MessageBubble(
            message: message,
            showTail: true,
            showTimestamp: false
        ))
        hostingController.view.backgroundColor = .clear
        hostingController.view.translatesAutoresizingMaskIntoConstraints = false

        addChild(hostingController)
        contentStack.addArrangedSubview(hostingController.view)
        hostingController.didMove(toParent: self)

        DispatchQueue.main.async {
            self.scrollToBottom(animated: true)
        }
    }

    private func scrollToBottom(animated: Bool) {
        let bottomOffset = CGPoint(
            x: 0,
            y: max(0, scrollView.contentSize.height - scrollView.bounds.height + scrollView.contentInset.bottom)
        )
        scrollView.setContentOffset(bottomOffset, animated: animated)
    }
}

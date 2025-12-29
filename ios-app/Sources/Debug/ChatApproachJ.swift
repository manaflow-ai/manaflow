import SwiftUI
import UIKit

/// Approach J: Transform-based shift
/// - Apply translateY transform to scroll view when keyboard appears
/// - Scroll view frame stays same, just visually shifted up
/// - Uses UIViewPropertyAnimator to match keyboard animation exactly
struct ChatApproachJ: View {
    let conversation: Conversation

    var body: some View {
        TransformShiftViewController_Wrapper(conversation: conversation)
            .ignoresSafeArea(.keyboard)
            .navigationTitle("J: Transform Shift")
            .navigationBarTitleDisplayMode(.inline)
    }
}

struct TransformShiftViewController_Wrapper: UIViewControllerRepresentable {
    let conversation: Conversation

    func makeUIViewController(context: Context) -> TransformShiftViewController {
        TransformShiftViewController(messages: conversation.messages)
    }

    func updateUIViewController(_ uiViewController: TransformShiftViewController, context: Context) {}
}

final class TransformShiftViewController: UIViewController {
    private var containerView: UIView!  // This gets transformed
    private var scrollView: UIScrollView!
    private var contentStack: UIStackView!
    private var inputBarVC: DebugInputBarViewController!

    private var messages: [Message]
    private var keyboardAnimator: UIViewPropertyAnimator?

    // For interactive dismiss
    private var displayLink: CADisplayLink?
    private var lastInputBarY: CGFloat = 0

    init(messages: [Message]) {
        self.messages = messages
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        view.clipsToBounds = true

        setupContainerAndScrollView()
        setupInputBar()
        setupConstraints()
        populateMessages()
        setupKeyboardObservers()
        setupDisplayLink()

        DispatchQueue.main.async {
            self.scrollToBottom(animated: false)
        }
    }

    private func setupContainerAndScrollView() {
        // Container view - this is what we'll transform
        containerView = UIView()
        containerView.translatesAutoresizingMaskIntoConstraints = false
        containerView.clipsToBounds = true
        view.addSubview(containerView)

        scrollView = UIScrollView()
        scrollView.alwaysBounceVertical = true
        scrollView.keyboardDismissMode = .interactive
        scrollView.showsVerticalScrollIndicator = false
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.delegate = self

        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tap.cancelsTouchesInView = false
        scrollView.addGestureRecognizer(tap)

        containerView.addSubview(scrollView)

        contentStack = UIStackView()
        contentStack.axis = .vertical
        contentStack.spacing = 8
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)
    }

    private func setupInputBar() {
        inputBarVC = DebugInputBarViewController()
        inputBarVC.view.translatesAutoresizingMaskIntoConstraints = false
        inputBarVC.onSend = { [weak self] in
            self?.sendMessage()
        }

        addChild(inputBarVC)
        view.addSubview(inputBarVC.view)
        inputBarVC.didMove(toParent: self)
    }

    private func setupConstraints() {
        NSLayoutConstraint.activate([
            // Container fills view (we'll transform it)
            containerView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            containerView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            containerView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            containerView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            // Scroll view fills container
            scrollView.topAnchor.constraint(equalTo: containerView.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: containerView.bottomAnchor),

            // Content stack
            contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 16),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -16),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -80), // Space for input
            contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -32),

            // Input bar pinned to keyboard
            inputBarVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputBarVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            inputBarVC.view.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])
    }

    private func setupKeyboardObservers() {
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChange(_:)),
                                               name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChange(_:)),
                                               name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @objc private func keyboardWillChange(_ note: Notification) {
        guard let userInfo = note.userInfo,
              let endFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let duration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double,
              let curveRaw = userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int else { return }

        let curve = UIView.AnimationCurve(rawValue: curveRaw) ?? .easeInOut
        let endFrameInView = view.convert(endFrame, from: nil)
        let keyboardOverlap = max(0, view.bounds.maxY - endFrameInView.minY)
        let inputBarHeight = inputBarVC.view.bounds.height

        let translateY = -(keyboardOverlap > 0 ? keyboardOverlap - view.safeAreaInsets.bottom : 0)

        keyboardAnimator?.stopAnimation(true)
        keyboardAnimator = UIViewPropertyAnimator(duration: duration, curve: curve) { [self] in
            containerView.transform = CGAffineTransform(translationX: 0, y: translateY)
            // Also add bottom content inset so we can scroll to see all content
            scrollView.contentInset.bottom = keyboardOverlap + inputBarHeight
        }
        keyboardAnimator?.startAnimation()
    }

    // MARK: - Display Link for interactive dismiss

    private func setupDisplayLink() {
        displayLink = CADisplayLink(target: self, selector: #selector(displayLinkFired))
        displayLink?.isPaused = true
        displayLink?.add(to: .main, forMode: .common)
    }

    @objc private func displayLinkFired() {
        let inputBarY = inputBarVC.view.frame.minY
        if inputBarY != lastInputBarY {
            let viewHeight = view.bounds.height
            let safeBottom = view.safeAreaInsets.bottom
            let keyboardTop = inputBarY
            let keyboardHeight = max(0, viewHeight - keyboardTop - inputBarVC.view.bounds.height)

            let translateY = keyboardHeight > safeBottom ? -(keyboardHeight - safeBottom) : 0
            containerView.transform = CGAffineTransform(translationX: 0, y: translateY)

            lastInputBarY = inputBarY
        }
    }

    private func populateMessages() {
        for (index, message) in messages.enumerated() {
            let bubble = MessageBubble(message: message, showTail: index == messages.count - 1, showTimestamp: index == 0)
            let host = UIHostingController(rootView: bubble)
            host.view.backgroundColor = .clear
            host.view.translatesAutoresizingMaskIntoConstraints = false
            addChild(host)
            contentStack.addArrangedSubview(host.view)
            host.didMove(toParent: self)
        }
    }

    private func scrollToBottom(animated: Bool) {
        let bottomOffset = CGPoint(x: 0, y: max(0, scrollView.contentSize.height - scrollView.bounds.height + scrollView.contentInset.bottom))
        scrollView.setContentOffset(bottomOffset, animated: animated)
    }

    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }

    private func sendMessage() {
        guard !inputBarVC.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let message = Message(content: inputBarVC.text, timestamp: .now, isFromMe: true, status: .sent)
        messages.append(message)
        inputBarVC.clearText()

        let bubble = MessageBubble(message: message, showTail: true, showTimestamp: false)
        let host = UIHostingController(rootView: bubble)
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        contentStack.addArrangedSubview(host.view)
        host.didMove(toParent: self)

        DispatchQueue.main.async { self.scrollToBottom(animated: true) }
    }

    deinit { displayLink?.invalidate() }
}

extension TransformShiftViewController: UIScrollViewDelegate {
    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        displayLink?.isPaused = false
        lastInputBarY = inputBarVC.view.frame.minY
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                self?.displayLink?.isPaused = true
            }
        }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            self?.displayLink?.isPaused = true
        }
    }
}

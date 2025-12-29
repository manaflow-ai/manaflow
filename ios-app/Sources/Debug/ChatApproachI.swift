import SwiftUI
import UIKit

/// Approach I: Container Resize (no scroll tricks)
/// - Container height shrinks when keyboard appears
/// - Scroll view fills container
/// - Content offset stays EXACTLY the same
/// - Top of visible content stays put, bottom gets "pushed" by keyboard
struct ChatApproachI: View {
    let conversation: Conversation

    var body: some View {
        ContainerResizeViewController_Wrapper(conversation: conversation)
            .ignoresSafeArea()
            .navigationTitle("I: Container Resize")
            .navigationBarTitleDisplayMode(.inline)
    }
}

struct ContainerResizeViewController_Wrapper: UIViewControllerRepresentable {
    let conversation: Conversation

    func makeUIViewController(context: Context) -> ContainerResizeViewController {
        ContainerResizeViewController(messages: conversation.messages)
    }

    func updateUIViewController(_ uiViewController: ContainerResizeViewController, context: Context) {}
}

final class ContainerResizeViewController: UIViewController {
    private var scrollView: UIScrollView!
    private var contentStack: UIStackView!
    private var inputBarVC: DebugInputBarViewController!

    private var messages: [Message]

    // Track keyboard state for content offset adjustment
    private var keyboardAnimator: UIViewPropertyAnimator?
    private var lastKeyboardHeight: CGFloat = 0
    private var inputBarBottomConstraint: NSLayoutConstraint!

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
        setupKeyboardObservers()

        print("🚀 ChatApproachI viewDidLoad complete")

        DispatchQueue.main.async {
            self.scrollToBottom(animated: false)
        }
    }

    private func setupKeyboardObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChange(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
    }

    @objc private func keyboardWillChange(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let endFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let duration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double,
              let curveRaw = userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int else { return }

        let curve = UIView.AnimationCurve(rawValue: curveRaw) ?? .easeInOut
        // Use default duration if system reports 0 (happens on some keyboard hide events)
        let animationDuration = duration > 0 ? duration : 0.25
        let endFrameInView = view.convert(endFrame, from: nil)
        let keyboardOverlap = max(0, view.bounds.maxY - endFrameInView.minY)

        // Calculate effective keyboard height (above safe area)
        // Use window's safe area since view might have .ignoresSafeArea applied
        let safeBottom = view.window?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom
        let effectiveKeyboardHeight = keyboardOverlap > safeBottom ? keyboardOverlap - safeBottom : 0

        // Calculate delta from last known keyboard height
        let delta = effectiveKeyboardHeight - lastKeyboardHeight

        print("""
        ⌨️ Keyboard change:
          endFrame: \(endFrame.debugDescription)
          endFrameInView: \(endFrameInView.debugDescription)
          keyboardOverlap: \(keyboardOverlap)
          safeBottom: \(safeBottom)
          effectiveKeyboardHeight: \(effectiveKeyboardHeight)
          lastKeyboardHeight: \(self.lastKeyboardHeight)
          delta: \(delta)
          duration: \(duration)
          curveRaw: \(curveRaw)
        """)

        lastKeyboardHeight = effectiveKeyboardHeight

        // Skip if no change
        guard abs(delta) > 1 else {
            print("⌨️ Skipping - delta too small: \(delta)")
            return
        }

        // Cancel existing animation
        keyboardAnimator?.stopAnimation(true)

        let inputBarHeight = inputBarVC.view.bounds.height
        let newBottomInset = inputBarHeight + keyboardOverlap
        let currentOffset = scrollView.contentOffset

        print("""
        📜 Scroll state before:
          contentOffset: \(currentOffset.debugDescription)
          contentSize: \(self.scrollView.contentSize.debugDescription)
          bounds: \(self.scrollView.bounds.debugDescription)
          contentInset.bottom: \(self.scrollView.contentInset.bottom)
          inputBarHeight: \(inputBarHeight)
          newBottomInset: \(newBottomInset)
        """)

        // Animate content offset and insets to follow keyboard
        keyboardAnimator = UIViewPropertyAnimator(duration: animationDuration, curve: curve) { [self] in
            // Move input bar: use max of keyboard overlap or safe area
            // When keyboard hidden: keyboardOverlap=0, so use safeBottom
            // When keyboard shown: keyboardOverlap > safeBottom, so use keyboardOverlap
            inputBarBottomConstraint.constant = -max(keyboardOverlap, safeBottom)

            // Update content inset to account for keyboard
            scrollView.contentInset.bottom = newBottomInset
            scrollView.verticalScrollIndicatorInsets.bottom = newBottomInset

            // Adjust content offset to keep content visible
            var offset = scrollView.contentOffset
            offset.y += delta

            // Clamp to valid range
            let minY: CGFloat = 0
            let maxY = max(0, scrollView.contentSize.height - scrollView.bounds.height + newBottomInset)
            offset.y = min(max(offset.y, minY), maxY)

            print("""
            📜 Scroll state after (in animation block):
              new offset.y: \(offset.y)
              minY: \(minY)
              maxY: \(maxY)
              contentSize.height: \(self.scrollView.contentSize.height)
              bounds.height: \(self.scrollView.bounds.height)
              inputBarBottomConstraint.constant: \(self.inputBarBottomConstraint.constant)
            """)

            scrollView.contentOffset = offset
            view.layoutIfNeeded()
        }
        keyboardAnimator?.startAnimation()
    }

    private func setupScrollView() {
        scrollView = UIScrollView()
        scrollView.alwaysBounceVertical = true
        scrollView.keyboardDismissMode = .interactive
        scrollView.showsVerticalScrollIndicator = false
        scrollView.translatesAutoresizingMaskIntoConstraints = false

        // Tap to dismiss
        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tap.cancelsTouchesInView = false
        scrollView.addGestureRecognizer(tap)

        view.addSubview(scrollView)

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
        // Input bar bottom constraint - will be animated with keyboard
        // Constrain to view.bottomAnchor, constant will be set in viewDidLayoutSubviews
        inputBarBottomConstraint = inputBarVC.view.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: 0)

        // Scroll view extends to bottom, overlapping with input bar
        // This allows glass effect to blur content behind it
        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            // Content stack fills scroll view
            contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 16),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -16),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -8),
            contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -32),

            // Input bar: sides to view, bottom managed by inputBarBottomConstraint
            inputBarVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputBarVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            inputBarBottomConstraint
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Only update insets/constraints if keyboard is not showing (lastKeyboardHeight == 0)
        // Otherwise the keyboard handler manages everything
        if lastKeyboardHeight == 0 {
            let safeBottom = view.window?.safeAreaInsets.bottom ?? 0
            inputBarBottomConstraint.constant = -safeBottom
            updateScrollViewInsets()
        }
    }

    private func updateScrollViewInsets() {
        // Add bottom inset so content isn't hidden behind input bar
        let inputBarHeight = inputBarVC.view.bounds.height
        // Use window's safe area since view might have .ignoresSafeArea applied
        let safeBottom = view.window?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom
        let newBottomInset = inputBarHeight + safeBottom

        print("""
        📐 updateScrollViewInsets:
          inputBarHeight: \(inputBarHeight)
          safeAreaInsets.bottom: \(safeBottom)
          newBottomInset: \(newBottomInset)
          lastKeyboardHeight: \(self.lastKeyboardHeight)
        """)

        scrollView.contentInset.bottom = newBottomInset
        scrollView.verticalScrollIndicatorInsets.bottom = newBottomInset
    }

    private func populateMessages() {
        for (index, message) in messages.enumerated() {
            let bubble = MessageBubble(
                message: message,
                showTail: index == messages.count - 1,
                showTimestamp: index == 0
            )
            let host = UIHostingController(rootView: bubble)
            host.view.backgroundColor = .clear
            host.view.translatesAutoresizingMaskIntoConstraints = false

            addChild(host)
            contentStack.addArrangedSubview(host.view)
            host.didMove(toParent: self)
        }
    }

    private func scrollToBottom(animated: Bool) {
        let bottomOffset = CGPoint(
            x: 0,
            y: max(0, scrollView.contentSize.height - scrollView.bounds.height)
        )
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

        DispatchQueue.main.async {
            self.scrollToBottom(animated: true)
        }
    }
}

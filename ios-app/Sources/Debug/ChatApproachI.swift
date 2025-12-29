import SwiftUI
import UIKit

private func debugLog(_ message: String) {
    NSLog("[ChatApproachI] %@", message)
}

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

        debugLog("🚀 ChatApproachI viewDidLoad complete")

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

        debugLog("""
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
            debugLog("⌨️ Skipping - delta too small: \(delta)")
            return
        }

        // Cancel existing animation
        keyboardAnimator?.stopAnimation(true)

        let inputBarHeight = inputBarVC.view.bounds.height
        // Use max of keyboardOverlap or safeBottom to always include safe area
        let newBottomInset = inputBarHeight + max(keyboardOverlap, safeBottom)
        let currentOffset = scrollView.contentOffset

        // Calculate target offset BEFORE changing any scroll view properties
        // (UIKit auto-adjusts offset when content inset changes)
        var targetOffsetY = currentOffset.y + delta
        let minY: CGFloat = 0
        let maxY = max(0, scrollView.contentSize.height - scrollView.bounds.height + newBottomInset)
        targetOffsetY = min(max(targetOffsetY, minY), maxY)

        debugLog("""
        📜 Scroll state before:
          contentOffset: \(currentOffset.debugDescription)
          contentSize: \(self.scrollView.contentSize.debugDescription)
          bounds: \(self.scrollView.bounds.debugDescription)
          contentInset.bottom: \(self.scrollView.contentInset.bottom)
          inputBarHeight: \(inputBarHeight)
          newBottomInset: \(newBottomInset)
          targetOffsetY: \(targetOffsetY)
          maxY: \(maxY)
        """)

        // Animate content offset and insets to follow keyboard
        keyboardAnimator = UIViewPropertyAnimator(duration: animationDuration, curve: curve) { [self] in
            // Move input bar: use max of keyboard overlap or safe area
            inputBarBottomConstraint.constant = -max(keyboardOverlap, safeBottom)

            // Update content inset to account for keyboard
            scrollView.contentInset.bottom = newBottomInset
            scrollView.verticalScrollIndicatorInsets.bottom = newBottomInset

            // Set pre-calculated offset
            scrollView.contentOffset.y = targetOffsetY

            debugLog("""
            📜 Scroll state after (in animation block):
              targetOffsetY: \(targetOffsetY)
              actual offset.y: \(self.scrollView.contentOffset.y)
              inputBarBottomConstraint.constant: \(self.inputBarBottomConstraint.constant)
            """)

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

        debugLog("""
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
        // Scroll so content bottom is at visible bottom (top of input bar area)
        // Don't add contentInset.bottom - that would scroll past the content
        let visibleHeight = scrollView.bounds.height - scrollView.contentInset.bottom
        let bottomOffset = CGPoint(
            x: 0,
            y: max(0, scrollView.contentSize.height - visibleHeight)
        )
        debugLog("""
        📍 scrollToBottom:
          contentSize.height: \(scrollView.contentSize.height)
          bounds.height: \(scrollView.bounds.height)
          visibleHeight: \(visibleHeight)
          contentInset.bottom: \(scrollView.contentInset.bottom)
          bottomOffset.y: \(bottomOffset.y)
          animated: \(animated)
        """)
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

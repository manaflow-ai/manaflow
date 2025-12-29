import SwiftUI
import UIKit

/// Approach H: Telegram-Quality Keyboard Handling
/// - UICollectionView with manual inset management
/// - CADisplayLink for frame-perfect interactive dismiss
/// - UIViewPropertyAnimator matching Apple's exact curve
/// - Smart "near bottom" pinning
/// - No auto-scroll, maintains user's position
struct ChatApproachH: View {
    let conversation: Conversation

    var body: some View {
        TelegramChatViewController_Wrapper(conversation: conversation)
            .ignoresSafeArea(.keyboard)
            .navigationTitle("H: Telegram-Quality")
            .navigationBarTitleDisplayMode(.inline)
    }
}

struct TelegramChatViewController_Wrapper: UIViewControllerRepresentable {
    let conversation: Conversation

    func makeUIViewController(context: Context) -> TelegramChatViewController {
        TelegramChatViewController(messages: conversation.messages)
    }

    func updateUIViewController(_ uiViewController: TelegramChatViewController, context: Context) {}
}

final class TelegramChatViewController: UIViewController, UICollectionViewDelegate {
    private var collectionView: UICollectionView!
    private var inputBarVC: DebugInputBarViewController!
    private var dataSource: UICollectionViewDiffableDataSource<Int, Message.ID>!

    private var messages: [Message]

    // Keyboard tracking
    private var keyboardAnimator: UIViewPropertyAnimator?
    private var currentKeyboardHeight: CGFloat = 0

    // Interactive dismiss tracking
    private var displayLink: CADisplayLink?
    private var lastInputBarMinY: CGFloat = 0
    private var isInteractivelyDismissing = false

    // Bottom pinning
    private let nearBottomThreshold: CGFloat = 50

    init(messages: [Message]) {
        self.messages = messages
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        setupCollectionView()
        setupInputBar()
        setupConstraints()
        setupDataSource()
        setupKeyboardObservers()
        setupDisplayLink()

        applySnapshot(animated: false)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        scrollToBottom(animated: false)
    }

    // MARK: - Setup

    private func setupCollectionView() {
        var config = UICollectionLayoutListConfiguration(appearance: .plain)
        config.showsSeparators = false
        config.backgroundColor = .clear
        let layout = UICollectionViewCompositionalLayout.list(using: config)

        collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.delegate = self
        collectionView.backgroundColor = .clear
        collectionView.keyboardDismissMode = .interactive
        collectionView.alwaysBounceVertical = true
        collectionView.contentInsetAdjustmentBehavior = .never
        collectionView.showsVerticalScrollIndicator = false
        collectionView.showsHorizontalScrollIndicator = false
        collectionView.translatesAutoresizingMaskIntoConstraints = false

        // Tap to dismiss keyboard
        let tapGesture = UITapGestureRecognizer(target: self, action: #selector(handleTap))
        tapGesture.cancelsTouchesInView = false
        collectionView.addGestureRecognizer(tapGesture)

        view.addSubview(collectionView)
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
            // Collection view fills entire view
            collectionView.topAnchor.constraint(equalTo: view.topAnchor),
            collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collectionView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            // Input bar pinned to keyboard
            inputBarVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputBarVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            inputBarVC.view.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])
    }

    private func setupDataSource() {
        let cellRegistration = UICollectionView.CellRegistration<UICollectionViewCell, Message.ID> { [weak self] cell, indexPath, messageID in
            guard let self, let message = self.messages.first(where: { $0.id == messageID }) else { return }

            cell.contentConfiguration = UIHostingConfiguration {
                MessageBubble(
                    message: message,
                    showTail: indexPath.item == self.messages.count - 1,
                    showTimestamp: indexPath.item == 0
                )
            }
            .margins(.horizontal, 16)
            .margins(.vertical, 4)
        }

        dataSource = UICollectionViewDiffableDataSource(collectionView: collectionView) { collectionView, indexPath, messageID in
            collectionView.dequeueConfiguredReusableCell(using: cellRegistration, for: indexPath, item: messageID)
        }
    }

    private func applySnapshot(animated: Bool) {
        var snapshot = NSDiffableDataSourceSnapshot<Int, Message.ID>()
        snapshot.appendSections([0])
        snapshot.appendItems(messages.map(\.id))
        dataSource.apply(snapshot, animatingDifferences: animated)
    }

    // MARK: - Keyboard Observers

    private func setupKeyboardObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChangeFrame(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillHide(_:)),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
    }

    @objc private func keyboardWillChangeFrame(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let endFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let duration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double,
              let curveRaw = userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int else { return }

        let curve = UIView.AnimationCurve(rawValue: curveRaw) ?? .easeInOut
        let endFrameInView = view.convert(endFrame, from: nil)
        let keyboardOverlap = max(0, view.bounds.maxY - endFrameInView.minY)

        animateKeyboardChange(to: keyboardOverlap, duration: duration, curve: curve)
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let duration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double,
              let curveRaw = userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int else { return }

        let curve = UIView.AnimationCurve(rawValue: curveRaw) ?? .easeInOut
        animateKeyboardChange(to: 0, duration: duration, curve: curve)
    }

    private func animateKeyboardChange(to keyboardOverlap: CGFloat, duration: Double, curve: UIView.AnimationCurve) {
        // Check if user is near bottom before changing insets
        let wasNearBottom = isNearBottom()

        // Cancel any existing animation
        keyboardAnimator?.stopAnimation(true)

        // Calculate new insets
        view.layoutIfNeeded()
        let inputBarHeight = inputBarVC.view.bounds.height
        let newBottomInset = keyboardOverlap + inputBarHeight
        let oldBottomInset = collectionView.contentInset.bottom
        let delta = newBottomInset - oldBottomInset

        // Create animator with Apple's exact curve
        keyboardAnimator = UIViewPropertyAnimator(duration: duration, curve: curve) { [self] in
            // Update insets
            collectionView.contentInset.top = view.safeAreaInsets.top
            collectionView.contentInset.bottom = newBottomInset

            // If user was near bottom, shift content to stay pinned
            if wasNearBottom && delta != 0 {
                var offset = collectionView.contentOffset
                offset.y += delta

                // Clamp to valid range
                let minY = -collectionView.adjustedContentInset.top
                let maxY = max(minY, collectionView.contentSize.height - collectionView.bounds.height + newBottomInset)
                offset.y = min(max(offset.y, minY), maxY)

                collectionView.contentOffset = offset
            }
        }

        keyboardAnimator?.addCompletion { [weak self] _ in
            self?.currentKeyboardHeight = keyboardOverlap
        }

        keyboardAnimator?.startAnimation()
    }

    // MARK: - Display Link (Interactive Dismiss)

    private func setupDisplayLink() {
        displayLink = CADisplayLink(target: self, selector: #selector(displayLinkFired))
        displayLink?.isPaused = true
        displayLink?.add(to: .main, forMode: .common)
    }

    @objc private func displayLinkFired() {
        guard let inputBarView = inputBarVC.view else { return }

        let inputBarMinY = inputBarView.frame.minY
        let inputBarHeight = inputBarView.bounds.height

        // Detect if we're in interactive dismiss (input bar position changed without notification)
        if inputBarMinY != lastInputBarMinY {
            // Calculate keyboard height from input bar position
            let viewHeight = view.bounds.height
            let keyboardHeight = max(0, viewHeight - inputBarMinY - inputBarHeight)

            // Update bottom inset to match
            let newBottomInset = keyboardHeight + inputBarHeight
            let oldBottomInset = collectionView.contentInset.bottom
            let delta = newBottomInset - oldBottomInset

            if abs(delta) > 0.5 {
                // Check if near bottom before adjusting
                let wasNearBottom = isNearBottom()

                collectionView.contentInset.bottom = newBottomInset

                // Shift content offset if was near bottom
                if wasNearBottom {
                    var offset = collectionView.contentOffset
                    offset.y += delta

                    let minY = -collectionView.adjustedContentInset.top
                    let maxY = max(minY, collectionView.contentSize.height - collectionView.bounds.height + newBottomInset)
                    offset.y = min(max(offset.y, minY), maxY)

                    collectionView.contentOffset = offset
                }
            }

            lastInputBarMinY = inputBarMinY
        }
    }

    // MARK: - UIScrollViewDelegate

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        // Start display link when user starts dragging (might be interactive dismiss)
        displayLink?.isPaused = false
        lastInputBarMinY = inputBarVC.view.frame.minY
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate {
            // Stop display link after a delay to catch final position
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.displayLink?.isPaused = true
            }
        }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        // Stop display link after deceleration
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.displayLink?.isPaused = true
        }
    }

    // MARK: - Helpers

    private func isNearBottom() -> Bool {
        let contentHeight = collectionView.contentSize.height
        let frameHeight = collectionView.bounds.height
        let bottomInset = collectionView.contentInset.bottom
        let offsetY = collectionView.contentOffset.y

        let visibleBottom = offsetY + frameHeight - bottomInset
        let distanceFromBottom = contentHeight - visibleBottom

        return distanceFromBottom < nearBottomThreshold
    }

    private func scrollToBottom(animated: Bool) {
        guard messages.count > 0 else { return }

        // Force layout to get correct content size
        collectionView.layoutIfNeeded()

        let indexPath = IndexPath(item: messages.count - 1, section: 0)
        collectionView.scrollToItem(at: indexPath, at: .bottom, animated: animated)
    }

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        view.endEditing(true)
    }

    private func sendMessage() {
        guard !inputBarVC.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        let message = Message(content: inputBarVC.text, timestamp: .now, isFromMe: true, status: .sent)
        messages.append(message)
        inputBarVC.clearText()

        var snapshot = dataSource.snapshot()
        snapshot.appendItems([message.id])
        dataSource.apply(snapshot, animatingDifferences: true) { [weak self] in
            self?.scrollToBottom(animated: true)
        }
    }

    // MARK: - Layout

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()

        // Set initial top inset
        collectionView.contentInset.top = view.safeAreaInsets.top

        // Set initial bottom inset if not yet set
        if collectionView.contentInset.bottom == 0 {
            let inputBarHeight = inputBarVC.view.bounds.height
            collectionView.contentInset.bottom = inputBarHeight + view.safeAreaInsets.bottom
        }
    }

    deinit {
        displayLink?.invalidate()
    }
}

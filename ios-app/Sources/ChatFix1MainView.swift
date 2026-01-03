import SwiftUI
import UIKit

private func log(_ message: String) {
    NSLog("[CMUX_CHAT_FIX1] MAIN %@", message)
}

struct ChatFix1MainView: View {
    let conversation: Conversation
    private let topShimHeight: CGFloat

    init(conversation: Conversation) {
        self.conversation = conversation
        self.topShimHeight = 1 / UIScreen.main.scale
    }

    var body: some View {
        ZStack(alignment: .top) {
            Fix1MainViewController_Wrapper(conversation: conversation)
                .ignoresSafeArea()
            Color.clear
                .frame(height: topShimHeight)
                .accessibilityHidden(true)
        }
        .background(Color.clear)
        .ignoresSafeArea()
    }
}

private struct Fix1MainViewController_Wrapper: UIViewControllerRepresentable {
    let conversation: Conversation

    func makeUIViewController(context: Context) -> Fix1MainViewController {
        Fix1MainViewController(messages: conversation.messages, titleText: conversation.name)
    }

    func updateUIViewController(_ uiViewController: Fix1MainViewController, context: Context) {}
}

private final class Fix1MainViewController: UIViewController, UIScrollViewDelegate {
    private var scrollView: UIScrollView!
    private var contentStack: UIStackView!
    private var inputBarVC: DebugInputBarViewController!
    private var backgroundView: UIView!

    private var messages: [Message]
    private var keyboardAnimator: UIViewPropertyAnimator?
    private var lastKeyboardHeight: CGFloat = 0
    private var lastAppliedBottomInset: CGFloat = 0
    private var lastContentHeight: CGFloat = 0
    private var hasUserScrolled = false
    private var didInitialScrollToBottom = false
    private var inputBarBottomConstraint: NSLayoutConstraint!
    private var contentStackBottomConstraint: NSLayoutConstraint!
    private var contentStackTopConstraint: NSLayoutConstraint!
    private var lastGeometryLogSignature: String?
    private var lastVisibleSignature: String?
    private var headerContainer: UIView!
    private var backButtonHost: UIHostingController<GlassBackButtonView>!
    private var titleLabel: UILabel!
    private var topFadeView: TopFadeView!
    private var topFadeHeightConstraint: NSLayoutConstraint!
    private var didLogGeometryOnce = false

    private let titleText: String

    init(messages: [Message], titleText: String) {
        self.messages = messages
        self.titleText = titleText
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear

        setupBackground()
        setupScrollView()
        setupInputBar()
        setupHeaderOverlay()
        setupConstraints()
        populateMessages()
        setupKeyboardObservers()

        applyFix1()

        log("🚀 viewDidLoad complete")

        DispatchQueue.main.async {
            log("viewDidLoad - second async scrollToBottom")
            self.scrollToBottom(animated: false)
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: false)
        enableInteractivePopGesture()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        enableInteractivePopGesture()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        navigationController?.setNavigationBarHidden(false, animated: false)
    }

    private func applyFix1() {
        log("🔧 applyFix1 called")

        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.contentInset.top = 0
        scrollView.verticalScrollIndicatorInsets.top = 0
        contentStackBottomConstraint.constant = -8

        log("applyFix1 - before updateScrollViewInsets")
        log("  view.window: \(String(describing: view.window))")
        log("  view.safeAreaInsets: \(view.safeAreaInsets)")
        log("  inputBarVC.view.bounds: \(inputBarVC.view.bounds)")

        updateScrollViewInsets()
        view.layoutIfNeeded()

        log("applyFix1 - after layoutIfNeeded")
        log("  scrollView.contentInset: \(scrollView.contentInset)")
        log("  scrollView.contentSize: \(scrollView.contentSize)")
        log("  scrollView.bounds: \(scrollView.bounds)")
        logContentGeometry(reason: "applyFix1-after-layout")

        DispatchQueue.main.async {
            log("applyFix1 - first async scrollToBottom")
            log("  scrollView.contentInset: \(self.scrollView.contentInset)")
            log("  scrollView.contentSize: \(self.scrollView.contentSize)")
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
        let animationDuration = duration > 0 ? duration : 0.25
        let endFrameInView = view.convert(endFrame, from: nil)
        let keyboardOverlap = max(0, view.bounds.maxY - endFrameInView.minY)

        let safeBottom = view.window?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom
        let effectiveKeyboardHeight = keyboardOverlap > safeBottom ? keyboardOverlap - safeBottom : 0
        let delta = effectiveKeyboardHeight - lastKeyboardHeight

        lastKeyboardHeight = effectiveKeyboardHeight

        guard abs(delta) > 1 else { return }

        keyboardAnimator?.stopAnimation(true)

        let inputBarHeight = inputBarVC.view.bounds.height
        let newBottomInset = inputBarHeight + max(keyboardOverlap, safeBottom)
        let currentOffset = scrollView.contentOffset

        var targetOffsetY = currentOffset.y + delta
        let adjustedTop = scrollView.adjustedContentInset.top
        let minY = -adjustedTop
        let maxY = max(minY, scrollView.contentSize.height - scrollView.bounds.height + newBottomInset)
        targetOffsetY = min(max(targetOffsetY, minY), maxY)

        keyboardAnimator = UIViewPropertyAnimator(duration: animationDuration, curve: curve) { [self] in
            inputBarBottomConstraint.constant = -max(keyboardOverlap, safeBottom)
            scrollView.contentInset.bottom = newBottomInset
            scrollView.verticalScrollIndicatorInsets.bottom = newBottomInset
            scrollView.contentOffset.y = targetOffsetY
            view.layoutIfNeeded()
        }
        keyboardAnimator?.startAnimation()
    }

    private func setupScrollView() {
        scrollView = UIScrollView()
        scrollView.alwaysBounceVertical = true
        scrollView.keyboardDismissMode = .interactive
        scrollView.showsVerticalScrollIndicator = false
        scrollView.backgroundColor = .clear
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.delegate = self

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

    private func setupBackground() {
        backgroundView = UIView()
        backgroundView.translatesAutoresizingMaskIntoConstraints = false
        backgroundView.backgroundColor = .systemBackground
        view.addSubview(backgroundView)
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

    private func setupHeaderOverlay() {
        topFadeView = TopFadeView()
        topFadeView.translatesAutoresizingMaskIntoConstraints = false
        topFadeView.isUserInteractionEnabled = false
        view.addSubview(topFadeView)

        headerContainer = UIView()
        headerContainer.translatesAutoresizingMaskIntoConstraints = false
        headerContainer.backgroundColor = .clear
        view.addSubview(headerContainer)

        let backButtonHost = UIHostingController(
            rootView: GlassBackButtonView { [weak self] in
                self?.handleBackButton()
            }
        )
        if #available(iOS 16.0, *) {
            backButtonHost.safeAreaRegions = []
        }
        backButtonHost.view.translatesAutoresizingMaskIntoConstraints = false
        backButtonHost.view.backgroundColor = .clear
        addChild(backButtonHost)
        headerContainer.addSubview(backButtonHost.view)
        backButtonHost.didMove(toParent: self)
        self.backButtonHost = backButtonHost

        titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = titleText
        titleLabel.font = UIFont.preferredFont(forTextStyle: .headline)
        titleLabel.textColor = .label
        headerContainer.addSubview(titleLabel)
    }

    private func setupConstraints() {
        inputBarBottomConstraint = inputBarVC.view.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: 0)
        contentStackBottomConstraint = contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -8)
        contentStackTopConstraint = contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8)
        topFadeHeightConstraint = topFadeView.heightAnchor.constraint(equalToConstant: 0)

        NSLayoutConstraint.activate([
            backgroundView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            backgroundView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            backgroundView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            backgroundView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            scrollView.topAnchor.constraint(equalTo: view.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            contentStackTopConstraint,
            contentStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 16),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -16),
            contentStackBottomConstraint,
            contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -32),

            inputBarVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputBarVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            inputBarBottomConstraint,

            topFadeView.topAnchor.constraint(equalTo: view.topAnchor),
            topFadeView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            topFadeView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            topFadeHeightConstraint,

            headerContainer.topAnchor.constraint(equalTo: view.topAnchor),
            headerContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            headerContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            backButtonHost.view.leadingAnchor.constraint(equalTo: headerContainer.leadingAnchor, constant: 16),
            backButtonHost.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            backButtonHost.view.widthAnchor.constraint(equalToConstant: 36),
            backButtonHost.view.heightAnchor.constraint(equalToConstant: 36),

            titleLabel.centerXAnchor.constraint(equalTo: headerContainer.centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: backButtonHost.view.centerYAnchor),

            headerContainer.bottomAnchor.constraint(equalTo: backButtonHost.view.bottomAnchor, constant: 8)
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        log("viewDidLayoutSubviews - lastKeyboardHeight: \(lastKeyboardHeight)")
        log("  view.window: \(String(describing: view.window))")
        log("  inputBarVC.view.bounds: \(inputBarVC.view.bounds)")
        updateTopFadeHeightIfNeeded()
        if lastKeyboardHeight == 0 {
            let safeBottom = view.window?.safeAreaInsets.bottom ?? 0
            log("  setting inputBarBottomConstraint to: \(-safeBottom)")
            inputBarBottomConstraint.constant = -safeBottom
            updateScrollViewInsets()
        }
        maybeScrollToBottomIfNeeded()
        logContentGeometry(reason: "viewDidLayoutSubviews")
        logVisibleMessages(reason: "viewDidLayoutSubviews")
        if !didLogGeometryOnce, view.window != nil {
            didLogGeometryOnce = true
            logContentGeometry(reason: "layoutOnce")
            logVisibleMessages(reason: "layoutOnce")
        }
    }

    private func updateScrollViewInsets() {
        let inputBarHeight = inputBarVC.view.bounds.height
        let safeBottom = view.window?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom
        let newBottomInset = inputBarHeight + safeBottom

        log("updateScrollViewInsets:")
        log("  inputBarHeight: \(inputBarHeight)")
        log("  safeBottom: \(safeBottom)")
        log("  newBottomInset: \(newBottomInset)")

        if abs(lastAppliedBottomInset - newBottomInset) > 0.5 {
            scrollView.contentInset.bottom = newBottomInset
            scrollView.verticalScrollIndicatorInsets.bottom = newBottomInset
            lastAppliedBottomInset = newBottomInset
        }
    }

    private func maybeScrollToBottomIfNeeded() {
        let contentHeight = scrollView.contentSize.height
        if abs(contentHeight - lastContentHeight) > 1 {
            lastContentHeight = contentHeight
            if !hasUserScrolled && (didInitialScrollToBottom == false || contentHeight > 0) {
                didInitialScrollToBottom = true
                scrollToBottom(animated: false)
            }
        }
    }

    private func logContentGeometry(reason: String) {
        let safeTop = view.window?.safeAreaInsets.top ?? view.safeAreaInsets.top
        let insetTop = scrollView.contentInset.top
        let insetBottom = scrollView.contentInset.bottom
        let adjustedTop = scrollView.adjustedContentInset.top
        let adjustedBottom = scrollView.adjustedContentInset.bottom
        let offset = scrollView.contentOffset
        let contentSize = scrollView.contentSize
        let stackFrame = contentStack.frame
        let firstFrame = contentStack.arrangedSubviews.first?.frame ?? .zero
        let lastFrame = contentStack.arrangedSubviews.last?.frame ?? .zero
        let signature = String(
            format: "safeTop=%.1f insetTop=%.1f insetBottom=%.1f adjustedTop=%.1f adjustedBottom=%.1f offset=(%.1f,%.1f) content=(%.1f,%.1f) stackY=%.1f stackH=%.1f firstY=%.1f lastMaxY=%.1f topConst=%.1f",
            safeTop,
            insetTop,
            insetBottom,
            adjustedTop,
            adjustedBottom,
            offset.x,
            offset.y,
            contentSize.width,
            contentSize.height,
            stackFrame.minY,
            stackFrame.height,
            firstFrame.minY,
            lastFrame.maxY,
            contentStackTopConstraint.constant
        )
        if signature != lastGeometryLogSignature {
            log("CMUX_CHAT_GEOM \(reason) \(signature)")
            lastGeometryLogSignature = signature
        }
    }

    private func updateTopFadeHeightIfNeeded() {
        let safeTop = view.window?.safeAreaInsets.top ?? view.safeAreaInsets.top
        let targetHeight = safeTop + 16
        if abs(topFadeHeightConstraint.constant - targetHeight) > 0.5 {
            topFadeHeightConstraint.constant = targetHeight
            topFadeView.updateColors()
        }
    }

    private func enableInteractivePopGesture() {
        guard let nav = navigationController else { return }
        nav.interactivePopGestureRecognizer?.isEnabled = true
        nav.interactivePopGestureRecognizer?.delegate = nil
    }

    private func populateMessages() {
        for (index, message) in messages.enumerated() {
            let bubble = MessageBubble(
                message: message,
                showTail: index == messages.count - 1,
                showTimestamp: index == 0
            )
            let host = UIHostingController(rootView: bubble)
            if #available(iOS 16.0, *) {
                host.safeAreaRegions = []
            }
            host.view.backgroundColor = .clear
            host.view.translatesAutoresizingMaskIntoConstraints = false

            addChild(host)
            contentStack.addArrangedSubview(host.view)
            host.didMove(toParent: self)
        }
    }

    private func scrollToBottom(animated: Bool) {
        let insets = scrollView.adjustedContentInset
        let visibleHeight = scrollView.bounds.height - insets.top - insets.bottom
        let bottomOffsetY = max(-insets.top, scrollView.contentSize.height - visibleHeight)
        let bottomOffset = CGPoint(x: 0, y: bottomOffsetY)
        log("scrollToBottom:")
        log("  scrollView.bounds: \(scrollView.bounds)")
        log("  scrollView.contentInset.top: \(scrollView.contentInset.top)")
        log("  scrollView.contentInset.bottom: \(scrollView.contentInset.bottom)")
        log("  visibleHeight: \(visibleHeight)")
        log("  scrollView.contentSize: \(scrollView.contentSize)")
        log("  bottomOffset: \(bottomOffset)")
        scrollView.setContentOffset(bottomOffset, animated: animated)
    }

    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }

    @objc private func handleBackButton() {
        if let navigationController {
            navigationController.popViewController(animated: true)
        } else {
            dismiss(animated: true)
        }
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate {
            logContentGeometry(reason: "scrollEndDrag")
            logVisibleMessages(reason: "scrollEndDrag")
        }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        logContentGeometry(reason: "scrollEndDecel")
        logVisibleMessages(reason: "scrollEndDecel")
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        hasUserScrolled = true
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        logVisibleMessages(reason: "scroll")
    }

    private func sendMessage() {
        guard !inputBarVC.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        let message = Message(content: inputBarVC.text, timestamp: .now, isFromMe: true, status: .sent)
        messages.append(message)
        inputBarVC.clearText()

        let bubble = MessageBubble(message: message, showTail: true, showTimestamp: false)
        let host = UIHostingController(rootView: bubble)
        if #available(iOS 16.0, *) {
            host.safeAreaRegions = []
        }
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false

        addChild(host)
        contentStack.addArrangedSubview(host.view)
        host.didMove(toParent: self)

        DispatchQueue.main.async {
            self.scrollToBottom(animated: true)
        }
    }

    private func logVisibleMessages(reason: String) {
        guard !contentStack.arrangedSubviews.isEmpty else { return }

        let visibleRect = CGRect(origin: scrollView.contentOffset, size: scrollView.bounds.size)
        var visibleItems: [(Int, CGRect)] = []
        visibleItems.reserveCapacity(contentStack.arrangedSubviews.count)

        for (index, subview) in contentStack.arrangedSubviews.enumerated() {
            let frameInScroll = contentStack.convert(subview.frame, to: scrollView)
            if frameInScroll.intersects(visibleRect) {
                visibleItems.append((index, frameInScroll))
            }
        }

        let signature = visibleItems
            .map { item in
                String(
                    format: "%d:%.1f:%.1f:%.1f:%.1f",
                    item.0,
                    item.1.origin.x,
                    item.1.origin.y,
                    item.1.size.width,
                    item.1.size.height
                )
            }
            .joined(separator: "|")

        guard signature != lastVisibleSignature else { return }
        lastVisibleSignature = signature

        log("CMUX_CHAT_MSG \(reason) count=\(visibleItems.count)")
        for (index, frame) in visibleItems {
            log("CMUX_CHAT_MSG \(reason)   [\(index)] frame: \(frame)")
        }
    }
}

private struct GlassBackButtonView: View {
    let action: () -> Void

    var body: some View {
        GlassEffectContainer {
            Button(action: action) {
                Image(systemName: "chevron.left")
                    .font(.title3)
                    .fontWeight(.medium)
                    .foregroundStyle(.primary)
            }
            .buttonStyle(.plain)
            .frame(width: 36, height: 36)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Back")
        }
        .frame(width: 36, height: 36)
        .allowsHitTesting(true)
    }
}

private final class TopFadeView: UIView {
    override class var layerClass: AnyClass {
        CAGradientLayer.self
    }

    private var gradientLayer: CAGradientLayer {
        layer as? CAGradientLayer ?? CAGradientLayer()
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        gradientLayer.startPoint = CGPoint(x: 0.5, y: 0)
        gradientLayer.endPoint = CGPoint(x: 0.5, y: 1)
        updateColors()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        isUserInteractionEnabled = false
        gradientLayer.startPoint = CGPoint(x: 0.5, y: 0)
        gradientLayer.endPoint = CGPoint(x: 0.5, y: 1)
        updateColors()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if previousTraitCollection?.userInterfaceStyle != traitCollection.userInterfaceStyle {
            updateColors()
        }
    }

    func updateColors() {
        let base = UIColor.systemBackground
        let maxAlpha: CGFloat = 0.6
        gradientLayer.colors = [
            base.withAlphaComponent(0.0).cgColor,
            base.withAlphaComponent(maxAlpha).cgColor
        ]
    }
}

import SwiftUI
import UIKit

/// Approach C: UICollectionView + Full UIKit
/// Uses UICollectionView with compositional layout
/// Direct control over contentInset and contentOffset
/// Keyboard tracking via notifications with UIViewPropertyAnimator
struct ChatApproachC: View {
    let conversation: Conversation

    var body: some View {
        ChatCollectionViewController_Wrapper(conversation: conversation)
            .ignoresSafeArea(.keyboard)
            .navigationTitle("C: UICollectionView")
            .navigationBarTitleDisplayMode(.inline)
    }
}

struct ChatCollectionViewController_Wrapper: UIViewControllerRepresentable {
    let conversation: Conversation

    func makeUIViewController(context: Context) -> ChatCollectionViewController {
        ChatCollectionViewController(messages: conversation.messages)
    }

    func updateUIViewController(_ uiViewController: ChatCollectionViewController, context: Context) {}
}

final class ChatCollectionViewController: UIViewController {
    private var collectionView: UICollectionView!
    private var inputBarVC: DebugInputBarViewController!
    private var inputBarBottom: NSLayoutConstraint!

    private var messages: [Message]
    private var dataSource: UICollectionViewDiffableDataSource<Int, Message.ID>!

    private var keyboardAnimator: UIViewPropertyAnimator?

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
        setupDataSource()
        setupKeyboardObservers()

        applySnapshot()
        scrollToBottom(animated: false)
    }

    private func setupCollectionView() {
        var config = UICollectionLayoutListConfiguration(appearance: .plain)
        config.showsSeparators = false
        config.backgroundColor = .clear
        let layout = UICollectionViewCompositionalLayout.list(using: config)

        collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.backgroundColor = .clear
        collectionView.keyboardDismissMode = .interactive
        collectionView.alwaysBounceVertical = true
        collectionView.contentInsetAdjustmentBehavior = .never
        collectionView.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(collectionView)

        NSLayoutConstraint.activate([
            collectionView.topAnchor.constraint(equalTo: view.topAnchor),
            collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collectionView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
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

        inputBarBottom = inputBarVC.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)

        NSLayoutConstraint.activate([
            inputBarVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputBarVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            inputBarBottom
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
            .margins(.all, 0)
        }

        dataSource = UICollectionViewDiffableDataSource(collectionView: collectionView) { collectionView, indexPath, messageID in
            collectionView.dequeueConfiguredReusableCell(using: cellRegistration, for: indexPath, item: messageID)
        }
    }

    private func applySnapshot() {
        var snapshot = NSDiffableDataSourceSnapshot<Int, Message.ID>()
        snapshot.appendSections([0])
        snapshot.appendItems(messages.map(\.id))
        dataSource.apply(snapshot, animatingDifferences: false)
    }

    private func sendTapped() {
        guard !inputBarVC.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let message = Message(content: inputBarVC.text, timestamp: .now, isFromMe: true, status: .sent)
        messages.append(message)
        inputBarVC.clearText()

        var snapshot = dataSource.snapshot()
        snapshot.appendItems([message.id])
        dataSource.apply(snapshot, animatingDifferences: true)

        scrollToBottom(animated: true)
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
        let keyboardHeight = max(0, keyboardOverlap - view.safeAreaInsets.bottom)

        let wasNearBottom = isNearBottom()

        keyboardAnimator?.stopAnimation(true)
        keyboardAnimator = UIViewPropertyAnimator(duration: duration, curve: curve) { [self] in
            inputBarBottom.constant = -keyboardHeight

            view.layoutIfNeeded()
            let inputHeight = inputBarVC.view.bounds.height
            let newInset = keyboardHeight + inputHeight
            let delta = newInset - collectionView.contentInset.bottom

            collectionView.contentInset.bottom = newInset
            collectionView.verticalScrollIndicatorInsets.bottom = newInset

            if wasNearBottom {
                var offset = collectionView.contentOffset
                offset.y += delta
                offset.y = min(max(offset.y, -collectionView.adjustedContentInset.top),
                               collectionView.contentSize.height - collectionView.bounds.height + collectionView.adjustedContentInset.bottom)
                collectionView.setContentOffset(offset, animated: false)
            }
        }
        keyboardAnimator?.startAnimation()
    }

    private func isNearBottom(threshold: CGFloat = 24) -> Bool {
        let visibleBottom = collectionView.contentOffset.y + collectionView.bounds.height - collectionView.adjustedContentInset.bottom
        return (collectionView.contentSize.height - visibleBottom) < threshold
    }

    private func scrollToBottom(animated: Bool) {
        guard messages.count > 0 else { return }
        let indexPath = IndexPath(item: messages.count - 1, section: 0)
        collectionView.scrollToItem(at: indexPath, at: .bottom, animated: animated)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        collectionView.contentInset.top = view.safeAreaInsets.top
        collectionView.verticalScrollIndicatorInsets.top = view.safeAreaInsets.top

        if collectionView.contentInset.bottom == 0 {
            let inputHeight = inputBarVC.view.bounds.height
            collectionView.contentInset.bottom = inputHeight
            collectionView.verticalScrollIndicatorInsets.bottom = inputHeight
        }
    }
}

import SwiftUI
import UIKit

/// Approach F: UICollectionViewController (Apple Recommended)
/// Uses UICollectionViewController which AUTOMATICALLY handles keyboard avoidance.
/// Per Apple DTS: "I highly recommend that you use UICollectionViewController,
/// which automatically handles the keyboard avoidance for you."
struct ChatApproachF: View {
    let conversation: Conversation

    var body: some View {
        ChatCollectionViewControllerWrapper(conversation: conversation)
            .ignoresSafeArea(.keyboard)
            .navigationTitle("F: UICollectionViewController")
            .navigationBarTitleDisplayMode(.inline)
    }
}

struct ChatCollectionViewControllerWrapper: UIViewControllerRepresentable {
    let conversation: Conversation

    func makeUIViewController(context: Context) -> ContainerViewController {
        ContainerViewController(messages: conversation.messages)
    }

    func updateUIViewController(_ uiViewController: ContainerViewController, context: Context) {}
}

/// Container that holds the collection view controller and input bar
final class ContainerViewController: UIViewController {
    private var collectionVC: ChatCVController!
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

        setupCollectionVC()
        setupInputBar()
        setupConstraints()
    }

    private func setupCollectionVC() {
        var config = UICollectionLayoutListConfiguration(appearance: .plain)
        config.showsSeparators = false
        config.backgroundColor = .clear
        let layout = UICollectionViewCompositionalLayout.list(using: config)

        collectionVC = ChatCVController(collectionViewLayout: layout)
        collectionVC.messages = messages
        collectionVC.view.translatesAutoresizingMaskIntoConstraints = false

        addChild(collectionVC)
        view.addSubview(collectionVC.view)
        collectionVC.didMove(toParent: self)
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
            // Collection view fills space above input bar
            collectionVC.view.topAnchor.constraint(equalTo: view.topAnchor),
            collectionVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collectionVC.view.bottomAnchor.constraint(equalTo: inputBarVC.view.topAnchor),

            // Input bar at bottom, tracks keyboard
            inputBarVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputBarVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            inputBarVC.view.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])
    }

    private func sendMessage() {
        guard !inputBarVC.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        let message = Message(content: inputBarVC.text, timestamp: .now, isFromMe: true, status: .sent)
        messages.append(message)
        collectionVC.messages = messages
        collectionVC.reloadAndScroll()
        inputBarVC.clearText()
    }
}

/// The actual UICollectionViewController - gets automatic keyboard avoidance
final class ChatCVController: UICollectionViewController {
    var messages: [Message] = []
    private var dataSource: UICollectionViewDiffableDataSource<Int, Message.ID>!

    override func viewDidLoad() {
        super.viewDidLoad()

        collectionView.backgroundColor = .clear
        collectionView.keyboardDismissMode = .interactive
        collectionView.alwaysBounceVertical = true

        if #available(iOS 16.0, *) {
            collectionView.selfSizingInvalidation = .enabledIncludingConstraints
        }

        setupDataSource()
        applySnapshot()

        DispatchQueue.main.async {
            self.scrollToBottom(animated: false)
        }
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

    private func applySnapshot(animating: Bool = false) {
        var snapshot = NSDiffableDataSourceSnapshot<Int, Message.ID>()
        snapshot.appendSections([0])
        snapshot.appendItems(messages.map(\.id))
        dataSource.apply(snapshot, animatingDifferences: animating)
    }

    func reloadAndScroll() {
        applySnapshot(animating: true)
        scrollToBottom(animated: true)
    }

    private func scrollToBottom(animated: Bool) {
        guard messages.count > 0 else { return }
        let indexPath = IndexPath(item: messages.count - 1, section: 0)
        collectionView.scrollToItem(at: indexPath, at: .bottom, animated: animated)
    }
}

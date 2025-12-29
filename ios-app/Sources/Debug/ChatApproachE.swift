import SwiftUI
import UIKit

/// Approach E: UITableView Inverted (Classic Messages Style)
/// Uses inverted table view (transform: scaleY = -1) so new messages
/// appear at bottom naturally. Each cell is also inverted to flip back.
/// Input bar uses keyboardLayoutGuide.
struct ChatApproachE: View {
    let conversation: Conversation

    var body: some View {
        ChatTableViewController_Wrapper(conversation: conversation)
            .ignoresSafeArea(.keyboard)
            .navigationTitle("E: Inverted Table")
            .navigationBarTitleDisplayMode(.inline)
    }
}

struct ChatTableViewController_Wrapper: UIViewControllerRepresentable {
    let conversation: Conversation

    func makeUIViewController(context: Context) -> ChatTableViewController {
        ChatTableViewController(messages: conversation.messages)
    }

    func updateUIViewController(_ uiViewController: ChatTableViewController, context: Context) {}
}

final class ChatTableViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private var tableView: UITableView!
    private var inputBarVC: DebugInputBarViewController!

    private var messages: [Message]
    private var keyboardAnimator: UIViewPropertyAnimator?

    init(messages: [Message]) {
        // Reverse messages for inverted table
        self.messages = messages.reversed()
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        setupTableView()
        setupInputBar()
        setupConstraints()
        setupKeyboardObservers()
    }

    private func setupTableView() {
        tableView = UITableView(frame: .zero, style: .plain)
        tableView.dataSource = self
        tableView.delegate = self
        tableView.separatorStyle = .none
        tableView.keyboardDismissMode = .interactive
        tableView.allowsSelection = false
        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.contentInsetAdjustmentBehavior = .never

        // Invert the table view
        tableView.transform = CGAffineTransform(scaleX: 1, y: -1)

        tableView.register(MessageTableCell.self, forCellReuseIdentifier: "message")

        view.addSubview(tableView)
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
        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

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

        keyboardAnimator?.stopAnimation(true)
        keyboardAnimator = UIViewPropertyAnimator(duration: duration, curve: curve) { [self] in
            view.layoutIfNeeded()
            let inputHeight = inputBarVC.view.bounds.height
            // For inverted table: "top" inset is actually bottom visually
            tableView.contentInset.top = keyboardOverlap + inputHeight
            tableView.verticalScrollIndicatorInsets.top = keyboardOverlap + inputHeight
            tableView.contentInset.bottom = view.safeAreaInsets.top
            tableView.verticalScrollIndicatorInsets.bottom = view.safeAreaInsets.top
        }
        keyboardAnimator?.startAnimation()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if tableView.contentInset.top == 0 {
            let inputHeight = inputBarVC.view.bounds.height
            tableView.contentInset.top = inputHeight
            tableView.verticalScrollIndicatorInsets.top = inputHeight
            tableView.contentInset.bottom = view.safeAreaInsets.top
            tableView.verticalScrollIndicatorInsets.bottom = view.safeAreaInsets.top
        }
    }

    // MARK: - UITableViewDataSource

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        messages.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "message", for: indexPath) as! MessageTableCell
        let message = messages[indexPath.row]
        cell.configure(with: message, showTail: indexPath.row == 0, showTimestamp: indexPath.row == messages.count - 1)
        return cell
    }

    private func sendTapped() {
        guard !inputBarVC.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let message = Message(content: inputBarVC.text, timestamp: .now, isFromMe: true, status: .sent)

        // Insert at beginning (inverted, so this appears at bottom)
        messages.insert(message, at: 0)
        inputBarVC.clearText()

        tableView.insertRows(at: [IndexPath(row: 0, section: 0)], with: .automatic)
    }
}

final class MessageTableCell: UITableViewCell {
    private var hostingController: UIHostingController<MessageBubble>?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        contentView.backgroundColor = .clear

        // Invert cell to counter table inversion
        contentView.transform = CGAffineTransform(scaleX: 1, y: -1)
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(with message: Message, showTail: Bool, showTimestamp: Bool) {
        hostingController?.view.removeFromSuperview()

        let bubble = MessageBubble(message: message, showTail: showTail, showTimestamp: showTimestamp)
        let hc = UIHostingController(rootView: bubble)
        hc.view.backgroundColor = .clear
        hc.view.translatesAutoresizingMaskIntoConstraints = false

        contentView.addSubview(hc.view)
        NSLayoutConstraint.activate([
            hc.view.topAnchor.constraint(equalTo: contentView.topAnchor),
            hc.view.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            hc.view.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            hc.view.bottomAnchor.constraint(equalTo: contentView.bottomAnchor)
        ])

        hostingController = hc
    }
}

import SwiftUI

struct MarkdownBlock: Identifiable {
    let id = UUID()
    let type: MarkdownBlockType
}

enum MarkdownBlockType: Equatable {
    case paragraph(String)
    case heading(String)
    case codeBlock(language: String?, code: String)
    case table(headers: [String], rows: [[String]])
}

struct MarkdownParser {
    static func parse(_ text: String) -> [MarkdownBlock] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalized.split(omittingEmptySubsequences: false) { $0.isNewline }
        var blocks: [MarkdownBlock] = []
        var paragraphLines: [String] = []
        var index = 0

        func flushParagraph() {
            guard !paragraphLines.isEmpty else { return }
            let paragraph = paragraphLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !paragraph.isEmpty {
                blocks.append(MarkdownBlock(type: .paragraph(paragraph)))
            }
            paragraphLines.removeAll(keepingCapacity: true)
        }

        while index < lines.count {
            let line = String(lines[index])
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)

            if trimmed.isEmpty {
                flushParagraph()
                index += 1
                continue
            }

            if let heading = parseHeading(trimmed) {
                flushParagraph()
                blocks.append(MarkdownBlock(type: .heading(heading)))
                index += 1
                continue
            }

            if isEmptyHeadingLine(trimmed) {
                flushParagraph()
                index += 1
                continue
            }

            if let fence = parseFence(trimmed) {
                flushParagraph()
                var codeLines: [String] = []
                index += 1
                while index < lines.count {
                    let codeLine = String(lines[index])
                    let codeTrimmed = codeLine.trimmingCharacters(in: .whitespacesAndNewlines)
                    if codeTrimmed.hasPrefix("```") {
                        index += 1
                        break
                    }
                    codeLines.append(codeLine)
                    index += 1
                }
                let code = codeLines.joined(separator: "\n")
                let language = fence.isEmpty ? nil : fence
                blocks.append(MarkdownBlock(type: .codeBlock(language: language, code: code)))
                continue
            }

            if index + 1 < lines.count,
               looksLikeTableRow(line),
               let header = parseTableRow(line),
               isTableSeparator(String(lines[index + 1]), expectedColumns: header.count) {
                flushParagraph()
                var rows: [[String]] = []
                index += 2
                while index < lines.count {
                    let rowLine = String(lines[index])
                    let rowTrimmed = rowLine.trimmingCharacters(in: .whitespacesAndNewlines)
                    if rowTrimmed.isEmpty || !looksLikeTableRow(rowLine) {
                        break
                    }
                    if let row = parseTableRow(rowLine) {
                        rows.append(row)
                    }
                    index += 1
                }
                blocks.append(MarkdownBlock(type: .table(headers: header, rows: rows)))
                continue
            }

            paragraphLines.append(line)
            index += 1
        }

        flushParagraph()
        return blocks
    }

    private static func parseHeading(_ line: String) -> String? {
        guard line.hasPrefix("#") else { return nil }
        let prefixCount = line.prefix { $0 == "#" }.count
        let trimmed = line.dropFirst(prefixCount).trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : String(trimmed)
    }

    private static func isEmptyHeadingLine(_ line: String) -> Bool {
        guard line.hasPrefix("#") else { return false }
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return trimmed.allSatisfy { $0 == "#" }
    }

    private static func parseFence(_ line: String) -> String? {
        guard line.hasPrefix("```") else { return nil }
        let remainder = line.dropFirst(3).trimmingCharacters(in: .whitespaces)
        return String(remainder)
    }

    private static func looksLikeTableRow(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return trimmed.contains("|")
    }

    private static func isTableSeparator(_ line: String, expectedColumns: Int) -> Bool {
        guard expectedColumns > 0 else { return false }
        guard let columns = parseTableColumns(line), columns.count == expectedColumns else { return false }
        for column in columns {
            let trimmed = column.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { return false }
            guard trimmed.contains("-") else { return false }
            for character in trimmed {
                if character != "-" && character != ":" {
                    return false
                }
            }
        }
        return true
    }

    private static func parseTableRow(_ line: String) -> [String]? {
        guard let columns = parseTableColumns(line) else { return nil }
        return columns.map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func parseTableColumns(_ line: String) -> [String]? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.contains("|") else { return nil }
        var parts = trimmed.split(separator: "|", omittingEmptySubsequences: false).map { String($0) }
        if let first = parts.first, first.trimmingCharacters(in: .whitespaces).isEmpty {
            parts.removeFirst()
        }
        if let last = parts.last, last.trimmingCharacters(in: .whitespaces).isEmpty {
            parts.removeLast()
        }
        return parts
    }
}

enum MarkdownInlineToken: Equatable {
    case text(String)
    case inlineCode(String)
    case link(text: String, url: String)
    case image(alt: String, url: String)
}

struct MarkdownInlineParser {
    static func parse(_ text: String) -> [MarkdownInlineToken] {
        var tokens: [MarkdownInlineToken] = []
        var buffer = ""
        var index = text.startIndex

        func flushBuffer() {
            guard !buffer.isEmpty else { return }
            tokens.append(.text(buffer))
            buffer.removeAll(keepingCapacity: true)
        }

        while index < text.endIndex {
            let char = text[index]
            if char == "`" {
                if let end = text[text.index(after: index)...].firstIndex(of: "`") {
                    flushBuffer()
                    let code = String(text[text.index(after: index)..<end])
                    tokens.append(.inlineCode(code))
                    index = text.index(after: end)
                    continue
                }
            }

            if char == "!" {
                let next = text.index(after: index)
                if next < text.endIndex, text[next] == "[",
                   let image = parseLinkToken(text, start: next, isImage: true) {
                    flushBuffer()
                    tokens.append(.image(alt: image.label, url: image.url))
                    index = image.nextIndex
                    continue
                }
            }

            if char == "[", let link = parseLinkToken(text, start: index, isImage: false) {
                flushBuffer()
                tokens.append(.link(text: link.label, url: link.url))
                index = link.nextIndex
                continue
            }

            buffer.append(char)
            index = text.index(after: index)
        }

        flushBuffer()
        return tokens
    }

    private static func parseLinkToken(
        _ text: String,
        start: String.Index,
        isImage: Bool
    ) -> (label: String, url: String, nextIndex: String.Index)? {
        guard text[start] == "[" else { return nil }
        guard let closeBracket = text[start...].firstIndex(of: "]") else { return nil }
        let label = String(text[text.index(after: start)..<closeBracket])
        let parenStart = text.index(after: closeBracket)
        guard parenStart < text.endIndex, text[parenStart] == "(" else { return nil }
        let urlStart = text.index(after: parenStart)
        guard let closeParen = text[urlStart...].firstIndex(of: ")") else { return nil }
        let url = String(text[urlStart..<closeParen]).trimmingCharacters(in: .whitespacesAndNewlines)
        let nextIndex = text.index(after: closeParen)
        if isImage, label.isEmpty, url.isEmpty {
            return nil
        }
        return (label: label, url: url, nextIndex: nextIndex)
    }
}

struct MarkdownLinkPolicy: Equatable {
    let allowedSchemes: Set<String>
    let allowedHosts: Set<String>?

    static let `default` = MarkdownLinkPolicy(
        allowedSchemes: ["https", "http"],
        allowedHosts: nil
    )
}

enum MarkdownImagePolicy: Equatable {
    case disabled
    case tapToLoad(allowedSchemes: Set<String>, allowedHosts: Set<String>?)
    case allow(allowedSchemes: Set<String>, allowedHosts: Set<String>?)

    static let `default` = MarkdownImagePolicy.tapToLoad(
        allowedSchemes: ["https"],
        allowedHosts: nil
    )
}

struct MarkdownRenderPolicy: Equatable {
    let linkPolicy: MarkdownLinkPolicy
    let imagePolicy: MarkdownImagePolicy

    static let assistantDefault = MarkdownRenderPolicy(
        linkPolicy: .default,
        imagePolicy: .default
    )
}

struct MarkdownURLValidator {
    static func isAllowed(url: URL, allowedSchemes: Set<String>, allowedHosts: Set<String>?) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              allowedSchemes.contains(scheme) else { return false }
        if let hosts = allowedHosts {
            guard let host = url.host?.lowercased() else { return false }
            return hosts.contains(host)
        }
        return true
    }
}

struct AssistantMarkdownView: View {
    let text: String
    let policy: MarkdownRenderPolicy

    init(text: String, policy: MarkdownRenderPolicy = .assistantDefault) {
        self.text = text
        self.policy = policy
    }

    var body: some View {
        let blocks = MarkdownParser.parse(text)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(blocks) { block in
                blockView(block.type)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func blockView(_ type: MarkdownBlockType) -> some View {
        switch type {
        case .paragraph(let text):
            MarkdownInlineView(tokens: MarkdownInlineParser.parse(text), policy: policy)
                .font(.body)
                .foregroundStyle(.primary)

        case .heading(let text):
            MarkdownInlineView(tokens: MarkdownInlineParser.parse(text), policy: policy)
                .font(.body.weight(.semibold))
                .foregroundStyle(.primary)

        case .codeBlock(let language, let code):
            MarkdownCodeBlockView(language: language, code: code)

        case .table(let headers, let rows):
            MarkdownTableView(headers: headers, rows: rows)
        }
    }
}

private enum MarkdownInlineSegment: Identifiable {
    case text([MarkdownInlineToken])
    case image(alt: String, url: String)

    var id: UUID { UUID() }
}

private struct MarkdownInlineView: View {
    let tokens: [MarkdownInlineToken]
    let policy: MarkdownRenderPolicy

    var body: some View {
        let segments = splitSegments(tokens)
        VStack(alignment: .leading, spacing: 6) {
            ForEach(segments) { segment in
                switch segment {
                case .text(let textTokens):
                    Text(MarkdownAttributedStringBuilder.build(tokens: textTokens, policy: policy))
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                case .image(let alt, let url):
                    MarkdownImageView(alt: alt, url: url, policy: policy.imagePolicy)
                }
            }
        }
    }

    private func splitSegments(_ tokens: [MarkdownInlineToken]) -> [MarkdownInlineSegment] {
        var segments: [MarkdownInlineSegment] = []
        var buffer: [MarkdownInlineToken] = []

        func flush() {
            guard !buffer.isEmpty else { return }
            segments.append(.text(buffer))
            buffer.removeAll(keepingCapacity: true)
        }

        for token in tokens {
            switch token {
            case .image(let alt, let url):
                flush()
                segments.append(.image(alt: alt, url: url))
            default:
                buffer.append(token)
            }
        }

        flush()
        return segments
    }
}

private struct MarkdownAttributedStringBuilder {
    static func build(tokens: [MarkdownInlineToken], policy: MarkdownRenderPolicy) -> AttributedString {
        var result = AttributedString()
        for token in tokens {
            switch token {
            case .text(let text):
                result.append(AttributedString(text))
            case .inlineCode(let code):
                var segment = AttributedString(code)
                segment.font = .system(.body, design: .monospaced)
                segment.backgroundColor = Color(.secondarySystemBackground)
                result.append(segment)
            case .link(let label, let urlString):
                let display = label.isEmpty ? urlString : label
                var segment = AttributedString(display)
                if let url = URL(string: urlString),
                   MarkdownURLValidator.isAllowed(
                    url: url,
                    allowedSchemes: policy.linkPolicy.allowedSchemes,
                    allowedHosts: policy.linkPolicy.allowedHosts
                   ) {
                    segment.link = url
                    segment.foregroundColor = .blue
                }
                result.append(segment)
            case .image:
                continue
            }
        }
        return result
    }
}

private struct MarkdownCodeBlockView: View {
    let language: String?
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let language {
                Text(language)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            ScrollView(.horizontal, showsIndicators: true) {
                Text(verbatim: code.isEmpty ? " " : code)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(.vertical, 2)
                    .textSelection(.enabled)
            }
        }
        .padding(10)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color(.separator), lineWidth: 1)
        )
        }
    }

private struct MarkdownTableView: View {
    let headers: [String]
    let rows: [[String]]
    @State private var columnWidths: [Int: CGFloat] = [:]

    private var columnCount: Int {
        let rowMax = rows.map { $0.count }.max() ?? 0
        return max(headers.count, rowMax)
    }

    var body: some View {
        let columns = max(columnCount, 1)

        ScrollView(.horizontal, showsIndicators: true) {
            let cornerRadius: CGFloat = 10
            ZStack {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color(.secondarySystemBackground))
                Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                    GridRow {
                        ForEach(0..<columns, id: \.self) { column in
                            tableCell(
                                text: cellText(headers, column),
                                isHeader: true,
                                row: -1,
                                column: column,
                                isEvenRow: true
                            )
                        }
                    }
                    ForEach(rows.indices, id: \.self) { rowIndex in
                        GridRow {
                            ForEach(0..<columns, id: \.self) { column in
                                tableCell(
                                    text: cellText(rows[rowIndex], column),
                                    isHeader: false,
                                    row: rowIndex,
                                    column: column,
                                    isEvenRow: rowIndex % 2 == 0
                                )
                            }
                        }
                    }
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color(.separator), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
        .coordinateSpace(name: "markdown.table")
        .onPreferenceChange(TableCellLayoutPreferenceKey.self) { layouts in
            updateColumnWidths(layouts)
        }
    }

    private func cellText(_ row: [String], _ column: Int) -> String {
        guard column < row.count else { return "" }
        return row[column]
    }

    @ViewBuilder
    private func tableCell(
        text: String,
        isHeader: Bool,
        row: Int,
        column: Int,
        isEvenRow: Bool
    ) -> some View {
        let background = isHeader
            ? Color(.tertiarySystemBackground)
            : (isEvenRow ? Color(.secondarySystemBackground) : Color(.tertiarySystemBackground))

        Text(verbatim: text.isEmpty ? " " : text)
            .font(isHeader ? .caption.weight(.semibold) : .caption)
            .foregroundStyle(.primary)
            .padding(8)
            .fixedSize(horizontal: true, vertical: false)
            .frame(width: columnWidths[column], alignment: .leading)
            .background(background)
            .overlay(
                Rectangle()
                    .stroke(Color(.separator), lineWidth: 0.5)
            )
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(
                        key: TableCellLayoutPreferenceKey.self,
                        value: [
                            TableCellLayout(
                                row: row,
                                column: column,
                                isHeader: isHeader,
                                minX: proxy.frame(in: .named("markdown.table")).minX,
                                width: proxy.size.width
                            )
                        ]
                    )
                }
            )
            .textSelection(.enabled)
    }

    private func updateColumnWidths(_ layouts: [TableCellLayout]) {
        var next = columnWidths
        for layout in layouts {
            let width = layout.width
            let current = next[layout.column] ?? 0
            if width > current + 0.5 {
                next[layout.column] = width
            }
        }
        if next != columnWidths {
            columnWidths = next
        }
    }
}

private struct TableCellLayout: Equatable {
    let row: Int
    let column: Int
    let isHeader: Bool
    let minX: CGFloat
    let width: CGFloat
}

private struct TableCellLayoutPreferenceKey: PreferenceKey {
    static var defaultValue: [TableCellLayout] = []

    static func reduce(value: inout [TableCellLayout], nextValue: () -> [TableCellLayout]) {
        value.append(contentsOf: nextValue())
    }
}

private struct MarkdownImageView: View {
    let alt: String
    let url: String
    let policy: MarkdownImagePolicy
    @State private var isRevealed = false

    var body: some View {
        Group {
            if let imageUrl = URL(string: url), isAllowed(url: imageUrl) {
                switch policy {
                case .disabled:
                    blockedView
                case .tapToLoad:
                    if isRevealed {
                        AsyncImage(url: imageUrl) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .scaledToFit()
                            case .failure:
                                failedView
                            default:
                                progressView
                            }
                        }
                    } else {
                        Button("Load image") {
                            isRevealed = true
                        }
                        .buttonStyle(.bordered)
                        .font(.caption)
                    }
                case .allow:
                    AsyncImage(url: imageUrl) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFit()
                        case .failure:
                            failedView
                        default:
                            progressView
                        }
                    }
                }
            } else {
                blockedView
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color(.separator), lineWidth: 1)
        )
        .accessibilityLabel(alt.isEmpty ? "Image" : "Image: \(alt)")
    }

    private var blockedView: some View {
        Text(alt.isEmpty ? "Image blocked" : "Image blocked: \(alt)")
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    private var failedView: some View {
        Text(alt.isEmpty ? "Image failed to load" : "Image failed to load: \(alt)")
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    private var progressView: some View {
        ProgressView()
    }

    private func isAllowed(url: URL) -> Bool {
        switch policy {
        case .disabled:
            return false
        case .tapToLoad(let schemes, let hosts),
             .allow(let schemes, let hosts):
            return MarkdownURLValidator.isAllowed(url: url, allowedSchemes: schemes, allowedHosts: hosts)
        }
    }
}

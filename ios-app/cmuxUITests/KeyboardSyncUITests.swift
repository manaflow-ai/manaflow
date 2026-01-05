import XCTest

final class KeyboardSyncUITests: XCTestCase {
    private let tolerance: CGFloat = 1.0

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testKeyboardSyncAtBottom() {
        runKeyboardSyncTest(scrollFraction: nil)
    }

    func testKeyboardSyncAtMiddle() {
        runKeyboardSyncTest(scrollFraction: 0.5)
    }

    func testKeyboardSyncAtTop() {
        runKeyboardSyncTest(scrollFraction: 0.0)
    }

    private func runKeyboardSyncTest(scrollFraction: Double?) {
        let app = XCUIApplication()
        app.launchEnvironment["CMUX_DEBUG_AUTOFOCUS"] = "0"
        if let scrollFraction {
            app.launchEnvironment["CMUX_UITEST_SCROLL_FRACTION"] = String(scrollFraction)
        }
        app.launch()

        let pill = app.otherElements["chat.inputPill"]
        XCTAssertTrue(pill.waitForExistence(timeout: 6))

        waitForScrollSettle()
        let baseGaps = captureGaps(app: app, pill: pill)
        XCTAssertFalse(baseGaps.isEmpty)

        openKeyboard(app: app)
        waitForKeyboard(app: app, visible: true)
        let openGaps = captureGaps(app: app, pill: pill)
        assertGapConsistency(reference: baseGaps, current: openGaps, context: "keyboard open")

        dismissKeyboard(app: app)
        waitForKeyboard(app: app, visible: false)
        let closedGaps = captureGaps(app: app, pill: pill)
        assertGapConsistency(reference: baseGaps, current: closedGaps, context: "keyboard closed")
    }

    private func waitForScrollSettle() {
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
    }

    private func openKeyboard(app: XCUIApplication) {
        let input = app.textFields["chat.inputField"]
        if input.exists {
            input.tap()
        } else {
            let pill = app.otherElements["chat.inputPill"]
            pill.tap()
        }
    }

    private func dismissKeyboard(app: XCUIApplication) {
        let scroll = locateScrollView(app: app)
        if scroll.exists {
            let target = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1))
            target.tap()
        } else {
            app.tap()
        }
    }

    private func waitForKeyboard(app: XCUIApplication, visible: Bool) {
        let keyboard = app.keyboards.element
        if visible {
            XCTAssertTrue(keyboard.waitForExistence(timeout: 4))
        } else {
            let predicate = NSPredicate(format: "exists == false")
            expectation(for: predicate, evaluatedWith: keyboard)
            waitForExpectations(timeout: 4)
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
    }

    private func captureGaps(app: XCUIApplication, pill: XCUIElement) -> [String: CGFloat] {
        let scroll = locateScrollView(app: app)
        let scrollFrame = scroll.exists ? scroll.frame : app.windows.element(boundBy: 0).frame
        let predicate = NSPredicate(format: "identifier BEGINSWITH %@", "chat.message.")
        let messages = app.otherElements.matching(predicate).allElementsBoundByIndex

        var gaps: [String: CGFloat] = [:]
        for message in messages where message.frame.intersects(scrollFrame) {
            let gap = pill.frame.minY - message.frame.maxY
            gaps[message.identifier] = gap
        }
        return gaps
    }

    private func assertGapConsistency(
        reference: [String: CGFloat],
        current: [String: CGFloat],
        context: String
    ) {
        let commonKeys = Set(reference.keys).intersection(current.keys)
        XCTAssertFalse(commonKeys.isEmpty, "No common messages for \(context)")
        for key in commonKeys {
            guard let base = reference[key], let now = current[key] else { continue }
            let delta = abs(base - now)
            XCTAssertLessThanOrEqual(
                delta,
                tolerance,
                "Gap drift for \(key) during \(context): \(delta)"
            )
        }
    }

    private func locateScrollView(app: XCUIApplication) -> XCUIElement {
        let scroll = app.scrollViews["chat.scroll"]
        if scroll.exists {
            return scroll
        }
        return app.otherElements["chat.scroll"]
    }
}

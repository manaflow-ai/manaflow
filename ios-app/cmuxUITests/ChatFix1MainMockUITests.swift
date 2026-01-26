import XCTest

final class ChatFix1MainMockUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testOpenFix1MainMockMessages() {
        let app = XCUIApplication()
        app.launchEnvironment["CMUX_UITEST_MOCK_DATA"] = "1"
        app.launch()

        ensureSignedIn(app: app)
        waitForConversationList(app: app)
        openSettings(app: app)
        openChatDebugMenu(app: app)
        openFix1MainMockMessages(app: app)

        let chatScroll = app.scrollViews["chat.scroll"]
        XCTAssertTrue(
            chatScroll.waitForExistence(timeout: 8),
            "Expected chat scroll view after opening Fix 1 main mock messages"
        )

        let inputPill = app.otherElements["chat.inputPill"]
        XCTAssertTrue(
            inputPill.waitForExistence(timeout: 8),
            "Expected input pill after opening Fix 1 main mock messages"
        )
    }

    private func ensureSignedIn(app: XCUIApplication) {
        let emailField = app.textFields["Email"]
        if emailField.waitForExistence(timeout: 2) {
            emailField.tap()
            emailField.typeText("42")
            let continueButton = app.buttons["Continue"]
            if continueButton.exists {
                continueButton.tap()
            }
        }
    }

    private func waitForConversationList(app: XCUIApplication) {
        let navBar = app.navigationBars["Tasks"]
        if navBar.waitForExistence(timeout: 10) {
            return
        }
        let list = app.tables.element(boundBy: 0)
        _ = list.waitForExistence(timeout: 10)
    }

    private func openSettings(app: XCUIApplication) {
        let menuButtons = [
            app.buttons["ellipsis.circle"],
            app.buttons["More"],
        ]
        var didTapMenu = false
        for button in menuButtons where button.exists {
            button.tap()
            didTapMenu = true
            break
        }
        XCTAssertTrue(didTapMenu, "Expected to find menu button on conversation list")

        let settingsButton = app.buttons["Settings"]
        let settingsMenuItem = app.menuItems["Settings"]
        if settingsButton.waitForExistence(timeout: 2) {
            settingsButton.tap()
        } else {
            XCTAssertTrue(settingsMenuItem.waitForExistence(timeout: 2))
            settingsMenuItem.tap()
        }

        XCTAssertTrue(
            app.navigationBars["Settings"].waitForExistence(timeout: 6),
            "Expected Settings view to appear"
        )
    }

    private func openChatDebugMenu(app: XCUIApplication) {
        let debugEntry = app.staticTexts["Chat Keyboard Approaches"]
        XCTAssertTrue(debugEntry.waitForExistence(timeout: 4))
        debugEntry.tap()
        XCTAssertTrue(
            app.navigationBars["Chat Debug"].waitForExistence(timeout: 6),
            "Expected Chat Debug menu to appear"
        )
    }

    private func openFix1MainMockMessages(app: XCUIApplication) {
        let entry = app.staticTexts["Fix 1 main (mock messages)"]
        XCTAssertTrue(entry.waitForExistence(timeout: 4))
        entry.tap()
    }
}

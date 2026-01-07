import XCTest

final class AuthPersistenceUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testAuthPersistsAcrossRelaunch() {
        let app = XCUIApplication()
        app.launch()

        ensureSignedIn(app: app)
        waitForConversationList(app: app)

        app.terminate()

        let relaunch = XCUIApplication()
        relaunch.launch()

        assertNoSignInFlash(app: relaunch)
        waitForConversationList(app: relaunch)

        let emailField = relaunch.textFields["Email"]
        XCTAssertFalse(emailField.exists, "Sign-in screen should not be visible after relaunch")
    }

    private func ensureSignedIn(app: XCUIApplication) {
        let emailField = app.textFields["Email"]
        guard emailField.waitForExistence(timeout: 2) else { return }
        emailField.tap()
        emailField.typeText("42")
        let continueButton = app.buttons["Continue"]
        if continueButton.exists {
            continueButton.tap()
        }
    }

    private func waitForConversationList(app: XCUIApplication) {
        let navBar = app.navigationBars["Tasks"]
        if navBar.waitForExistence(timeout: 10) {
            return
        }
        let list = app.tables.element(boundBy: 0)
        _ = list.waitForExistence(timeout: 6)
    }

    private func assertNoSignInFlash(app: XCUIApplication, duration: TimeInterval = 2.5) {
        let emailField = app.textFields["Email"]
        let deadline = Date().addingTimeInterval(duration)
        while Date() < deadline {
            XCTAssertFalse(emailField.exists, "Sign-in screen flashed during session restore")
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
    }
}

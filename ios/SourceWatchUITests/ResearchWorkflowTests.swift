import XCTest

final class ResearchWorkflowTests: XCTestCase {
    func testNativeResearchWorkflow() {
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.navigationBars["SourceWatch"].waitForExistence(timeout: 20))
        app.buttons["Add source"].tap()
        let sourceTitle = "Phone audit \(UUID().uuidString.prefix(6))"
        app.textFields["Source title"].tap(); app.textFields["Source title"].typeText(sourceTitle)
        app.buttons["Add"].tap()
        app.staticTexts[sourceTitle].firstMatch.tap()
        preserve(app, title: "Original terms", text: "Keep this\nDeleted section")
        preserve(app, title: "Updated terms", text: "Keep this\nNew section")
        app.staticTexts["Updated terms"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Deleted section"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["New section"].exists)
        XCTAssertTrue(app.staticTexts["Keep this"].exists, "Unchanged text must remain unchanged")
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "Native revision comparison"; screenshot.lifetime = .keepAlways; add(screenshot)
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts[sourceTitle].waitForExistence(timeout: 15))
        app.staticTexts[sourceTitle].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Updated terms"].exists)
        app.tabBars.buttons["Evidence"].tap()
        XCTAssertTrue(app.buttons["Choose evidence ZIP"].waitForExistence(timeout: 5))
    }
    private func preserve(_ app: XCUIApplication, title: String, text: String) {
        app.buttons["Preserve a revision"].tap()
        let field = app.textFields["Revision title"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap()
        if let old = field.value as? String { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count)) }
        field.typeText(title)
        let editor = app.textViews["Revision text"]; editor.tap(); editor.typeText(text)
        XCTAssertTrue(NSPredicate(format: "value == %@", text).evaluate(with: editor), "Editor must contain the exact supplied evidence text")
        app.buttons["Preserve"].tap()
        XCTAssertTrue(app.staticTexts[title].firstMatch.waitForExistence(timeout: 10))
    }
}

import XCTest
import UIKit

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
        let editor = app.textViews["Revision text"]
        UIPasteboard.general.string = text
        editor.tap(); editor.press(forDuration: 1.2)
        let menuPaste = app.menuItems["Paste"].firstMatch
        let buttonPaste = app.buttons["Paste"].firstMatch
        if menuPaste.waitForExistence(timeout: 3) { menuPaste.tap() }
        else { XCTAssertTrue(buttonPaste.waitForExistence(timeout: 3)); buttonPaste.tap() }
        let exact = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", text), object: editor)
        XCTAssertEqual(XCTWaiter.wait(for: [exact], timeout: 5), .completed, "Editor value: \(String(describing: editor.value))")
        app.buttons["Preserve"].tap()
        XCTAssertTrue(app.staticTexts[title].firstMatch.waitForExistence(timeout: 10))
    }
}

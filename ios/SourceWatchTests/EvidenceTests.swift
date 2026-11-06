import XCTest
@testable import SourceWatch

final class EvidenceTests: XCTestCase {
    private func library() throws -> LocalLibrary { try LocalLibrary(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)) }
    func testCaptureCompareExportVerifyAndRestart() throws {
        let library = try library(); defer { try? FileManager.default.removeItem(at: library.root) }
        let source = UUID().uuidString.lowercased()
        let first = try library.capture(sourceID: source, title: "First", url: "https://example.com", text: "Keep this\nDeleted section")
        let second = try library.capture(sourceID: source, title: "Second", url: "https://example.com", text: "Keep this\nNew section")
        let reopened = try LocalLibrary(root: library.root)
        XCTAssertEqual(try reopened.history(source).map(\.id), [first.id, second.id])
        let changes = TextComparison.compare("Keep this\nDeleted section", "Keep this\nNew section")
        XCTAssertTrue(changes.contains { $0.kind == .removed && $0.text == "Deleted section" })
        XCTAssertTrue(changes.contains { $0.kind == .added && $0.text == "New section" })
        let (zip, checksum) = try reopened.export(source)
        XCTAssertEqual(try Evidence.verify(EvidenceZIP.read(zip), expectedManifestHash: checksum), 2)
        if let output = ProcessInfo.processInfo.environment["SOURCEWATCH_IOS_FIXTURE_OUTPUT"] { try zip.write(to: URL(fileURLWithPath: output)) }
    }
    func testModifiedAndMissingFilesFail() throws {
        let library = try library(); defer { try? FileManager.default.removeItem(at: library.root) }
        let source = UUID().uuidString.lowercased()
        let receipt = try library.capture(sourceID: source, title: "Test", url: "", text: "Original")
        var entries = try EvidenceZIP.read(library.export(source).0)
        let name = "captures/\(receipt.id)/text.txt"
        entries[name] = Data("Tampered".utf8)
        XCTAssertThrowsError(try Evidence.verify(entries))
        entries.removeValue(forKey: name)
        XCTAssertThrowsError(try Evidence.verify(entries))
    }
    func testReceiptChainCannotBeReordered() throws {
        let library = try library(); defer { try? FileManager.default.removeItem(at: library.root) }
        let source = UUID().uuidString.lowercased()
        try library.capture(sourceID: source, title: "One", url: "", text: "one")
        try library.capture(sourceID: source, title: "Two", url: "", text: "two")
        var entries = try EvidenceZIP.read(library.export(source).0)
        let m = try JSONDecoder().decode(MobileManifest.self, from: entries["manifest.json"]!)
        entries["manifest.json"] = try Evidence.encode(MobileManifest(format: m.format, sourceID: m.sourceID, captures: m.captures.reversed(), files: m.files, timestampNotice: m.timestampNotice))
        XCTAssertThrowsError(try Evidence.verify(entries))
    }
    func testExternalChecksumRejectsReplacedManifest() throws {
        let library = try library(); defer { try? FileManager.default.removeItem(at: library.root) }
        let source = UUID().uuidString.lowercased()
        try library.capture(sourceID: source, title: "Test", url: "", text: "Original")
        let (zip, _) = try library.export(source)
        XCTAssertThrowsError(try Evidence.verify(EvidenceZIP.read(zip), expectedManifestHash: String(repeating: "0", count: 64)))
    }
    func testZIPRoundTripAndTruncation() throws {
        let files = ["manifest.json": Data("{}".utf8), "captures/test/text.txt": Data("Hello 世界".utf8)]
        let zip = try EvidenceZIP.create(files)
        XCTAssertEqual(try EvidenceZIP.read(zip), files)
        XCTAssertThrowsError(try EvidenceZIP.read(Data(zip.dropLast())))
        XCTAssertThrowsError(try EvidenceZIP.create(["../escape": Data()]))
        var corrupt = zip; corrupt[40] ^= 1
        XCTAssertThrowsError(try EvidenceZIP.read(corrupt))
    }
    func testCaptureLimitsAndImmutableArtifacts() throws {
        let library = try library(); defer { try? FileManager.default.removeItem(at: library.root) }
        XCTAssertThrowsError(try library.capture(sourceID: "../escape", title: "", url: "", text: "text"))
        XCTAssertThrowsError(try library.capture(sourceID: UUID().uuidString, title: "", url: "", text: ""))
        let source = UUID().uuidString.lowercased()
        let receipt = try library.capture(sourceID: source, title: "Original", url: "", text: "original")
        let url = try library.sourceFolder(source).appendingPathComponent(receipt.id).appendingPathComponent("text.txt")
        try Data("modified".utf8).write(to: url)
        XCTAssertThrowsError(try library.artifact(receipt, "text.txt"))
        XCTAssertThrowsError(try library.export(source))
    }
    func testNoteRevisionsPersistIndependently() throws {
        let library = try library(); defer { try? FileManager.default.removeItem(at: library.root) }
        let id = UUID().uuidString.lowercased()
        try library.saveNoteRevision(id: id, title: "Note", body: "Original [[Other]]")
        try library.saveNoteRevision(id: id, title: "Note", body: "Changed")
        let folder = library.root.appendingPathComponent("notes/\(id)")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path).count, 2)
    }
}

import Foundation
import SwiftData

@Model final class ResearchSource {
    @Attribute(.unique) var id: String
    var title: String
    var url: String
    var collection: String
    var createdAt: Date
    init(title: String, url: String, collection: String) {
        id = UUID().uuidString.lowercased(); self.title = title; self.url = url
        self.collection = collection; createdAt = Date()
    }
}

@Model final class ResearchNote {
    @Attribute(.unique) var id: String
    var title: String
    var body: String
    var modifiedAt: Date
    init(title: String = "Untitled note", body: String = "") {
        id = UUID().uuidString.lowercased(); self.title = title; self.body = body; modifiedAt = Date()
    }
}

struct NoteRevision: Codable { let id: String; let title: String; let body: String; let savedAt: String }

struct DiffLine: Identifiable, Equatable {
    enum Kind: String { case unchanged, added, removed }
    let id: Int
    let kind: Kind
    let text: String
}

enum TextComparison {
    static func compare(_ old: String, _ new: String) -> [DiffLine] {
        let before = old.components(separatedBy: "\n"), after = new.components(separatedBy: "\n")
        let difference = after.difference(from: before)
        var removed = Set<Int>(), added = Set<Int>()
        for change in difference {
            switch change { case .remove(let offset, _, _): removed.insert(offset)
            case .insert(let offset, _, _): added.insert(offset) }
        }
        var result: [DiffLine] = [], i = 0, j = 0
        func emit(_ kind: DiffLine.Kind, _ text: String) { result.append(DiffLine(id: result.count, kind: kind, text: text)) }
        while i < before.count || j < after.count {
            if i < before.count && removed.contains(i) { emit(.removed, before[i]); i += 1 }
            else if j < after.count && added.contains(j) { emit(.added, after[j]); j += 1 }
            else if i < before.count && j < after.count { emit(.unchanged, after[j]); i += 1; j += 1 }
            else if i < before.count { emit(.removed, before[i]); i += 1 }
            else { emit(.added, after[j]); j += 1 }
        }
        return result
    }
}

struct LocalLibrary {
    private static let captureLock = NSLock()
    let root: URL
    init(root: URL? = nil) throws {
        self.root = try root ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Evidence", isDirectory: true)
        try FileManager.default.createDirectory(at: self.root, withIntermediateDirectories: true)
    }
    func sourceFolder(_ source: String) throws -> URL {
        guard Evidence.validID(source) else { throw EvidenceError.invalid("Invalid source identifier") }
        return root.appendingPathComponent(source, isDirectory: true)
    }
    func history(_ source: String) throws -> [Receipt] {
        let folder = try sourceFolder(source)
        guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
        let children = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).filter { Evidence.validID($0.lastPathComponent) }
        var remaining: [(Receipt, String)] = try children.map { child in
            let bytes = try Data(contentsOf: child.appendingPathComponent("receipt.json"))
            let record = try JSONDecoder().decode(Receipt.self, from: bytes)
            guard record.sourceID == source, record.id == child.lastPathComponent else { throw EvidenceError.invalid("Mismatched local receipt") }
            return (record, Evidence.hash(bytes))
        }
        var ordered: [Receipt] = [], previous: String?
        while !remaining.isEmpty {
            let next = remaining.indices.filter { remaining[$0].0.previousHash == previous }
            guard next.count == 1, let index = next.first else { throw EvidenceError.invalid("Broken or branched capture chain") }
            let item = remaining.remove(at: index); ordered.append(item.0); previous = item.1
        }
        return ordered
    }
    func artifact(_ receipt: Receipt, _ name: String) throws -> Data {
        guard Evidence.validID(receipt.id), Evidence.safePath(name), !name.contains("/"), let checksum = receipt.files[name] else { throw EvidenceError.invalid("Invalid artifact") }
        let url = try sourceFolder(receipt.sourceID).appendingPathComponent(receipt.id).appendingPathComponent(name)
        let bytes = try Data(contentsOf: url)
        guard Evidence.hash(bytes) == checksum else { throw EvidenceError.invalid("Modified artifact: \(name)") }
        return bytes
    }
    @discardableResult func capture(sourceID: String, title: String, url: String, text: String, attachment: Data? = nil, extension ext: String? = nil) throws -> Receipt {
        Self.captureLock.lock(); defer { Self.captureLock.unlock() }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || attachment != nil,
              text.utf8.count <= 512 * 1024, (attachment?.count ?? 0) <= Evidence.maxFile else { throw EvidenceError.invalid("Enter text or import a file (text: 512 KiB, attachment: 32 MiB maximum)") }
        let existing = try history(sourceID)
        guard existing.count < 1000 else { throw EvidenceError.invalid("Export this source before adding more than 1,000 revisions") }
        var files = ["text.txt": Data(text.utf8)]
        if let attachment, let ext {
            guard ["pdf", "png", "jpg", "jpeg", "html", "txt", "md"].contains(ext) else { throw EvidenceError.invalid("Unsupported import") }
            files["original.\(ext)"] = attachment
        }
        let folder = try sourceFolder(sourceID)
        var previous: String?
        if let last = existing.last { previous = Evidence.hash(try Data(contentsOf: folder.appendingPathComponent(last.id).appendingPathComponent("receipt.json"))) }
        let record = Receipt(id: UUID().uuidString.lowercased(), sourceID: sourceID, observedAt: ISO8601DateFormatter().string(from: Date()), originalURL: url, title: title,
                             method: attachment == nil ? "user-supplied-text" : "user-imported-file", previousHash: previous, files: files.mapValues(Evidence.hash))
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let stage = folder.appendingPathComponent(".pending-\(record.id)")
        try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: stage) }
        for (name, data) in files { try data.write(to: stage.appendingPathComponent(name), options: .atomic) }
        try Evidence.encode(record).write(to: stage.appendingPathComponent("receipt.json"), options: .atomic)
        // Rename only after all artifacts are durable. Existing capture folders are never overwritten.
        try FileManager.default.moveItem(at: stage, to: folder.appendingPathComponent(record.id))
        return record
    }
    func export(_ source: String) throws -> (Data, String) {
        let records = try history(source)
        guard !records.isEmpty else { throw EvidenceError.invalid("Capture a revision first") }
        var entries: [String: Data] = [:], total = 0
        for record in records {
            let prefix = "captures/\(record.id)/"
            for name in record.files.keys {
                let bytes = try artifact(record, name); total += bytes.count
                guard total <= Evidence.maxBundle else { throw EvidenceError.invalid("Bundle exceeds 128 MiB") }
                entries[prefix + name] = bytes
            }
            entries[prefix + "receipt.json"] = try Data(contentsOf: sourceFolder(source).appendingPathComponent(record.id).appendingPathComponent("receipt.json"))
        }
        let manifest = MobileManifest(format: Evidence.format, sourceID: source, captures: records.map(\.id), files: entries.mapValues(Evidence.hash), timestampNotice: "Local observation times only. Hashes do not prove website authenticity or independently certify publication times.")
        let bytes = try Evidence.encode(manifest); entries["manifest.json"] = bytes
        _ = try Evidence.verify(entries)
        return (try EvidenceZIP.create(entries), Evidence.hash(bytes))
    }
    func saveNoteRevision(id: String, title: String, body: String) throws {
        guard Evidence.validID(id), title.utf8.count <= 1024, body.utf8.count <= 512 * 1024 else { throw EvidenceError.invalid("Note exceeds size limit") }
        let folder = root.appendingPathComponent("notes/\(id)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let record = NoteRevision(id: id, title: title, body: body, savedAt: ISO8601DateFormatter().string(from: Date()))
        try Evidence.encode(record).write(to: folder.appendingPathComponent(UUID().uuidString + ".json"), options: .atomic)
    }
}

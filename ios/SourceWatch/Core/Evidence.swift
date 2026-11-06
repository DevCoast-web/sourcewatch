import Foundation
import CryptoKit

enum EvidenceError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let message) = self { return message }; return nil }
}

struct Receipt: Codable, Identifiable {
    let id: String
    let sourceID: String
    let observedAt: String
    let originalURL: String
    let title: String
    let method: String
    let previousHash: String?
    let files: [String: String]
}

struct MobileManifest: Codable {
    let format: String
    let sourceID: String
    let captures: [String]
    let files: [String: String]
    let timestampNotice: String
}

enum Evidence {
    static let format = "sourcewatch-mobile-evidence-v1"
    static let maxFile = 32 * 1024 * 1024
    static let maxBundle = 128 * 1024 * 1024
    static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }
    static func validID(_ value: String) -> Bool { UUID(uuidString: value) != nil }
    static func safePath(_ path: String) -> Bool {
        !path.isEmpty && !path.contains("\\") && !path.contains(":") && !path.contains("\0") &&
        path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    /// Chain links hash the exact receipt.json bytes; verification never relies on JSON key order.
    static func verify(_ entries: [String: Data], expectedManifestHash: String? = nil) throws -> Int {
        guard let bytes = entries["manifest.json"], bytes.count <= 2 * 1024 * 1024 else { throw EvidenceError.invalid("Missing or oversized manifest") }
        if let expectedManifestHash, hash(bytes) != expectedManifestHash { throw EvidenceError.invalid("Manifest does not match your retained checksum") }
        let manifest = try JSONDecoder().decode(MobileManifest.self, from: bytes)
        guard manifest.format == format, validID(manifest.sourceID), !manifest.captures.isEmpty,
              Set(manifest.captures).count == manifest.captures.count, manifest.captures.count <= 1000,
              entries.count <= 5000, entries.values.reduce(0, { $0 + $1.count }) <= maxBundle else {
            throw EvidenceError.invalid("Unsupported or invalid evidence bundle")
        }
        guard Set(entries.keys) == Set(manifest.files.keys).union(["manifest.json"]) else { throw EvidenceError.invalid("Unexpected or missing bundle files") }
        for (name, digest) in manifest.files {
            guard safePath(name), let content = entries[name], hash(content) == digest else { throw EvidenceError.invalid("Missing or modified: \(name)") }
        }
        var previous: String?
        for id in manifest.captures {
            guard validID(id), let raw = entries["captures/\(id)/receipt.json"] else { throw EvidenceError.invalid("Missing capture receipt") }
            let record = try JSONDecoder().decode(Receipt.self, from: raw)
            guard record.id == id, record.sourceID == manifest.sourceID, record.previousHash == previous,
                  record.files["text.txt"] != nil else { throw EvidenceError.invalid("Capture chain mismatch: \(id)") }
            for (name, digest) in record.files {
                guard safePath(name), !name.contains("/"), name != "receipt.json",
                      manifest.files["captures/\(id)/\(name)"] == digest else { throw EvidenceError.invalid("Artifact absent from manifest") }
            }
            previous = hash(raw)
        }
        return manifest.captures.count
    }
}

/// ZIP method 0 (stored), deliberately bounded. No downloaded code or third-party archive engine.
enum EvidenceZIP {
    static func crc(_ data: Data) -> UInt32 {
        var value: UInt32 = 0xffffffff
        for byte in data { value ^= UInt32(byte); for _ in 0..<8 { value = (value >> 1) ^ ((value & 1) == 1 ? 0xedb88320 : 0) } }
        return value ^ 0xffffffff
    }
    static func create(_ entries: [String: Data]) throws -> Data {
        guard entries.count <= 5000, entries.values.reduce(0, { $0 + $1.count }) <= Evidence.maxBundle else { throw EvidenceError.invalid("Export exceeds 128 MiB / 5,000 files") }
        var archive = Data(), central = Data()
        for name in entries.keys.sorted() {
            guard Evidence.safePath(name), let content = entries[name], let filename = name.data(using: .utf8), filename.count <= 1024 else { throw EvidenceError.invalid("Invalid ZIP filename") }
            let offset = UInt32(archive.count), checksum = crc(content), size = UInt32(content.count)
            archive.put32(0x04034b50); archive.put16(20); archive.put16(0x800); archive.put16(0)
            archive.put16(0); archive.put16(33); archive.put32(checksum); archive.put32(size); archive.put32(size)
            archive.put16(UInt16(filename.count)); archive.put16(0); archive.append(filename); archive.append(content)
            central.put32(0x02014b50); central.put16(20); central.put16(20); central.put16(0x800); central.put16(0)
            central.put16(0); central.put16(33); central.put32(checksum); central.put32(size); central.put32(size)
            central.put16(UInt16(filename.count)); central.put16(0); central.put16(0); central.put16(0); central.put16(0)
            central.put32(0); central.put32(offset); central.append(filename)
        }
        let start = UInt32(archive.count); archive.append(central)
        archive.put32(0x06054b50); archive.put16(0); archive.put16(0); archive.put16(UInt16(entries.count)); archive.put16(UInt16(entries.count))
        archive.put32(UInt32(central.count)); archive.put32(start); archive.put16(0)
        return archive
    }
    static func read(_ archive: Data) throws -> [String: Data] {
        guard archive.count <= Evidence.maxBundle + 8 * 1024 * 1024 else { throw EvidenceError.invalid("ZIP exceeds size limit") }
        var offset = 0, result: [String: Data] = [:]
        while offset + 4 <= archive.count, try archive.u32(offset) == 0x04034b50 {
            let flags = try archive.u16(offset + 6), method = try archive.u16(offset + 8)
            let checksum = try archive.u32(offset + 14), size = Int(try archive.u32(offset + 18)), expanded = Int(try archive.u32(offset + 22))
            let length = Int(try archive.u16(offset + 26)), extra = Int(try archive.u16(offset + 28)), start = offset + 30 + length + extra
            guard flags & ~UInt16(0x800) == 0, method == 0, size == expanded, length > 0, length <= 1024,
                  start <= archive.count, size <= archive.count - start, result.count < 5000,
                  let name = String(data: archive.subdata(in: offset + 30 ..< offset + 30 + length), encoding: .utf8), Evidence.safePath(name), result[name] == nil else {
                throw EvidenceError.invalid("Unsupported, unsafe or truncated ZIP (use a SourceWatch Mobile export)")
            }
            let content = archive.subdata(in: start ..< start + size)
            guard crc(content) == checksum else { throw EvidenceError.invalid("ZIP checksum mismatch") }
            result[name] = content; offset = start + size
        }
        guard !result.isEmpty, offset + 4 <= archive.count, try archive.u32(offset) == 0x02014b50 else { throw EvidenceError.invalid("Invalid ZIP directory") }
        // Validate the archive's directory and end record too, rather than accepting a truncated payload.
        let centralStart = offset
        var count = 0
        while offset + 46 <= archive.count, try archive.u32(offset) == 0x02014b50 {
            let nameLength = Int(try archive.u16(offset + 28)), extra = Int(try archive.u16(offset + 30)), comment = Int(try archive.u16(offset + 32))
            let next = offset + 46 + nameLength + extra + comment
            guard next <= archive.count else { throw EvidenceError.invalid("Truncated ZIP directory") }
            count += 1; offset = next
        }
        guard offset + 22 == archive.count, try archive.u32(offset) == 0x06054b50,
              Int(try archive.u16(offset + 10)) == result.count, count == result.count,
              Int(try archive.u32(offset + 12)) == offset - centralStart,
              Int(try archive.u32(offset + 16)) == centralStart else { throw EvidenceError.invalid("Invalid ZIP end record") }
        return result
    }
}

private extension Data {
    mutating func put16(_ value: UInt16) { append(UInt8(value & 255)); append(UInt8(value >> 8)) }
    mutating func put32(_ value: UInt32) { put16(UInt16(value & 65535)); put16(UInt16(value >> 16)) }
    func u16(_ offset: Int) throws -> UInt16 {
        guard offset >= 0, offset + 2 <= count else { throw EvidenceError.invalid("Truncated ZIP") }
        return UInt16(self[startIndex + offset]) | UInt16(self[startIndex + offset + 1]) << 8
    }
    func u32(_ offset: Int) throws -> UInt32 { try UInt32(u16(offset)) | UInt32(u16(offset + 2)) << 16 }
}

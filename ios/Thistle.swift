import Foundation
import NitroModules

private final class StreamCallback {
    let onChunk: (String) -> Void
    init(_ onChunk: @escaping (String) -> Void) { self.onChunk = onChunk }
}

class ThistleModule: HybridThistleSpec {
    public func loadModel(path: String, optionsJson: String) throws -> Promise<Double> {
        Promise<Double>.parallel {
            let modelPath = Self.resolveModelPath(path)
            var errorMessage: UnsafeMutablePointer<CChar>?
            let modelId = thistle_engine_load_model(modelPath, optionsJson, &errorMessage)
            try Self.throwIfError(errorMessage)
            guard modelId != 0 else {
                throw Self.error("[thistle:model_load_failed] Unable to load GGUF model.")
            }
            return Double(modelId)
        }
    }

    public func warmup(modelId: Double, maxContextSize: Double) throws -> Promise<Void> {
        let id = try Self.modelId(modelId)
        let contextSize = try Self.int32(maxContextSize, name: "maxContextSize")
        return Promise<Void>.parallel {
            var errorMessage: UnsafeMutablePointer<CChar>?
            let ok = thistle_engine_warmup(id, contextSize, &errorMessage)
            try Self.throwIfError(errorMessage)
            if ok == 0 {
                throw Self.error("[thistle:internal_error] Warmup failed.")
            }
        }
    }

    public func prompt(modelId: Double, requestJson: String) throws -> Promise<String> {
        let id = try Self.modelId(modelId)
        return Promise<String>.parallel {
            var errorMessage: UnsafeMutablePointer<CChar>?
            let response = thistle_engine_prompt(id, requestJson, &errorMessage)
            try Self.throwIfError(errorMessage)
            guard let response else {
                throw Self.error("[thistle:internal_error] GGUF inference failed.")
            }
            defer { thistle_engine_free_string(response) }
            return String(cString: response)
        }
    }

    public func unloadModel(modelId: Double) throws {
        guard let id = try? Self.modelId(modelId) else {
            return
        }
        _ = thistle_engine_unload_model(id)
    }

    public func stream(modelId: Double, requestJson: String, onChunk: @escaping (String) -> Void) throws -> Promise<String> {
        let id = try Self.modelId(modelId)
        return Promise<String>.parallel {
            let callback = Unmanaged.passRetained(StreamCallback(onChunk))
            defer { callback.release() }
            var errorMessage: UnsafeMutablePointer<CChar>?
            let response = thistle_engine_stream(id, requestJson, { text, length, context in
                guard let text, let context else { return }
                let bytes = UnsafeRawBufferPointer(start: text, count: Int(length))
                Unmanaged<StreamCallback>.fromOpaque(context).takeUnretainedValue().onChunk(String(decoding: bytes, as: UTF8.self))
            }, callback.toOpaque(), &errorMessage)
            try Self.throwIfError(errorMessage)
            guard let response else {
                throw Self.error("[thistle:internal_error] GGUF streaming failed.")
            }
            defer { thistle_engine_free_string(response) }
            return String(cString: response)
        }
    }

    private static func throwIfError(_ message: UnsafeMutablePointer<CChar>?) throws {
        guard let message else {
            return
        }
        let text = String(cString: message)
        thistle_engine_free_string(message)
        throw error(text)
    }

    private static func error(_ message: String) -> NSError {
        NSError(domain: "Thistle", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    // Converting Double to an integer traps in Swift when out of range.
    private static func modelId(_ value: Double) throws -> UInt64 {
        guard value.isFinite, value >= 1, value <= 9_007_199_254_740_991, value.rounded() == value else {
            throw error("[thistle:model_not_loaded] Invalid model id.")
        }
        return UInt64(value)
    }

    private static func int32(_ value: Double, name: String) throws -> Int32 {
        guard value.isFinite, value >= 0, value <= Double(Int32.max), value.rounded() == value else {
            throw error("[thistle:invalid_argument] \(name) must be a non-negative integer.")
        }
        return Int32(value)
    }

    private static func resolveModelPath(_ path: String) -> String {
        let filesystemPath = path.hasPrefix("file://") ? (URL(string: path)?.path ?? path) : path
        if FileManager.default.fileExists(atPath: filesystemPath) {
            return filesystemPath
        }
        // Metro serves assets over HTTP in development; release builds bundle them.
        let filename = URL(string: path)?.lastPathComponent ?? (path as NSString).lastPathComponent
        let name = (filename as NSString).deletingPathExtension
        let ext = (filename as NSString).pathExtension
        for directory in ["assets/assets", "assets"] {
            if let bundled = Bundle.main.path(forResource: name, ofType: ext, inDirectory: directory) {
                return bundled
            }
        }
        return Bundle.main.path(forResource: name, ofType: ext) ?? filesystemPath
    }
}

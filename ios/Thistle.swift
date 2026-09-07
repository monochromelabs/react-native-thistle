import NitroModules

class ThistleModule: HybridThistleSpec {
    public func loadModel(path: String) throws -> Double {
        var errorMessage: UnsafeMutablePointer<CChar>?
        let filesystemPath = path.hasPrefix("file://")
            ? URL(string: path)?.path ?? path
            : path
        let modelId = filesystemPath.withCString { pathPointer in
            thistle_load_model(pathPointer, &errorMessage)
        }
        defer {
            if let errorMessage {
                thistle_free_string(errorMessage)
            }
        }
        if modelId == 0 {
            throw inferenceError(errorMessage)
        }
        return Double(modelId)
    }

    public func warmup(modelId: Double, maxContextSize: Double) throws {
        var errorMessage: UnsafeMutablePointer<CChar>?
        thistle_warmup(UInt64(modelId), Int32(maxContextSize), &errorMessage)
        defer {
            if let errorMessage {
                thistle_free_string(errorMessage)
            }
        }
        if let errorMessage {
            throw inferenceError(errorMessage)
        }
    }

    public func prompt(modelId: Double, text: String, maxInputTokens: Double, maxContextSize: Double, maxOutputTokens: Double, maxReasoningTokens: Double) -> Promise<String> {
        Promise<String>.parallel {
            var errorMessage: UnsafeMutablePointer<CChar>?
            let response = text.withCString { textPointer in
                thistle_prompt(UInt64(modelId), textPointer, Int32(maxInputTokens), Int32(maxContextSize), Int32(maxOutputTokens), Int32(maxReasoningTokens), &errorMessage)
            }
            defer {
                if let errorMessage {
                    thistle_free_string(errorMessage)
                }
            }
            guard let response else {
                throw NSError(domain: "Thistle", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: errorMessage.map { String(cString: $0) } ?? "GGUF inference failed."
                ])
            }
            defer { thistle_free_string(response) }
            return String(cString: response)
        }
    }

    public func unloadModel(modelId: Double) throws {
        thistle_unload_model(UInt64(modelId))
    }

    private func inferenceError(_ message: UnsafeMutablePointer<CChar>?) -> NSError {
        NSError(domain: "Thistle", code: 1, userInfo: [
            NSLocalizedDescriptionKey: message.map { String(cString: $0) } ?? "GGUF inference failed."
        ])
    }
}

package com.margelo.nitro.thistle

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.io.File

@DoNotStrip
class Thistle : HybridThistleSpec() {
  override fun loadModel(path: String): Double {
    return nativeLoadModel(resolveModelPath(path)).toDouble()
  }

  override fun warmup(modelId: Double, maxContextSize: Double) {
    nativeWarmup(modelId.toLong(), maxContextSize.toInt())
  }

  override fun prompt(modelId: Double, text: String, maxInputTokens: Double, maxContextSize: Double, maxOutputTokens: Double, maxReasoningTokens: Double): Promise<String> {
    return Promise.parallel {
      nativePrompt(
        modelId.toLong(),
        text,
        maxInputTokens.toInt(),
        maxContextSize.toInt(),
        maxOutputTokens.toInt(),
        maxReasoningTokens.toInt(),
      )
    }
  }

  override fun unloadModel(modelId: Double) {
    nativeUnloadModel(modelId.toLong())
  }

  private fun resolveModelPath(path: String): String {
    val normalizedPath = path.removePrefix("file://")
    val directFile = File(normalizedPath)
    if (directFile.isFile) {
      return directFile.absolutePath
    }

    val filename = normalizedPath.substringAfterLast('/')
    require(filename.isNotEmpty()) { "Model path is empty." }
    val context = requireNotNull(NitroModules.applicationContext) {
      "Nitro application context is unavailable."
    }
    val cachedFile = File(File(context.cacheDir, "thistle-models"), filename)
    if (!cachedFile.isFile) {
      cachedFile.parentFile?.mkdirs()
      context.assets.open(filename).use { input ->
        cachedFile.outputStream().use { output -> input.copyTo(output) }
      }
    }
    return cachedFile.absolutePath
  }

  private external fun nativeLoadModel(path: String): Long
  private external fun nativeWarmup(modelId: Long, maxContextSize: Int)
  private external fun nativePrompt(
    modelId: Long,
    text: String,
    maxInputTokens: Int,
    maxContextSize: Int,
    maxOutputTokens: Int,
    maxReasoningTokens: Int,
  ): String
  private external fun nativeUnloadModel(modelId: Long)
}

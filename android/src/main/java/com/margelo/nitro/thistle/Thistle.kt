package com.margelo.nitro.thistle

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

@DoNotStrip
class Thistle : HybridThistleSpec() {
  override fun loadModel(path: String, optionsJson: String): Promise<Double> {
    return Promise.parallel {
      val modelPath = resolveModelPath(path)
      nativeLoadModel(modelPath.toByteArray(Charsets.UTF_8), optionsJson.toByteArray(Charsets.UTF_8)).toDouble()
    }
  }

  override fun warmup(modelId: Double, maxContextSize: Double): Promise<Unit> {
    val id = modelId(modelId)
    val contextSize = nonNegativeInt(maxContextSize, "maxContextSize")
    return Promise.parallel { nativeWarmup(id, contextSize) }
  }

  override fun prompt(modelId: Double, requestJson: String): Promise<String> {
    val id = modelId(modelId)
    // Strings cross JNI as standard UTF-8 bytes; JNI's modified UTF-8 corrupts emoji.
    val request = requestJson.toByteArray(Charsets.UTF_8)
    return Promise.parallel { String(nativePrompt(id, request), Charsets.UTF_8) }
  }

  override fun unloadModel(modelId: Double) {
    val id = runCatching { modelId(modelId) }.getOrNull() ?: return
    nativeUnloadModel(id)
  }

  override fun stream(modelId: Double, requestJson: String, onChunk: (String) -> Unit): Promise<String> {
    val id = modelId(modelId)
    val request = requestJson.toByteArray(Charsets.UTF_8)
    return Promise.parallel {
      String(nativeStream(id, request) { bytes ->
        onChunk(String(bytes, Charsets.UTF_8))
      }, Charsets.UTF_8)
    }
  }

  private fun modelId(value: Double): Long {
    if (!value.isFinite() || value < 1 || value > MAX_SAFE_INTEGER || value != Math.rint(value)) {
      throw IllegalArgumentException("[thistle:model_not_loaded] Invalid model id.")
    }
    return value.toLong()
  }

  private fun nonNegativeInt(value: Double, name: String): Int {
    if (!value.isFinite() || value < 0 || value > Int.MAX_VALUE || value != Math.rint(value)) {
      throw IllegalArgumentException("[thistle:invalid_argument] $name must be a non-negative integer.")
    }
    return value.toInt()
  }

  private fun resolveModelPath(path: String): String {
    val normalizedPath = path.removePrefix("file://")
    val directFile = File(normalizedPath)
    if (directFile.isFile) {
      return directFile.absolutePath
    }

    val filename = normalizedPath.substringBefore('?').substringAfterLast('/')
    require(filename.isNotEmpty()) { "[thistle:invalid_argument] Model path is empty." }
    val context = requireNotNull(NitroModules.applicationContext) {
      "[thistle:model_load_failed] Nitro application context is unavailable."
    }
    // Key cached copies by app install/update time so updated bundled models replace stale ones.
    @Suppress("DEPRECATION")
    val versionKey = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
    val directory = File(context.cacheDir, "thistle-models")
    val cachedFile = File(directory, "$versionKey-$filename")

    synchronized(cacheLock) {
      if (cachedFile.isFile && cachedFile.length() > 0) {
        return cachedFile.absolutePath
      }
      if (!directory.isDirectory && !directory.mkdirs()) {
        throw IOException("[thistle:model_load_failed] Unable to create ${directory.absolutePath}.")
      }
      directory.listFiles()?.forEach { file ->
        if (file != cachedFile && (file.name.endsWith("-$filename") || file.name.endsWith(".tmp"))) {
          file.delete()
        }
      }
      // Copy to a temporary file and rename, so an interrupted copy is never reused.
      val temporaryFile = File(directory, "${cachedFile.name}.${UUID.randomUUID()}.tmp")
      try {
        context.assets.open(filename).use { input ->
          FileOutputStream(temporaryFile).use { output ->
            input.copyTo(output)
            output.fd.sync()
          }
        }
        if (!temporaryFile.renameTo(cachedFile)) {
          throw IOException("[thistle:model_load_failed] Unable to finalize cached model $filename.")
        }
      } finally {
        temporaryFile.delete()
      }
    }
    return cachedFile.absolutePath
  }

  private external fun nativeLoadModel(path: ByteArray, optionsJson: ByteArray): Long
  private external fun nativeWarmup(modelId: Long, maxContextSize: Int)
  private external fun nativePrompt(modelId: Long, requestJson: ByteArray): ByteArray
  private external fun nativeStream(modelId: Long, requestJson: ByteArray, onChunk: (ByteArray) -> Unit): ByteArray
  private external fun nativeUnloadModel(modelId: Long)

  private companion object {
    const val MAX_SAFE_INTEGER = 9_007_199_254_740_991.0
    val cacheLock = Any()
  }
}

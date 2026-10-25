#include <jni.h>

#include "thistle/ThistleEngine.h"

#include <string>

namespace {

std::string to_utf8(JNIEnv *env, jbyteArray bytes) {
  if (bytes == nullptr) {
    return {};
  }
  const jsize length = env->GetArrayLength(bytes);
  std::string value(static_cast<size_t>(length), '\0');
  if (length > 0) {
    env->GetByteArrayRegion(bytes, 0, length, reinterpret_cast<jbyte *>(value.data()));
  }
  return value;
}

jbyteArray to_bytes(JNIEnv *env, const char *value, size_t length) {
  jbyteArray bytes = env->NewByteArray(static_cast<jsize>(length));
  if (bytes != nullptr && length > 0) {
    env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(length),
                            reinterpret_cast<const jbyte *>(value));
  }
  return bytes;
}

// Throws a RuntimeException whose message is decoded as standard UTF-8
// (JNI's ThrowNew expects modified UTF-8). Frees `message`.
void throw_error(JNIEnv *env, char *message) {
  const std::string text = message != nullptr
      ? message : "[thistle:internal_error] Native call failed.";
  thistle_engine_free_string(message);
  jbyteArray bytes = to_bytes(env, text.data(), text.size());
  jclass string_class = env->FindClass("java/lang/String");
  jmethodID string_init = env->GetMethodID(string_class, "<init>", "([BLjava/lang/String;)V");
  jstring charset = env->NewStringUTF("UTF-8");
  auto *java_message = static_cast<jstring>(
      env->NewObject(string_class, string_init, bytes, charset));
  jclass exception_class = env->FindClass("java/lang/RuntimeException");
  jmethodID exception_init = env->GetMethodID(exception_class, "<init>", "(Ljava/lang/String;)V");
  auto *exception = static_cast<jthrowable>(
      env->NewObject(exception_class, exception_init, java_message));
  if (exception != nullptr) {
    env->Throw(exception);
  }
}

} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_thistle_Thistle_nativeLoadModel(JNIEnv *env, jobject, jbyteArray path,
                                                        jbyteArray options_json) {
  const std::string model_path = to_utf8(env, path);
  const std::string options = to_utf8(env, options_json);
  char *error = nullptr;
  const uint64_t model_id =
      thistle_engine_load_model(model_path.c_str(), options.c_str(), &error);
  if (model_id == 0) {
    throw_error(env, error);
    return 0;
  }
  return static_cast<jlong>(model_id);
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_thistle_Thistle_nativeWarmup(JNIEnv *env, jobject, jlong model_id,
                                                     jint max_context_size) {
  char *error = nullptr;
  if (thistle_engine_warmup(static_cast<uint64_t>(model_id), max_context_size, &error) == 0) {
    throw_error(env, error);
  }
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_margelo_nitro_thistle_Thistle_nativePrompt(JNIEnv *env, jobject, jlong model_id,
                                                     jbyteArray request_json) {
  const std::string request = to_utf8(env, request_json);
  char *error = nullptr;
  char *response =
      thistle_engine_prompt(static_cast<uint64_t>(model_id), request.c_str(), &error);
  if (response == nullptr) {
    throw_error(env, error);
    return nullptr;
  }
  const std::string value(response);
  thistle_engine_free_string(response);
  return to_bytes(env, value.data(), value.size());
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_thistle_Thistle_nativeUnloadModel(JNIEnv *, jobject, jlong model_id) {
  thistle_engine_unload_model(static_cast<uint64_t>(model_id));
}

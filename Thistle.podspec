require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "Thistle"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/monochromelabs/react-native-thistle.git", :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm,h}",
    "cpp/llama.cpp/src/**/*.{h,cpp}",
    "cpp/llama.cpp/ggml/include/**/*.h",
    "cpp/llama.cpp/ggml/src/*.{h,c,cpp}",
    "cpp/llama.cpp/ggml/src/ggml-cpu/*.{h,c,cpp}",
    "cpp/llama.cpp/ggml/src/ggml-cpu/arch/arm/*.{h,c,cpp}",
    "cpp/llama.cpp/ggml/src/ggml-metal/**/*.{h,m,cpp}",
  ]

  s.resources = [
    "cpp/llama.cpp/ggml/src/ggml-common.h",
    "cpp/llama.cpp/ggml/src/ggml-metal/ggml-metal.metal",
    "cpp/llama.cpp/ggml/src/ggml-metal/ggml-metal-impl.h",
  ]

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) GGML_USE_CPU GGML_USE_METAL LLAMA_VERSION=\\\"0.1.2-dev\\\" GGML_VERSION=\\\"0.20.2\\\" GGML_COMMIT=\\\"6d05498\\\"",
    "HEADER_SEARCH_PATHS" => [
      "$(PODS_TARGET_SRCROOT)/cpp/llama.cpp/src",
      "$(PODS_TARGET_SRCROOT)/cpp/llama.cpp/include",
      "$(PODS_TARGET_SRCROOT)/cpp/llama.cpp/ggml/include",
      "$(PODS_TARGET_SRCROOT)/cpp/llama.cpp/ggml/src",
    ].join(" "),
  }

  s.frameworks = ["Foundation", "Metal", "MetalKit"]
  s.public_header_files = ["ios/ThistleBridge.h"]
  s.compiler_flags = "-fno-objc-arc"

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'

  load 'nitrogen/generated/ios/Thistle+autolinking.rb'
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end

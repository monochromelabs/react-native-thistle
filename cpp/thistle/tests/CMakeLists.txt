cmake_minimum_required(VERSION 3.22)
project(thistle_engine_test CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(THISTLE_TEST_ASAN "Build with AddressSanitizer" ON)
if(THISTLE_TEST_ASAN)
  add_compile_options(-fsanitize=address -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address)
endif()

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
foreach(opt COMMON EXAMPLES TESTS TOOLS SERVER MTMD APP UI)
  set(LLAMA_BUILD_${opt} OFF CACHE BOOL "" FORCE)
endforeach()

set(THISTLE_CPP ${CMAKE_CURRENT_SOURCE_DIR}/..)
set(LLAMA_DIR ${THISTLE_CPP}/../llama.cpp)
add_subdirectory(${LLAMA_DIR} llama.cpp EXCLUDE_FROM_ALL)

file(GLOB THISTLE_VENDOR ${THISTLE_CPP}/vendor/*.cpp)
add_executable(engine_test
  engine_test.cpp
  ${THISTLE_CPP}/ThistleEngine.cpp
  ${THISTLE_VENDOR})
target_include_directories(engine_test PRIVATE
  ${THISTLE_CPP}
  ${LLAMA_DIR}/src
  ${LLAMA_DIR}/common
  ${LLAMA_DIR}/vendor)
target_link_libraries(engine_test PRIVATE llama ggml)

add_executable(model_smoke
  model_smoke.cpp
  ${THISTLE_CPP}/ThistleEngine.cpp
  ${THISTLE_VENDOR})
target_include_directories(model_smoke PRIVATE
  ${THISTLE_CPP}
  ${LLAMA_DIR}/src
  ${LLAMA_DIR}/common
  ${LLAMA_DIR}/vendor)
target_link_libraries(model_smoke PRIVATE llama ggml)

#include "ThistleEngine.h"

#include <nlohmann/json.hpp>

#include <chrono>
#include <charconv>
#include <cstdio>
#include <string>
#include <sys/resource.h>

#ifdef __APPLE__
#include <mach/mach.h>
#endif

using json = nlohmann::ordered_json;
using Clock = std::chrono::steady_clock;

static double milliseconds(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

static json memory() {
  struct rusage usage {};
  if (getrusage(RUSAGE_SELF, &usage) != 0) {
    std::perror("getrusage");
    std::exit(2);
  }
#ifdef __APPLE__
  mach_task_basic_info_data_t info {};
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  const auto status = task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                                reinterpret_cast<task_info_t>(&info), &count);
  if (status != KERN_SUCCESS) {
    std::fprintf(stderr, "task_info failed: %d\n", status);
    std::exit(2);
  }
  return {{"peak_rss_bytes", usage.ru_maxrss},
          {"resident_bytes", info.resident_size}};
#else
  return {{"peak_rss_bytes", static_cast<uint64_t>(usage.ru_maxrss) * 1024},
          {"resident_bytes", nullptr}};
#endif
}

static int fail(json &report, const char *stage, char *error) {
  report["failed_stage"] = stage;
  report["error"] = error ? error : "Native call failed without an error message";
  thistle_engine_free_string(error);
  report["memory_at_failure"] = memory();
  std::puts(report.dump().c_str());
  return 1;
}

struct StreamState {
  Clock::time_point start;
  double first_delta_ms = -1;
  size_t chunks = 0;
  std::string answer;
};

int main(int argc, char **argv) {
  if (argc != 2 && argc != 3) {
    std::fprintf(stderr, "usage: engine_bench model.gguf [trials]\n");
    return 2;
  }
  int trials = 3;
  if (argc == 3) {
    const std::string argument = argv[2];
    const auto parsed = std::from_chars(
        argument.data(), argument.data() + argument.size(), trials);
    if (parsed.ec != std::errc{} ||
        parsed.ptr != argument.data() + argument.size() || trials < 1) {
      std::fprintf(stderr, "trials must be a positive integer\n");
      return 2;
    }
  }
  const json request = {
      {"messages",
       {{{"role", "user"},
         {"content", "Write a detailed description of a river flowing through "
                     "a forest. Continue for at least one hundred words."}}}},
      {"temperature", 0},
      {"seed", 42},
      {"maxContextSize", 2048},
      {"maxOutputTokens", 64},
      {"enableThinking", false},
      {"maxReasoningTokens", 0}};
  json report = {{"model", argv[1]},
                 {"request", request},
                 {"requested_trials", trials},
                 {"trials", json::array()},
                 {"memory_before_load", memory()}};
  char *error = nullptr;
  const auto load_start = Clock::now();
  const auto id = thistle_engine_load_model(argv[1], "{}", &error);
  report["load_ms"] = milliseconds(load_start);
  if (!id) return fail(report, "load", error);
  report["memory_after_load"] = memory();

  const auto warmup_start = Clock::now();
  const auto warmed = thistle_engine_warmup(id, 2048, &error);
  report["warmup_ms"] = milliseconds(warmup_start);
  if (!warmed) {
    thistle_engine_unload_model(id);
    return fail(report, "warmup", error);
  }
  report["memory_after_warmup"] = memory();

  for (int trial = 0; trial < trials; ++trial) {
    StreamState state{Clock::now()};
    char *raw = thistle_engine_stream(
        id, request.dump().c_str(),
        [](const char *delta, uint64_t length, void *context) {
          auto &state = *static_cast<StreamState *>(context);
          if (state.chunks == 0) {
            state.first_delta_ms = milliseconds(state.start);
          }
          ++state.chunks;
          state.answer.append(delta, static_cast<size_t>(length));
        },
        &state, &error);
    const double elapsed = milliseconds(state.start);
    if (!raw) {
      thistle_engine_unload_model(id);
      return fail(report, "stream", error);
    }
    json completion;
    try {
      completion = json::parse(raw);
    } catch (const json::exception &exception) {
      std::fprintf(stderr, "Invalid native completion: %s\n", exception.what());
      thistle_engine_free_string(raw);
      thistle_engine_unload_model(id);
      return 2;
    }
    thistle_engine_free_string(raw);
    const bool matches = state.answer == completion.at("text").get<std::string>();
    report["trials"].push_back({
        {"index", trial},
        {"elapsed_ms", elapsed},
        {"first_answer_delta_ms",
         state.first_delta_ms < 0 ? json(nullptr) : json(state.first_delta_ms)},
        {"chunks", state.chunks},
        {"stream_matches_completion", matches},
        {"end_to_end_tokens_per_second",
         completion.at("completionTokens").get<double>() * 1000 / elapsed},
        {"completion", completion},
        {"memory", memory()}});
    if (!matches) {
      report["failed_stage"] = "stream_reconstruction";
      report["error"] = "Streamed answer differs from completion text";
      thistle_engine_unload_model(id);
      std::puts(report.dump().c_str());
      return 1;
    }
  }
  report["memory_before_unload"] = memory();
  const auto unload_start = Clock::now();
  const auto unloaded = thistle_engine_unload_model(id);
  report["unload_ms"] = milliseconds(unload_start);
  report["memory_after_unload"] = memory();
  report["unloaded"] = unloaded == 1;
  std::puts(report.dump().c_str());
  return unloaded == 1 ? 0 : 1;
}

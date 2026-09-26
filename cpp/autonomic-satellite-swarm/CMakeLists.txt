cmake_minimum_required(VERSION 3.25)

project(
  autonomic_satellite_swarm
  VERSION 2.0.0
  DESCRIPTION "A portable research prototype for fail-safe satellite swarm coordination"
  LANGUAGES CXX)

include(CTest)
include(FetchContent)

option(SATELLITE_SWARM_BUILD_SIMULATION "Build the deterministic host simulation" ON)
option(SATELLITE_SWARM_BUILD_BROWSER "Build the Emscripten browser adapter" OFF)
option(SATELLITE_SWARM_ENABLE_COVERAGE "Enable gcov-compatible coverage instrumentation" OFF)
option(SATELLITE_SWARM_ENABLE_SANITIZERS "Enable address and undefined-behavior sanitizers" OFF)
set(SATELLITE_SWARM_SOURCE_REVISION "unknown" CACHE STRING
    "Full Git revision used to build the browser module")

add_library(
  satellite_swarm
  src/satellite_swarm/controller.cpp
  src/satellite_swarm/historical_orbital_scorer.cpp
  src/satellite_swarm/telemetry.cpp
  src/satellite_swarm/telemetry_codec.cpp
  src/satellite_swarm/telemetry_transmitter.cpp
  src/satellite_swarm/types.cpp
  src/satellite_swarm/wire_codec.cpp)
add_library(satellite_swarm::coordination ALIAS satellite_swarm)

target_include_directories(
  satellite_swarm
  PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
         $<INSTALL_INTERFACE:include>)
target_compile_features(satellite_swarm PUBLIC cxx_std_20)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(
    satellite_swarm
    PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -Wshadow
            -Wnon-virtual-dtor -Wold-style-cast -Woverloaded-virtual)
endif()

if(SATELLITE_SWARM_ENABLE_SANITIZERS AND CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(satellite_swarm PUBLIC -fno-omit-frame-pointer -fsanitize=address,undefined)
  target_link_options(satellite_swarm PUBLIC -fno-omit-frame-pointer -fsanitize=address,undefined)
endif()

if(SATELLITE_SWARM_ENABLE_COVERAGE)
  if(NOT CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
    message(FATAL_ERROR "Coverage instrumentation requires GCC or Clang")
  endif()

  target_compile_options(satellite_swarm PRIVATE --coverage -O0 -g)
  target_link_options(satellite_swarm PUBLIC --coverage)
endif()

if(SATELLITE_SWARM_BUILD_SIMULATION)
  add_library(
    satellite_swarm_simulation
    simulation/src/browser_simulation.cpp
    simulation/src/fair_allocation_simulation.cpp
    simulation/src/simulation.cpp)
  add_library(satellite_swarm::simulation ALIAS satellite_swarm_simulation)
  target_include_directories(
    satellite_swarm_simulation
    PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/simulation/include>)
  target_link_libraries(satellite_swarm_simulation PUBLIC satellite_swarm::coordination)
  target_compile_features(satellite_swarm_simulation PUBLIC cxx_std_20)

  if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
    target_compile_options(
      satellite_swarm_simulation
      PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -Wshadow
              -Wnon-virtual-dtor -Wold-style-cast -Woverloaded-virtual)
  endif()

  add_executable(autonomic-satellite-swarm-simulation examples/simulation/main.cpp)
  target_link_libraries(autonomic-satellite-swarm-simulation PRIVATE satellite_swarm::simulation)

  if(SATELLITE_SWARM_ENABLE_COVERAGE)
    target_compile_options(satellite_swarm_simulation PRIVATE --coverage -O0 -g)
    target_compile_options(autonomic-satellite-swarm-simulation PRIVATE --coverage -O0 -g)
  endif()

  if(BUILD_TESTING)
    add_test(NAME satellite_swarm_simulation COMMAND autonomic-satellite-swarm-simulation)
    add_test(
      NAME satellite_swarm_browser_fixture
      COMMAND autonomic-satellite-swarm-simulation --json)
    add_test(
      NAME satellite_swarm_fair_allocation
      COMMAND autonomic-satellite-swarm-simulation --fairness-json)
    add_test(
      NAME satellite_swarm_invalid_arguments
      COMMAND autonomic-satellite-swarm-simulation --unsupported)
    set_tests_properties(
      satellite_swarm_browser_fixture
      PROPERTIES PASS_REGULAR_EXPRESSION
                 "\"source\": \"portable C\\+\\+ SimulationTrace\".*\"events\"")
    set_tests_properties(
      satellite_swarm_fair_allocation
      PROPERTIES PASS_REGULAR_EXPRESSION
                 "\"policy\": \"mission-keyed-cyclic-equal-score\".*\"assignmentCounts\"")
    set_tests_properties(satellite_swarm_invalid_arguments PROPERTIES WILL_FAIL TRUE)
  endif()
endif()

if(SATELLITE_SWARM_BUILD_BROWSER)
  string(LENGTH "${SATELLITE_SWARM_SOURCE_REVISION}"
               SATELLITE_SWARM_SOURCE_REVISION_LENGTH)
  if(NOT SATELLITE_SWARM_SOURCE_REVISION MATCHES "^[0-9a-f]+$"
     OR NOT SATELLITE_SWARM_SOURCE_REVISION_LENGTH EQUAL 40)
    message(
      FATAL_ERROR
        "SATELLITE_SWARM_SOURCE_REVISION must be a full lowercase Git revision"
    )
  endif()
  if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "SATELLITE_SWARM_BUILD_BROWSER requires the Emscripten toolchain")
  endif()
  if(NOT SATELLITE_SWARM_BUILD_SIMULATION)
    message(FATAL_ERROR "SATELLITE_SWARM_BUILD_BROWSER requires the simulation library")
  endif()

  add_executable(satellite_swarm_browser browser/src/browser_api.cpp)
  target_include_directories(
    satellite_swarm_browser
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/browser/include)
  target_link_libraries(satellite_swarm_browser PRIVATE satellite_swarm::simulation)
  target_compile_features(satellite_swarm_browser PRIVATE cxx_std_20)
  target_compile_options(
    satellite_swarm PRIVATE -fexceptions)
  target_compile_options(
    satellite_swarm_simulation PRIVATE -fexceptions)
  target_compile_options(
    satellite_swarm_browser PRIVATE -fexceptions)
  target_compile_definitions(
    satellite_swarm_browser
    PRIVATE SATELLITE_SWARM_SOURCE_REVISION="${SATELLITE_SWARM_SOURCE_REVISION}")
  set_target_properties(
    satellite_swarm_browser
    PROPERTIES OUTPUT_NAME "satellite-swarm"
               SUFFIX ".mjs"
               RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/browser")
  target_link_options(
    satellite_swarm_browser
    PRIVATE --no-entry
            "SHELL:-sALLOW_MEMORY_GROWTH=1"
            "SHELL:-sDISABLE_EXCEPTION_CATCHING=0"
            "SHELL:-sENVIRONMENT=worker,node"
            "SHELL:-sEXPORT_ES6=1"
            "SHELL:-sEXPORTED_RUNTIME_METHODS=['UTF8ToString']"
            "SHELL:-sFILESYSTEM=0"
            "SHELL:-sMODULARIZE=1")
endif()

if(BUILD_TESTING)
  FetchContent_Declare(
    Catch2
    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
    GIT_TAG v3.16.0
    GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(Catch2)

  add_executable(
    satellite_swarm_tests
    tests/controller_test.cpp
    tests/historical_orbital_scorer_test.cpp
    tests/invariant_test.cpp
    tests/telemetry_codec_test.cpp
    tests/telemetry_test.cpp
    tests/telemetry_transmitter_test.cpp
    tests/wire_codec_test.cpp)
  if(SATELLITE_SWARM_BUILD_SIMULATION)
    target_sources(
      satellite_swarm_tests
      PRIVATE browser/src/browser_api.cpp
              tests/browser_api_test.cpp
              tests/simulation_test.cpp)
    target_include_directories(
      satellite_swarm_tests
      PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/browser/include)
  endif()
  target_link_libraries(
    satellite_swarm_tests
    PRIVATE satellite_swarm::coordination Catch2::Catch2WithMain)
  if(SATELLITE_SWARM_BUILD_SIMULATION)
    target_link_libraries(satellite_swarm_tests PRIVATE satellite_swarm::simulation)
  endif()

  if(SATELLITE_SWARM_ENABLE_COVERAGE)
    target_compile_options(satellite_swarm_tests PRIVATE --coverage -O0 -g)
  endif()

  if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
    target_compile_options(
      satellite_swarm_tests
      PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -Wshadow)
  endif()

  include(Catch)
  catch_discover_tests(satellite_swarm_tests)
endif()

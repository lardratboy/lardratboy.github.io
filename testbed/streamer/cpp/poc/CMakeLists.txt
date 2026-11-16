cmake_minimum_required(VERSION 3.20)
project(vdagpoc CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
# No -ffast-math: the job's keepCount and the colour means must round exactly
# as the JavaScript's do, or the records stop being byte for byte the same.
# No fused multiply-adds either: clang contracts a*b + c into one instruction
# on ARM by default, which rounds once where JS rounds twice. The colour
# fields (noise, the kit's frame maps) are full of such expressions.
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -ffp-contract=off")
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG")

find_package(ZLIB REQUIRED)
find_package(Threads REQUIRED)

# The engine half: no window, no GL. Both programs link it.
add_library(vdagcore STATIC src/vdag.cpp src/baked.cpp src/job.cpp src/cut.cpp src/fields.cpp)
target_include_directories(vdagcore PUBLIC src)
target_link_libraries(vdagcore PUBLIC ZLIB::ZLIB Threads::Threads)

add_executable(vdagbench src/bench.cpp)
target_link_libraries(vdagbench PRIVATE vdagcore)

option(POC_VIEWER "Build the SDL3 + OpenGL + Dear ImGui viewer" ON)
if(POC_VIEWER)
  find_package(SDL3 CONFIG REQUIRED)
  find_package(OpenGL REQUIRED)
  include(FetchContent)
  FetchContent_Declare(imgui
    GIT_REPOSITORY https://github.com/ocornut/imgui.git
    GIT_TAG v1.91.9b
    GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(imgui)
  add_library(imgui STATIC
    ${imgui_SOURCE_DIR}/imgui.cpp ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_sdl3.cpp ${imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp)
  target_include_directories(imgui PUBLIC ${imgui_SOURCE_DIR} ${imgui_SOURCE_DIR}/backends)
  target_link_libraries(imgui PUBLIC SDL3::SDL3)

  add_executable(vdagview src/viewer.cpp)
  target_link_libraries(vdagview PRIVATE vdagcore imgui SDL3::SDL3 OpenGL::GL)
  target_compile_definitions(vdagview PRIVATE GL_SILENCE_DEPRECATION
    POC_REPO_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/../..")
endif()

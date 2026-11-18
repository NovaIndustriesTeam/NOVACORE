cmake_minimum_required(VERSION 3.24)
project(NovaEngine VERSION 0.8.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
include(CTest)

set(NOVA_SOURCES src/nova_core.cpp src/nova_render.cpp src/nova_camera.cpp src/nova_image.cpp)
set(NOVA_GPU_SOURCES src/nova_gpu_common.cpp)
if(WIN32)
  list(APPEND NOVA_GPU_SOURCES src/nova_d3d12_common.cpp src/nova_d3d12.cpp src/nova_d3d12_window.cpp)
else()
  list(APPEND NOVA_GPU_SOURCES src/nova_gpu_null.cpp src/nova_window_null.cpp)
endif()

add_library(NovaCore STATIC ${NOVA_SOURCES} ${NOVA_GPU_SOURCES})
target_include_directories(NovaCore PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_include_directories(NovaCore PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb)
target_compile_features(NovaCore PUBLIC cxx_std_20)

if(WIN32)
  target_link_libraries(NovaCore PRIVATE d3d12 dxgi d3dcompiler)
endif()

add_executable(NovaEngine src/main.cpp)
target_link_libraries(NovaEngine PRIVATE NovaCore)

if(BUILD_TESTING)
  add_executable(NovaEngineTests tests/core_tests.cpp)
  target_link_libraries(NovaEngineTests PRIVATE NovaCore)
  add_test(NAME NovaEngine.CoreTests COMMAND NovaEngineTests)

  add_executable(NovaRenderTests tests/render_tests.cpp)
  target_link_libraries(NovaRenderTests PRIVATE NovaCore)
  add_test(NAME NovaEngine.RenderTests COMMAND NovaRenderTests)

  add_executable(NovaCameraTests tests/camera_tests.cpp)
  target_link_libraries(NovaCameraTests PRIVATE NovaCore)
  add_test(NAME NovaEngine.CameraTests COMMAND NovaCameraTests)

  if(WIN32)
    add_executable(NovaGpuTests tests/gpu_tests.cpp)
    target_link_libraries(NovaGpuTests PRIVATE NovaCore)
    add_test(NAME NovaEngine.GpuTests COMMAND NovaGpuTests)

    add_executable(NovaWindowTests tests/window_tests.cpp)
    target_link_libraries(NovaWindowTests PRIVATE NovaCore)
    add_test(NAME NovaEngine.WindowTests COMMAND NovaWindowTests)
  endif()
endif()

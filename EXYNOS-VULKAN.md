# Vulkan-on-Exynos validation — field report (2026-06-11)

Report from the AI News app session: on-device validation of the Vulkan-runtime hypothesis
for the Exynos GPU-inference failure. Preserved verbatim; see RESULTS.md §12 for how it
slots into the speed findings.

---

**Task recap:** test the hypothesis that a Vulkan runtime (llama.cpp) gets on-device GPU
inference working on the failing Exynos device, where the OpenCL stack dies. Validate without
app integration; measure; give a go/no-go.

## Verdict

**Hypothesis CONFIRMED, integration NO-GO.** Vulkan inference *does* run on the Exynos
Xclipse. But on the real model it's a **net regression vs the optimized CPU**, so it's not
worth shipping.

## Phase 1 — feasibility

**Build:** llama.cpp `arm64-v8a` + `-DGGML_VULKAN=ON` built on Windows / NDK 29. Models:
Qwen2.5-0.5B-Q4_K_M (smoke) and unsloth `gemma-3n-E2B-it-Q4_K_M` (the real model).

**Devices & Vulkan init:**

| Device | GPU / driver | Vulkan init | Compute |
|---|---|---|---|
| **S26 — Exynos** | **Xclipse 960**, Samsung proprietary | ✅ enumerated | ✅ **runs, no crash** |
| S25 — Qualcomm | Adreno 830, Qualcomm Vulkan | ✅ enumerated | ❌ **crash** |

Xclipse 960 props: `uma=1, fp16=1, bf16=0, warp=64, shared-mem=65536, int-dot=0,
matrix-cores=none`. Adreno 830: identical but `shared-mem=32768`, and
`createComputePipeline: ErrorUnknown` on `mul_mat_vec_q4_k` → `DeviceLost`. Reproduced under
both glslc 2022.3 (NDK) and 2025.3 (shaderc) → it's the Adreno *driver*, not SPIR-V.
Expected: llama.cpp's Qualcomm path is OpenCL/Hexagon, not Vulkan. Irrelevant to the Exynos
question and irrelevant operationally (Qualcomm already has working GPU via LiteRT-OpenCL).

**Output sanity:** CPU greedy decode coherent; Xclipse Vulkan produced valid tokens (decode
path correct, no garbage).

## Phase 2 — numbers (pp512 / tg128, t/s, same-device S26 Exynos)

**Qwen2.5-0.5B (tiny — GPU launch/transfer overhead dominates):**

| backend | pp512 | tg128 |
|---|---|---|
| Vulkan (Xclipse) | 40.7 | 60.2 |
| CPU (10-thr) | **393** | **113** |

**Gemma-3n-E2B — 4.46 B, Q4_K (the model the app actually runs):**

| backend | pp512 (prompt) | tg128 (decode) |
|---|---|---|
| **Vulkan (Xclipse)** | **5.3** | **10.4** |
| **CPU (10-thr, i8mm+dotprod)** | **58.7** | 7.9 |

**Reading it:**

- **Decode:** Vulkan +31% (10.4 vs 7.9) — real, but below a 2× "worth it" bar.
- **Prompt:** Vulkan **~11× slower** (5.3 vs 58.7). pp **<** tg is inverted/pathological —
  the prompt matmul (`mul_mm`, batch GEMM) path is broken-slow on this driver. With
  `matrix-cores=none` the coopmat path is unused and the scalar/vec fallback is terrible.
  Decode (`mul_mat_vec`, GEMV) is fine; prefill (GEMM) is not.
- Net: a 512-token article would ingest in **~1.5 min on GPU vs ~9 s on CPU**. Disqualifying
  for summarize/chat (long context in, stream out).
- CPU pp had thermal variance (58.7 ± 35) but even worst-case ≫ 5.3.

## Go/No-Go: NO-GO

1. Exynos Vulkan **works but is slower overall** for E2B; the modest decode gain can't
   offset the prefill collapse.
2. Integration cost is high regardless: a second on-device runtime beside LiteRT-LM (JNI,
   GGUF↔`.litertlm`, ~80 MB libs, dual maintenance) — unjustifiable for a net-negative
   result.
3. **The win is on CPU, not GPU.** Optimized CPU (`armv8.2-a+dotprod+i8mm+fp16`) already
   does E2B 59/8 on the S26; ~8 t/s decode is roughly the realistic CPU ceiling for a ~5 B
   model on this hardware. The slowness is inherent to the model class on a phone, not a
   missing optimization.
4. **If revisiting GPU later:** (a) the `mul_mm` prefill anomaly might be tunable (workgroup
   sizes / alternative GEMM kernel / coopmat-free fast path), but the decode ceiling (~1.3×)
   makes ROI low; (b) **MLC-LLM** (Vulkan via TVM) is the alternate runtime worth a shot on
   Xclipse for a second data point. The high-ROI direction is smaller/faster models or
   model-arch choices (E2B vs E4B), not the runtime.

## Reusable build recipe (the non-obvious parts)

- Windows + **NDK 29** (ships `glslc` under `shader-tools/` + Vulkan C headers +
  `libvulkan.so` in sysroot) + **VS2022 BuildTools `cl`** (needed to compile the host
  `vulkan-shaders-gen`).
- NDK has **no C++ `vulkan.hpp`** and **no SPIRV-Headers** → clone
  `KhronosGroup/Vulkan-Headers` + `SPIRV-Headers`; point `Vulkan_INCLUDE_DIR` at
  Vulkan-Headers and **merge the `spirv/` tree into it** (ggml expects
  `spirv/unified1/spirv.hpp` beside the Vulkan headers, LunarG-SDK-style).
- Android toolchain needs `-DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH` so `find_package` sees
  the cloned headers.
- **Integer-dot (q8_1) shader-gen is broken** for this cross-build once a modern glslc
  enables it (`use of undeclared identifier mul_mat_vec_q4_0_q8_1_f32_data`) → set
  `GGML_VULKAN_INTEGER_DOT_GLSLC_SUPPORT OFF` in `ggml/src/ggml-vulkan/CMakeLists.txt`,
  **and delete stale generated `*.comp.cpp` + `vulkan-shaders-gen-prefix`** to force
  regeneration (toggling the flag alone won't regen the dispatch glue).
- CPU bench gotcha: a Vulkan-enabled build hijacks `ngl 0` benches (drags pp / `DeviceLost`)
  → hide the GPU with `GGML_VK_VISIBLE_DEVICES=99` for a true CPU number.

**Bottom line for model work:** drop the GPU thread for Exynos; the lever is model size/arch
and making sure the CPU runtime uses ARM i8mm/dotprod (XNNPACK in LiteRT-LM does this by
runtime detection, so it's likely already optimal).

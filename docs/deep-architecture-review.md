# Deep Technical Review — Face Scan App

Date: 2026-04-21
Reviewer stance: Staff-level architecture/code review focused on production behavior under load.

## Executive summary

Overall assessment:
The codebase is promising and has a coherent high-level direction (JS orchestrator + native scoring/capture pipeline), but it is still in a transition/debug-heavy state and not yet production-ready. The most important risks are in threading/throughput pressure, cross-platform parity drift, and leaky JS/native contracts.

Main strengths:
- Clear intent to push expensive scoring/capture selection into native (`FaceCapturePipeline` on both platforms).
- Reasonable domain modeling for scan states/poses and capture outputs.
- Separation between guidance derivation (`utils/faceGuidance.ts`) and flow orchestration (`useFaceScanFlow.ts`) is better than typical ad-hoc screen logic.

Main risks:
- Hot-path CPU/memory cost in native frame processors (blocking ML calls + frequent conversions/copies).
- JS/runtime complexity from multiple timing models and debug logic embedded in production hooks.
- Contract inconsistency across Nitro enum vs app string types.
- iOS/Android behavior divergence risk remains high despite recent orientation/yaw fixes.

Technical debt level:
Medium-High.

Confidence level:
Medium-High for findings based on visible code paths; Medium for runtime assertions that require device profiling.

---

## Architecture review

What is good:
- Native pipeline boundaries exist and are explicit (`FaceDetectionFrameProcessor` -> `FaceCapturePipeline` -> capture payload).
- Pose/readiness logic has centralized constants (`CaptureConfig.kt`, `CaptureConfig.swift`, and JS thresholds).
- UI is decomposed into presentational components (`PoseInstruction`, `DistanceHint`, `QualityHint`, etc.) instead of one giant screen.

What is weak:
- Hook-level orchestration has become a de facto mini-runtime with refs, polling intervals, debug overlays, and fallbacks (`useFaceDetection.ts`, `useFaceScanFlow.ts`). This is hard to reason about and test.
- Debug/prototype behavior is mixed into mainline logic (`mockMode` simulation in same hook used by production camera flow).
- JS/native contract shape is not fully normalized (numeric enum on Nitro side, string discriminants in app types, runtime coercion).
- Routing/app-shell is clean but minimal; no explicit lifecycle strategy for camera interruption/backgrounding.

What should be refactored first:
1. Stabilize and simplify runtime model (single source of truth for scan phase transitions).
2. Normalize JS/native result contract and remove union coercion logic.
3. Reduce native hot-path costs (especially Android `Tasks.await` and iOS JPEG encode path allocations).
4. Gate/remove debug UI and mock logic from production paths.

---

## Detailed findings

### 1) Blocking ML call inside frame processor can starve throughput
- Severity: High
- Area: Android / Vision Camera / Performance
- Why it matters: Calling ML Kit synchronously from the frame callback can block frame processing, causing dropped frames, high thermals, and unstable guidance cadence.
- Evidence from code: `Tasks.await(detector.process(inputImage), 300, ...)` in `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/FaceDetectionFrameProcessor.kt:94-98`.
- Recommended fix: Move to non-blocking detector scheduling with latest-frame-wins policy, or dedicated analyzer queue with bounded backlog and explicit frame drop strategy.
- Classification: Proven issue.

### 2) Frequent frame conversion fallback is expensive and likely to regress low-end devices
- Severity: High
- Area: Android / Performance
- Why it matters: `InputImage.fromBitmap(imageProxy.toBitmap())` in hot path incurs extra allocation/copy; this is expensive under sustained camera load.
- Evidence from code: Fallback branch in `FaceDetectionFrameProcessor.kt:87-89`; also bitmap fallback in snapshot path `FaceCapturePipeline.kt:178-182`.
- Recommended fix: Enforce YUV-only input contract end-to-end and fail fast if format deviates; avoid bitmap conversion in runtime hot path.
- Classification: Likely issue (depends on actual pixel format consistency at runtime).

### 3) Quality metrics become neutral for common portrait rotations on Android
- Severity: High
- Area: Android / Correctness / Reliability
- Why it matters: Returning neutral brightness/sharpness at 90/270 weakens quality gating and can admit poor frames while claiming quality checks.
- Evidence from code: `if (rotation == 90 || rotation == 270) return 0.5 to 0.5` in `FaceDetectionFrameProcessor.kt:185-186`.
- Recommended fix: Rotate/transform sampling coordinates into sensor space or compute metrics in a rotation-aware buffer abstraction.
- Classification: Proven issue.

### 4) iOS uses heavier Vision request than necessary
- Severity: Medium
- Area: iOS / Performance
- Why it matters: `VNDetectFaceLandmarksRequest` is heavier than plain face rectangle detection for current gating needs.
- Evidence from code: `VNDetectFaceLandmarksRequest` in `modules/FaceDetection/ios/FaceDetectionFrameProcessor.swift:7-10` while logic mostly uses `boundingBox`/angles.
- Recommended fix: Benchmark with `VNDetectFaceRectanglesRequest`; only enable landmarks when truly needed.
- Classification: Architectural smell.

### 5) iOS JPEG encoding path allocates `CIContext` per encode
- Severity: High
- Area: iOS / Performance
- Why it matters: Recreating `CIContext` every encode is expensive and increases memory churn.
- Evidence from code: `let ctx = CIContext(...)` inside `encodeJPEG` in `modules/FaceDetection/ios/FaceCapturePipeline.swift:213`.
- Recommended fix: Reuse a long-lived `CIContext` instance on pipeline object.
- Classification: Proven issue.

### 6) JS/native union contract is leaky and handled with runtime coercion
- Severity: Medium
- Area: Nitro Modules / TypeScript / DX
- Why it matters: Ambiguous type discriminants reduce type safety and make edge-case bugs harder to detect.
- Evidence from code:
  - Nitro enum numeric discriminant: `modules/FaceDetection/src/specs/FaceDetectionFrameProcessor.nitro.ts:8-15, 41-43`
  - App-level string discriminant types: `types/faceDetection.ts:29-31, 49-52`
  - Runtime coercion: `kind === 'captured' || kind === 1` in `hooks/useFaceDetection.ts:239-241`.
- Recommended fix: Normalize to one canonical discriminant contract (prefer explicit string literal in both Nitro and app-level types, or numeric everywhere with wrappers).
- Classification: Proven issue.

### 7) Runtime state model is over-complex and prone to desync
- Severity: High
- Area: Reanimated / Reliability / DX
- Why it matters: Multiple async loops and refs can drift, causing hard-to-reproduce state bugs.
- Evidence from code:
  - Periodic state sync loop in `useFaceDetection.ts:300-337`
  - Stabilization effect + separate polling fallback in `useFaceScanFlow.ts:145-205`
  - Multiple mutable refs (`phaseRef`, `poseIndexRef`, `isRunningRef`) in `useFaceScanFlow.ts:113-129`.
- Recommended fix: Consolidate into one explicit state machine (xstate/reducer + event queue). Remove polling fallback by making transitions event-driven.
- Classification: Proven issue.

### 8) `runOnJS` payload frequency may still be too chatty under load
- Severity: Medium
- Area: Reanimated / Vision Camera / Performance
- Why it matters: Crossing threads frequently with large objects can pressure JS and cause frame-guidance jitter.
- Evidence from code: `runOnJS(handleResult)(raw)` on each processed frame in `useFaceDetection.ts:353-355`; processed every N frames with default `processEveryNFrames=2` (`useFaceDetection.ts:119, 123, 344`).
- Recommended fix: Keep per-frame guidance calculations native and send compact deltas at lower fixed cadence (e.g., 5-10Hz), only emitting capture events immediately.
- Classification: Likely issue.

### 9) Debug panel and debug validation logic are in production rendering path
- Severity: Medium
- Area: UI / DX / Performance
- Why it matters: Large always-on overlay increases render cost and noise; easier to accidentally ship debug internals.
- Evidence from code: Debug panel in `components/face-scan/FaceScanCameraScreen.tsx:286-423`; validation computations baked into return object in `useFaceScanFlow.ts:372-454`.
- Recommended fix: Guard behind `__DEV__` and feature flag; move debug derivations to isolated dev-only hook.
- Classification: Proven issue.

### 10) Mock behavior is coupled with production hook
- Severity: Medium
- Area: Architecture / Maintainability
- Why it matters: Increases branching complexity and risk of accidental mock fallback in real flows.
- Evidence from code: Mock sequence and capture simulation inside `useFaceDetection.ts:35-233`; fallback default `mockModeOverride ?? !isPluginLinked` at `useFaceDetection.ts:122`.
- Recommended fix: Split into `useFaceDetectionNative` and `useFaceDetectionMock`; select at composition boundary.
- Classification: Architectural smell.

### 11) Native detector/resource lifecycle not explicit
- Severity: Medium
- Area: Android / Reliability
- Why it matters: Detector instances should be closed/disposed intentionally to avoid leaks in long sessions or repeated mounts.
- Evidence from code: detector created in `FaceDetectionFrameProcessor.kt:18-27`; no explicit close/deinit visible.
- Recommended fix: Add lifecycle hooks to close detector and shutdown executors cleanly.
- Classification: Likely issue.

### 12) Capture pipeline can remain in "encoding" with no timeout/recovery path
- Severity: Medium
- Area: Reliability / Native
- Why it matters: If encode queue stalls/fails unexpectedly, user flow can appear stuck at 100% progress.
- Evidence from code: `.encoding` returns 1 forever until callback resets (`FaceCapturePipeline.swift:124-126`, `FaceCapturePipeline.kt:113-114`, reset in async callback).
- Recommended fix: Add watchdog timeout and fallback state reset + telemetry.
- Classification: Likely issue.

### 13) Podspec metadata indicates packaging immaturity
- Severity: Low
- Area: iOS / DX / Production readiness
- Why it matters: Placeholder `source/homepage` complicates CI/cocoapods publishing and onboarding.
- Evidence from code: `modules/FaceDetection/FaceDetection.podspec:9,14` uses `example.local`.
- Recommended fix: Use real repository metadata or local-module comments indicating intentionally unpublished spec.
- Classification: Proven issue.

### 14) Camera lifecycle handling is simplistic
- Severity: Medium
- Area: React Native / Reliability
- Why it matters: `isActive={true}` with no app-state/route focus integration risks battery and edge-case crashes during interruptions.
- Evidence from code: Camera always active in `FaceScanCameraScreen.tsx:257`.
- Recommended fix: Bind `isActive` to screen focus + AppState; add interruption handlers.
- Classification: Likely issue.

### 15) Type boundaries are better than average but still partially duplicated
- Severity: Low
- Area: TypeScript / Maintainability
- Why it matters: Duplicate models (`types/faceDetection.ts` vs nitro spec) increase drift risk.
- Evidence from code: duplicated guidance/capture type sets in `types/faceDetection.ts` and `modules/FaceDetection/src/specs/FaceDetectionFrameProcessor.nitro.ts`.
- Recommended fix: Generate or re-export canonical runtime contract types from Nitro surface and derive app types from them.
- Classification: Architectural smell.

---

## Threading and runtime model assessment

JS thread model:
- Risky today. The app uses refs + interval syncing (`useFaceDetection.ts:300-337`) and additional interval fallback (`useFaceScanFlow.ts:193-203`). This works but creates timing ambiguity and makes bugs highly stateful.

UI thread model:
- Acceptable for animations themselves (`Animated.Value` for flash/progress), but UI logic is coupled to many derived debug fields and can re-render frequently from synchronized state flushes.

Worklet usage:
- Mostly correct in structure (`onFrame` worklet calling native processor, then `runOnJS`).
- Risk comes from frequency/payload size and potential stale closure assumptions if target pose changes rapidly.

Native thread usage:
- Android: high risk due to synchronous detector wait in frame path.
- iOS: better queue isolation for encode, but per-encode object churn and no explicit watchdog.

Cross-thread communication:
- Functional but noisy. High-frequency `runOnJS` with union coercion and separate timing loops makes runtime reasoning harder than necessary.

Verdict on threading model:
- Partially sound conceptually, but operationally fragile under real-device load and intermittent detection.

---

## Native boundary assessment

Current boundary quality:
- Medium.
- Good: One clear native entry point (`processFrame(frame,args)`), and capture payload includes detailed scoring subcomponents.
- Weak: Contract discriminant mismatch (numeric enum vs string handling), optional fields loosely typed, and fallback behavior encoded in JS runtime checks.

Design issues:
- The JS side still compensates for boundary ambiguity (`kind === 0/1 or string`), which should be unnecessary in a clean contract.
- The boundary carries fairly rich objects per frame; for guidance this should be minimized/quantized to reduce churn.

API ergonomics:
- Better than custom event emitter patterns, but still too low-level for app layer. A typed façade should expose stable domain events (`guidanceTick`, `poseCaptured`) with strict schema.

---

## Refactor roadmap

Immediate fixes (next 1-2 sprints):
1. Remove synchronous ML Kit wait from Android frame path and implement bounded async analyzer.
2. Reuse `CIContext` on iOS; avoid per-encode recreation.
3. Gate all debug UI/logic under `__DEV__`.
4. Normalize result type discriminant across Nitro + JS.
5. Add camera `isActive` lifecycle binding (focus + AppState).

Short-term refactors (1-2 months):
1. Replace multi-interval/ref orchestration with explicit event-driven state machine.
2. Split mock/native hooks to avoid runtime branching in production pipeline.
3. Introduce parity tests for pose thresholds and orientation semantics between Android/iOS.
4. Add watchdog and error telemetry for capture pipeline encoding state.

Long-term architecture improvements:
1. Move more gating/pose validity decisions fully native; JS receives compact state snapshots.
2. Build a unified cross-platform contract package (generated types from Nitro spec).
3. Add performance instrumentation (frame time, detector latency, JS update latency, thermal impact) and ship with dashboards.
4. Create deterministic replay harness (recorded frame metadata -> expected pose transitions).

---

## Final verdict

Is this codebase solid?
- Moderately solid in direction, not yet in execution quality.

Is it fragile?
- Yes, especially around runtime timing and native hot-path behavior.

Is it senior-level?
- Parts of the architecture intent are senior-level; implementation details currently are mixed with prototype/debug residue.

Is it production-ready?
- Not yet.

If left as-is, what team problems will appear?
- Slow debugging cycles for state desync bugs.
- Device-specific behavior regressions (especially low-end Android and orientation/mirroring edge cases).
- Increased onboarding cost because behavior is spread across JS refs/intervals and native pipelines without strict contract boundaries.

---

## Top 10 issues to fix first (ranked)

1. Android synchronous detector wait in frame callback (`Tasks.await`) — throughput/latency risk.
2. Android rotation-based neutral quality metrics (90/270) — correctness gap in quality gating.
3. iOS per-encode `CIContext` allocation — sustained performance/memory churn.
4. Multi-loop JS orchestration (interval + polling + refs) — desync/debug complexity.
5. JS/native discriminant mismatch and union coercion — type safety and runtime ambiguity.
6. High-frequency `runOnJS` payload chatter — JS pressure/jitter risk.
7. Debug panel + debug calculations in production render path — performance + accidental ship risk.
8. Camera lifecycle too static (`isActive={true}`) — reliability/battery/interruption issues.
9. Missing explicit native resource lifecycle/teardown semantics — leak/stability risk.
10. Cross-platform parity not systematically enforced (Vision vs ML Kit behavior) — inconsistent UX.

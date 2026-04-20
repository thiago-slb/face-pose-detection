# Face Scan Technical Architecture

## 1. Purpose

This document describes the current face-scan implementation in this project:
- how frames are collected and processed
- what native analysis runs per frame
- how best-frame capture works
- how JS orchestrates the 5-pose flow

Target poses:
- `center`
- `left`
- `right`
- `up`
- `down`

## 2. Current App Surface

Current routed screens are only:
- `app/(tabs)/index.tsx`
- `app/(tabs)/_layout.tsx`
- `app/_layout.tsx`

`explore` and `modal` routes are removed.

The scan flow is rendered from `app/(tabs)/index.tsx` and switches among:
- intro screen
- camera/scan screen
- success screen

## 3. End-to-End Runtime Flow

1. UI starts scan via `useFaceScanFlow`.
2. `useFaceDetection` sets up a VisionCamera frame output (`useFrameOutput`).
3. Worklet calls `detectFace(frame, { targetPose })`.
4. `detectFace` resolves Nitro HybridObject `FaceDetectionFrameProcessor` and synchronously calls native `processFrame(...)`.
5. Native returns one of:
- `guidance` per-frame telemetry
- `captured` best-frame event for current pose
6. JS applies smoothing/derivation to guidance and updates UI.
7. On `captured`, JS stores URI for current pose and advances to next pose.

## 4. JavaScript/Worklet Layer

### 4.1 Nitro binding

File: `frameProcessors/detectFace.ts`

- Hybrid object name: `FaceDetectionFrameProcessor`
- Uses:
- `NitroModules.hasHybridObject(...)`
- `NitroModules.createHybridObject(...)`
- `NitroModules.box(...).unbox()` for worklet-safe usage
- Exposes:
- `detectFace(...)`
- `isPluginLinked`

If not linked, `detectFace` returns `null` and the hook can run in mock mode.

### 4.2 Detection hook

File: `hooks/useFaceDetection.ts`

Responsibilities:
- runs frame processing with throttling (`processEveryNFrames`, default 2)
- forwards `targetPose` via shared value into worklet
- maps native guidance to app guidance model
- handles native captured events
- supports mock mode (`mockMode = !isPluginLinked` by default)
- updates React state on interval (`stateUpdateIntervalMs`, default 100ms)

### 4.3 Scan flow hook

File: `hooks/useFaceScanFlow.ts`

Responsibilities:
- pose orchestration across 5 steps
- pose status transitions (`detecting`, `stabilizing`, `captured`)
- stores captured frame URIs per pose
- advances to success screen when all poses complete

## 5. Native Module Architecture (Nitro)

Local package:
- `react-native-face-detection` (via `file:modules/FaceDetection` in root `package.json`)

Core files:
- `modules/FaceDetection/nitro.json`
- `modules/FaceDetection/src/specs/FaceDetectionFrameProcessor.nitro.ts`
- `modules/FaceDetection/nitrogen/generated/...` (generated bridges/autolinking)

### 5.1 Registered HybridObject

Name: `FaceDetectionFrameProcessor`

Generated registration:
- Android: `modules/FaceDetection/nitrogen/generated/android/FaceDetectionOnLoad.cpp`
- iOS: `modules/FaceDetection/nitrogen/generated/ios/FaceDetectionAutolinking.mm`

## 6. Android Implementation

Files:
- `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/FaceDetectionFrameProcessor.kt`
- `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/FaceCapturePipeline.kt`
- `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/FrameQualityScorer.kt`
- `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/CaptureConfig.kt`

Processing details:
- ML Kit face detection (`PERFORMANCE_MODE_FAST`, tracking enabled)
- bounding box + Euler angles extracted from `Face`
- ROI Y-plane metrics:
- brightness = mean luma
- sharpness = Laplacian variance (normalized)
- stabilization window collects best candidate
- candidate encoded to JPEG in background and returned as `captured`

## 7. iOS Implementation

Files:
- `modules/FaceDetection/ios/FaceDetectionFrameProcessor.swift`
- `modules/FaceDetection/ios/FaceCapturePipeline.swift`
- `modules/FaceDetection/ios/FrameQualityScorer.swift`
- `modules/FaceDetection/ios/CaptureConfig.swift`

Processing details:
- Vision face detection (`VNDetectFaceLandmarksRequest` + `VNSequenceRequestHandler`)
- `VNFaceObservation` used for bbox/yaw/pitch/roll
- ROI Y-plane metrics on pixel buffer
- stabilization + best-frame capture logic mirrors Android behavior
- JPEG encoded and emitted as `captured`

## 8. Native Result Contract Used by JS

App-level TypeScript contract:
- `types/faceDetection.ts`

Native frame result union consumed by hooks:
- `guidance`
- `faceDetected`
- `boundingBoxX/Y/Width/Height`
- `yaw/pitch/roll`
- `brightness/sharpness`
- `faceSizeRatio`, `faceCenterX/Y`
- `stabilizationProgress`
- `captured`
- `poseId`
- `uri` (local file path)
- `qualityScore`
- `scores` (`brightness`, `sharpness`, `centeredness`, `poseAccuracy`, `stability`, `faceSize`, `composite`)

## 9. Stabilization and Best-Frame Selection

Native pipeline state machine:
- `idle`
- `running(startedAt, best?)`
- `encoding`
- back to `idle`

Behavior:
- readiness checks gate entry to stabilization window
- default window length: `500ms`
- only highest composite frame is retained
- final best frame encoded to JPEG and emitted asynchronously

## 10. Fallback Behavior

When native module is unavailable:
- `isPluginLinked` is false
- `useFaceDetection` defaults to mock mode
- app still runs full UX flow with synthetic guidance/capture

## 11. Technologies in Use

- Expo + React Native + Expo Router
- TypeScript
- react-native-vision-camera (frame outputs/worklet integration)
- react-native-reanimated (`runOnJS`, animated UI values)
- react-native-nitro-modules (HybridObject runtime)
- Android: Kotlin + ML Kit
- iOS: Swift + Vision

## 12. Key Source Files

- `app/(tabs)/index.tsx`
- `hooks/useFaceDetection.ts`
- `hooks/useFaceScanFlow.ts`
- `frameProcessors/detectFace.ts`
- `types/faceDetection.ts`
- `modules/FaceDetection/src/specs/FaceDetectionFrameProcessor.nitro.ts`
- `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/FaceDetectionFrameProcessor.kt`
- `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/FaceCapturePipeline.kt`
- `modules/FaceDetection/ios/FaceDetectionFrameProcessor.swift`
- `modules/FaceDetection/ios/FaceCapturePipeline.swift`

# Face Scan Technical Architecture

## 1. Purpose

This document explains how the app captures and parses face frames, what is analyzed on each frame, how the best image is selected, and which technologies power the pipeline.

The pipeline supports 5 poses:
- `center`
- `left`
- `right`
- `up`
- `down`

## 2. End-to-End Flow

1. The React Native UI opens the front camera using VisionCamera.
2. A frame worklet (`useFrameOutput`) runs per frame on the camera thread.
3. The worklet calls the native Nitro HybridObject `FaceDetectionFrameProcessor.processFrame(frame, { targetPose })`.
4. Native returns one of two payloads:
- `guidance`: per-frame face telemetry + stabilization progress.
- `captured`: best-frame result for a pose, including JPEG path and quality scores.
5. JS smooths/derives guidance for UX feedback (`distance`, `alignment`, `quality`, message).
6. When native emits `captured`, JS stores the frame for the current pose and advances to the next pose.

## 3. Frame Collection and Parsing

## 3.1 Camera stream and frame worklet

- Camera component: `react-native-vision-camera` `<Camera outputs={[frameOutput]} />`
- Frame hook: `useFrameOutput({ onFrame })` in `hooks/useFaceDetection.ts`
- Processing rate: JS intentionally skips every other frame (`processEveryNFrames = 2`) to reduce load.
- Worklet cleanup: each processed/skipped frame is explicitly disposed (`frame.dispose()`).

## 3.2 Native bridge contract

HybridObject name is `FaceDetectionFrameProcessor` on both platforms, registered via Nitro autolinking:
- Android: `modules/FaceDetection/nitrogen/generated/android/FaceDetectionOnLoad.cpp`
- iOS: `modules/FaceDetection/nitrogen/generated/ios/FaceDetectionAutolinking.mm`

Returned union type:
- `guidance` payload:
- `faceDetected`
- normalized bounding box (`boundingBoxX/Y/Width/Height`, range `0..1`)
- head angles (`yaw`, `pitch`, `roll`, degrees)
- raw quality metrics (`brightness`, `sharpness`, range `0..1`)
- geometry (`faceSizeRatio`, `faceCenterX`, `faceCenterY`)
- `stabilizationProgress` (`0..1`)
- `captured` payload:
- `poseId`
- `uri` (absolute JPEG path when available)
- `qualityScore` (composite)
- detailed scores (`brightness`, `sharpness`, `centeredness`, `poseAccuracy`, `stability`, `faceSize`, `composite`)

## 3.3 Parsing in JS

`hooks/useFaceDetection.ts`:
- Converts native guidance to `RawFaceDetectionResult`.
- Applies EMA smoothing (`FaceDataSmoother`).
- Derives UX guidance (`deriveGuidance`) for:
- detected pose
- distance status
- alignment status
- quality status
- user-facing messages
- Syncs guidance state at a throttled interval (default `100ms`) to decouple UI from camera FPS.

## 4. What Is Analyzed Per Frame

## 4.1 Face detection and pose estimation

Android (`FaceDetectionFrameProcessor.kt`):
- Uses Google ML Kit Face Detection (`PERFORMANCE_MODE_FAST`, tracking enabled).
- Reads bounding box and Euler angles from `Face`.

iOS (`FaceDetectionFrameProcessor.swift`):
- Uses Apple Vision (`VNDetectFaceLandmarksRequest` + `VNSequenceRequestHandler`).
- Reads `VNFaceObservation` bounding box and `yaw/pitch/roll`.

Both platforms normalize conventions so JS uses consistent semantics:
- `yaw > 0` means face turned right.
- `pitch > 0` means face tilted up.

## 4.2 Quality metrics (computed on face ROI Y plane)

For the detected face rectangle, both platforms compute:
- Brightness: mean luma sampled with stride 8.
- Sharpness: Laplacian-variance-based sharpness sampled with stride 16, normalized to `0..1`.

This makes scoring resilient to color-space differences and keeps per-frame cost low.

## 4.3 Readiness gates (must pass before stabilization window)

Native readiness checks include:
- face detected
- pose near target (`maxYawDeviation`, `maxPitchDeviation`)
- alignment near center (`maxAlignmentOffsetX/Y`)
- acceptable face size range (`readinessMinSize`, `readinessMaxSize`)
- minimum image quality (`minBrightness`, `maxBrightness`, `minSharpness`)

Defaults are defined in:
- Android: `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/CaptureConfig.kt`
- iOS: `modules/FaceDetection/ios/CaptureConfig.swift`

## 4.4 Best-frame scoring dimensions

For candidate frames that pass hard rejection, native computes:
- `brightness`: Gaussian score around ideal luma.
- `sharpness`: normalized sharpness.
- `centeredness`: distance from frame center.
- `poseAccuracy`: Gaussian distance to target yaw/pitch.
- `stability`: inter-frame angular motion penalty.
- `faceSize`: Gaussian score around ideal face-size ratio.

Composite score is a weighted sum (defaults):
- sharpness `0.30`
- poseAccuracy `0.25`
- brightness `0.20`
- centeredness `0.15`
- faceSize `0.05`
- stability `0.05`

## 5. Stabilization and Capture Strategy

Native pipeline state machine (`FaceCapturePipeline` on iOS/Android):
1. `idle`
2. `running(startedAt, best?)`
3. `encoding`
4. back to `idle`

Mechanics:
- When readiness is first satisfied, the stabilization window starts.
- Window duration default is `500ms`.
- During window, only the highest composite frame is retained.
- At window end, best frame is JPEG-encoded asynchronously and emitted as `captured`.

Memory/throughput considerations:
- Android copies YUV planes synchronously during callback for the current best candidate, then encodes on background thread.
- iOS retains a copied `CMSampleBuffer` for the best candidate, then encodes on background queue.
- At most one best candidate is retained at a time.

## 6. JS Orchestration and UX State

`hooks/useFaceScanFlow.ts` orchestrates pose progression:
- Pose-level state: `idle -> detecting -> stabilizing -> captured`
- Screen-level state: `intro -> scanning -> success`
- Uses native `stabilizationProgress` to drive progress UI.
- Consumes native `captured` events to store per-pose frames and advance.

The scan loop ends after all 5 poses are captured.

## 7. Technologies Used

Application layer:
- Expo + React Native
- TypeScript
- Expo Router

Camera/worklets:
- `react-native-vision-camera` (v5 API style with `useFrameOutput`)
- `react-native-vision-camera-worklets`
- `react-native-worklets`
- `react-native-reanimated` (for `runOnJS` and UI animation integration)

Native analysis:
- Android: Kotlin + Google ML Kit Face Detection
- iOS: Swift + Apple Vision (`VNDetectFaceLandmarksRequest`)

Native imaging/encoding:
- Android: `Image` (`YUV_420_888`) + `YuvImage` JPEG compression
- iOS: `CMSampleBuffer`/`CVPixelBuffer` + CoreImage + `UIImage.jpegData`

## 8. Data Produced by the Pipeline

During scan:
- Real-time guidance telemetry (not persisted as images)

Per captured pose:
- JPEG file path (`uri`) in app cache/temp storage
- quality score bundle for diagnostics/selection traceability

## 9. Fallback and Degraded Modes

If native plugin is unavailable:
- JS detects plugin absence (`isPluginLinked === false`)
- Hook enters mock mode with synthetic guidance/capture events
- UI still exercises the full flow for development and demos

## 10. Key Source Files

- `hooks/useFaceDetection.ts`
- `hooks/useFaceScanFlow.ts`
- `frameProcessors/detectFace.ts`
- `types/faceDetection.ts`
- `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/FaceDetectionFrameProcessor.kt`
- `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/FaceCapturePipeline.kt`
- `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/FrameQualityScorer.kt`
- `modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/CaptureConfig.kt`
- `modules/FaceDetection/ios/FaceDetectionFrameProcessor.swift`
- `modules/FaceDetection/ios/FaceCapturePipeline.swift`
- `modules/FaceDetection/ios/FrameQualityScorer.swift`
- `modules/FaceDetection/ios/CaptureConfig.swift`

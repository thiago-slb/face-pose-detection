/**
 * nativeContract.ts
 *
 * Single source of truth for constants that must stay in sync across the
 * Android (CaptureConfig.kt) and iOS (CaptureConfig.swift) native pipelines.
 *
 * When any value here is changed it MUST be mirrored in both:
 *   modules/FaceDetection/android/src/main/java/com/margelo/nitro/facedetection/CaptureConfig.kt
 *   modules/FaceDetection/ios/CaptureConfig.swift
 *
 * This file is also consumed by the JS debug panel (useFaceScanFlow) to
 * validate readiness gates against the same thresholds native uses, so a
 * mismatch would show up as incorrect OK/NO badges in the debug overlay.
 */

// ─── Pose targets (degrees) ───────────────────────────────────────────────────
// Sign convention (both platforms): positive yaw = user turned RIGHT,
// positive pitch = user tilted UP.  Matches CaptureConfig.invertYawForFrontCamera=true.
export const POSE_TARGETS: Record<string, { yaw: number; pitch: number }> = {
  center: { yaw:   0, pitch:   0 },
  left:   { yaw: -30, pitch:   0 },
  right:  { yaw:  30, pitch:   0 },
  up:     { yaw:   0, pitch:  20 },
  down:   { yaw:   0, pitch: -20 },
};

// ─── Hard-rejection thresholds ────────────────────────────────────────────────
// A frame violating any threshold is discarded before composite scoring.
// Mirrors CaptureThresholds defaults on both platforms.
export const CAPTURE_THRESHOLDS = {
  minBrightness:            0.20,
  maxBrightness:            0.88,
  minSharpness:             0.12,
  minCenteredness:          0.40,
  minFaceSizeRatio:         0.15,
  maxFaceSizeRatio:         0.80,
  maxYawDeviation:          20,    // degrees from target yaw
  maxPitchDeviation:        12,    // degrees from target pitch
  minYawForSidePose:        22,    // min absolute yaw for left/right poses
  minPitchForVerticalPose:  16,    // min absolute pitch for up/down poses
  maxAlignmentOffsetX:      0.13,  // face center X offset from 0.5
  maxAlignmentOffsetY:      0.15,
  readinessMinSize:         0.15,
  readinessMaxSize:         0.80,
} as const;

// ─── Scoring weights (must sum to 1.0) ───────────────────────────────────────
// Mirrors CaptureWeights defaults on both platforms.
export const CAPTURE_WEIGHTS = {
  sharpness:    0.30,
  poseAccuracy: 0.25,
  brightness:   0.20,
  centeredness: 0.15,
  faceSize:     0.05,
  stability:    0.05,
} as const;

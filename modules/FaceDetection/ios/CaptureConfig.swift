// CaptureConfig.swift
// Tunable constants for the native best-frame capture pipeline.
// All values can be overridden at runtime for A/B testing.

import Foundation

// ─── Pose targets (degrees) ───────────────────────────────────────────────────
// Yaw: positive = turned right. Pitch: positive = tilted up.
enum PoseTargets {
  struct Target { let yaw: Float; let pitch: Float }
  static let byId: [String: Target] = [
    "center": Target(yaw:   0, pitch:  0),
    "left":   Target(yaw: -30, pitch:  0),
    "right":  Target(yaw:  30, pitch:  0),
    "up":     Target(yaw:   0, pitch: 20),
    "down":   Target(yaw:   0, pitch:-20),
  ]
}

// ─── Scoring weights (must sum to 1.0) ───────────────────────────────────────
struct CaptureWeights {
  var sharpness:    Float = 0.30
  var poseAccuracy: Float = 0.25
  var brightness:   Float = 0.20
  var centeredness: Float = 0.15
  var faceSize:     Float = 0.05
  var stability:    Float = 0.05
}

// ─── Hard-rejection thresholds ────────────────────────────────────────────────
// A frame violating any threshold is discarded before composite scoring.
struct CaptureThresholds {
  var minBrightness:       Float = 0.20   // below = too dark
  var maxBrightness:       Float = 0.88   // above = overexposed
  var minSharpness:        Float = 0.12   // below = blurry
  var minCenteredness:     Float = 0.65   // face must be near frame center
  var minFaceSizeRatio:    Float = 0.15   // face height / frame height
  var maxFaceSizeRatio:    Float = 0.72
  // Pose readiness gates (same semantics as JS DetectionThresholds)
  var maxYawDeviation:     Float = 15     // degrees from target yaw
  var maxPitchDeviation:   Float = 12     // degrees from target pitch
  var minYawForSidePose:   Float = 22     // min absolute yaw for left/right
  var minPitchForVerticalPose: Float = 16 // min absolute pitch for up/down
  var maxAlignmentOffsetX: Float = 0.13   // face center X offset from 0.5
  var maxAlignmentOffsetY: Float = 0.15
  var readinessMinSize:    Float = 0.20
  var readinessMaxSize:    Float = 0.65
}

// ─── Global config ────────────────────────────────────────────────────────────
enum CaptureConfig {
  static var weights:              CaptureWeights    = .init()
  static var thresholds:           CaptureThresholds = .init()
  /// Milliseconds the stabilization window stays open collecting candidates.
  static var stabilizationWindowMs: Int    = 500
  /// JPEG compression quality for saved best frames (0-1).
  static var jpegQuality:           CGFloat = 0.88
  /// Laplacian variance normalization baseline. Increase for noisier sensors.
  static var sharpnessBaseline:     Double  = 300.0
  /// Ideal face height / frame height ratio. Brightness score peaks here.
  static var idealFaceSizeRatio:    Float   = 0.40
  /// Gaussian σ for pose accuracy scoring (degrees).
  static var poseAccuracySigma:     Float   = 12.0
  /// Gaussian σ for face size scoring (ratio units).
  static var faceSizeSigma:         Float   = 0.12
  /// Gaussian σ for brightness scoring (luma units, 0–1).
  static var brightnessSigma:       Float   = 0.18
}

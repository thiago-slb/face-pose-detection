// FrameQualityScorer.swift
// Pure, stateless scoring functions for frame quality evaluation.
// All functions are safe to call from any thread.

import Foundation

// ─── Score bundle ─────────────────────────────────────────────────────────────
struct QualityScores {
  let brightness:   Float   // gaussian score around ideal luma
  let sharpness:    Float   // normalized Laplacian variance
  let centeredness: Float   // 1.0 = face perfectly centered in frame
  let poseAccuracy: Float   // gaussian around target head angles
  let stability:    Float   // 1.0 = zero inter-frame angular motion
  let faceSize:     Float   // gaussian around ideal face-size ratio

  var composite: Float {
    let w = CaptureConfig.weights
    return brightness   * w.brightness   +
           sharpness    * w.sharpness    +
           centeredness * w.centeredness +
           poseAccuracy * w.poseAccuracy +
           stability    * w.stability    +
           faceSize     * w.faceSize
  }

  func toDictionary() -> [String: Double] { [
    "brightness":   Double(brightness),
    "sharpness":    Double(sharpness),
    "centeredness": Double(centeredness),
    "poseAccuracy": Double(poseAccuracy),
    "stability":    Double(stability),
    "faceSize":     Double(faceSize),
    "composite":    Double(composite),
  ] }
}

// ─── Scorer ───────────────────────────────────────────────────────────────────
enum FrameQualityScorer {

  // MARK: - Dimension scores

  /// Gaussian score peaking at luma 0.50 (ideal exposure).
  static func brightnessScore(_ luma: Float) -> Float {
    gaussian(luma, mean: 0.50, sigma: CaptureConfig.brightnessSigma)
  }

  /// Sharpness is already normalized [0,1]; soft-clamp and pass through.
  static func sharpnessScore(_ normalized: Float) -> Float {
    max(0, min(1, normalized))
  }

  /// 1.0 = face center at (0.5, 0.5). Falls to 0 at ~0.33 normalized distance.
  static func centerednessScore(cx: Float, cy: Float) -> Float {
    let dist = hypot(cx - 0.5, cy - 0.5)
    return max(0, 1 - dist * 3)
  }

  /// Gaussian score: 1.0 = exact target angles, decays with angular deviation.
  static func poseAccuracyScore(yaw: Float, pitch: Float, targetPose: String) -> Float {
    guard let target = PoseTargets.byId[targetPose] else { return 0 }
    let dyaw   = yaw   - target.yaw
    let dpitch = pitch - target.pitch
    let sigma  = CaptureConfig.poseAccuracySigma
    return exp(-(dyaw * dyaw + dpitch * dpitch) / (2 * sigma * sigma))
  }

  /// Gaussian score peaking at the ideal face-size ratio.
  static func faceSizeScore(_ ratio: Float) -> Float {
    gaussian(ratio, mean: CaptureConfig.idealFaceSizeRatio, sigma: CaptureConfig.faceSizeSigma)
  }

  /// 1.0 = no inter-frame motion. Falls to 0 at ≥10° total angular delta.
  static func stabilityScore(yaw: Float, pitch: Float, prevYaw: Float, prevPitch: Float) -> Float {
    let delta = hypot(yaw - prevYaw, pitch - prevPitch)
    return max(0, 1 - delta / 10)
  }

  // MARK: - Composite builder

  static func score(
    rawBrightness: Float,
    rawSharpness:  Float,
    cx: Float, cy: Float,
    yaw: Float, pitch: Float,
    faceSizeRatio: Float,
    targetPose:    String,
    prevYaw:       Float,
    prevPitch:     Float
  ) -> QualityScores {
    QualityScores(
      brightness:   brightnessScore(rawBrightness),
      sharpness:    sharpnessScore(rawSharpness),
      centeredness: centerednessScore(cx: cx, cy: cy),
      poseAccuracy: poseAccuracyScore(yaw: yaw, pitch: pitch, targetPose: targetPose),
      stability:    stabilityScore(yaw: yaw, pitch: pitch, prevYaw: prevYaw, prevPitch: prevPitch),
      faceSize:     faceSizeScore(faceSizeRatio)
    )
  }

  // MARK: - Hard rejection

  /// Returns false if any hard threshold is violated — frame should be discarded.
  static func passes(
    rawBrightness: Float,
    rawSharpness:  Float,
    centeredness:  Float,
    faceSizeRatio: Float
  ) -> Bool {
    let t = CaptureConfig.thresholds
    return rawBrightness >= t.minBrightness    &&
           rawBrightness <= t.maxBrightness    &&
           rawSharpness  >= t.minSharpness     &&
           centeredness  >= t.minCenteredness  &&
           faceSizeRatio >= t.minFaceSizeRatio &&
           faceSizeRatio <= t.maxFaceSizeRatio
  }

  // MARK: - Pose readiness (native equivalent of JS isReadyForPose)

  static func isReady(
    faceDetected:  Bool,
    yaw: Float, pitch: Float,
    cx: Float, cy: Float,
    faceSizeRatio: Float,
    rawBrightness: Float,
    rawSharpness:  Float,
    targetPose:    String
  ) -> Bool {
    guard faceDetected, let target = PoseTargets.byId[targetPose] else { return false }
    let t = CaptureConfig.thresholds
    let directionalReady: Bool = {
      switch targetPose {
      case "left":
        return yaw <= -t.minYawForSidePose
      case "right":
        return yaw >= t.minYawForSidePose
      case "up":
        return pitch >= t.minPitchForVerticalPose
      case "down":
        return pitch <= -t.minPitchForVerticalPose
      default:
        return abs(yaw) <= t.maxYawDeviation && abs(pitch) <= t.maxPitchDeviation
      }
    }()
    return abs(yaw   - target.yaw)   <= t.maxYawDeviation     &&
           abs(pitch - target.pitch) <= t.maxPitchDeviation   &&
           directionalReady                                   &&
           abs(cx - 0.5)            <= t.maxAlignmentOffsetX  &&
           abs(cy - 0.5)            <= t.maxAlignmentOffsetY  &&
           faceSizeRatio            >= t.readinessMinSize      &&
           faceSizeRatio            <= t.readinessMaxSize
  }

  // MARK: - Helpers

  private static func gaussian(_ x: Float, mean: Float, sigma: Float) -> Float {
    let d = x - mean
    return exp(-(d * d) / (2 * sigma * sigma))
  }
}

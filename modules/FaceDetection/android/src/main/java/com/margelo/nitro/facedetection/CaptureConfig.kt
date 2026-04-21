package com.margelo.nitro.facedetection

object PoseTargets {
  data class Target(val yaw: Float, val pitch: Float)

  val byId: Map<String, Target> = mapOf(
    "center" to Target(0f, 0f),
    "left" to Target(-30f, 0f),
    "right" to Target(30f, 0f),
    "up" to Target(0f, 20f),
    "down" to Target(0f, -20f),
  )
}

data class CaptureWeights(
  val sharpness: Float = 0.30f,
  val poseAccuracy: Float = 0.25f,
  val brightness: Float = 0.20f,
  val centeredness: Float = 0.15f,
  val faceSize: Float = 0.05f,
  val stability: Float = 0.05f,
)

data class CaptureThresholds(
  val minBrightness: Float = 0.20f,
  val maxBrightness: Float = 0.88f,
  val minSharpness: Float = 0.12f,
  val minCenteredness: Float = 0.65f,
  val minFaceSizeRatio: Float = 0.15f,
  val maxFaceSizeRatio: Float = 0.72f,
  val maxYawDeviation: Float = 20f,
  val maxPitchDeviation: Float = 12f,
  val minYawForSidePose: Float = 22f,
  val minPitchForVerticalPose: Float = 16f,
  val maxAlignmentOffsetX: Float = 0.13f,
  val maxAlignmentOffsetY: Float = 0.15f,
  val readinessMinSize: Float = 0.15f,
  val readinessMaxSize: Float = 0.80f,
)

object CaptureConfig {
  var weights: CaptureWeights = CaptureWeights()
  var thresholds: CaptureThresholds = CaptureThresholds()
  // Normalize yaw to user-facing semantics for mirrored front-camera UX.
  // true: positive yaw means user's RIGHT turn.
  var invertYawForFrontCamera: Boolean = true
  var stabilizationWindowMs: Long = 500L
  var jpegQuality: Int = 88
  var sharpnessBaseline: Double = 300.0
  var idealFaceSizeRatio: Float = 0.40f
  var poseAccuracySigma: Float = 12.0f
  var faceSizeSigma: Float = 0.12f
  var brightnessSigma: Float = 0.18f
}

package com.margelo.nitro.facedetection

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sqrt

data class QualityScores(
  val brightness: Float,
  val sharpness: Float,
  val centeredness: Float,
  val poseAccuracy: Float,
  val stability: Float,
  val faceSize: Float,
) {
  val composite: Float
    get() {
      val w = CaptureConfig.weights
      return brightness * w.brightness +
        sharpness * w.sharpness +
        centeredness * w.centeredness +
        poseAccuracy * w.poseAccuracy +
        stability * w.stability +
        faceSize * w.faceSize
    }
}

object FrameQualityScorer {
  private fun gaussian(x: Float, mean: Float, sigma: Float): Float {
    val d = x - mean
    return exp(-(d * d) / (2f * sigma * sigma))
  }

  fun brightnessScore(luma: Float): Float =
    gaussian(luma, 0.50f, CaptureConfig.brightnessSigma)

  fun sharpnessScore(normalized: Float): Float =
    normalized.coerceIn(0f, 1f)

  fun centerednessScore(cx: Float, cy: Float): Float {
    val dist = sqrt((cx - 0.5f).pow(2) + (cy - 0.5f).pow(2))
    return max(0f, 1f - dist * 3f)
  }

  fun poseAccuracyScore(yaw: Float, pitch: Float, targetPose: String): Float {
    val target = PoseTargets.byId[targetPose] ?: return 0f
    val dyaw = yaw - target.yaw
    val dpitch = pitch - target.pitch
    val sigma = CaptureConfig.poseAccuracySigma
    return exp(-(dyaw * dyaw + dpitch * dpitch) / (2f * sigma * sigma))
  }

  fun faceSizeScore(ratio: Float): Float =
    gaussian(ratio, CaptureConfig.idealFaceSizeRatio, CaptureConfig.faceSizeSigma)

  fun stabilityScore(yaw: Float, pitch: Float, prevYaw: Float, prevPitch: Float): Float {
    val delta = sqrt((yaw - prevYaw).pow(2) + (pitch - prevPitch).pow(2))
    return max(0f, 1f - delta / 10f)
  }

  fun score(
    rawBrightness: Float,
    rawSharpness: Float,
    cx: Float,
    cy: Float,
    yaw: Float,
    pitch: Float,
    faceSizeRatio: Float,
    targetPose: String,
    prevYaw: Float,
    prevPitch: Float,
  ) = QualityScores(
    brightness = brightnessScore(rawBrightness),
    sharpness = sharpnessScore(rawSharpness),
    centeredness = centerednessScore(cx, cy),
    poseAccuracy = poseAccuracyScore(yaw, pitch, targetPose),
    stability = stabilityScore(yaw, pitch, prevYaw, prevPitch),
    faceSize = faceSizeScore(faceSizeRatio),
  )

  fun passes(rawBrightness: Float, rawSharpness: Float, centeredness: Float, faceSizeRatio: Float): Boolean {
    val t = CaptureConfig.thresholds
    return rawBrightness >= t.minBrightness &&
      rawBrightness <= t.maxBrightness &&
      centeredness >= t.minCenteredness &&
      faceSizeRatio >= t.minFaceSizeRatio &&
      faceSizeRatio <= t.maxFaceSizeRatio
  }

  fun isReady(
    faceDetected: Boolean,
    yaw: Float,
    pitch: Float,
    cx: Float,
    cy: Float,
    faceSizeRatio: Float,
    rawBrightness: Float,
    rawSharpness: Float,
    targetPose: String,
  ): Boolean {
    if (!faceDetected) return false
    val target = PoseTargets.byId[targetPose] ?: return false
    val t = CaptureConfig.thresholds
    val directionalReady = when (targetPose) {
      "left" -> yaw <= -t.minYawForSidePose
      "right" -> yaw >= t.minYawForSidePose
      "up" -> pitch >= t.minPitchForVerticalPose
      "down" -> pitch <= -t.minPitchForVerticalPose
      else -> abs(yaw) <= t.maxYawDeviation && abs(pitch) <= t.maxPitchDeviation
    }
    return abs(yaw - target.yaw) <= t.maxYawDeviation &&
      abs(pitch - target.pitch) <= t.maxPitchDeviation &&
      directionalReady &&
      abs(cx - 0.5f) <= t.maxAlignmentOffsetX &&
      abs(cy - 0.5f) <= t.maxAlignmentOffsetY &&
      faceSizeRatio >= t.readinessMinSize &&
      faceSizeRatio <= t.readinessMaxSize
  }
}

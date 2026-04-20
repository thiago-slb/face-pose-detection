package com.margelo.nitro.facedetection

import android.content.Context
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import androidx.camera.core.ImageProxy
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

private data class YuvSnapshot(
  val yBytes: ByteArray,
  val yRowStride: Int,
  val yPixelStride: Int,
  val uBytes: ByteArray,
  val vBytes: ByteArray,
  val uvRowStride: Int,
  val uvPixelStride: Int,
  val width: Int,
  val height: Int,
)

private data class BestCandidate(
  val snapshot: YuvSnapshot,
  val scores: QualityScores,
  val poseId: String,
)

data class CapturePayload(
  val poseId: String,
  val uri: String?,
  val qualityScore: Double,
  val scores: QualityScores,
)

class FaceCapturePipeline(private val context: Context) {
  private sealed class WindowState {
    data object Idle : WindowState()
    data class Running(val startedAt: Long, val best: BestCandidate?) : WindowState()
    data object Encoding : WindowState()
  }

  private var state: WindowState = WindowState.Idle
  private var prevYaw = 0f
  private var prevPitch = 0f
  private val lock = Any()

  private val encoder = Executors.newSingleThreadExecutor()

  var onCapture: ((CapturePayload) -> Unit)? = null

  fun processFrame(
    image: ImageProxy?,
    faceDetected: Boolean,
    yaw: Float,
    pitch: Float,
    cx: Float,
    cy: Float,
    faceSizeRatio: Float,
    rawBrightness: Float,
    rawSharpness: Float,
    targetPose: String,
  ): Float {
    synchronized(lock) {
      val ready = FrameQualityScorer.isReady(
        faceDetected,
        yaw,
        pitch,
        cx,
        cy,
        faceSizeRatio,
        rawBrightness,
        rawSharpness,
        targetPose,
      )

      val progress = when (val s = state) {
        WindowState.Idle -> {
          if (ready && image != null) {
            state = WindowState.Running(System.currentTimeMillis(), null)
            tryCollect(image, yaw, pitch, cx, cy, faceSizeRatio, rawBrightness, rawSharpness, targetPose)
          }
          0f
        }

        is WindowState.Running -> {
          if (!ready) {
            state = WindowState.Idle
            return@synchronized 0f
          }
          if (image != null) {
            tryCollect(image, yaw, pitch, cx, cy, faceSizeRatio, rawBrightness, rawSharpness, targetPose)
          }

          val elapsed = System.currentTimeMillis() - s.startedAt
          val localProgress = (elapsed.toFloat() / CaptureConfig.stabilizationWindowMs).coerceIn(0f, 1f)

          if (elapsed >= CaptureConfig.stabilizationWindowMs) {
            val best = (state as? WindowState.Running)?.best
            state = WindowState.Encoding
            deliverAsync(best, targetPose)
          }

          localProgress
        }

        WindowState.Encoding -> 1f
      }

      prevYaw = yaw
      prevPitch = pitch
      return progress
    }
  }

  fun reset() {
    synchronized(lock) {
      state = WindowState.Idle
      prevYaw = 0f
      prevPitch = 0f
    }
  }

  private fun tryCollect(
    image: ImageProxy,
    yaw: Float,
    pitch: Float,
    cx: Float,
    cy: Float,
    faceSizeRatio: Float,
    rawBrightness: Float,
    rawSharpness: Float,
    targetPose: String,
  ) {
    val centeredness = FrameQualityScorer.centerednessScore(cx, cy)
    if (!FrameQualityScorer.passes(rawBrightness, rawSharpness, centeredness, faceSizeRatio)) return

    val scores = FrameQualityScorer.score(
      rawBrightness,
      rawSharpness,
      cx,
      cy,
      yaw,
      pitch,
      faceSizeRatio,
      targetPose,
      prevYaw,
      prevPitch,
    )

    val current = state as? WindowState.Running ?: return
    if (current.best != null && scores.composite <= current.best.scores.composite) return

    val snapshot = snapshotYuv(image) ?: return
    state = WindowState.Running(
      startedAt = current.startedAt,
      best = BestCandidate(snapshot, scores, targetPose),
    )
  }

  private fun snapshotYuv(image: ImageProxy): YuvSnapshot? = runCatching {
    val yPlane = image.planes[0]
    val uPlane = image.planes[1]
    val vPlane = image.planes[2]

    fun copy(buf: java.nio.ByteBuffer): ByteArray {
      val arr = ByteArray(buf.remaining())
      buf.get(arr)
      buf.rewind()
      return arr
    }

    YuvSnapshot(
      yBytes = copy(yPlane.buffer),
      yRowStride = yPlane.rowStride,
      yPixelStride = yPlane.pixelStride,
      uBytes = copy(uPlane.buffer),
      vBytes = copy(vPlane.buffer),
      uvRowStride = uPlane.rowStride,
      uvPixelStride = uPlane.pixelStride,
      width = image.width,
      height = image.height,
    )
  }.getOrNull()

  private fun deliverAsync(best: BestCandidate?, targetPose: String) {
    encoder.submit {
      val payload = if (best == null) {
        CapturePayload(
          poseId = targetPose,
          uri = null,
          qualityScore = 0.0,
          scores = QualityScores(0f, 0f, 0f, 0f, 0f, 0f),
        )
      } else {
        CapturePayload(
          poseId = targetPose,
          uri = encodeToJpeg(best.snapshot),
          qualityScore = best.scores.composite.toDouble(),
          scores = best.scores,
        )
      }

      onCapture?.invoke(payload)
      synchronized(lock) { state = WindowState.Idle }
    }
  }

  private fun encodeToJpeg(snap: YuvSnapshot): String? = runCatching {
    val nv21 = yuvToNv21(snap)
    val yuvImage = YuvImage(nv21, ImageFormat.NV21, snap.width, snap.height, null)
    val out = ByteArrayOutputStream()
    yuvImage.compressToJpeg(Rect(0, 0, snap.width, snap.height), CaptureConfig.jpegQuality, out)
    val file = File(context.cacheDir, "facescan_${UUID.randomUUID()}.jpg")
    file.writeBytes(out.toByteArray())
    file.absolutePath
  }.getOrNull()

  private fun yuvToNv21(snap: YuvSnapshot): ByteArray {
    val frameSize = snap.width * snap.height
    val nv21 = ByteArray(frameSize + frameSize / 2)

    for (row in 0 until snap.height) {
      for (col in 0 until snap.width) {
        nv21[row * snap.width + col] = snap.yBytes[row * snap.yRowStride + col * snap.yPixelStride]
      }
    }

    var uvIdx = frameSize
    for (row in 0 until snap.height / 2) {
      for (col in 0 until snap.width / 2) {
        val planeIdx = row * snap.uvRowStride + col * snap.uvPixelStride
        nv21[uvIdx++] = snap.vBytes[planeIdx]
        nv21[uvIdx++] = snap.uBytes[planeIdx]
      }
    }

    return nv21
  }
}

package com.margelo.nitro.facedetection

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import androidx.camera.core.ImageProxy
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

// Stores compressed JPEG bytes — format-agnostic, safe to retain after callback.
private data class BestCandidate(
  val jpegBytes: ByteArray,
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
  private var notReadyStreak = 0
  private val lock = Any()

  // Allow up to this many consecutive not-ready frames before resetting the window.
  // Handles brief ML Kit detection gaps on profile poses without killing the window.
  private val NOT_READY_GRACE_FRAMES = 6

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
    return synchronized(lock) {
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
            notReadyStreak++
            if (notReadyStreak >= NOT_READY_GRACE_FRAMES) {
              state = WindowState.Idle
              notReadyStreak = 0
              return@synchronized 0f
            }
            // Brief gap — keep the window alive and report current progress
            val elapsed = System.currentTimeMillis() - s.startedAt
            return@synchronized (elapsed.toFloat() / CaptureConfig.stabilizationWindowMs).coerceIn(0f, 1f)
          }
          notReadyStreak = 0

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
      progress
    }
  }

  fun reset() {
    synchronized(lock) {
      state = WindowState.Idle
      prevYaw = 0f
      prevPitch = 0f
      notReadyStreak = 0
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

    val jpegBytes = snapshotFrame(image) ?: return
    state = WindowState.Running(
      startedAt = current.startedAt,
      best = BestCandidate(jpegBytes, scores, targetPose),
    )
  }

  // Compress the frame to JPEG bytes synchronously while ImageProxy is still valid.
  // Returns null only on an unrecoverable error — the caller skips this candidate.
  private fun snapshotFrame(image: ImageProxy): ByteArray? = runCatching {
    val out = ByteArrayOutputStream()
    if (image.format == ImageFormat.YUV_420_888) {
      // Fast path: copy YUV planes, convert to NV21, compress with YuvImage.
      val nv21 = yuvToNv21(image)
      YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
        .compressToJpeg(Rect(0, 0, image.width, image.height), CaptureConfig.jpegQuality, out)
    } else {
      // Fallback: any other format (RGBA_8888, PRIVATE, etc.) — convert via Bitmap.
      val bmp = image.toBitmap()
      bmp.compress(Bitmap.CompressFormat.JPEG, CaptureConfig.jpegQuality, out)
      bmp.recycle()
    }
    out.toByteArray()
  }.getOrNull()

  private fun deliverAsync(best: BestCandidate?, targetPose: String) {
    encoder.submit {
      val uri = best?.let { writeJpeg(it.jpegBytes) }
      val payload = CapturePayload(
        poseId       = targetPose,
        uri          = uri,
        qualityScore = best?.scores?.composite?.toDouble() ?: 0.0,
        scores       = best?.scores ?: QualityScores(0f, 0f, 0f, 0f, 0f, 0f),
      )
      onCapture?.invoke(payload)
      synchronized(lock) { state = WindowState.Idle }
    }
  }

  private fun writeJpeg(bytes: ByteArray): String? = runCatching {
    val file = File(context.cacheDir, "facescan_${UUID.randomUUID()}.jpg")
    file.writeBytes(bytes)
    file.absolutePath
  }.getOrNull()

  private fun yuvToNv21(image: ImageProxy): ByteArray {
    val yPlane = image.planes[0]
    val uPlane = image.planes[1]
    val vPlane = image.planes[2]
    val w = image.width; val h = image.height
    val frameSize = w * h
    val nv21 = ByteArray(frameSize + frameSize / 2)

    val yBuf = yPlane.buffer; val yRowStride = yPlane.rowStride; val yPixStride = yPlane.pixelStride
    for (row in 0 until h) {
      for (col in 0 until w) {
        nv21[row * w + col] = yBuf.get(row * yRowStride + col * yPixStride)
      }
    }

    val vBuf = vPlane.buffer; val uBuf = uPlane.buffer
    val uvRowStride = vPlane.rowStride; val uvPixStride = vPlane.pixelStride
    var uvIdx = frameSize
    for (row in 0 until h / 2) {
      for (col in 0 until w / 2) {
        val pi = row * uvRowStride + col * uvPixStride
        nv21[uvIdx++] = vBuf.get(pi)  // NV21 = V before U
        nv21[uvIdx++] = uBuf.get(pi)
      }
    }
    return nv21
  }
}

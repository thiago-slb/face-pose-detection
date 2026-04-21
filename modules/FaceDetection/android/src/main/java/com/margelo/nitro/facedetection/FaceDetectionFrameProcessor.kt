package com.margelo.nitro.facedetection

import android.graphics.Rect
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.margelo.nitro.NitroModules
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.public.NativeFrame
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

class FaceDetectionFrameProcessor : HybridFaceDetectionFrameProcessorSpec() {
  private data class DetectionSnapshot(
    val bbX: Double,
    val bbY: Double,
    val bbW: Double,
    val bbH: Double,
    val cx: Float,
    val cy: Float,
    val faceSizeRatio: Float,
    val yaw: Float,
    val pitch: Float,
    val roll: Double,
    val brightness: Double,
    val sharpness: Double,
  )

  private val detector = FaceDetection.getClient(
    FaceDetectorOptions.Builder()
      .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
      .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
      .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
      .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
      .enableTracking()
      .setMinFaceSize(0.10f)
      .build(),
  )

  private val appContext = NitroModules.applicationContext?.applicationContext
    ?: throw IllegalStateException("NitroModules.applicationContext is null; FaceDetection cannot initialize.")
  private val pipeline = FaceCapturePipeline(appContext)
  private val detectorExecutor = Executors.newSingleThreadExecutor()
  private val latestDetection = AtomicReference<DetectionSnapshot?>(null)
  private val detectionInFlight = AtomicBoolean(false)
  private val lastDetectionStartedAtMs = AtomicLong(0L)
  private val minDetectionIntervalMs = 50L

  private val pendingCapture = AtomicReference<CapturePayload?>(null)
  private val lastTargetPose = AtomicReference<String?>(null)

  init {
    pipeline.onCapture = { payload -> pendingCapture.set(payload) }
  }

  override fun processFrame(
    frame: HybridFrameSpec,
    args: FaceDetectionArgs,
  ): Variant_NullType_GuidanceResult_CaptureResult {
    val targetPose = args.targetPose
    val previousPose = lastTargetPose.getAndSet(targetPose)
    if (previousPose != null && previousPose != targetPose) {
      // Pose step changed (e.g. center -> left). Drop any stale capture from the
      // previous step and restart stabilization for the new target.
      pendingCapture.set(null)
      pipeline.reset()
    }

    pendingCapture.getAndSet(null)?.let { payload ->
      // Drop stale captures from a previous pose step.
      if (payload.poseId == targetPose) {
        return Variant_NullType_GuidanceResult_CaptureResult.create(
          CaptureResult(
            type = NativeResultType.CAPTURED,
            poseId = payload.poseId,
            uri = payload.uri,
            qualityScore = payload.qualityScore,
            scores = CaptureScores(
              brightness = payload.scores.brightness.toDouble(),
              sharpness = payload.scores.sharpness.toDouble(),
              centeredness = payload.scores.centeredness.toDouble(),
              poseAccuracy = payload.scores.poseAccuracy.toDouble(),
              stability = payload.scores.stability.toDouble(),
              faceSize = payload.scores.faceSize.toDouble(),
              composite = payload.scores.composite.toDouble(),
            ),
          ),
        )
      }
    }

    val imageProxy = (frame as? NativeFrame)?.image
    if (imageProxy != null) {
      scheduleAsyncDetectionIfNeeded(imageProxy)
    }

    val snapshot = latestDetection.get() ?: return noFaceResult(targetPose)
    val progress = pipeline.processFrame(
      image = imageProxy,
      faceDetected = true,
      yaw = snapshot.yaw,
      pitch = snapshot.pitch,
      cx = snapshot.cx,
      cy = snapshot.cy,
      faceSizeRatio = snapshot.faceSizeRatio,
      rawBrightness = snapshot.brightness.toFloat(),
      rawSharpness = snapshot.sharpness.toFloat(),
      targetPose = targetPose,
    )

    return Variant_NullType_GuidanceResult_CaptureResult.create(
      GuidanceResult(
        type = NativeResultType.GUIDANCE,
        faceDetected = true,
        boundingBoxX = snapshot.bbX,
        boundingBoxY = snapshot.bbY,
        boundingBoxWidth = snapshot.bbW,
        boundingBoxHeight = snapshot.bbH,
        yaw = snapshot.yaw.toDouble(),
        pitch = snapshot.pitch.toDouble(),
        roll = snapshot.roll,
        brightness = snapshot.brightness,
        sharpness = snapshot.sharpness,
        faceSizeRatio = snapshot.faceSizeRatio.toDouble(),
        faceCenterX = snapshot.cx.toDouble(),
        faceCenterY = snapshot.cy.toDouble(),
        stabilizationProgress = progress.toDouble(),
      ),
    )
  }

  private fun scheduleAsyncDetectionIfNeeded(imageProxy: ImageProxy) {
    if (detectionInFlight.get()) return

    val now = System.currentTimeMillis()
    val lastStarted = lastDetectionStartedAtMs.get()
    if (now - lastStarted < minDetectionIntervalMs) return
    if (!lastDetectionStartedAtMs.compareAndSet(lastStarted, now)) return

    val bitmap = runCatching { imageProxy.toBitmap() }.getOrNull() ?: return
    val rotation = imageProxy.imageInfo.rotationDegrees
    val frameW = imageProxy.width.toFloat()
    val frameH = imageProxy.height.toFloat()
    val inputImage = InputImage.fromBitmap(bitmap, rotation)

    detectionInFlight.set(true)
    detector
      .process(inputImage)
      .addOnSuccessListener(detectorExecutor) { faces ->
        val snapshot = buildSnapshot(
          face = faces.firstOrNull(),
          frameW = frameW,
          frameH = frameH,
          rotation = rotation,
          bitmap = bitmap,
        )
        latestDetection.set(snapshot)
        bitmap.recycle()
        detectionInFlight.set(false)
      }
      .addOnFailureListener(detectorExecutor) {
        latestDetection.set(null)
        bitmap.recycle()
        detectionInFlight.set(false)
      }
  }

  private fun buildSnapshot(
    face: Face?,
    frameW: Float,
    frameH: Float,
    rotation: Int,
    bitmap: android.graphics.Bitmap,
  ): DetectionSnapshot? {
    face ?: return null
    val rect = face.boundingBox
    val (normW, normH) = if (rotation == 90 || rotation == 270) {
      frameH.toDouble() to frameW.toDouble()
    } else {
      frameW.toDouble() to frameH.toDouble()
    }
    val bbX = (rect.left.toDouble() / normW).coerceIn(0.0, 1.0)
    val bbY = (rect.top.toDouble() / normH).coerceIn(0.0, 1.0)
    val bbW = (rect.width().toDouble() / normW).coerceIn(0.0, 1.0)
    val bbH = (rect.height().toDouble() / normH).coerceIn(0.0, 1.0)
    val cx = (rect.exactCenterX().toDouble() / normW).coerceIn(0.0, 1.0).toFloat()
    val cy = (rect.exactCenterY().toDouble() / normH).coerceIn(0.0, 1.0).toFloat()
    val faceSizeRatio = bbH.toFloat()

    val rawYaw = face.headEulerAngleY
    val yaw = if (CaptureConfig.invertYawForFrontCamera) -rawYaw else rawYaw
    val pitch = face.headEulerAngleX
    val roll = face.headEulerAngleZ.toDouble()
    val (brightness, sharpness) = qualityMetricsFromBitmap(bitmap, rect)

    return DetectionSnapshot(
      bbX = bbX,
      bbY = bbY,
      bbW = bbW,
      bbH = bbH,
      cx = cx,
      cy = cy,
      faceSizeRatio = faceSizeRatio,
      yaw = yaw,
      pitch = pitch,
      roll = roll,
      brightness = brightness,
      sharpness = sharpness,
    )
  }

  private fun qualityMetricsFromBitmap(bitmap: android.graphics.Bitmap, rect: Rect): Pair<Double, Double> {
    val x0 = max(1, rect.left.coerceAtLeast(0))
    val y0 = max(1, rect.top.coerceAtLeast(0))
    val x1 = min(bitmap.width - 2, rect.right.coerceAtMost(bitmap.width))
    val y1 = min(bitmap.height - 2, rect.bottom.coerceAtMost(bitmap.height))
    if (x1 <= x0 || y1 <= y0) return 0.5 to 0.0

    fun lumaAt(x: Int, y: Int): Int {
      val color = bitmap.getPixel(x, y)
      val r = (color shr 16) and 0xFF
      val g = (color shr 8) and 0xFF
      val b = color and 0xFF
      return (r * 299 + g * 587 + b * 114) / 1000
    }

    var sum = 0L
    var n = 0
    val brightnessStride = 8
    var py = y0
    while (py <= y1) {
      var px = x0
      while (px <= x1) {
        sum += lumaAt(px, py)
        n++
        px += brightnessStride
      }
      py += brightnessStride
    }
    val brightness = if (n > 0) sum.toDouble() / n / 255.0 else 0.5

    val laps = ArrayList<Double>()
    val lapStride = 16
    py = y0
    while (py <= y1) {
      var px = x0
      while (px <= x1) {
        laps.add(
          -4.0 * lumaAt(px, py) +
            lumaAt(px - 1, py) +
            lumaAt(px + 1, py) +
            lumaAt(px, py - 1) +
            lumaAt(px, py + 1),
        )
        px += lapStride
      }
      py += lapStride
    }
    val sharpness = if (laps.size > 1) {
      val mean = laps.average()
      (laps.map { (it - mean).pow(2) }.average() / CaptureConfig.sharpnessBaseline).coerceIn(0.0, 1.0)
    } else {
      0.0
    }

    return brightness to sharpness
  }

  private fun noFaceResult(targetPose: String = "center"): Variant_NullType_GuidanceResult_CaptureResult {
    pipeline.processFrame(null, false, 0f, 0f, 0.5f, 0.5f, 0f, 0.5f, 0f, targetPose)
    return Variant_NullType_GuidanceResult_CaptureResult.create(
      GuidanceResult(
        type = NativeResultType.GUIDANCE,
        faceDetected = false,
        boundingBoxX = null,
        boundingBoxY = null,
        boundingBoxWidth = null,
        boundingBoxHeight = null,
        yaw = null,
        pitch = null,
        roll = null,
        brightness = null,
        sharpness = null,
        faceSizeRatio = null,
        faceCenterX = null,
        faceCenterY = null,
        stabilizationProgress = 0.0,
      ),
    )
  }
}

package com.margelo.nitro.facedetection

import android.graphics.ImageFormat
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.margelo.nitro.NitroModules
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.public.NativeFrame
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

class FaceDetectionFrameProcessor : HybridFaceDetectionFrameProcessorSpec() {
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

    val imageProxy = (frame as? NativeFrame)?.image ?: return noFaceResult(targetPose)
    val frameW = imageProxy.width.toFloat()
    val frameH = imageProxy.height.toFloat()

    // ML Kit's fromMediaImage only accepts YUV_420_888 or JPEG.
    // For RGBA_8888 or any other format produced by HybridFrameOutput, fall back
    // to fromBitmap so detection always works regardless of camera output format.
    val mediaImage = imageProxy.image
    val inputImage = try {
      if (mediaImage != null && imageProxy.format == ImageFormat.YUV_420_888) {
        InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
      } else {
        InputImage.fromBitmap(imageProxy.toBitmap(), imageProxy.imageInfo.rotationDegrees)
      }
    } catch (_: Exception) {
      return noFaceResult(targetPose)
    }
    val faces: List<Face> = try {
      com.google.android.gms.tasks.Tasks.await(
        detector.process(inputImage),
        300,
        java.util.concurrent.TimeUnit.MILLISECONDS,
      )
    } catch (_: Exception) {
      return noFaceResult(targetPose)
    }

    val face = faces.firstOrNull() ?: return noFaceResult(targetPose)

    val rect = face.boundingBox
    val rotation = imageProxy.imageInfo.rotationDegrees
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
    // Normalize pitch to user-facing semantics: positive = UP, negative = DOWN.
    // ML Kit's headEulerAngleX already follows this convention on Android.
    val pitch = face.headEulerAngleX
    val roll = face.headEulerAngleZ.toDouble()

    val (rawBrightness, rawSharpness) = qualityMetrics(
      imageProxy,
      frameW.toInt(),
      frameH.toInt(),
      bbX,
      bbY,
      bbW,
      bbH,
    )

    val progress = pipeline.processFrame(
      image = imageProxy,
      faceDetected = true,
      yaw = yaw,
      pitch = pitch,
      cx = cx,
      cy = cy,
      faceSizeRatio = faceSizeRatio,
      rawBrightness = rawBrightness.toFloat(),
      rawSharpness = rawSharpness.toFloat(),
      targetPose = targetPose,
    )

    return Variant_NullType_GuidanceResult_CaptureResult.create(
      GuidanceResult(
        type = NativeResultType.GUIDANCE,
        faceDetected = true,
        boundingBoxX = bbX,
        boundingBoxY = bbY,
        boundingBoxWidth = bbW,
        boundingBoxHeight = bbH,
        yaw = yaw.toDouble(),
        pitch = pitch.toDouble(),
        roll = roll,
        brightness = rawBrightness,
        sharpness = rawSharpness,
        faceSizeRatio = faceSizeRatio.toDouble(),
        faceCenterX = cx.toDouble(),
        faceCenterY = cy.toDouble(),
        stabilizationProgress = progress.toDouble(),
      ),
    )
  }

  private fun qualityMetrics(
    image: ImageProxy,
    frameW: Int,
    frameH: Int,
    bbX: Double,
    bbY: Double,
    bbW: Double,
    bbH: Double,
  ): Pair<Double, Double> {
    // Y-plane analysis requires YUV_420_888 and rotation=0/180.
    // For rotated frames (portrait phones: rotation=90/270) the bounding box is in
    // display-space but Y-plane indices are in sensor-space — axes are transposed,
    // so we'd read from the wrong region. Return neutral values instead.
    if (image.format != ImageFormat.YUV_420_888) return 0.5 to 0.5
    val rotation = image.imageInfo.rotationDegrees
    if (rotation == 90 || rotation == 270) return 0.5 to 0.5
    val yPlane = image.planes[0]
    val yBuf = yPlane.buffer
    val rowStride = yPlane.rowStride
    val pixStride = yPlane.pixelStride

    val x0 = max(1, (bbX * frameW).toInt())
    val y0 = max(1, (bbY * frameH).toInt())
    val x1 = min(frameW - 2, ((bbX + bbW) * frameW).toInt())
    val y1 = min(frameH - 2, ((bbY + bbH) * frameH).toInt())
    if (x1 <= x0 || y1 <= y0) return 0.5 to 0.0

    fun luma(x: Int, y: Int) = yBuf.get(y * rowStride + x * pixStride).toInt() and 0xFF

    var sum = 0L
    var n = 0
    val brightnessStride = 8
    var py = y0
    while (py <= y1) {
      var px = x0
      while (px <= x1) {
        sum += luma(px, py)
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
        laps.add((-4.0 * luma(px, py) + luma(px - 1, py) + luma(px + 1, py) + luma(px, py - 1) + luma(px, py + 1)))
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

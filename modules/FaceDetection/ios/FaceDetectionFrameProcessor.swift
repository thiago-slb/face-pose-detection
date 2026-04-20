import CoreMedia
import NitroModules
import Vision
import VisionCamera

class FaceDetectionFrameProcessor: HybridFaceDetectionFrameProcessorSpec {
  private lazy var request: VNDetectFaceLandmarksRequest = {
    let r = VNDetectFaceLandmarksRequest()
    r.revision = VNDetectFaceLandmarksRequestRevision3
    return r
  }()
  private lazy var handler = VNSequenceRequestHandler()

  private let pipeline = FaceCapturePipeline()

  private var pendingCapture: [String: Any]? = nil
  private let pendingLock = NSLock()
  private var lastTargetPose: String? = nil

  override init() {
    super.init()
    pipeline.onCapture = { [weak self] result in
      self?.pendingLock.lock()
      self?.pendingCapture = result
      self?.pendingLock.unlock()
    }
  }

  func processFrame(frame: any HybridFrameSpec, args: FaceDetectionArgs) throws -> Variant_NullType_GuidanceResult_CaptureResult {
    let targetPose = args.targetPose
    if let previousPose = lastTargetPose, previousPose != targetPose {
      // Pose step changed (e.g. center -> left). Drop stale pending captures and
      // restart the native stabilization window for the new target.
      pipeline.reset()
      pendingLock.lock()
      pendingCapture = nil
      pendingLock.unlock()
    }
    lastTargetPose = targetPose

    pendingLock.lock()
    if let pending = pendingCapture {
      pendingCapture = nil
      pendingLock.unlock()
      // Drop stale captures from a previous pose step.
      let pendingPose = pending["poseId"] as? String
      if pendingPose == targetPose {
        return .third(captureResult(from: pending))
      }
    } else {
      pendingLock.unlock()
    }

    guard let nativeFrame = frame as? NativeFrame,
          let sampleBuffer = nativeFrame.sampleBuffer
    else {
      return noFaceResult()
    }

    do {
      try handler.perform([request], on: sampleBuffer, orientation: .leftMirrored)
    } catch {
      return noFaceResult(sampleBuffer: sampleBuffer, targetPose: targetPose)
    }

    guard let obs = request.results?.first as? VNFaceObservation else {
      return noFaceResult(sampleBuffer: sampleBuffer, targetPose: targetPose)
    }

    let bb = obs.boundingBox
    let bbX = Double(bb.minX)
    let bbY = Double(1.0 - bb.maxY)
    let bbW = Double(bb.width)
    let bbH = Double(bb.height)
    let cx = Float(bbX + bbW / 2.0)
    let cy = Float(bbY + bbH / 2.0)
    let faceSizeRatio = Float(bbH)

    let yaw = Float(obs.yaw.map { -$0.doubleValue * 180.0 / .pi } ?? 0.0)
    let pitch = Float(obs.pitch.map { $0.doubleValue * 180.0 / .pi } ?? 0.0)
    let roll = obs.roll.map { $0.doubleValue * 180.0 / .pi } ?? 0.0

    let faceRect = CGRect(x: bbX, y: bbY, width: bbW, height: bbH)
    let (rawBrightness, rawSharpness) = qualityMetrics(buffer: sampleBuffer, faceRect: faceRect)

    let progress = pipeline.processFrame(
      sampleBuffer: sampleBuffer,
      faceDetected: true,
      yaw: yaw,
      pitch: pitch,
      cx: cx,
      cy: cy,
      faceSizeRatio: faceSizeRatio,
      rawBrightness: Float(rawBrightness),
      rawSharpness: Float(rawSharpness),
      targetPose: targetPose
    )

    let guidance = GuidanceResult(
      type: .guidance,
      faceDetected: true,
      boundingBoxX: bbX,
      boundingBoxY: bbY,
      boundingBoxWidth: bbW,
      boundingBoxHeight: bbH,
      yaw: Double(yaw),
      pitch: Double(pitch),
      roll: roll,
      brightness: rawBrightness,
      sharpness: rawSharpness,
      faceSizeRatio: Double(faceSizeRatio),
      faceCenterX: Double(cx),
      faceCenterY: Double(cy),
      stabilizationProgress: Double(progress)
    )
    return .second(guidance)
  }

  private func captureResult(from payload: [String: Any]) -> CaptureResult {
    let poseId = payload["poseId"] as? String ?? "center"
    let uri = payload["uri"] as? String
    let qualityScore = payload["qualityScore"] as? Double ?? 0.0

    let rawScores = payload["scores"] as? [String: Any] ?? [:]
    let scores = CaptureScores(
      brightness: rawScores["brightness"] as? Double ?? 0.0,
      sharpness: rawScores["sharpness"] as? Double ?? 0.0,
      centeredness: rawScores["centeredness"] as? Double ?? 0.0,
      poseAccuracy: rawScores["poseAccuracy"] as? Double ?? 0.0,
      stability: rawScores["stability"] as? Double ?? 0.0,
      faceSize: rawScores["faceSize"] as? Double ?? 0.0,
      composite: rawScores["composite"] as? Double ?? qualityScore
    )

    return CaptureResult(
      type: .captured,
      poseId: poseId,
      uri: uri,
      qualityScore: qualityScore,
      scores: scores
    )
  }

  private func noFaceResult(sampleBuffer: CMSampleBuffer? = nil, targetPose: String = "center") -> Variant_NullType_GuidanceResult_CaptureResult {
    if let sampleBuffer {
      _ = pipeline.processFrame(
        sampleBuffer: sampleBuffer,
        faceDetected: false,
        yaw: 0,
        pitch: 0,
        cx: 0.5,
        cy: 0.5,
        faceSizeRatio: 0,
        rawBrightness: 0.5,
        rawSharpness: 0,
        targetPose: targetPose
      )
    }

    let guidance = GuidanceResult(
      type: .guidance,
      faceDetected: false,
      boundingBoxX: nil,
      boundingBoxY: nil,
      boundingBoxWidth: nil,
      boundingBoxHeight: nil,
      yaw: nil,
      pitch: nil,
      roll: nil,
      brightness: nil,
      sharpness: nil,
      faceSizeRatio: nil,
      faceCenterX: nil,
      faceCenterY: nil,
      stabilizationProgress: 0.0
    )
    return .second(guidance)
  }

  private func qualityMetrics(buffer: CMSampleBuffer, faceRect: CGRect) -> (brightness: Double, sharpness: Double) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(buffer) else {
      return (0.5, 0.0)
    }
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    guard CVPixelBufferGetPlaneCount(pixelBuffer) >= 1,
          let yBase = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0)
    else {
      return (0.5, 0.0)
    }

    let yPtr = yBase.assumingMemoryBound(to: UInt8.self)
    let bpr = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
    let planeW = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0)
    let planeH = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0)

    let x0 = max(1, Int(faceRect.minX * Double(planeW)))
    let y0 = max(1, Int(faceRect.minY * Double(planeH)))
    let x1 = min(planeW - 2, Int(faceRect.maxX * Double(planeW)))
    let y1 = min(planeH - 2, Int(faceRect.maxY * Double(planeH)))
    guard x1 > x0, y1 > y0 else { return (0.5, 0.0) }

    var lumaSum = 0
    var lumaCount = 0
    let brightnessStride = 8
    var py = y0
    while py <= y1 {
      var px = x0
      while px <= x1 {
        lumaSum += Int(yPtr[py * bpr + px])
        lumaCount += 1
        px += brightnessStride
      }
      py += brightnessStride
    }
    let brightness = lumaCount > 0 ? Double(lumaSum) / Double(lumaCount) / 255.0 : 0.5

    var lapValues = [Double]()
    let lapStride = 16
    py = y0
    while py <= y1 {
      var px = x0
      while px <= x1 {
        let c = Int(yPtr[py * bpr + px])
        let lap = Double(
          -4 * c +
            Int(yPtr[py * bpr + px - 1]) +
            Int(yPtr[py * bpr + px + 1]) +
            Int(yPtr[(py - 1) * bpr + px]) +
            Int(yPtr[(py + 1) * bpr + px])
        )
        lapValues.append(lap)
        px += lapStride
      }
      py += lapStride
    }

    var sharpness = 0.0
    if lapValues.count > 1 {
      let mean = lapValues.reduce(0, +) / Double(lapValues.count)
      let variance = lapValues.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Double(lapValues.count)
      sharpness = min(variance / CaptureConfig.sharpnessBaseline, 1.0)
    }

    return (brightness, sharpness)
  }
}

// FaceCapturePipeline.swift
// Stateful native best-frame capture pipeline.
//
// State machine:
//   idle ──► running(startedAt, best?) ──► encoding ──► idle
//
// Memory model: at most ONE best-frame CMSampleBuffer is retained at any time.
// When a new frame beats the current best, the old buffer is released and the
// new one is stored via CMSampleBufferCreateCopy (CF-ownership, pool-safe).
// JPEG encoding happens on a background queue; the result is delivered via
// onCapture closure and placed in the plugin's pendingCapture slot.

import Foundation
import CoreMedia
import CoreImage
import UIKit

// ─── Best-frame record ────────────────────────────────────────────────────────
private struct BestCandidate {
  let buffer: CMSampleBuffer   // retained copy — ownership is ours
  let scores: QualityScores
  let poseId: String
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────
final class FaceCapturePipeline {

  // MARK: - State
  private enum WindowState {
    case idle
    case running(startedAt: CFAbsoluteTime, best: BestCandidate?)
    case encoding
  }

  private var windowState: WindowState = .idle
  private var prevYaw:   Float = 0
  private var prevPitch: Float = 0
  private var notReadyStreak = 0
  private let NOT_READY_GRACE_FRAMES = 6
  private let lock = NSLock()
  private let encodeQueue = DispatchQueue(label: "com.pocfacescan.encode", qos: .userInitiated)
  private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

  /// Called on `encodeQueue` when a frame has been selected and saved.
  /// Payload: { type, poseId, uri?, qualityScore, scores }
  var onCapture: (([String: Any]) -> Void)?

  // MARK: - Per-frame entry point

  /// Call once per processed camera frame (on the frame-processor thread).
  /// Returns the stabilization progress [0, 1] to embed in the guidance dict.
  func processFrame(
    sampleBuffer:  CMSampleBuffer,
    faceDetected:  Bool,
    yaw:           Float,
    pitch:         Float,
    cx:            Float,
    cy:            Float,
    faceSizeRatio: Float,
    rawBrightness: Float,
    rawSharpness:  Float,
    targetPose:    String
  ) -> Float {
    lock.lock()
    defer {
      prevYaw   = yaw
      prevPitch = pitch
      lock.unlock()
    }

    let ready = FrameQualityScorer.isReady(
      faceDetected:  faceDetected,
      yaw: yaw, pitch: pitch,
      cx: cx, cy: cy,
      faceSizeRatio: faceSizeRatio,
      rawBrightness: rawBrightness,
      rawSharpness:  rawSharpness,
      targetPose:    targetPose
    )

    switch windowState {

    case .idle:
      guard ready else { return 0 }
      windowState = .running(startedAt: CFAbsoluteTimeGetCurrent(), best: nil)
      tryCollect(sampleBuffer: sampleBuffer,
                 yaw: yaw, pitch: pitch, cx: cx, cy: cy,
                 faceSizeRatio: faceSizeRatio,
                 rawBrightness: rawBrightness, rawSharpness: rawSharpness,
                 targetPose: targetPose)
      return 0

    case .running(let startedAt, _):
      if !ready {
        notReadyStreak += 1
        if notReadyStreak >= NOT_READY_GRACE_FRAMES {
          windowState = .idle
          notReadyStreak = 0
          return 0
        }
        // Brief gap — keep the window alive and report current progress
        let windowSec = Double(CaptureConfig.stabilizationWindowMs) / 1000.0
        let elapsed = CFAbsoluteTimeGetCurrent() - startedAt
        return Float(min(elapsed / windowSec, 1.0))
      }
      notReadyStreak = 0

      tryCollect(sampleBuffer: sampleBuffer,
                 yaw: yaw, pitch: pitch, cx: cx, cy: cy,
                 faceSizeRatio: faceSizeRatio,
                 rawBrightness: rawBrightness, rawSharpness: rawSharpness,
                 targetPose: targetPose)

      let windowSec = Double(CaptureConfig.stabilizationWindowMs) / 1000.0
      let elapsed   = CFAbsoluteTimeGetCurrent() - startedAt
      let progress  = Float(min(elapsed / windowSec, 1.0))

      if elapsed >= windowSec {
        guard case .running(_, let best) = windowState else { return 1 }
        windowState = .encoding
        deliverAsync(best: best, targetPose: targetPose)
      }
      return progress

    case .encoding:
      return 1   // hold at 100% while JPEG write is in flight
    }
  }

  func reset() {
    lock.lock()
    windowState = .idle
    prevYaw = 0; prevPitch = 0
    notReadyStreak = 0
    lock.unlock()
  }

  // MARK: - Candidate evaluation (called under lock)

  private func tryCollect(
    sampleBuffer:  CMSampleBuffer,
    yaw: Float, pitch: Float,
    cx: Float, cy: Float,
    faceSizeRatio: Float,
    rawBrightness: Float,
    rawSharpness:  Float,
    targetPose:    String
  ) {
    let centeredness = FrameQualityScorer.centerednessScore(cx: cx, cy: cy)

    guard FrameQualityScorer.passes(
      rawBrightness: rawBrightness,
      rawSharpness:  rawSharpness,
      centeredness:  centeredness,
      faceSizeRatio: faceSizeRatio
    ) else { return }

    let scores = FrameQualityScorer.score(
      rawBrightness: rawBrightness,
      rawSharpness:  rawSharpness,
      cx: cx, cy: cy,
      yaw: yaw, pitch: pitch,
      faceSizeRatio: faceSizeRatio,
      targetPose:    targetPose,
      prevYaw:       prevYaw,
      prevPitch:     prevPitch
    )

    guard case .running(let startedAt, let current) = windowState else { return }

    // Keep only the highest-scoring frame in memory
    if let cur = current, scores.composite <= cur.scores.composite { return }

    // CMSampleBufferCreateCopy gives us CF ownership independent of the buffer pool
    var copy: CMSampleBuffer?
    CMSampleBufferCreateCopy(allocator: nil, sampleBuffer: sampleBuffer, sampleBufferOut: &copy)
    guard let retained = copy else { return }

    windowState = .running(
      startedAt: startedAt,
      best: BestCandidate(buffer: retained, scores: scores, poseId: targetPose)
    )
  }

  // MARK: - Async JPEG encoding

  private func deliverAsync(best: BestCandidate?, targetPose: String) {
    encodeQueue.async { [weak self] in
      guard let self else { return }

      var result: [String: Any] = [
        "type":         "captured",
        "poseId":       targetPose,
        "qualityScore": best.map { Double($0.scores.composite) } ?? 0.0,
        "scores":       best?.scores.toDictionary() ?? [:],
      ]

      if let best, let uri = self.encodeJPEG(buffer: best.buffer) {
        result["uri"] = uri
      }

      self.onCapture?(result)

      self.lock.lock()
      self.windowState = .idle
      self.lock.unlock()
    }
  }

  private func encodeJPEG(buffer: CMSampleBuffer) -> String? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(buffer) else { return nil }
    // Use GPU-backed CIContext to avoid software rendering overhead
    let ci  = CIImage(cvPixelBuffer: pixelBuffer)
    guard let cg  = ciContext.createCGImage(ci, from: ci.extent) else { return nil }
    let img = UIImage(cgImage: cg)
    guard let data = img.jpegData(compressionQuality: CaptureConfig.jpegQuality) else { return nil }
    let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("facescan_\(UUID().uuidString).jpg")
    do {
      try data.write(to: url, options: .atomic)
      return url.path
    } catch { return nil }
  }
}

import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CameraRef } from "react-native-vision-camera";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from "react-native-vision-camera";
import { C, POSES } from "../../constants/faceScanConfig";
import type { FaceScanState } from "../../types/faceScan";
import { DistanceHint } from "./DistanceHint";
import { FaceGuideOverlay } from "./FaceGuideOverlay";
import { PoseInstruction } from "./PoseInstruction";
import { QualityHint } from "./QualityHint";
import { StabilizationIndicator } from "./StabilizationIndicator";

// ─── Permission gate ─────────────────────────────────────────────────────────
function PermissionGate({ onGranted }: { onGranted: () => void }) {
  const { hasPermission, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (hasPermission) onGranted();
  }, [hasPermission, onGranted]);

  if (hasPermission) return null;

  return (
    <View style={styles.permWrap}>
      <Text style={styles.permTitle}>Camera access required</Text>
      <Text style={styles.permSub}>
        We need access to your front camera to perform the face scan.
      </Text>
      <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
        <Text style={styles.permBtnText}>Allow camera</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Capture flash ───────────────────────────────────────────────────────────
function CaptureFlash({ poseStatus }: { poseStatus: string }) {
  const flashAnim = useRef(new Animated.Value(0)).current;
  const prevStatus = useRef(poseStatus);

  useEffect(() => {
    if (poseStatus === "captured" && prevStatus.current !== "captured") {
      flashAnim.setValue(0.85);
      Animated.timing(flashAnim, {
        toValue: 0,
        duration: 420,
        useNativeDriver: true,
      }).start();
    }
    prevStatus.current = poseStatus;
  }, [poseStatus, flashAnim]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: "#fff", opacity: flashAnim },
      ]}
    />
  );
}

// ─── Top bar ─────────────────────────────────────────────────────────────────
function TopBar({
  onCancel,
  currentIndex,
}: {
  onCancel: () => void;
  currentIndex: number;
}) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity
        onPress={onCancel}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.cancelBtn}>Cancel</Text>
      </TouchableOpacity>
      <Text style={styles.topTitle}>
        {POSES[currentIndex]?.label ?? ""} scan
      </Text>
      <View style={{ width: 56 }} />
    </View>
  );
}

// ─── Alignment banner ────────────────────────────────────────────────────────
function AlignmentBanner({ alignmentStatus }: { alignmentStatus: string }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const visible =
      alignmentStatus === "offCenter" || alignmentStatus === "partiallyOutside";
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [alignmentStatus, opacity]);

  const label =
    alignmentStatus === "partiallyOutside"
      ? "Keep your face inside the frame"
      : "Center your face";

  return (
    <Animated.View style={[styles.alignBanner, { opacity }]}>
      <Text style={styles.alignBannerText}>{label}</Text>
    </Animated.View>
  );
}

function DebugBadge({ ok }: { ok: boolean }) {
  return (
    <View
      style={[
        styles.debugBadge,
        ok ? styles.debugBadgeOk : styles.debugBadgeBad,
      ]}
    >
      <Text style={styles.debugBadgeText}>{ok ? "OK" : "NO"}</Text>
    </View>
  );
}

function DebugGateRow({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value?: string;
}) {
  return (
    <View style={styles.debugGateRow}>
      <DebugBadge ok={ok} />
      <Text style={styles.debugText}>
        {value == null ? label : `${label}: ${value}`}
      </Text>
    </View>
  );
}

// ─── Main props ───────────────────────────────────────────────────────────────
interface Props {
  state: FaceScanState;
  debugReadout: {
    cx: number | null;
    cy: number | null;
    yaw: number | null;
    pitch: number | null;
    roll: number | null;
    brightness: number | null;
    sharpness: number | null;
    faceSizeRatio: number | null;
    detectedPose: string;
    stabilizationProgress: number;
    alignmentStatus: string;
    faceDetected: boolean;
    lastGuidanceAtMs: number | null;
    targetPose: string;
    lastNativeCapturePoseId: string | null;
    lastNativeCaptureAtMs: number | null;
    acceptedCapturePoseId: string | null;
    acceptedCaptureAtMs: number | null;
    completedPoseIds: string[];
    poseStatus: string;
    stabilizingForMs: number | null;
    msSinceLastProgress: number | null;
    lastCaptureEvent: {
      poseId: string | null;
      hasUri: boolean | null;
      atMs: number | null;
      outcome:
        | "none"
        | "missing_uri"
        | "pose_mismatch"
        | "stale_previous_pose"
        | "duplicate_for_current_pose"
        | "accepted";
    };
    validation: {
      poseMatch: boolean;
      faceDetected: boolean;
      distanceGood: boolean;
      alignmentCentered: boolean;
      qualityGood: boolean;
      yawWithinWindow: boolean;
      pitchWithinWindow: boolean;
      directionalReady: boolean;
      centerednessReady: boolean;
      alignmentXReady: boolean;
      alignmentYReady: boolean;
      faceSizeReady: boolean;
      brightnessReady: boolean;
      sharpnessReady: boolean;
      centerednessScore: number | null;
      guidanceReady: boolean;
    };
  };
  stabilizationAnim: Animated.Value;
  cameraRef: React.RefObject<CameraRef | null>;
  frameOutput: ReturnType<
    typeof import("react-native-vision-camera").useFrameOutput
  >;
  isNativeLinked: boolean;
  onCancel: () => void;
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export function FaceScanCameraScreen({
  state,
  debugReadout,
  stabilizationAnim,
  cameraRef,
  frameOutput,
  isNativeLinked,
  onCancel,
}: Props) {
  const insets = useSafeAreaInsets();
  const device = useCameraDevice("front");
  const pose = POSES[state.currentPoseIndex];
  const { hasPermission } = useCameraPermission();

  if (!hasPermission) {
    return <PermissionGate onGranted={() => {}} />;
  }

  if (!device) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.permTitle}>No front camera found</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── Real camera feed ── */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        outputs={[frameOutput]}
        // Keep the front camera preview mirrored (selfie feel)
        mirrorMode="on"
      />

      {!isNativeLinked && (
        <View style={styles.devBanner}>
          <Text style={styles.devBannerText}>
            {"⚠️ Native plugin not linked"}
          </Text>
        </View>
      )}

      {/* ── Face guide overlay (drawn on top of camera) ── */}
      <FaceGuideOverlay
        pose={pose.id}
        poseStatus={state.poseStatus}
        alignmentStatus={state.alignmentStatus}
      />

      {/* ── Capture flash ── */}
      <CaptureFlash poseStatus={state.poseStatus} />

      {/* ── Top overlay ── */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}>
        <TopBar onCancel={onCancel} currentIndex={state.currentPoseIndex} />
      </View>

      {/* ── Debug readout (dev builds only) ── */}
      {__DEV__ && (
        <View style={[styles.debugPanel, { top: insets.top + 56 }]}>
          <Text style={styles.debugText}>
            {`faceDetected: ${debugReadout.faceDetected ? "yes" : "no"}`}
          </Text>
          <Text style={styles.debugText}>
            {`targetPose: ${debugReadout.targetPose}`}
          </Text>
          <Text style={styles.debugText}>
            {`detectedPose: ${debugReadout.detectedPose}`}
          </Text>
          <Text style={styles.debugText}>
            {`cx: ${debugReadout.cx == null ? "n/a" : debugReadout.cx.toFixed(3)}`}
          </Text>
          <Text style={styles.debugText}>
            {`cy: ${debugReadout.cy == null ? "n/a" : debugReadout.cy.toFixed(3)}`}
          </Text>
          <Text style={styles.debugText}>
            {`yaw/pitch: ${
              debugReadout.yaw == null || debugReadout.pitch == null
                ? "n/a"
                : `${debugReadout.yaw.toFixed(1)} / ${debugReadout.pitch.toFixed(1)}`
            }`}
          </Text>
          <Text style={styles.debugText}>
            {`alignment: ${debugReadout.alignmentStatus}`}
          </Text>
          <Text style={styles.debugText}>
            {`status/progress: ${debugReadout.poseStatus} / ${debugReadout.stabilizationProgress.toFixed(2)}`}
          </Text>
          <Text style={styles.debugText}>
            {`stabilizingFor(ms): ${debugReadout.stabilizingForMs ?? "-"}`}
          </Text>
          <Text style={styles.debugText}>
            {`sinceProgress(ms): ${debugReadout.msSinceLastProgress ?? "-"}`}
          </Text>
          <Text style={styles.debugText}>
            {`nativeCapture: ${debugReadout.lastNativeCapturePoseId ?? "-"}`}
          </Text>
          <Text style={styles.debugText}>
            {`acceptedCapture: ${debugReadout.acceptedCapturePoseId ?? "-"}`}
          </Text>
          <Text style={styles.debugText}>
            {`lastCaptureEvent: ${debugReadout.lastCaptureEvent.outcome} (${debugReadout.lastCaptureEvent.poseId ?? "-"})`}
          </Text>
          <Text style={styles.debugText}>
            {`completed: ${debugReadout.completedPoseIds.join(", ") || "-"}`}
          </Text>

          <View style={styles.debugDivider} />
          <DebugGateRow
            label="poseMatch"
            ok={debugReadout.validation.poseMatch}
            value={`${debugReadout.detectedPose} -> ${debugReadout.targetPose}`}
          />
          <DebugGateRow
            label="guidanceReady"
            ok={debugReadout.validation.guidanceReady}
          />
          <DebugGateRow
            label="faceDetected"
            ok={debugReadout.validation.faceDetected}
          />
          <DebugGateRow
            label="distanceGood"
            ok={debugReadout.validation.distanceGood}
          />
          <DebugGateRow
            label="alignmentCentered"
            ok={debugReadout.validation.alignmentCentered}
          />
          <DebugGateRow
            label="qualityGood"
            ok={debugReadout.validation.qualityGood}
          />
          <DebugGateRow
            label="directionalReady"
            ok={debugReadout.validation.directionalReady}
          />
          <DebugGateRow
            label="centeredness"
            ok={debugReadout.validation.centerednessReady}
            value={
              debugReadout.validation.centerednessScore == null
                ? "n/a"
                : debugReadout.validation.centerednessScore.toFixed(3)
            }
          />
          <DebugGateRow
            label="yawWindow"
            ok={debugReadout.validation.yawWithinWindow}
            value={debugReadout.yaw == null ? "n/a" : debugReadout.yaw.toFixed(1)}
          />
          <DebugGateRow
            label="pitchWindow"
            ok={debugReadout.validation.pitchWithinWindow}
            value={
              debugReadout.pitch == null ? "n/a" : debugReadout.pitch.toFixed(1)
            }
          />
          <DebugGateRow
            label="alignX"
            ok={debugReadout.validation.alignmentXReady}
            value={debugReadout.cx == null ? "n/a" : debugReadout.cx.toFixed(3)}
          />
          <DebugGateRow
            label="alignY"
            ok={debugReadout.validation.alignmentYReady}
            value={debugReadout.cy == null ? "n/a" : debugReadout.cy.toFixed(3)}
          />
          <DebugGateRow
            label="faceSize"
            ok={debugReadout.validation.faceSizeReady}
            value={
              debugReadout.faceSizeRatio == null
                ? "n/a"
                : debugReadout.faceSizeRatio.toFixed(3)
            }
          />
          <DebugGateRow
            label="brightness"
            ok={debugReadout.validation.brightnessReady}
            value={
              debugReadout.brightness == null
                ? "n/a"
                : debugReadout.brightness.toFixed(3)
            }
          />
          <DebugGateRow
            label="sharpness"
            ok={debugReadout.validation.sharpnessReady}
            value={
              debugReadout.sharpness == null
                ? "n/a"
                : debugReadout.sharpness.toFixed(3)
            }
          />
        </View>
      )}

      {/* ── Alignment banner ── */}
      <AlignmentBanner alignmentStatus={state.alignmentStatus} />

      {/* ── Bottom panel ── */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 16 }]}>
        <PoseInstruction state={state} />

        <View style={styles.hints}>
          <DistanceHint distanceStatus={state.distanceStatus} />
          <QualityHint qualityStatus={state.qualityStatus} />
        </View>

        <StabilizationIndicator
          poseStatus={state.poseStatus}
          stabilizationAnim={stabilizationAnim}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bg,
  },

  // Permission screen
  permWrap: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  permTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: C.textPrimary,
    textAlign: "center",
  },
  permSub: {
    fontSize: 15,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  permBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 8,
  },
  permBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },

  // Dev warning banner
  devBanner: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    backgroundColor: "rgba(245,158,11,0.9)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    zIndex: 99,
  },
  devBannerText: { fontSize: 11, color: "#fff", fontWeight: "600" },

  // Temporary debug panel
  debugPanel: {
    position: "absolute",
    left: 12,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  debugText: {
    color: "#D1D5DB",
    fontSize: 11,
    fontFamily: "monospace",
  },
  debugDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.15)",
    marginVertical: 6,
  },
  debugGateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  debugBadge: {
    borderRadius: 8,
    minWidth: 26,
    paddingHorizontal: 5,
    paddingVertical: 1,
    alignItems: "center",
  },
  debugBadgeOk: {
    backgroundColor: "rgba(34,197,94,0.9)",
  },
  debugBadgeBad: {
    backgroundColor: "rgba(239,68,68,0.9)",
  },
  debugBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  // Top overlay
  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    gap: 10,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  cancelBtn: {
    fontSize: 15,
    color: C.textSecondary,
    fontWeight: "500",
    width: 56,
  },
  topTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
    textTransform: "capitalize",
    letterSpacing: 0.1,
  },

  // Alignment banner
  alignBanner: {
    position: "absolute",
    top: "46%",
    alignSelf: "center",
    backgroundColor: C.warning,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  alignBannerText: { fontSize: 13, fontWeight: "600", color: "#fff" },

  // Bottom panel
  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(7,10,18,0.88)",
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 4,
  },
  hints: { gap: 4, minHeight: 48, justifyContent: "center" },
  divider: { height: 1, backgroundColor: C.border, marginHorizontal: 24 },
});

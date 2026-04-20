import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { C, POSES } from "../../constants/faceScanConfig";
import type { FaceScanState } from "../../types/faceScan";

function deriveInstruction(state: FaceScanState): {
  primary: string;
  sub: string | null;
} {
  const pose = POSES[state.currentPoseIndex];

  if (state.poseStatus === "captured") {
    return { primary: "Got it", sub: null };
  }

  if (state.poseStatus === "stabilizing") {
    return { primary: "Hold still…", sub: "Selecting best frame" };
  }

  if (state.alignmentStatus === "offCenter") {
    return { primary: "Center your face", sub: pose.instruction };
  }

  if (state.alignmentStatus === "partiallyOutside") {
    return { primary: "Move closer to the center", sub: null };
  }

  if (state.distanceStatus !== "good") {
    // DistanceHint handles the specific message; we still set the pose context here
    return { primary: pose.instruction, sub: null };
  }

  if (state.poseStatus === "detecting") {
    return { primary: pose.instruction, sub: "Align your face in the frame" };
  }

  return { primary: pose.instruction, sub: null };
}

interface Props {
  state: FaceScanState;
}

export function PoseInstruction({ state }: Props) {
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [display, setDisplay] = useState(() => deriveInstruction(state));

  const isCaptured = state.poseStatus === "captured";

  useEffect(() => {
    const next = deriveInstruction(state);

    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 130,
      useNativeDriver: true,
    }).start(() => {
      setDisplay(next);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  }, [
    state.poseStatus,
    state.alignmentStatus,
    state.distanceStatus,
    state.currentPoseIndex,
    fadeAnim,
  ]);

  const primaryColor = isCaptured
    ? C.captured
    : state.poseStatus === "stabilizing"
      ? C.success
      : C.textPrimary;

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Text style={[styles.primary, { color: primaryColor }]}>
        {display.primary}
      </Text>
      {display.sub ? <Text style={styles.sub}>{display.sub}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    gap: 4,
    justifyContent: "center",
  },
  primary: {
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  sub: {
    fontSize: 14,
    color: C.textSecondary,
    fontWeight: "400",
  },
});

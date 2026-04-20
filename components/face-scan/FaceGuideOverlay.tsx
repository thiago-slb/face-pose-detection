import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { AlignmentStatus, PoseId, PoseStatus } from '../../types/faceScan';
import { C } from '../../constants/faceScanConfig';

const OVAL_W = 236;
const OVAL_H = 312;

const POSE_ARROW: Record<PoseId, string> = {
  center: '',
  left:   '←',
  right:  '→',
  up:     '↑',
  down:   '↓',
};

function ovalBorderColor(poseStatus: PoseStatus, alignmentStatus: AlignmentStatus): string {
  if (alignmentStatus !== 'centered') return C.warning;
  switch (poseStatus) {
    case 'stabilizing': return C.ovalStable;
    case 'captured':    return C.ovalCaptured;
    case 'detecting':   return C.ovalDetecting;
    default:            return C.ovalIdle;
  }
}

interface Props {
  pose: PoseId;
  poseStatus: PoseStatus;
  alignmentStatus: AlignmentStatus;
}

export function FaceGuideOverlay({ pose, poseStatus, alignmentStatus }: Props) {
  const pulse    = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const arrowOpacity = useRef(new Animated.Value(0)).current;

  // Subtle breathing pulse when detecting
  useEffect(() => {
    if (poseStatus === 'detecting') {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.025, duration: 900, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.975, duration: 900, useNativeDriver: true }),
        ])
      );
      pulse.setValue(1);
      anim.start();
      return () => { anim.stop(); pulse.setValue(1); };
    } else {
      pulse.setValue(1);
    }
  }, [poseStatus, pulse]);

  // Glow behind oval when stabilizing/captured
  useEffect(() => {
    const toValue = (poseStatus === 'stabilizing' || poseStatus === 'captured') ? 1 : 0;
    Animated.timing(glowOpacity, { toValue, duration: 300, useNativeDriver: true }).start();
  }, [poseStatus, glowOpacity]);

  // Arrow fade
  useEffect(() => {
    const toValue = pose !== 'center' ? 1 : 0;
    Animated.timing(arrowOpacity, { toValue, duration: 250, useNativeDriver: true }).start();
  }, [pose, arrowOpacity]);

  const borderColor = ovalBorderColor(poseStatus, alignmentStatus);
  const glowColor   =
    poseStatus === 'captured'    ? C.successGlow :
    poseStatus === 'stabilizing' ? C.successGlow :
    C.primaryGlow;

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Subtle dark vignette */}
      <View style={styles.vignette} />

      {/* Glow behind oval */}
      <Animated.View
        style={[
          styles.glow,
          { backgroundColor: glowColor, opacity: glowOpacity },
        ]}
      />

      {/* Oval guide */}
      <Animated.View
        style={[
          styles.oval,
          { borderColor, transform: [{ scale: pulse }] },
        ]}
      >
        {/* Corner brackets for biometric feel */}
        <View style={[styles.corner, styles.tl]} />
        <View style={[styles.corner, styles.tr]} />
        <View style={[styles.corner, styles.bl]} />
        <View style={[styles.corner, styles.br]} />

        {/* Pose direction arrow */}
        <Animated.Text style={[styles.arrow, { color: borderColor, opacity: arrowOpacity }]}>
          {POSE_ARROW[pose]}
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

const CORNER_SIZE = 18;
const CORNER_THICKNESS = 2;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7,10,18,0.42)',
  },
  glow: {
    position: 'absolute',
    width: OVAL_W + 60,
    height: OVAL_H + 60,
    borderRadius: (OVAL_W + 60) / 2,
    alignSelf: 'center',
  },
  oval: {
    width: OVAL_W,
    height: OVAL_H,
    borderRadius: OVAL_W / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  // corner bracket marks at the edges of the oval bounding box
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  tl: { top: 22, left: 22, borderTopWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  tr: { top: 22, right: 22, borderTopWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
  bl: { bottom: 22, left: 22, borderBottomWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  br: { bottom: 22, right: 22, borderBottomWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
  arrow: {
    fontSize: 28,
    fontWeight: '200',
  },
});

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CapturedFrame } from '../../types/faceScan';
import { CapturedFramesGrid } from './CapturedFramesGrid';
import { C } from '../../constants/faceScanConfig';

interface Props {
  capturedFrames: (CapturedFrame | null)[];
  onContinue: () => void;
  onRetake: () => void;
}

export function FaceScanSuccessScreen({ capturedFrames, onContinue, onRetake }: Props) {
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const slideAnim  = useRef(new Animated.Value(20)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const checkAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(checkScale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 6 }),
        Animated.timing(checkAnim,  { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 380, useNativeDriver: true }),
      ]),
    ]).start();
  }, [fadeAnim, slideAnim, checkScale, checkAnim]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Title row: checkmark on left, text inline */}
        <Animated.View style={[styles.titleRow, { opacity: checkAnim }]}>
          <Animated.View style={[styles.checkCircle, { transform: [{ scale: checkScale }] }]}>
            <Text style={styles.checkMark}>✓</Text>
          </Animated.View>
          <Animated.Text style={[styles.title, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            Scan complete
          </Animated.Text>
        </Animated.View>

        {/* Captured frames grid — no label */}
        <Animated.View style={[styles.framesSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <CapturedFramesGrid capturedFrames={capturedFrames} />
        </Animated.View>

        {/* Actions */}
        <Animated.View style={[styles.actions, { opacity: fadeAnim }]}>
          <TouchableOpacity style={styles.btnPrimary} onPress={onContinue} activeOpacity={0.85}>
            <Text style={styles.btnPrimaryText}>Continue</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.btnSecondary} onPress={onRetake} activeOpacity={0.75}>
            <Text style={styles.btnSecondaryText}>Retake scan</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 48,
    gap: 32,
  },

  // Inline title row
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  checkCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.success,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkMark: {
    fontSize: 20,
    color: '#fff',
    fontWeight: '700',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: -0.4,
    flexShrink: 1,
  },

  // Frames
  framesSection: {
    gap: 0,
  },

  // Actions
  actions: { gap: 12 },
  btnPrimary: {
    backgroundColor: C.success,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },
  btnSecondary: {
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  btnSecondaryText: {
    fontSize: 15,
    fontWeight: '500',
    color: C.textSecondary,
  },
});

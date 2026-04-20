import React, { useEffect, useRef } from 'react';
import {
  Animated,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C } from '../../constants/faceScanConfig';

const TIPS = [
  { icon: '☀️', text: 'Find a well-lit area' },
  { icon: '👓', text: 'Remove glasses if possible' },
  { icon: '😐', text: 'Keep a neutral expression' },
  { icon: '📱', text: 'Hold the phone at eye level' },
];

interface Props {
  onStart: () => void;
}

export function FaceScanIntroScreen({ onStart }: Props) {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const ovalPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 520, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 520, useNativeDriver: true }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(ovalPulse, { toValue: 1.04, duration: 1800, useNativeDriver: true }),
        Animated.timing(ovalPulse, { toValue: 0.96, duration: 1800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [fadeAnim, slideAnim, ovalPulse]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* Hero oval */}
          <View style={styles.heroWrap}>
            <Animated.View style={[styles.heroOval, { transform: [{ scale: ovalPulse }] }]}>
              <View style={styles.heroOvalInner}>
                {/* Silhouette suggestion */}
                <View style={styles.heroHead} />
                <View style={styles.heroShoulder} />
              </View>
              {/* Scanning line hint */}
              <View style={styles.scanLine} />
            </Animated.View>
            <View style={styles.scanBadge}>
              <Text style={styles.scanBadgeText}>BIOMETRIC</Text>
            </View>
          </View>

          {/* Title */}
          <Text style={styles.title}>Face Scan</Text>
          <Text style={styles.subtitle}>
            We'll guide you through 5 short poses to verify your identity. The scan takes about
            30 seconds.
          </Text>

          {/* Tips */}
          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>For best results</Text>
            {TIPS.map(tip => (
              <View key={tip.text} style={styles.tipRow}>
                <Text style={styles.tipIcon}>{tip.icon}</Text>
                <Text style={styles.tipText}>{tip.text}</Text>
              </View>
            ))}
          </View>

          {/* CTA */}
          <TouchableOpacity style={styles.btn} onPress={onStart} activeOpacity={0.85}>
            <Text style={styles.btnText}>Start Scan</Text>
          </TouchableOpacity>

          <Text style={styles.footer}>
            Your biometric data is processed locally and never stored.
          </Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 24,
  },

  // Hero
  heroWrap: {
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  heroOval: {
    width: 140,
    height: 186,
    borderRadius: 70,
    borderWidth: 1.5,
    borderColor: C.primary,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroOvalInner: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    width: '100%',
    height: '100%',
  },
  heroHead: {
    position: 'absolute',
    top: 28,
    width: 52,
    height: 60,
    borderRadius: 26,
    backgroundColor: C.surfaceHigh,
  },
  heroShoulder: {
    position: 'absolute',
    bottom: -10,
    width: 110,
    height: 60,
    borderRadius: 55,
    backgroundColor: C.surfaceHigh,
  },
  scanLine: {
    position: 'absolute',
    top: '45%',
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: C.primary,
    opacity: 0.35,
  },
  scanBadge: {
    backgroundColor: C.surfaceHigh,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  scanBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textSecondary,
    letterSpacing: 1.5,
  },

  // Text
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: C.textSecondary,
    lineHeight: 22,
    marginTop: -10,
  },

  // Tips card
  tipsCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  tipsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tipIcon: {
    fontSize: 18,
    width: 28,
    textAlign: 'center',
  },
  tipText: {
    fontSize: 15,
    color: C.textPrimary,
    fontWeight: '400',
  },

  // CTA
  btn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },

  footer: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});

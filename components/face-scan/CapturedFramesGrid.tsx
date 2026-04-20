import React from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import type { CapturedFrame } from '../../types/faceScan';
import { C, POSES } from '../../constants/faceScanConfig';

interface FrameCardProps {
  frame: CapturedFrame | null;
  label: string;
}

function FrameCard({ frame, label }: FrameCardProps) {
  const uri = frame?.uri
    ? (frame.uri.startsWith('file://') ? frame.uri : `file://${frame.uri}`)
    : null;

  return (
    <View style={styles.card}>
      {uri ? (
        <View style={styles.preview}>
          <Image source={{ uri }} style={styles.previewImage} contentFit="cover" />
          <Text style={styles.checkmark}>✓</Text>
        </View>
      ) : (
        <View style={[styles.preview, styles.previewEmpty]}>
          <Text style={styles.emptyLabel}>No image</Text>
        </View>
      )}
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

interface Props {
  capturedFrames: (CapturedFrame | null)[];
}

export function CapturedFramesGrid({ capturedFrames }: Props) {
  const topRow    = POSES.slice(0, 3);
  const bottomRow = POSES.slice(3);

  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        {topRow.map((pose, i) => (
          <FrameCard key={pose.id} frame={capturedFrames[i]} label={pose.label} />
        ))}
      </View>
      <View style={[styles.row, styles.rowCentered]}>
        {bottomRow.map((pose, i) => (
          <FrameCard key={pose.id} frame={capturedFrames[3 + i]} label={pose.label} />
        ))}
      </View>
    </View>
  );
}

const CARD_SIZE = 96;

const styles = StyleSheet.create({
  grid: {
    gap: 10,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-start',
  },
  rowCentered: {
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    gap: 6,
  },
  preview: {
    width: CARD_SIZE,
    height: CARD_SIZE * 1.3,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  checkmark: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '700',
    zIndex: 1,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  previewEmpty: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyLabel: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  cardLabel: {
    fontSize: 11,
    color: C.textSecondary,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});

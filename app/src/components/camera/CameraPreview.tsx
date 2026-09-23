import { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/theme/tokens';
import { AppText } from '../ui/AppText';

/** Photo preview. While analyzing, dims the photo and sweeps a scan line. */
export function CameraPreview({ uri, analyzing }: { uri: string; analyzing?: boolean }) {
  const sweep = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    if (!analyzing) return;
    sweep.setValue(0);
    const anim = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [analyzing, sweep]);

  return (
    <View style={styles.frame}>
      <Image source={{ uri }} style={styles.image} resizeMode="cover" accessibilityLabel="Machinery photo" />
      {analyzing ? (
        <View style={styles.overlay} accessibilityLiveRegion="polite" accessibilityLabel="Analyzing image">
          <Animated.View
            style={[
              styles.scan,
              { transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, 260] }) }] },
            ]}
          />
          <View style={styles.badge}>
            <AppText variant="label" tone="brand" caps style={{ letterSpacing: 3 }}>
              Analyzing image…
            </AppText>
          </View>
        </View>
      ) : null}
      {/* Corner marks, like a viewfinder */}
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <View key={c} style={[styles.corner, styles[c]]} />
      ))}
    </View>
  );
}

const C = 18;
const styles = StyleSheet.create({
  frame: {
    height: 280,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.inset,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scan: { position: 'absolute', top: 10, left: 0, right: 0, height: 2, backgroundColor: colors.brand, opacity: 0.8 },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderWidth: 1,
    borderColor: colors.brandBorder,
  },
  corner: { position: 'absolute', width: C, height: C, borderColor: colors.brand },
  tl: { top: spacing.sm, left: spacing.sm, borderTopWidth: 2, borderLeftWidth: 2 },
  tr: { top: spacing.sm, right: spacing.sm, borderTopWidth: 2, borderRightWidth: 2 },
  bl: { bottom: spacing.sm, left: spacing.sm, borderBottomWidth: 2, borderLeftWidth: 2 },
  br: { bottom: spacing.sm, right: spacing.sm, borderBottomWidth: 2, borderRightWidth: 2 },
});

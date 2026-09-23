import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, radius } from '@/theme/tokens';

/** Thin progress track that animates when the value changes. */
export function ProgressBar({
  value,
  color = colors.brand,
  height = 6,
  label,
}: {
  /** 0..1 */
  value: number;
  color?: string;
  height?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const anim = useState(() => new Animated.Value(clamped))[0];

  useEffect(() => {
    Animated.timing(anim, { toValue: clamped, duration: 500, useNativeDriver: false }).start();
  }, [anim, clamped]);

  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2 }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <Animated.View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: color,
          width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: colors.raised, overflow: 'hidden', borderRadius: radius.round },
});

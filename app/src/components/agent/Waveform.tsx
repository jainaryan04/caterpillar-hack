import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { voiceService } from '@/services';
import { colors } from '@/theme/tokens';

export type WaveformMode = 'idle' | 'listening' | 'thinking' | 'responding';

const BAR_COUNT = 31;
const FLOOR = 0.06;

/** Centre-weighted envelope so the waveform tapers at the edges. */
const envelope = Array.from({ length: BAR_COUNT }, (_, i) => {
  const x = (i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
  return 0.25 + 0.75 * Math.exp(-2.2 * x * x);
});

const modeColor: Record<WaveformMode, string> = {
  idle: colors.borderStrong,
  listening: colors.brand,
  thinking: colors.textMuted,
  responding: colors.text,
};

/**
 * Audio waveform for the Jarvis overlay.
 * - listening: driven by `voiceService.onAmplitude` (mock levels for now)
 * - thinking: a slow pulse travelling across flat bars
 * - responding: synthetic speech pattern while the answer is read out
 */
export function Waveform({ mode, height = 72 }: { mode: WaveformMode; height?: number }) {
  const bars = useMemo(() => Array.from({ length: BAR_COUNT }, () => new Animated.Value(FLOOR)), []);
  const tick = useRef(0);

  useEffect(() => {
    const animateTo = (targets: number[], duration: number) =>
      Animated.parallel(
        bars.map((b, i) =>
          Animated.timing(b, {
            toValue: Math.max(FLOOR, Math.min(1, targets[i])),
            duration,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ),
      ).start();

    if (mode === 'idle') {
      animateTo(bars.map(() => FLOOR), 250);
      return;
    }

    if (mode === 'listening') {
      return voiceService.onAmplitude((level) => {
        animateTo(
          envelope.map((e) => level * e * (0.55 + Math.random() * 0.45)),
          90,
        );
      });
    }

    const interval = setInterval(() => {
      tick.current += 1;
      const t = tick.current;
      if (mode === 'thinking') {
        const pos = (t % (BAR_COUNT + 10)) - 5;
        animateTo(
          envelope.map((_, i) => 0.08 + 0.22 * Math.exp(-((i - pos) ** 2) / 6)),
          120,
        );
      } else {
        const loud = 0.45 + 0.35 * Math.abs(Math.sin(t * 0.45));
        animateTo(
          envelope.map((e, i) => loud * e * (0.6 + 0.4 * Math.abs(Math.sin(t * 0.9 + i * 0.5)))),
          110,
        );
      }
    }, 110);
    return () => clearInterval(interval);
  }, [bars, mode]);

  const color = modeColor[mode];
  return (
    <View style={[styles.row, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[styles.bar, { height, backgroundColor: color, transform: [{ scaleY: b }] }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  bar: { width: 4, borderRadius: 2 },
});

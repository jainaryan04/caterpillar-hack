import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { VoicePhase } from '@/types/agent';
import { colors } from '@/theme/tokens';
import { Icon, type IconName } from '../ui/Icon';

const phaseIcon: Record<VoicePhase, IconName> = {
  idle: 'microphone-outline',
  listening: 'microphone',
  thinking: 'dots-horizontal',
  responding: 'volume-high',
  done: 'check',
  error: 'alert',
};

/**
 * The Cat assistant orb. Each phase looks different so the state reads at a glance:
 * listening = solid yellow core with rings pulsing out,
 * thinking = dark core with a rotating yellow arc,
 * responding = light core, slow breathing,
 * idle = small, quiet outline.
 */
export function CatOrb({ phase, size = 120 }: { phase: VoicePhase; size?: number }) {
  const ring = useState(() => new Animated.Value(0))[0];
  const spin = useState(() => new Animated.Value(0))[0];
  const breathe = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    ring.setValue(0);
    spin.setValue(0);
    breathe.setValue(0);
    let anim: Animated.CompositeAnimation | null = null;
    if (phase === 'listening' || phase === 'idle') {
      anim = Animated.loop(
        Animated.timing(ring, {
          toValue: 1,
          duration: phase === 'listening' ? 1400 : 2600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      );
    } else if (phase === 'thinking') {
      anim = Animated.loop(
        Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
      );
    } else if (phase === 'responding') {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breathe, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
    }
    anim?.start();
    return () => anim?.stop();
  }, [phase, ring, spin, breathe]);

  const core = size * 0.62;
  const coreStyle = {
    idle: { backgroundColor: colors.raised, borderColor: colors.borderStrong },
    listening: { backgroundColor: colors.brand, borderColor: colors.brand },
    thinking: { backgroundColor: colors.panel, borderColor: colors.borderStrong },
    responding: { backgroundColor: colors.text, borderColor: colors.text },
    done: { backgroundColor: colors.raised, borderColor: colors.success },
    error: { backgroundColor: colors.warningSubtle, borderColor: colors.warning },
  }[phase];
  const iconColor = {
    idle: colors.textSecondary,
    listening: colors.onBrand,
    thinking: colors.brand,
    responding: colors.onBrand,
    done: colors.success,
    error: colors.warning,
  }[phase];

  const ringStyle = (delay: number) => ({
    opacity: ring.interpolate({
      inputRange: [0, delay, 1],
      outputRange: [0, phase === 'idle' ? 0.35 : 0.6, 0],
    }),
    transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.62, phase === 'idle' ? 0.9 : 1] }) }],
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {(phase === 'listening' || phase === 'idle') && (
        <>
          <Animated.View style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }, ringStyle(0.15)]} />
          {phase === 'listening' && (
            <Animated.View
              style={[
                styles.ring,
                { width: size * 0.82, height: size * 0.82, borderRadius: size },
                ringStyle(0.4),
              ]}
            />
          )}
        </>
      )}
      {phase === 'thinking' && (
        <Animated.View
          style={[
            styles.arc,
            {
              width: core + 18,
              height: core + 18,
              borderRadius: core,
              transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
            },
          ]}
        />
      )}
      <Animated.View
        style={[
          styles.core,
          coreStyle,
          { width: core, height: core, borderRadius: core / 2 },
          phase === 'responding' && {
            transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
          },
        ]}
      >
        <Icon name={phaseIcon[phase]} size={core * 0.42} color={iconColor} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', borderWidth: 2, borderColor: colors.brand },
  arc: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: 'transparent',
    borderTopColor: colors.brand,
    borderRightColor: colors.brand,
  },
  core: { alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
});

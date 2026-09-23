import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useAgent } from '@/state/AgentProvider';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatTimeOfDay } from '@/utils/format';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';

/**
 * Reflects SOS state reported by the backend. The Supervisor dashboard owns
 * the incident; this only tells the operator that help is coming.
 */
export function SosBanner() {
  const { sos, dismissSos } = useAgent();
  const pulse = useState(() => new Animated.Value(1))[0];
  const sent = sos?.state === 'sent';

  useEffect(() => {
    if (!sent) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [sent, pulse]);

  if (!sos) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <View style={styles.head}>
        {sent ? <Animated.View style={[styles.dot, { opacity: pulse }]} /> : <Icon name="check-circle" size={18} color={colors.text} />}
        <AppText variant="label" caps style={styles.title}>
          {sent ? 'Emergency alert sent' : 'Help is on the way'}
        </AppText>
        <AppText variant="mono" style={styles.meta}>
          {sos.incidentId} · {formatTimeOfDay(sos.sentAt)}
        </AppText>
      </View>
      <AppText variant="bodyStrong">
        {sent
          ? 'Your supervisor has been notified.'
          : `${sos.supervisorName} acknowledged${sos.note ? ` · ${sos.note}` : ''}`}
      </AppText>
      <AppText variant="small" style={{ color: '#FECACA' }}>
        Stay where you are if it is safe. Keep your radio on.
      </AppText>
      {!sent ? (
        <Pressable accessibilityRole="button" onPress={dismissSos} style={styles.dismiss} hitSlop={8}>
          <AppText variant="small" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
            Hide
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#3A0E0E',
    borderColor: colors.danger,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  title: { flex: 1, color: colors.text },
  meta: { fontSize: 12, color: '#FECACA' },
  dismiss: { alignSelf: 'flex-end', minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm },
});

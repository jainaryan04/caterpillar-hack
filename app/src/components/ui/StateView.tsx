import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/theme/tokens';
import { ActionButton } from './ActionButton';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

type Kind = 'loading' | 'empty' | 'error' | 'offline';

const defaults: Record<Kind, { icon: IconName; color: string }> = {
  loading: { icon: 'loading', color: colors.textSecondary },
  empty: { icon: 'tray-remove', color: colors.textSecondary },
  error: { icon: 'alert-octagon-outline', color: colors.warning },
  offline: { icon: 'wifi-off', color: colors.warning },
};

/** Full-area placeholder for loading, empty, error and offline states. */
export function StateView({
  kind,
  title,
  message,
  onRetry,
  compact,
}: {
  kind: Kind;
  title: string;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const d = defaults[kind];
  return (
    <View
      style={[styles.wrap, compact && styles.compact]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={message ? `${title}. ${message}` : title}
    >
      {kind === 'loading' ? (
        <ActivityIndicator color={colors.brand} size="large" />
      ) : (
        <Icon name={d.icon} size={36} color={d.color} />
      )}
      <AppText variant="bodyStrong" style={styles.center}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="small" tone="secondary" style={styles.center}>
          {message}
        </AppText>
      ) : null}
      {onRetry ? (
        <ActionButton label="Try again" icon="refresh" variant="secondary" size="md" onPress={onRetry} style={styles.retry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  compact: { flex: 0, paddingVertical: spacing.xxl },
  center: { textAlign: 'center', maxWidth: 300 },
  retry: { marginTop: spacing.md, minWidth: 160 },
});

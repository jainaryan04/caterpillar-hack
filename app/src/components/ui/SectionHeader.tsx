import { Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing, touch } from '@/theme/tokens';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export function SectionHeader({
  title,
  icon,
  meta,
  actionLabel,
  onAction,
}: {
  title: string;
  icon?: IconName;
  /** Right-aligned info, e.g. "2 / 5" */
  meta?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="header">
      <View style={styles.title}>
        {icon ? <Icon name={icon} size={16} color={colors.textSecondary} /> : null}
        <AppText variant="label" tone="secondary" caps>
          {title}
        </AppText>
      </View>
      {meta ? (
        <AppText variant="mono" tone="muted">
          {meta}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8} style={styles.action}>
          <AppText variant="small" tone="brand" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    minHeight: 28,
  },
  title: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  action: { minHeight: touch.min - 12, justifyContent: 'center' },
});

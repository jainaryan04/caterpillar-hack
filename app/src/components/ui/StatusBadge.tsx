import { StyleSheet, View } from 'react-native';
import type { TaskStatus } from '@/types/domain';
import { colors, radius, spacing } from '@/theme/tokens';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

interface BadgeStyle {
  label: string;
  icon: IconName;
  fg: string;
  bg: string;
}

/**
 * Current task uses brand yellow ("act here"). Other states use the status
 * palette. Every state has icon + text, never colour alone.
 */
export const taskStatusStyle: Record<TaskStatus | 'next', BadgeStyle> = {
  completed: { label: 'Done', icon: 'check-circle', fg: colors.success, bg: colors.successSubtle },
  in_progress: { label: 'In progress', icon: 'progress-clock', fg: colors.brand, bg: colors.brandSubtle },
  next: { label: 'Up next', icon: 'arrow-right-circle', fg: colors.brand, bg: colors.brandSubtle },
  pending: { label: 'To do', icon: 'circle-outline', fg: colors.textSecondary, bg: colors.neutralSubtle },
  blocked: { label: 'Blocked', icon: 'alert', fg: colors.warning, bg: colors.warningSubtle },
  cancelled: { label: 'Cancelled', icon: 'cancel', fg: colors.textMuted, bg: colors.neutralSubtle },
};

export function StatusBadge({ status }: { status: TaskStatus | 'next' }) {
  const s = taskStatusStyle[status];
  return <Badge label={s.label} icon={s.icon} fg={s.fg} bg={s.bg} />;
}

export function Badge({ label, icon, fg, bg }: { label: string; icon?: IconName; fg: string; bg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]} accessibilityLabel={label}>
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <AppText variant="label" style={{ color: fg, letterSpacing: 0.6 }} caps>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
});

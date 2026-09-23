import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Operator, WorkerStatus } from '@/types/domain';
import { colors, radius, spacing, touch } from '@/theme/tokens';
import { AppText } from '../ui/AppText';
import { Icon, type IconName } from '../ui/Icon';

const statusStyle: Record<WorkerStatus, { label: string; icon: IconName; color: string }> = {
  AVAILABLE: { label: 'Available', icon: 'check-circle-outline', color: colors.success },
  RESERVED: { label: 'Scheduled', icon: 'calendar-check', color: colors.info },
  IN_USE: { label: 'On a task', icon: 'progress-clock', color: colors.brand },
  OFF_DUTY: { label: 'Off duty', icon: 'circle-outline', color: colors.textMuted },
};

/** One selectable worker in the sign-in list. */
export const WorkerRow = memo(function WorkerRow({
  operator,
  selected,
  onPress,
}: {
  operator: Operator;
  selected: boolean;
  onPress: (id: string) => void;
}) {
  const s = statusStyle[operator.status];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${operator.id}. ${s.label}. Skill level ${operator.skillLevel}. ${operator.skills.join(', ')}`}
      onPress={() => onPress(operator.id)}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && !selected && { backgroundColor: colors.raised }]}
    >
      <Icon
        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
        size={26}
        color={selected ? colors.brand : colors.textSecondary}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.top}>
          <AppText variant="monoLarge">{operator.id}</AppText>
          <View style={styles.status}>
            <Icon name={s.icon} size={14} color={s.color} />
            <AppText variant="small" style={{ color: s.color, fontSize: 13 }}>
              {s.label}
            </AppText>
          </View>
        </View>
        <AppText variant="small" tone="secondary" numberOfLines={1}>
          {operator.skills.join(' · ') || 'No skills listed'}
        </AppText>
        <AppText variant="small" tone="muted" style={{ fontSize: 13 }}>
          Skill level {operator.skillLevel}
          {operator.plannedAssignments ? ` · ${operator.plannedAssignments} tasks in the plan` : ''}
        </AppText>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.large + 20,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  selected: { borderColor: colors.brand, backgroundColor: colors.brandSubtle },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Task, TaskStatus } from '@/types/domain';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatMinutes } from '@/utils/format';
import { dayLabel } from '@/utils/schedule';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';
import { taskStatusStyle } from '../ui/StatusBadge';

/** One row in "Today's tasks". The current task gets a yellow rail. */
export const TaskCard = memo(function TaskCard({
  task,
  status,
  onPress,
}: {
  task: Task;
  status: TaskStatus | 'next';
  onPress: (task: Task) => void;
}) {
  const s = taskStatusStyle[status];
  const isCurrent = status === 'next' || status === 'in_progress';
  const done = status === 'completed';
  const day = task.scheduledStartAt ? dayLabel(new Date(task.scheduledStartAt)) : 'Today';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${task.machine}, ${formatMinutes(task.estimatedMinutes)}, ${s.label}`}
      onPress={() => onPress(task)}
      style={({ pressed }) => [styles.card, isCurrent && styles.current, pressed && styles.pressed]}
    >
      <Icon name={s.icon} size={24} color={s.fg} />
      <View style={styles.body}>
        <AppText variant="bodyStrong" tone={done ? 'secondary' : 'primary'} numberOfLines={1}>
          {task.title}
        </AppText>
        <AppText variant="small" tone="muted" numberOfLines={1}>
          {task.machine} · {task.location}
        </AppText>
        <View style={styles.meta}>
          <AppText variant="label" caps style={{ color: s.fg, letterSpacing: 0.6 }}>
            {s.label}
          </AppText>
          {task.priority === 'high' && !done ? (
            <View style={styles.meta}>
              <Icon name="flag-outline" size={13} color={colors.textSecondary} />
              <AppText variant="small" tone="secondary" style={{ fontSize: 13 }}>
                High priority
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.right}>
        <AppText variant="mono" tone={done ? 'muted' : 'primary'}>
          {done && task.completedAt ? task.completedAt : task.scheduledStart}
        </AppText>
        <AppText variant="small" tone="muted" style={{ fontSize: 13 }}>
          {done ? 'done' : formatMinutes(task.estimatedMinutes)}
        </AppText>
        {!done && day !== 'Today' ? (
          <AppText variant="small" tone="muted" style={{ fontSize: 12 }}>
            {day}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 76,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  current: {
    borderLeftWidth: 3,
    borderLeftColor: colors.brand,
    backgroundColor: '#1A1810',
  },
  pressed: { backgroundColor: colors.raised },
  body: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 2 },
});

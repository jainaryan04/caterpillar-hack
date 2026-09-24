import { StyleSheet, View } from 'react-native';
import type { Shift, Task } from '@/types/domain';
import { colors, spacing } from '@/theme/tokens';
import { TaskProgress } from '../tasks/TaskProgress';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';

export function ShiftCard({
  shift,
  subtitle,
  tasks,
  progressLabel,
}: {
  shift?: Shift;
  subtitle: string;
  tasks: Task[];
  progressLabel: string;
}) {
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Icon name="calendar-clock" size={20} color={colors.textSecondary} />
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{shift ? `${shift.name} · ${shift.dayLabel}` : 'No scheduled times'}</AppText>
          <AppText variant="small" tone="muted" numberOfLines={1}>
            {subtitle}
          </AppText>
        </View>
        {shift ? (
          <AppText variant="mono" accessibilityLabel={`${shift.start} to ${shift.end}`}>
            {shift.start} — {shift.end}
          </AppText>
        ) : null}
      </View>
      <View style={styles.divider} />
      <TaskProgress tasks={tasks} label={progressLabel} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  divider: { height: 1, backgroundColor: colors.border },
});

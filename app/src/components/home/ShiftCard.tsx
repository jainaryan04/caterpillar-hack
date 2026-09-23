import { StyleSheet, View } from 'react-native';
import type { Shift, Task } from '@/types/domain';
import { colors, spacing } from '@/theme/tokens';
import { TaskProgress } from '../tasks/TaskProgress';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';

export function ShiftCard({ shift, machine, tasks }: { shift: Shift; machine: string; tasks: Task[] }) {
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Icon name="calendar-clock" size={20} color={colors.textSecondary} />
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{shift.name}</AppText>
          <AppText variant="small" tone="muted">
            {machine}
          </AppText>
        </View>
        <AppText variant="mono" accessibilityLabel={`${shift.start} to ${shift.end}`}>
          {shift.start} — {shift.end}
        </AppText>
      </View>
      <View style={styles.divider} />
      <TaskProgress tasks={tasks} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  divider: { height: 1, backgroundColor: colors.border },
});

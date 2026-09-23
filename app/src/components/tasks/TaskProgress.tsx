import { StyleSheet, View } from 'react-native';
import type { Task } from '@/types/domain';
import { spacing } from '@/theme/tokens';
import { formatMinutes } from '@/utils/format';
import { AppText } from '../ui/AppText';
import { ProgressBar } from '../ui/ProgressBar';

export function TaskProgress({ tasks }: { tasks: Task[] }) {
  const done = tasks.filter((t) => t.status === 'completed').length;
  const remainingMin = tasks.filter((t) => t.status !== 'completed').reduce((sum, t) => sum + t.estimatedMinutes, 0);
  const total = tasks.length;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <AppText variant="label" tone="secondary" caps>
          Today
        </AppText>
        <AppText variant="small" tone="muted">
          {remainingMin > 0 ? `≈ ${formatMinutes(remainingMin)} left` : 'All done'}
        </AppText>
      </View>
      <View style={styles.count}>
        <AppText variant="monoLarge" style={{ fontSize: 26, lineHeight: 32 }}>
          {done} / {total}
        </AppText>
        <AppText variant="body" tone="secondary">
          tasks completed
        </AppText>
      </View>
      <ProgressBar value={total ? done / total : 0} height={8} label={`${done} of ${total} tasks completed`} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
});

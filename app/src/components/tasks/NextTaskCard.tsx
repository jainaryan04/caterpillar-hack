import { StyleSheet, View } from 'react-native';
import type { Task } from '@/types/domain';
import { colors, spacing } from '@/theme/tokens';
import { formatMinutes } from '@/utils/format';
import { ActionButton } from '../ui/ActionButton';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Icon, type IconName } from '../ui/Icon';

/** The one thing the operator should do now. Only yellow-accented card on Home. */
export function NextTaskCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const inProgress = task.status === 'in_progress';
  return (
    <Card accent="brand" style={styles.card}>
      <AppText variant="label" tone="brand" caps>
        {inProgress ? 'In progress' : 'Next task'}
      </AppText>
      <AppText variant="display" style={styles.title}>
        {task.title}
      </AppText>
      <View style={styles.lines}>
        <Line icon="cog-outline" text={task.machine} />
        <Line icon="map-marker-outline" text={task.location} />
      </View>
      <View style={styles.stats}>
        <Stat label="Estimated time" value={formatMinutes(task.estimatedMinutes)} />
        <Stat label="Planned start" value={task.scheduledStart} />
        {task.priority === 'high' ? <Stat label="Priority" value="High" icon="flag-outline" /> : null}
      </View>
      <ActionButton
        label={inProgress ? 'Continue task' : 'Start task'}
        icon={inProgress ? 'play' : 'arrow-right'}
        onPress={() => onOpen(task)}
        accessibilityHint="Opens the task with its safety check"
      />
    </Card>
  );
}

function Line({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.line}>
      <Icon name={icon} size={18} color={colors.textSecondary} />
      <AppText variant="body" tone="secondary" style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: IconName }) {
  return (
    <View style={styles.stat}>
      <AppText variant="small" tone="muted" style={{ fontSize: 12 }}>
        {label}
      </AppText>
      <View style={styles.line}>
        {icon ? <Icon name={icon} size={16} color={colors.text} /> : null}
        <AppText variant="monoLarge">{value}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  title: { marginTop: spacing.xxs },
  lines: { gap: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stats: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingVertical: spacing.md,
    marginVertical: spacing.xs,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  stat: { gap: 2 },
});

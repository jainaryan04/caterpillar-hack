import { Pressable, StyleSheet, View } from 'react-native';
import type { AgentAction } from '@/types/agent';
import { colors, radius, spacing, touch } from '@/theme/tokens';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';
import { actionMeta } from './agentActionMeta';

/** Renders the actions attached to an agent answer. */
export function AgentActions({
  actions,
  onRun,
  exclude = [],
}: {
  actions: AgentAction[];
  onRun: (action: AgentAction) => void;
  exclude?: AgentAction['type'][];
}) {
  const visible = actions.filter((a) => !exclude.includes(a.type) && actionMeta(a).kind !== 'hidden');
  if (!visible.length) return null;
  return (
    <View style={styles.row}>
      {visible.map((action, i) => {
        const meta = actionMeta(action);
        if (meta.kind === 'button') {
          return (
            <Pressable
              key={`${action.type}-${i}`}
              accessibilityRole="button"
              accessibilityLabel={meta.label}
              onPress={() => onRun(action)}
              style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
            >
              <Icon name={meta.icon} size={18} color={colors.brand} />
              <AppText variant="small" style={styles.buttonText}>
                {meta.label}
              </AppText>
            </Pressable>
          );
        }
        const danger = meta.kind === 'status-danger';
        return (
          <View
            key={`${action.type}-${i}`}
            style={[styles.tag, { backgroundColor: danger ? colors.dangerSubtle : colors.infoSubtle }]}
            accessibilityLabel={meta.label}
          >
            <Icon name={meta.icon} size={16} color={danger ? colors.danger : colors.info} />
            <AppText variant="small" style={{ color: danger ? colors.danger : colors.info, fontFamily: 'IBMPlexSans_600SemiBold' }}>
              {meta.label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: touch.min - 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    backgroundColor: colors.brandSubtle,
  },
  buttonText: { fontFamily: 'IBMPlexSans_600SemiBold', color: colors.text },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.md,
  },
});

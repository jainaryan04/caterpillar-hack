import { StyleSheet, View } from 'react-native';
import type { AgentCitation } from '@/types/agent';
import { colors, spacing } from '@/theme/tokens';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';

export function Citations({ citations }: { citations: AgentCitation[] }) {
  if (!citations.length) return null;
  return (
    <View style={styles.wrap}>
      {citations.map((c, i) => (
        <View key={i} style={styles.row}>
          <Icon name="book-open-page-variant-outline" size={14} color={colors.textMuted} />
          <AppText variant="small" tone="muted" style={{ flex: 1 }}>
            {c.source} · {c.locator}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** Shown when an answer has no source, per the Supervisor trust rules. */
export function NoSourceNotice() {
  return (
    <View style={[styles.row, styles.wrap]}>
      <Icon name="alert-outline" size={14} color={colors.warning} />
      <AppText variant="small" tone="warning">
        No source found in the manuals. Check before you act.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
});

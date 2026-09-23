import { Pressable, StyleSheet, View } from 'react-native';
import type { SafetyCheckItem } from '@/types/domain';
import { colors, radius, spacing, touch } from '@/theme/tokens';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';

/**
 * Required pre-start checks. Big tap rows (whole row toggles), explicit
 * checked/unchecked icons and a running count, so it works with gloves on.
 */
export function SafetyChecklist({
  items,
  checked,
  onToggle,
  locked,
}: {
  items: SafetyCheckItem[];
  checked: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Task already started: show as confirmed, not editable. */
  locked?: boolean;
}) {
  const count = locked ? items.length : items.filter((i) => checked.has(i.id)).length;
  const complete = count === items.length;
  return (
    <View style={[styles.box, complete && styles.boxDone]}>
      <View style={styles.head}>
        <Icon name="hard-hat" size={20} color={complete ? colors.success : colors.brand} />
        <View style={{ flex: 1 }}>
          <AppText variant="label" caps tone={complete ? 'success' : 'brand'}>
            Safety check
          </AppText>
          <AppText variant="small" tone="secondary">
            {locked ? 'Confirmed before start' : 'Required before you start'}
          </AppText>
        </View>
        <AppText variant="mono" tone={complete ? 'success' : 'primary'} accessibilityLabel={`${count} of ${items.length} checked`}>
          {count}/{items.length}
        </AppText>
      </View>
      {items.map((item) => {
        const on = locked || checked.has(item.id);
        return (
          <Pressable
            key={item.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: !!locked }}
            accessibilityLabel={item.label}
            accessibilityHint={item.detail}
            disabled={locked}
            onPress={() => onToggle(item.id)}
            style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.raised }]}
          >
            <Icon
              name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={28}
              color={on ? colors.success : colors.textSecondary}
            />
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong" tone={on ? 'secondary' : 'primary'}>
                {item.label}
              </AppText>
              {item.detail ? (
                <AppText variant="small" tone="muted">
                  {item.detail}
                </AppText>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: colors.brandBorder,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    overflow: 'hidden',
  },
  boxDone: { borderColor: 'rgba(34,197,94,0.35)' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.large,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});

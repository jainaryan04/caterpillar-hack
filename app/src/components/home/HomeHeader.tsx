import { Pressable, StyleSheet, View } from 'react-native';
import type { Operator } from '@/types/domain';
import { colors, spacing, touch } from '@/theme/tokens';
import { greetingFor } from '@/utils/format';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

export function HomeHeader({
  operator,
  onTalk,
  onSwitchWorker,
}: {
  operator: Operator;
  onTalk: () => void;
  onSwitchWorker: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="label" tone="secondary" caps>
          {greetingFor(new Date())}
        </AppText>
        <AppText variant="display" accessibilityRole="header">
          {operator.name}
        </AppText>
        <AppText variant="small" tone="secondary" numberOfLines={1}>
          Skill level {operator.skillLevel}
          {operator.skills.length ? ` · ${operator.skills.join(', ')}` : ''}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch worker"
          onPress={onSwitchWorker}
          hitSlop={8}
          style={styles.switch}
        >
          <Icon name="account-switch-outline" size={16} color={colors.brand} />
          <AppText variant="small" tone="brand" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
            Not {operator.name}? Switch worker
          </AppText>
        </Pressable>
      </View>
      <IconButton icon="microphone" label="Talk to Cat" tone="brand" onPress={onTalk} size={52} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  switch: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: touch.min - 12, alignSelf: 'flex-start' },
});

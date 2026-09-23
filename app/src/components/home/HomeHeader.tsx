import { StyleSheet, View } from 'react-native';
import type { Operator } from '@/types/domain';
import { spacing } from '@/theme/tokens';
import { greetingFor } from '@/utils/format';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/IconButton';

export function HomeHeader({ operator, onJarvis }: { operator: Operator; onJarvis: () => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <AppText variant="display" caps accessibilityRole="header">
          {greetingFor(new Date())}, {operator.firstName}
        </AppText>
        <AppText variant="small" tone="secondary">
          {operator.id} · {operator.crew} · {operator.site}
        </AppText>
      </View>
      <IconButton icon="microphone" label="Talk to Jarvis" tone="brand" onPress={onJarvis} size={52} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});

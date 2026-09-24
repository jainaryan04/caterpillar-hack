import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WorkerRow } from '@/components/home/WorkerRow';
import { ActionButton } from '@/components/ui/ActionButton';
import { AppText } from '@/components/ui/AppText';
import { Icon } from '@/components/ui/Icon';
import { StateView } from '@/components/ui/StateView';
import { config } from '@/config';
import { useAsync } from '@/hooks/useAsync';
import { operatorService } from '@/services';
import { useSession } from '@/state/SessionProvider';
import type { Operator } from '@/types/domain';
import { colors, fonts, radius, spacing, touch } from '@/theme/tokens';

/** Launch screen: choose which worker is using this phone. */
export default function WorkerPickerScreen() {
  const { lastWorkerId, ready, signIn } = useSession();
  const { data: operators, error, loading, reload } = useAsync(() => operatorService.listOperators(), []);
  const [choice, setChoice] = useState<string>();
  const [query, setQuery] = useState('');

  // Preselect the last worker once both it and the list are known.
  const selected = choice ?? (operators?.some((o) => o.id === lastWorkerId) ? lastWorkerId : undefined);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!operators || !q) return operators ?? [];
    return operators.filter((o) => o.id.toLowerCase().includes(q) || o.skills.some((s) => s.toLowerCase().includes(q)));
  }, [operators, query]);

  const confirm = () => {
    if (!selected) return;
    signIn(selected);
    router.replace('/home');
  };

  const renderItem = useCallback(
    ({ item }: { item: Operator }) => <WorkerRow operator={item} selected={item.id === selected} onPress={setChoice} />,
    [selected],
  );

  let body;
  if (!ready || (loading && !operators)) {
    body = <StateView kind="loading" title="Loading workers…" />;
  } else if (!operators) {
    body = (
      <StateView
        kind="offline"
        title="Can't reach the task server"
        message={`${error?.message ?? ''} Check that the Fleet API is running at ${config.fleetApiUrl} and the phone is on the same network.`}
        onRetry={reload}
      />
    );
  } else if (operators.length === 0) {
    body = <StateView kind="empty" title="No workers on the roster" message="Ask your supervisor to sync the roster." onRetry={reload} />;
  } else {
    body = (
      <FlatList
        data={filtered}
        keyExtractor={(o) => o.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<StateView kind="empty" title={`No worker matches "${query}"`} compact />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.mark}>
            <Icon name="hard-hat" size={18} color={colors.onBrand} />
          </View>
          <AppText variant="label" tone="secondary" caps>
            Cat Operator
          </AppText>
        </View>
        <AppText variant="display" caps accessibilityRole="header">
          Who is working?
        </AppText>
        <AppText variant="body" tone="secondary">
          Choose your worker ID to see your tasks.
        </AppText>
        {operators && operators.length > 8 ? (
          <View style={styles.search}>
            <Icon name="magnify" size={20} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search ID or skill"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCapitalize="characters"
              accessibilityLabel="Search workers"
              cursorColor={colors.brand}
            />
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>{body}</View>

      <View style={styles.footer}>
        <ActionButton
          label={selected ? `Continue as ${selected}` : 'Choose your worker ID'}
          icon="arrow-right"
          disabled={!selected}
          onPress={confirm}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: { padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.xs },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  mark: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: touch.min,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inset,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 16 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.panel },
});

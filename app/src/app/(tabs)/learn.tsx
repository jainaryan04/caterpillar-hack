import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VideoCard } from '@/components/video/VideoCard';
import { categoryMeta } from '@/components/video/videoMeta';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { ConnectionBanner } from '@/components/ui/ConnectionBanner';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StateView } from '@/components/ui/StateView';
import { useAsync } from '@/hooks/useAsync';
import { videoService } from '@/services';
import type { LearningCategory, TrainingVideo } from '@/types/domain';
import { colors, spacing } from '@/theme/tokens';

const CATEGORIES: LearningCategory[] = ['safety', 'machinery', 'maintenance', 'emergency'];
type Filter = 'all' | LearningCategory;

export default function LearnScreen() {
  const { data: library, error, loading, reload } = useAsync(() => videoService.getLibrary(), []);
  const [filter, setFilter] = useState<Filter>('all');

  // Progress changes while watching; refresh when returning.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      reload();
    }, [reload]),
  );

  const open = useCallback((v: TrainingVideo) => router.push({ pathname: '/video/[id]', params: { id: v.id } }), []);

  let content;
  if (!library) {
    content = error ? (
      <StateView kind="error" title="Unable to load training" message={error.message} onRetry={reload} />
    ) : (
      <StateView kind="loading" title="Loading training library…" />
    );
  } else {
    const all = CATEGORIES.flatMap((c) => library.byCategory[c]);
    const required = all.filter((v) => v.required);
    const requiredDone = required.filter((v) => v.completed).length;
    const shownCategories = filter === 'all' ? CATEGORIES : [filter];

    content = (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} colors={[colors.onBrand]} progressBackgroundColor={colors.brand} />
        }
      >
        {all.length === 0 ? (
          <StateView kind="empty" title="No learning videos available." message="New training will appear here." />
        ) : (
          <>
            <Card style={{ gap: spacing.sm }}>
              <View style={styles.reqRow}>
                <AppText variant="label" tone="secondary" caps>
                  Required training
                </AppText>
                <AppText variant="mono">
                  {requiredDone} / {required.length}
                </AppText>
              </View>
              <ProgressBar
                value={required.length ? requiredDone / required.length : 1}
                color={colors.success}
                label={`${requiredDone} of ${required.length} required videos completed`}
              />
            </Card>

            {filter === 'all' && library.recommended.length ? (
              <View>
                <SectionHeader title="Recommended for today" icon="star-outline" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
                  {library.recommended.map((v) => (
                    <VideoCard key={v.id} video={v} variant="tile" onPress={open} />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {filter === 'all' && library.recentlyWatched.length ? (
              <View>
                <SectionHeader title="Continue watching" icon="history" />
                <View style={styles.list}>
                  {library.recentlyWatched.map((v) => (
                    <VideoCard key={v.id} video={v} onPress={open} />
                  ))}
                </View>
              </View>
            ) : null}

            {shownCategories.map((c) => {
              const items = library.byCategory[c];
              return (
                <View key={c}>
                  <SectionHeader title={categoryMeta[c].label} icon={categoryMeta[c].icon} meta={`${items.length}`} />
                  {items.length ? (
                    <View style={styles.list}>
                      {items.map((v) => (
                        <VideoCard key={v.id} video={v} onPress={open} />
                      ))}
                    </View>
                  ) : (
                    <Card>
                      <StateView kind="empty" title="No learning videos available." compact />
                    </Card>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ConnectionBanner />
      <View style={styles.header}>
        <AppText variant="title" accessibilityRole="header">
          Learn
        </AppText>
        <AppText variant="small" tone="secondary">
          Field training library
        </AppText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.filters}>
        <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
        {CATEGORIES.map((c) => (
          <Chip
            key={c}
            label={c === 'emergency' ? 'Emergency' : categoryMeta[c].label}
            icon={categoryMeta[c].icon}
            selected={filter === c}
            onPress={() => setFilter(c)}
          />
        ))}
      </ScrollView>
      <View style={{ flex: 1 }}>{content}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  filters: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  content: { padding: spacing.lg, paddingTop: spacing.xs, gap: spacing.xl, paddingBottom: spacing.xxxl },
  reqRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rail: { gap: spacing.sm, paddingRight: spacing.lg },
  list: { gap: spacing.sm },
});

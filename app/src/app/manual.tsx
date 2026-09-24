import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/AppText';
import { Chip } from '@/components/ui/Chip';
import { RemoteImage } from '@/components/ui/RemoteImage';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StateView } from '@/components/ui/StateView';
import { useAsync } from '@/hooks/useAsync';
import { agentService } from '@/services';
import type { ManualOpenResult } from '@/types/agent';
import { colors, spacing } from '@/theme/tokens';

/** "Open the manual for this": the page(s) behind the last answer, or a given page. */
export default function ManualScreen() {
  const params = useLocalSearchParams<{
    page?: string;
    /** Set when Cat pushed the pages over voice ("Hey Cat, open it"). */
    url?: string;
    pageEnd?: string;
    topic?: string;
    width?: string;
    height?: string;
  }>();
  const { page } = params;
  const { data, error, loading, reload } = useAsync<ManualOpenResult>(
    () =>
      params.url
        ? Promise.resolve({
            opened: true,
            page: {
              url: params.url,
              page: Number(page) || 0,
              pageEnd: params.pageEnd ? Number(params.pageEnd) : undefined,
              topic: params.topic || null,
              width: Number(params.width) || 935,
              height: Number(params.height) || 1210,
              message: `Manual page ${page}`,
            },
          })
        : agentService.openManual(page ? Number(page) : undefined),
    [page, params.url],
  );
  const { width } = useWindowDimensions();
  const [zoom, setZoom] = useState(1);

  let body;
  if (loading && !data) {
    body = <StateView kind="loading" title="Opening the manual…" />;
  } else if (error) {
    body = <StateView kind="error" title="Unable to open the manual" message={error.message} onRetry={reload} />;
  } else if (!data || !data.opened) {
    body = (
      <StateView
        kind="error"
        title={page ? `Couldn't open page ${page}` : "Couldn't open the manual"}
        message={data?.message ?? 'Ask Cat a question first, then open the page it came from.'}
        onRetry={reload}
      />
    );
  } else {
    const p = data.page;
    const imgWidth = (width - spacing.lg * 2) * zoom;
    const imgHeight = imgWidth * (p.height / p.width);
    body = (
      <>
        <View style={styles.meta}>
          <AppText variant="heading" style={{ flex: 1 }}>
            {p.topic ?? 'Operation & Maintenance Manual'}
          </AppText>
          <Chip label={zoom === 1 ? 'Zoom 2×' : 'Fit width'} icon="magnify" onPress={() => setZoom(zoom === 1 ? 2 : 1)} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ScrollView horizontal scrollEnabled={zoom > 1} showsHorizontalScrollIndicator={zoom > 1}>
            <RemoteImage
              uri={p.url}
              style={{ width: imgWidth, height: imgHeight, backgroundColor: '#FAFAF7' }}
              label={p.message}
              failedText="The page image couldn't be downloaded from the Cat server."
            />
          </ScrollView>
        </ScrollView>
      </>
    );
  }

  const opened = data?.opened ? data.page : undefined;
  const label = opened
    ? `Manual · p. ${opened.page}${opened.pageEnd && opened.pageEnd !== opened.page ? `–${opened.pageEnd}` : ''}`
    : page
      ? `Manual · p. ${page}`
      : 'Manual';
  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader label={label} />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.sm },
  scroll: { padding: spacing.lg, paddingTop: 0 },
});

import { Pressable, StyleSheet, View } from 'react-native';
import type { VideoChapter } from '@/types/domain';
import { colors, radius, spacing, touch } from '@/theme/tokens';
import { formatClock } from '@/utils/format';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';

export function ChapterList({
  chapters,
  currentIndex,
  onSelect,
}: {
  chapters: VideoChapter[];
  currentIndex: number;
  onSelect: (c: VideoChapter) => void;
}) {
  return (
    <View style={styles.list}>
      {chapters.map((c, i) => {
        const current = i === currentIndex;
        return (
          <Pressable
            key={c.startsAt}
            accessibilityRole="button"
            accessibilityState={{ selected: current }}
            accessibilityLabel={`Chapter ${i + 1}, ${c.title}, at ${formatClock(c.startsAt)}`}
            onPress={() => onSelect(c)}
            style={({ pressed }) => [styles.row, current && styles.current, pressed && { backgroundColor: colors.raised }]}
          >
            <AppText variant="mono" tone={current ? 'brand' : 'muted'} style={styles.time}>
              {formatClock(c.startsAt)}
            </AppText>
            <AppText variant={current ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>
              {c.title}
            </AppText>
            {current ? <Icon name="volume-high" size={18} color={colors.brand} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.panel },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.large,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  current: { backgroundColor: colors.brandSubtle, borderLeftWidth: 3, borderLeftColor: colors.brand },
  time: { width: 52 },
});

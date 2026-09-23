import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { AgentContext } from '@/types/agent';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClock } from '@/utils/format';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';

export function describeContext(ctx: AgentContext): string | null {
  if (ctx.videoTitle) {
    return ctx.timestamp !== undefined ? `${ctx.videoTitle} · ${formatClock(ctx.timestamp)}` : ctx.videoTitle;
  }
  if (ctx.taskTitle) return ctx.taskTitle;
  if (ctx.imageUri) return 'Machinery photo';
  return null;
}

/** Shows what a question is about: a paused video moment, a task or a photo. */
export function ContextTag({ context, onClear }: { context: AgentContext; onClear?: () => void }) {
  const text = describeContext(context);
  if (!text) return null;
  const icon = context.videoId ? 'play-box-outline' : context.imageUri ? 'image-outline' : 'clipboard-text-outline';
  return (
    <View style={styles.tag} accessibilityLabel={`About: ${text}`}>
      {context.imageUri ? (
        <Image source={{ uri: context.imageUri }} style={styles.thumb} accessibilityIgnoresInvertColors />
      ) : (
        <Icon name={icon} size={16} color={colors.brand} />
      )}
      <AppText variant="small" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
        {text}
      </AppText>
      {onClear ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove context" onPress={onClear} hitSlop={12}>
          <Icon name="close" size={16} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inset,
  },
  thumb: { width: 28, height: 28, borderRadius: radius.sm },
});

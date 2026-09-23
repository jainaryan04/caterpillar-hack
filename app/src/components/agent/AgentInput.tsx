import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { colors, fonts, radius, spacing, touch } from '@/theme/tokens';
import { IconButton } from '../ui/IconButton';

/**
 * Composer. The big yellow button is the microphone while the field is empty
 * (voice is the default in the field) and becomes Send once there is text.
 */
export function AgentInput({
  onSend,
  onMic,
  onCamera,
  disabled,
}: {
  onSend: (text: string) => void;
  onMic: () => void;
  onCamera: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const hasText = text.trim().length > 0;

  const send = () => {
    if (!hasText) return;
    onSend(text);
    setText('');
  };

  return (
    <View style={styles.row}>
      <IconButton icon="camera-outline" label="Ask about a machinery photo" onPress={onCamera} />
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={disabled ? 'Offline. Jarvis needs a connection' : 'Ask Jarvis…'}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        multiline
        editable={!disabled}
        accessibilityLabel="Message to Jarvis"
        returnKeyType="send"
        submitBehavior="blurAndSubmit"
        onSubmitEditing={send}
        cursorColor={colors.brand}
        selectionColor={colors.brandBorder}
      />
      {hasText ? (
        <IconButton icon="send" label="Send message" tone="brand" onPress={send} size={touch.large} />
      ) : (
        <IconButton icon="microphone" label="Talk to Jarvis" tone="brand" onPress={onMic} size={touch.large} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: touch.large,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingTop: 15,
    paddingBottom: 15,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inset,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
    textAlignVertical: 'center',
  },
});

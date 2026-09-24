import { RecordingPresets, useAudioRecorder } from 'expo-audio';
import { useEffect } from 'react';
import { attachRecorder } from '@/services/cat/catTalkVoiceService';

const OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

/**
 * Creates the push-to-talk recorder (expo-audio only makes one through a hook)
 * and hands it to catTalkVoiceService. Mounted once at the root; renders nothing.
 */
export function TalkRecorderHost() {
  const recorder = useAudioRecorder(OPTIONS);
  useEffect(() => {
    attachRecorder(recorder);
    return () => attachRecorder(null);
  }, [recorder]);
  return null;
}

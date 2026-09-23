import type { AgentAction } from '@/types/agent';
import type { IconName } from '../ui/Icon';

export interface ActionMeta {
  label: string;
  icon: IconName;
  /** Status-only actions are shown as a tag, not a button. */
  kind: 'button' | 'status-danger' | 'status-info' | 'hidden';
}

export function actionMeta(action: AgentAction): ActionMeta {
  switch (action.type) {
    case 'OPEN_TASK':
      return { label: 'Open task', icon: 'clipboard-text-outline', kind: 'button' };
    case 'OPEN_VIDEO':
      return { label: 'Watch video', icon: 'play-circle-outline', kind: 'button' };
    case 'EXPLAIN_VIDEO':
      return { label: 'Go to this moment', icon: 'play-circle-outline', kind: 'button' };
    case 'OPEN_LEARNING':
      return { label: 'Open Learn', icon: 'school-outline', kind: 'button' };
    case 'PAUSE_VIDEO':
      return { label: 'Pause video', icon: 'pause', kind: 'button' };
    case 'RESUME_VIDEO':
      return { label: 'Resume video', icon: 'play', kind: 'button' };
    case 'OPEN_CAMERA':
      return { label: 'Open camera', icon: 'camera-outline', kind: 'button' };
    case 'GET_CURRENT_TASK':
      return { label: "Today's tasks", icon: 'format-list-checks', kind: 'button' };
    case 'TRIGGER_SOS':
      return { label: 'Emergency alert sent', icon: 'alert-octagon', kind: 'status-danger' };
    case 'CONTACT_SUPERVISOR':
      return { label: 'Supervisor notified', icon: 'account-hard-hat', kind: 'status-info' };
    case 'ANSWER':
    default:
      return { label: '', icon: 'information-outline', kind: 'hidden' };
  }
}

import type { AgentAction, AgentCitation, AgentMessage, ImageAnalysis } from '@/types/agent';

const MANUAL_320D = 'Cat 320D Operation & Maintenance Manual';
const SITE_SOP = 'North Ridge SOP';

export interface CannedAnswer {
  /** Lower-case keywords; the first answer with any match wins. */
  keywords: string[];
  text: string;
  caution?: string;
  citations: AgentCitation[];
  actions: AgentAction[];
}

export const cannedAnswers: CannedAnswer[] = [
  {
    keywords: ['sos', 'emergency', 'help me', 'injured', 'hurt', 'fire'],
    text:
      'Emergency alert sent. Your supervisor and the site control room have your location (Pit 2 · Crusher House). Stay where you are if it is safe. If there is immediate danger, move to Muster Point B.',
    citations: [{ source: SITE_SOP, locator: 'EM-01 Emergency Response' }],
    actions: [{ type: 'TRIGGER_SOS' }],
  },
  {
    keywords: ['supervisor', 'call', 'contact'],
    text: 'I have asked R. Mehta to call you back. They are on the Pit 2 radio channel if you need them sooner.',
    citations: [],
    actions: [{ type: 'CONTACT_SUPERVISOR' }],
  },
  {
    keywords: ['hydraulic pressure', 'pressure'],
    text:
      'First make sure the machine is parked on level ground with the bucket down and the hydraulic lockout lever raised.\n\n1. Connect the gauge to the test port on the main control valve.\n2. Start the engine and run it at high idle.\n3. Lower the lockout lever and slowly operate the circuit to relief.\n4. Read the gauge. Main relief on the 320D should read about 34,300 kPa.\n\nIf the reading is more than 10% off, stop and report it. Do not adjust the relief valve yourself.',
    caution: 'Hydraulic oil at working pressure can penetrate skin. Never check for leaks with your hand.',
    citations: [{ source: MANUAL_320D, locator: 'p. 112 · Relief Valve Test' }],
    actions: [{ type: 'ANSWER' }],
  },
  {
    keywords: ['leak', 'drip', 'fluid'],
    text:
      'For the pump, a slow drip from the gland seal (about one drop per second) is normal. It keeps the packing cool. A steady stream, or fluid coming from the casing or flange joint, is not.\n\nWipe the area clean, run the pump for 2 minutes, then look again so you can find the source.',
    caution: 'Isolate the pump before touching the flange bolts.',
    citations: [{ source: 'Pump Inspection Procedure', locator: 'Gland seal inspection · 07:45' }],
    actions: [{ type: 'OPEN_VIDEO', videoId: 'VID-103' }],
  },
  {
    keywords: ['task', 'next', 'what should i do', 'today'],
    text:
      'Your next task is Pump Inspection on PMP-114 in the Crusher House, planned for 09:30 and about 45 minutes. You need to complete the 6-item safety check before you start.',
    citations: [],
    actions: [{ type: 'OPEN_TASK', taskId: 'TASK-003' }],
  },
  {
    keywords: ['inspect', 'pump', 'machine', 'engine', 'start'],
    text:
      'Start with isolation. Stop the pump, lock and tag it at MCC-3, and prove zero energy by trying to start it from the local panel.\n\nThen work from the outside in: casing and flanges, gland seal, drive belts and guard. Record discharge pressure and bearing temperature after restart.',
    citations: [
      { source: 'Pump Inspection Procedure', locator: 'Isolation and lockout · 00:00' },
      { source: SITE_SOP, locator: 'MT-14 Slurry Pumps' },
    ],
    actions: [{ type: 'OPEN_VIDEO', videoId: 'VID-101' }],
  },
  {
    keywords: ['lockout', 'isolate', 'isolation', 'lock out', 'tagout', 'seat belt'],
    text:
      'Isolate, lock, tag, then prove it. Use your own lock on the isolation point, not a shared one. Try to start the equipment from its local control before you begin. It must not move.',
    citations: [{ source: 'Lockout / Tagout Fundamentals', locator: 'Prove zero energy · 06:50' }],
    actions: [{ type: 'OPEN_VIDEO', videoId: 'VID-107' }],
  },
  {
    keywords: ['photo', 'camera', 'picture', 'look at'],
    text: 'Opening the camera. Take a clear photo of the area you are asking about, from about one metre away.',
    citations: [],
    actions: [{ type: 'OPEN_CAMERA' }],
  },
];

export const fallbackAnswer: CannedAnswer = {
  keywords: [],
  text:
    'I could not find that in the manuals I have for this site. Check with your supervisor before you continue if it affects safety.',
  citations: [],
  actions: [{ type: 'CONTACT_SUPERVISOR' }],
};

/** Chapter-specific guidance for paused-video questions, matched by keyword. */
const chapterTips: { match: string; tip: string; caution?: string }[] = [
  {
    match: 'isolation',
    tip: 'This step is about proving zero energy. After you lock and tag at the MCC, try the local start button. The pump must not turn. If it does, stop and tell your supervisor.',
    caution: 'Use your own lock. Never rely on someone else\'s isolation.',
  },
  {
    match: 'visual',
    tip: 'Look at the casing and both flanges for fresh wet patches, cracks or weeping bolts. Old dry staining is less of a concern than anything shiny and wet.',
  },
  {
    match: 'gland',
    tip: 'Check where the gland meets the shaft. A slow drip is normal and keeps the packing cool. A steady stream means the packing needs adjusting. That is a maintenance job, so report it; don\'t tighten it yourself.',
    caution: 'Only inspect the seal with the pump isolated and the shaft stopped.',
  },
  {
    match: 'pressure',
    tip: 'Take the discharge pressure after 5 minutes of running. For PMP-114 it should sit between 380 and 450 kPa. Record bearing temperature too; above 80 °C, or rising fast, needs reporting.',
    caution: 'Keep clear of the coupling guard while the pump is running.',
  },
  {
    match: 'restart',
    tip: 'Remove only your own lock, clear the area and restart from the local panel. Sign the inspection sheet with the pressure and temperature readings.',
  },
];

/** Answer used when the question comes with a paused-video context. */
export const videoContextAnswer = (videoTitle: string, chapter: string, time: string): CannedAnswer => {
  const hit = chapterTips.find((c) => chapter.toLowerCase().includes(c.match));
  return {
    keywords: [],
    text: `At ${time} in "${videoTitle}" you are in the "${chapter}" section.\n\n${
      hit?.tip ?? 'Follow the steps shown here in order, and check the task sheet for the site-specific values.'
    }`,
    caution: hit?.caution,
    citations: [{ source: videoTitle, locator: `${chapter} · ${time}` }],
    actions: [{ type: 'RESUME_VIDEO' }],
  };
};

/** What the mock speech engine "hears". Picked based on context. */
export const mockVoiceQuestions = {
  // "this" makes the Cat agent answer from the paused frame.
  video: 'what does this do?',
  task: 'how do I start the engine safely?',
  general: 'how do I wear the seat belt?',
};

export const mockHistory: AgentMessage[] = [
  {
    id: 'MSG-0001',
    role: 'operator',
    text: 'Where is the isolation point for conveyor CV-07?',
    createdAt: '2026-09-23T06:58:00',
    mode: 'voice',
    status: 'sent',
  },
  {
    id: 'MSG-0002',
    role: 'agent',
    text:
      'CV-07 is isolated at MCC-2, breaker 14, in the Crusher House switch room. The pull-wire on the walkway side should also be tested before you go near the belt.',
    createdAt: '2026-09-23T06:58:04',
    mode: 'voice',
    status: 'sent',
    citations: [{ source: SITE_SOP, locator: 'EI-03 Isolation Register' }],
    actions: [{ type: 'OPEN_TASK', taskId: 'TASK-002' }],
  },
];

export const mockImageAnalyses: Omit<ImageAnalysis, 'id' | 'createdAt'>[] = [
  {
    summary: 'Possible hydraulic fluid leakage is visible near the lower connection.',
    findings: [
      { label: 'Dark, wet staining below a hose fitting', severity: 'caution' },
      { label: 'Fluid pooling on the surface underneath', severity: 'caution' },
      { label: 'No visible damage to the hose outer cover', severity: 'info' },
    ],
    limitations:
      'I cannot confirm the cause from an image alone. The staining could also be old residue, or grease washed down from above.',
    recommendedAction:
      'Avoid touching the area and follow the site isolation procedure. Report it to your supervisor before the machine is used again.',
    confidence: 'medium',
  },
  {
    summary: 'The drive belt guard looks out of position.',
    findings: [
      { label: 'Guard panel appears to be missing a fastener', severity: 'caution' },
      { label: 'Belt edge visible through the gap', severity: 'critical' },
    ],
    limitations:
      'The angle of the photo makes it hard to judge the size of the gap. I cannot tell whether the pump is running.',
    recommendedAction:
      'Keep hands and tools away from the gap. Do not run the pump until the guard is secured. Tell your supervisor.',
    confidence: 'low',
  },
];

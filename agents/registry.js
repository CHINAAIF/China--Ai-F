import { instance } from './BrainMemoryAgent.js';
import { instance } from './LogInspectionAgent.js';
import { instance } from './RegistryAgent.js';
import { instance } from './TaskQueueAgent.js';
import { instance } from './VerificationAgent.js';
import { brain } from './brain.js';
import { governor } from './governance/governor.js';
import { multiModel } from './governance/multi-model.js';
import { orchestrator } from './index.js';
import { chinaSocialAgent } from './intelligence/china-social.js';

export const agentRegistry = {
  instance,
  instance,
  instance,
  instance,
  instance,
  brain,
  governor,
  multiModel,
  orchestrator,
  chinaSocialAgent,
};
export default agentRegistry;

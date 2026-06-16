import { EventEmitter } from 'events';

class AgentOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.agents = new Map();
    this.queue = [];
    this.running = false;
  }

  register(name, agent) {
    this.agents.set(name, agent);
    console.log(`✅ Agent registered: ${name}`);
  }

  async dispatch(agentName, task) {
    const agent = this.agents.get(agentName);
    if (!agent) throw new Error(`Agent not found: ${agentName}`);
    return await agent.execute(task);
  }

  getAll() {
    return Array.from(this.agents.keys());
  }
}

export const orchestrator = new AgentOrchestrator();
export default orchestrator;

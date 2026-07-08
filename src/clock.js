// The clock is an injected edge (see CLAUDE.md). Production uses the wall
// clock; tests inject a fixed one so the pipeline is deterministic.
export const systemClock = () => Date.now();

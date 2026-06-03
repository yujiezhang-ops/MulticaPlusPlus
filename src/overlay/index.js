export function buildInstructionOverlay({ workspace, agent, task }) {
  const sections = [];
  if (workspace.context) {
    sections.push(["Workspace Context", workspace.context]);
  }
  if (agent.instructions) {
    sections.push(["Agent Instructions", agent.instructions]);
  }
  if (task.prompt) {
    sections.push(["Task Prompt", task.prompt]);
  }
  if (task.triggerComment) {
    sections.push(["Trigger Comment", task.triggerComment]);
  }
  if (task.autopilotId || task.autopilotRunId || task.autopilotSource) {
    sections.push([
      "Autopilot Context",
      [
        task.autopilotId ? `autopilot_id=${task.autopilotId}` : "",
        task.autopilotRunId ? `autopilot_run_id=${task.autopilotRunId}` : "",
        task.autopilotSource ? `source=${task.autopilotSource}` : "",
      ].filter(Boolean).join("\n"),
    ]);
  }

  const diff = sections
    .flatMap(([heading, body]) => [
      `+ ${heading}`,
      ...String(body).split(/\r?\n/).map((line) => `+ ${line}`),
    ])
    .join("\n");

  return {
    reviewStatus: "pending",
    layers: sections.map(([name, content]) => ({ name, content })),
    diff,
  };
}

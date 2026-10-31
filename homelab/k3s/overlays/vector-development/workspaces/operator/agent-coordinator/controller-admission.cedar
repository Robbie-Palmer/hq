@id("admit-severe-open-dependabot-alert")
permit (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"controller.incident.admit",
  resource is AgentCoordinator::DependabotAlert
)
when {
  resource.repository == AgentCoordinator::Repository::"robbie-palmer/hq" &&
  resource.state == "open" &&
  ["high", "critical"].contains(resource.severity) &&
  context.activeIncidentCount < 1 &&
  context.routeMatchesCurrentState
};

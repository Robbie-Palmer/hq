@id("record-owned-incident")
permit (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action in [
    AgentCoordinator::Action::"work_graph.incident.write",
    AgentCoordinator::Action::"work_graph.attention.request"
  ],
  resource is AgentCoordinator::Incident
)
when {
  resource.repository == AgentCoordinator::Repository::"robbie-palmer/hq" &&
  resource.controllerOwned
};

@id("complete-verified-incident")
permit (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"work_graph.incident.complete",
  resource is AgentCoordinator::Incident
)
when {
  resource.repository == AgentCoordinator::Repository::"robbie-palmer/hq" &&
  resource.controllerOwned &&
  resource.productionValidated &&
  !resource.alertOpen
};

@id("never-complete-unverified-incident")
forbid (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"work_graph.incident.complete",
  resource is AgentCoordinator::Incident
)
unless {
  resource.controllerOwned &&
  resource.productionValidated &&
  !resource.alertOpen
};

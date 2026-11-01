@id("launch-owned-incident-worker")
permit (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"t3.worker.launch",
  resource is AgentCoordinator::Incident
)
when {
  resource.repository == AgentCoordinator::Repository::"robbie-palmer/hq" &&
  resource.controllerOwned
};

@id("watch-owned-pull-request")
permit (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"t3.pull_request.watch",
  resource is AgentCoordinator::PullRequest
)
when {
  resource.repository == AgentCoordinator::Repository::"robbie-palmer/hq" &&
  resource.ownsChange
};

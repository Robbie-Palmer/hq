@id("operate-established-production-deployment")
permit (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action in [
    AgentCoordinator::Action::"deployment.production.invoke",
    AgentCoordinator::Action::"deployment.production.validate",
    AgentCoordinator::Action::"deployment.production.repair"
  ],
  resource is AgentCoordinator::Deployment
)
when {
  resource.repository == AgentCoordinator::Repository::"robbie-palmer/hq" &&
  resource.controllerOwned &&
  resource.environment == "production" &&
  resource.establishedPath
};

@id("never-create-deployment-path")
forbid (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"deployment.path.create",
  resource
);

@id("never-invoke-unestablished-deployment")
forbid (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"deployment.production.invoke",
  resource is AgentCoordinator::Deployment
)
unless {
  resource.controllerOwned &&
  resource.environment == "production" &&
  resource.establishedPath
};

@id("create-pull-request-in-approved-repository")
permit (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"github.pull_requests.create",
  resource == AgentCoordinator::Repository::"robbie-palmer/hq"
);

@id("write-controller-owned-non-default-ref")
permit (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action in [
    AgentCoordinator::Action::"github.contents.write",
    AgentCoordinator::Action::"github.git_refs.write"
  ],
  resource is AgentCoordinator::Ref
)
when {
  resource.repository == AgentCoordinator::Repository::"robbie-palmer/hq" &&
  resource.controllerOwned &&
  !resource.isDefaultBranch
};

@id("never-write-default-or-unowned-ref")
forbid (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action in [
    AgentCoordinator::Action::"github.contents.write",
    AgentCoordinator::Action::"github.git_refs.write"
  ],
  resource is AgentCoordinator::Ref
)
unless {
  resource.controllerOwned &&
  !resource.isDefaultBranch
};

@id("update-owned-pull-request")
permit (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"github.pull_requests.review_comments.write",
  resource is AgentCoordinator::PullRequest
)
when {
  resource.repository == AgentCoordinator::Repository::"robbie-palmer/hq" &&
  resource.ownsChange
};

@id("merge-owned-pull-request-after-checks")
permit (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"github.pull_requests.merge",
  resource is AgentCoordinator::PullRequest
)
when {
  resource.repository == AgentCoordinator::Repository::"robbie-palmer/hq" &&
  resource.ownsChange &&
  resource.requiredChecksPassed &&
  resource.reviewThreadsResolved
};

@id("never-merge-without-required-state")
forbid (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action == AgentCoordinator::Action::"github.pull_requests.merge",
  resource is AgentCoordinator::PullRequest
)
unless {
  resource.ownsChange &&
  resource.requiredChecksPassed &&
  resource.reviewThreadsResolved
};

@id("never-dismiss-dependabot-alert")
forbid (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action in AgentCoordinator::Action::"github.security_alert.change",
  resource
);

@id("never-change-repository-guardrails")
forbid (
  principal in AgentCoordinator::AuthorityProfile::"authority:personal-project-unattended",
  action in AgentCoordinator::Action::"github.repository.administration",
  resource
);
